import os
import re
import csv
import json
import zipfile
from datetime import datetime
from typing import List, Optional
from .base import BaseSocialParser, SocialMessageDict


class WeChatParser(BaseSocialParser):
    platform = "wechat"

    # Common WeChat export patterns
    # 2023-01-15 14:32 张三: hello
    # 2023/01/15 14:32:00 张三 说: hello
    # [2023-01-15 14:32:00] 张三: hello
    PATTERNS = [
        re.compile(r"^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?)\s+([^:]+):(.*)$"),
        re.compile(r"^\[(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?)\]\s+([^:]+):(.*)$"),
        re.compile(r"^(\d{4}/\d{2}/\d{2}\s+\d{2}:\d{2}(:\d{2})?)\s+([^:]+?)\s+(说|say)?[:：](.*)$"),
    ]

    def parse(self, file_path: str, account_id: str, user_id: str) -> List[SocialMessageDict]:
        ext = os.path.splitext(file_path)[1].lower()
        if ext == ".zip":
            return self._parse_zip(file_path, account_id, user_id)
        if ext == ".csv":
            return self._parse_csv(file_path, account_id, user_id)
        if ext in (".html", ".htm"):
            return self._parse_html(file_path, account_id, user_id)
        if ext == ".txt":
            return self._parse_text(file_path, account_id, user_id)
        # Unsupported extension; try text fallback
        return self._parse_text(file_path, account_id, user_id)

    def _parse_zip(self, file_path: str, account_id: str, user_id: str) -> List[SocialMessageDict]:
        messages = []
        temp_dir = os.path.join(os.path.dirname(file_path), f"_wechat_extract_{datetime.now().strftime('%Y%m%d%H%M%S')}")
        os.makedirs(temp_dir, exist_ok=True)
        with zipfile.ZipFile(file_path, 'r') as zf:
            for name in zf.namelist():
                # 防 zip 路径穿越：拒绝绝对路径和含 .. 的条目
                normalized = os.path.normpath(name)
                if (name.startswith(("/", "\\")) or os.path.isabs(name)
                        or normalized.startswith("..") or os.path.isabs(normalized)):
                    continue
                if name.lower().endswith(('.txt', '.csv', '.html', '.htm')):
                    zf.extract(name, temp_dir)
                    src = os.path.join(temp_dir, name)
                    messages.extend(self.parse(src, account_id, user_id))
        return messages

    def _parse_csv(self, file_path: str, account_id: str, user_id: str) -> List[SocialMessageDict]:
        messages = []
        conversation_name = self._infer_conversation_name(file_path)
        with open(file_path, 'r', encoding='utf-8-sig', errors='replace') as f:
            reader = csv.DictReader(f)
            for i, row in enumerate(reader):
                time_str = row.get('Time') or row.get('time') or row.get('Date') or row.get('date') or ''
                sender = row.get('Name') or row.get('name') or row.get('Sender') or row.get('sender') or '未知'
                content = row.get('Message') or row.get('message') or row.get('Content') or row.get('content') or ''
                if not content.strip():
                    continue
                sent_at = self._parse_datetime(time_str)
                messages.append(self._normalize_message(
                    account_id=account_id,
                    user_id=user_id,
                    message_uid=f"{account_id}-{i}-{hash(content) & 0xFFFFFFFF}",
                    sender_name=sender.strip() or None,
                    sender_id=None,
                    content_text=content,
                    content_raw=content,
                    sent_at=sent_at,
                    conversation_id=conversation_name,
                    conversation_name=conversation_name,
                    message_type=self._detect_type(content),
                ))
        return messages

    def _parse_html(self, file_path: str, account_id: str, user_id: str) -> List[SocialMessageDict]:
        from html.parser import HTMLParser
        messages = []
        conversation_name = self._infer_conversation_name(file_path)
        with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
            html = f.read()
        text = self._clean_html_text(html)
        return self._parse_lines(text.split('\n'), account_id, user_id, conversation_name)

    def _parse_text(self, file_path: str, account_id: str, user_id: str) -> List[SocialMessageDict]:
        conversation_name = self._infer_conversation_name(file_path)
        with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
            lines = f.read().split('\n')
        return self._parse_lines(lines, account_id, user_id, conversation_name)

    def _parse_lines(self, lines: List[str], account_id: str, user_id: str, conversation_name: Optional[str]) -> List[SocialMessageDict]:
        messages = []
        idx = 0
        for line in lines:
            line = line.strip()
            if not line:
                continue
            for pattern in self.PATTERNS:
                match = pattern.match(line)
                if match:
                    groups = match.groups()
                    time_str = groups[0]
                    sender = groups[-2].strip() if len(groups) >= 3 else "未知"
                    content = groups[-1].strip()
                    if not content:
                        break
                    sent_at = self._parse_datetime(time_str)
                    messages.append(self._normalize_message(
                        account_id=account_id,
                        user_id=user_id,
                        message_uid=f"{account_id}-{idx}-{hash(line) & 0xFFFFFFFF}",
                        sender_name=sender,
                        sender_id=None,
                        content_text=content,
                        content_raw=line,
                        sent_at=sent_at,
                        conversation_id=conversation_name,
                        conversation_name=conversation_name,
                        message_type=self._detect_type(content),
                    ))
                    idx += 1
                    break
        return messages

    def _parse_datetime(self, value: str) -> Optional[datetime]:
        value = value.strip()
        if not value:
            return None
        formats = [
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%d %H:%M",
            "%Y/%m/%d %H:%M:%S",
            "%Y/%m/%d %H:%M",
        ]
        for fmt in formats:
            try:
                return datetime.strptime(value, fmt)
            except ValueError:
                continue
        return None

    def _detect_type(self, content: str) -> str:
        if not content:
            return "text"
        if content.startswith(("http://", "https://")):
            return "link"
        if content.startswith("[") and ("图片" in content or "image" in content.lower()):
            return "image"
        if content.startswith("[") and ("文件" in content or "file" in content.lower()):
            return "file"
        return "text"

    def _infer_conversation_name(self, file_path: str) -> Optional[str]:
        base = os.path.splitext(os.path.basename(file_path))[0]
        return base if base else None
