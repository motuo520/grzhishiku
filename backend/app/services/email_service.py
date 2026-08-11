"""Email integration service - IMAP import and message extraction."""
import imaplib
import logging
import email
import uuid
import json
import re
import html
from datetime import datetime
from typing import List, Optional, Dict
from email.header import decode_header
from email.utils import parsedate_to_datetime

from sqlalchemy.orm import Session

from app.core.crypto import decrypt_secret
from app.models.base import EmailAccount, EmailMessage, User

logger = logging.getLogger(__name__)


# Preset IMAP configurations for common providers
IMAP_PRESETS = {
    "gmail": {"host": "imap.gmail.com", "port": 993, "use_ssl": True},
    "outlook": {"host": "outlook.office365.com", "port": 993, "use_ssl": True},
    "qq": {"host": "imap.qq.com", "port": 993, "use_ssl": True},
    "163": {"host": "imap.163.com", "port": 993, "use_ssl": True},
    "126": {"host": "imap.126.com", "port": 993, "use_ssl": True},
    "sina": {"host": "imap.sina.com", "port": 993, "use_ssl": True},
    "sohu": {"host": "imap.sohu.com", "port": 993, "use_ssl": True},
    "yahoo": {"host": "imap.mail.yahoo.com", "port": 993, "use_ssl": True},
}


def get_imap_preset(provider: str) -> Optional[Dict]:
    return IMAP_PRESETS.get(provider.lower())


def decode_header_value(value: Optional[str]) -> str:
    """Decode RFC2047 encoded email header."""
    if not value:
        return ""
    parts = []
    for decoded, charset in decode_header(value):
        if isinstance(decoded, bytes):
            try:
                parts.append(decoded.decode(charset or "utf-8", errors="replace"))
            except Exception:
                parts.append(decoded.decode("utf-8", errors="replace"))
        else:
            parts.append(decoded)
    return "".join(parts)


def parse_email_address(addr_str: str) -> Dict[str, str]:
    """Parse 'Name <email@example.com>' into name and email."""
    addr_str = decode_header_value(addr_str)
    match = re.match(r'"?([^"<]+)"?\s*<([^>]+)>', addr_str)
    if match:
        return {"name": match.group(1).strip(), "email": match.group(2).strip()}
    return {"name": "", "email": addr_str.strip()}


def extract_body(msg: email.message.EmailMessage) -> Dict[str, Optional[str]]:
    """Extract plain text and HTML bodies from an email message."""
    text_body = None
    html_body = None

    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            content_disposition = str(part.get("Content-Disposition", ""))
            if "attachment" in content_disposition:
                continue
            try:
                payload = part.get_payload(decode=True)
                if payload is None:
                    continue
                charset = part.get_content_charset() or "utf-8"
                decoded = payload.decode(charset, errors="replace")
                if content_type == "text/plain" and text_body is None:
                    text_body = decoded
                elif content_type == "text/html" and html_body is None:
                    html_body = decoded
            except Exception:
                continue
    else:
        try:
            payload = msg.get_payload(decode=True)
            if payload:
                charset = msg.get_content_charset() or "utf-8"
                decoded = payload.decode(charset, errors="replace")
                content_type = msg.get_content_type()
                if content_type == "text/html":
                    html_body = decoded
                else:
                    text_body = decoded
        except Exception:
            pass

    return {"text": text_body, "html": html_body}


def html_to_text(html_content: str) -> str:
    """Convert HTML email body to clean plain text."""
    if not html_content:
        return ""

    # Decode HTML entities
    text = html.unescape(html_content)

    # Replace block tags with newlines
    text = re.sub(r'<br\s*/?>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'</(p|div|h[1-6]|li|tr)>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'<(p|div|h[1-6]|li|tr)[^>]*>', '', text, flags=re.IGNORECASE)

    # Strip remaining tags
    text = re.sub(r'<[^>]+>', '', text)

    # Collapse whitespace
    lines = [line.strip() for line in text.splitlines()]
    text = '\n'.join(line for line in lines if line)

    # Remove common email footer patterns
    text = re.sub(r'\n-{2,}\s*\n.*', '', text, flags=re.DOTALL)
    text = re.sub(r'\nSent from my .*', '', text, flags=re.IGNORECASE)

    return text


def extract_main_text(body_text: Optional[str], body_html: Optional[str]) -> str:
    """Get the best available plain text from email bodies."""
    if body_text and len(body_text.strip()) > 50:
        return body_text.strip()
    if body_html:
        return html_to_text(body_html).strip()
    if body_text:
        return body_text.strip()
    return ""


def connect_imap(account: EmailAccount) -> imaplib.IMAP4_SSL:
    """Connect to IMAP server using account credentials."""
    host = account.imap_host
    port = account.imap_port or 993
    use_ssl = account.imap_use_ssl if account.imap_use_ssl is not None else True

    # SSRF 防护：解析 host，拒绝环回/链路本地（含云元数据 169.254.169.254）/保留地址；
    # RFC1918 私网段仅在生产环境（云端部署）拒绝——本产品支持自托管，
    # 用户可能确有局域网邮件服务器，非生产环境放行。
    from app.core.config import settings
    from app.services.url_guard import validate_fetch_host
    validate_fetch_host(host, allow_private=settings.ENV != "production")

    # access_token stores IMAP password/app-specific code (encrypted at rest)
    password = decrypt_secret(account.access_token) or ""

    if use_ssl:
        mail = imaplib.IMAP4_SSL(host, port)
    else:
        mail = imaplib.IMAP4(host, port)

    mail.login(account.email_address, password)
    return mail


def sync_account(db: Session, account: EmailAccount, user: User, max_messages: int = 50) -> Dict:
    """
    Sync emails from an IMAP account.
    Returns summary dict with synced_count, error, etc.
    """
    account.sync_status = "syncing"
    account.last_error = None
    db.commit()

    mail = None
    synced_count = 0
    error_msg = None

    try:
        mail = connect_imap(account)
        mail.select("INBOX")

        # Search for all messages; could be limited to UNSEEN or by date later
        status, data = mail.search(None, "ALL")
        if status != "OK":
            raise Exception("IMAP search failed")

        msg_ids = data[0].split()
        # Take the most recent N messages
        msg_ids = msg_ids[-max_messages:]

        existing_uids = {
            row[0] for row in db.query(EmailMessage.message_uid).filter(
                EmailMessage.account_id == account.id
            ).all()
        }

        for msg_id in reversed(msg_ids):  # newest first
            try:
                status, msg_data = mail.fetch(msg_id, "(RFC822)")
                if status != "OK" or not msg_data or not msg_data[0]:
                    continue

                raw_email = msg_data[0][1]
                msg = email.message_from_bytes(raw_email)

                message_uid = msg.get("Message-ID", f"{account.id}-{msg_id.decode()}")
                if message_uid in existing_uids:
                    continue

                bodies = extract_body(msg)
                main_text = extract_main_text(bodies["text"], bodies["html"])
                if not main_text and not msg.get("Subject"):
                    continue

                sender = parse_email_address(msg.get("From", ""))
                to_list = [parse_email_address(a)["email"] for a in msg.get_all("To", [])]
                cc_list = [parse_email_address(a)["email"] for a in msg.get_all("Cc", [])]

                received_at = None
                date_header = msg.get("Date")
                if date_header:
                    try:
                        received_at = parsedate_to_datetime(date_header)
                    except Exception:
                        pass

                email_msg = EmailMessage(
                    id=str(uuid.uuid4()),
                    user_id=user.id,
                    account_id=account.id,
                    message_uid=message_uid,
                    subject=decode_header_value(msg.get("Subject", "")),
                    sender_name=sender["name"],
                    sender_email=sender["email"],
                    recipients_to=json.dumps(to_list, ensure_ascii=False),
                    recipients_cc=json.dumps(cc_list, ensure_ascii=False),
                    body_text=bodies["text"],
                    body_html=bodies["html"],
                    received_at=received_at,
                    is_read=False,
                    labels=json.dumps(["INBOX"], ensure_ascii=False),
                    status="active",
                )
                db.add(email_msg)
                synced_count += 1

                # Commit in batches to avoid huge transactions
                if synced_count % 10 == 0:
                    db.commit()

            except Exception as e:
                logger.warning(f"Failed to process email {msg_id}: {e}")
                continue

        db.commit()

    except Exception as e:
        error_msg = str(e)
        account.sync_status = "error"
        account.last_error = error_msg
        db.commit()
        return {"success": False, "error": error_msg, "synced_count": synced_count}

    finally:
        if mail:
            try:
                mail.close()
                mail.logout()
            except Exception:
                pass

    account.sync_status = "success"
    account.last_sync_at = datetime.now()
    account.sync_count = (account.sync_count or 0) + synced_count
    account.last_error = None
    db.commit()

    return {"success": True, "synced_count": synced_count}


def test_imap_connection(account: EmailAccount) -> bool:
    """Test if IMAP credentials work."""
    mail = None
    try:
        mail = connect_imap(account)
        return True
    except Exception:
        return False
    finally:
        if mail:
            try:
                mail.close()
                mail.logout()
            except Exception:
                pass
