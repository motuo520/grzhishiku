from abc import ABC, abstractmethod
from datetime import datetime
from typing import List, Optional, Dict, Any


class SocialMessageDict(Dict[str, Any]):
    """Typed dict-like structure for parsed social messages."""
    pass


class BaseSocialParser(ABC):
    """Base class for social platform chat record parsers."""

    platform: str = ""

    @abstractmethod
    def parse(self, file_path: str, account_id: str, user_id: str) -> List[SocialMessageDict]:
        """
        Parse the given file and return a list of normalized message dicts.
        Each dict should contain keys compatible with SocialMessage model.
        """
        pass

    def _normalize_message(
        self,
        account_id: str,
        user_id: str,
        message_uid: str,
        sender_name: Optional[str],
        sender_id: Optional[str],
        content_text: str,
        content_raw: Optional[str] = None,
        sent_at: Optional[datetime] = None,
        conversation_id: Optional[str] = None,
        conversation_name: Optional[str] = None,
        message_type: str = "text",
        attachments: Optional[List[Dict[str, Any]]] = None,
        is_me: bool = False,
    ) -> SocialMessageDict:
        return {
            "account_id": account_id,
            "user_id": user_id,
            "platform": self.platform,
            "message_uid": message_uid,
            "sender_name": sender_name,
            "sender_id": sender_id,
            "content_text": content_text.strip() if content_text else "",
            "content_raw": content_raw or content_text,
            "sent_at": sent_at,
            "conversation_id": conversation_id,
            "conversation_name": conversation_name,
            "message_type": message_type,
            "attachments": attachments or [],
            "is_me": is_me,
        }

    def _clean_html_text(self, html_content: str) -> str:
        """Basic HTML tag stripping and whitespace collapse."""
        import re
        text = re.sub(r'<br\s*/?>', '\n', html_content, flags=re.IGNORECASE)
        text = re.sub(r'</(p|div|h[1-6]|li|tr)>', '\n', text, flags=re.IGNORECASE)
        text = re.sub(r'<[^>]+>', '', text)
        text = re.sub(r'\s+', ' ', text)
        return text.strip()
