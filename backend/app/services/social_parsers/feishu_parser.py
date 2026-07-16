import os
import re
import csv
import json
from datetime import datetime
from typing import List, Optional, Any, Dict
from .base import BaseSocialParser, SocialMessageDict


class FeiShuParser(BaseSocialParser):
    platform = "feishu"

    def parse(self, file_path: str, account_id: str, user_id: str) -> List[SocialMessageDict]:
        ext = os.path.splitext(file_path)[1].lower()
        if ext == ".json":
            return self._parse_json(file_path, account_id, user_id)
        if ext == ".csv":
            return self._parse_csv(file_path, account_id, user_id)
        if ext in (".html", ".htm"):
            return self._parse_html(file_path, account_id, user_id)
        if ext == ".txt":
            return self._parse_text(file_path, account_id, user_id)
        return self._parse_text(file_path, account_id, user_id)

    def _parse_json(self, file_path: str, account_id: str, user_id: str) -> List[SocialMessageDict]:
        messages = []
        conversation_name = self._infer_conversation_name(file_path)
        with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
            try:
                data = json.load(f)
            except json.JSONDecodeError:
                return []
        if isinstance(data, dict):
            # Try common keys
            items = data.get('messages') or data.get('data') or data.get('records') or []
        elif isinstance(data, list):
            items = data
        else:
            items = []
        for i, item in enumerate(items):
            if not isinstance(item, dict):
                continue
            msg = self._item_to_message(item, account_id, user_id, i, conversation_name)
            if msg:
                messages.append(msg)
        return messages

    def _parse_csv(self, file_path: str, account_id: str, user_id: str) -> List[SocialMessageDict]:
        messages = []
        conversation_name = self._infer_conversation_name(file_path)
        with open(file_path, 'r', encoding='utf-8-sig', errors='replace') as f:
            reader = csv.DictReader(f)
            for i, row in enumerate(reader):
                time_str = row.get('时间') or row.get('Time') or row.get('time') or row.get('Date') or row.get('date') or ''
                sender = row.get('发送者') or row.get('用户') or row.get('Name') or row.get('name') or row.get('Sender') or row.get('sender') or '未知'
                content = row.get('内容') or row.get('消息') or row.get('Message') or row.get('message') or row.get('Content') or row.get('content') or ''
                if not content.strip():
                    continue
                messages.append(self._normalize_message(
                    account_id=account_id,
                    user_id=user_id,
                    message_uid=f"{account_id}-{i}-{hash(content) & 0xFFFFFFFF}",
                    sender_name=sender.strip() or None,
                    sender_id=None,
                    content_text=content,
                    content_raw=content,
                    sent_at=self._parse_datetime(time_str),
                    conversation_id=conversation_name,
                    conversation_name=conversation_name,
                    message_type=self._detect_type(content),
                ))
        return messages

    def _parse_html(self, file_path: str, account_id: str, user_id: str) -> List[SocialMessageDict]:
        messages = []
        conversation_name = self._infer_conversation_name(file_path)
        with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
            html = f.read()
        text = self._clean_html_text(html)
        lines = [l.strip() for l in text.split('\n') if l.strip()]
        idx = 0
        i = 0
        while i < len(lines):
            line = lines[i]
            # Feishu HTML often uses: 2023-01-15 14:32:00 张三
            match = re.match(r"^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?)\s+([^\n]+)$", line)
            if match and i + 1 < len(lines):
                time_str = match.group(1)
                sender = match.group(3).strip()
                content = lines[i + 1]
                i += 2
                if not content.strip():
                    continue
                messages.append(self._normalize_message(
                    account_id=account_id,
                    user_id=user_id,
                    message_uid=f"{account_id}-{idx}-{hash(content) & 0xFFFFFFFF}",
                    sender_name=sender or None,
                    sender_id=None,
                    content_text=content,
                    content_raw=content,
                    sent_at=self._parse_datetime(time_str),
                    conversation_id=conversation_name,
                    conversation_name=conversation_name,
                    message_type=self._detect_type(content),
                ))
                idx += 1
            else:
                i += 1
        return messages

    def _parse_text(self, file_path: str, account_id: str, user_id: str) -> List[SocialMessageDict]:
        messages = []
        conversation_name = self._infer_conversation_name(file_path)
        with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
            lines = [l.strip() for l in f.readlines() if l.strip()]
        idx = 0
        i = 0
        while i < len(lines):
            line = lines[i]
            match = re.match(r"^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?)\s+([^\n]+)$", line)
            if match and i + 1 < len(lines):
                time_str = match.group(1)
                sender = match.group(3).strip()
                content = lines[i + 1]
                i += 2
                if not content.strip():
                    continue
                messages.append(self._normalize_message(
                    account_id=account_id,
                    user_id=user_id,
                    message_uid=f"{account_id}-{idx}-{hash(content) & 0xFFFFFFFF}",
                    sender_name=sender or None,
                    sender_id=None,
                    content_text=content,
                    content_raw=content,
                    sent_at=self._parse_datetime(time_str),
                    conversation_id=conversation_name,
                    conversation_name=conversation_name,
                    message_type=self._detect_type(content),
                ))
                idx += 1
            else:
                i += 1
        return messages

    def _item_to_message(self, item: Dict[str, Any], account_id: str, user_id: str, index: int, conversation_name: Optional[str]) -> Optional[SocialMessageDict]:
        content = item.get('content') or item.get('text') or item.get('message') or item.get('body') or ''
        if not content or not str(content).strip():
            return None
        sender = item.get('sender_name') or item.get('user_name') or item.get('from') or item.get('sender') or '未知'
        sender_id = item.get('sender_id') or item.get('user_id') or item.get('open_id') or item.get('open_chat_id')
        time_str = item.get('sent_at') or item.get('create_time') or item.get('timestamp') or item.get('time') or ''
        conversation_id = item.get('chat_id') or item.get('conversation_id') or conversation_name
        msg_type = item.get('msg_type') or item.get('message_type') or 'text'
        return self._normalize_message(
            account_id=account_id,
            user_id=user_id,
            message_uid=item.get('message_id') or f"{account_id}-{index}-{hash(content) & 0xFFFFFFFF}",
            sender_name=str(sender).strip() or None,
            sender_id=str(sender_id) if sender_id else None,
            content_text=str(content),
            content_raw=json.dumps(item, ensure_ascii=False),
            sent_at=self._parse_datetime(str(time_str)) if time_str else None,
            conversation_id=conversation_id,
            conversation_name=conversation_name,
            message_type=self._map_msg_type(msg_type),
        )

    def _map_msg_type(self, msg_type: Any) -> str:
        if not msg_type:
            return "text"
        t = str(msg_type).lower()
        if t in ("image", "img"):
            return "image"
        if t in ("file", "media"):
            return "file"
        if t in ("link", "url", "card"):
            return "link"
        if t in ("system", "event", "notification"):
            return "system"
        return "text"

    def _parse_datetime(self, value: str) -> Optional[datetime]:
        value = value.strip()
        if not value:
            return None
        # Try timestamp integer (seconds or milliseconds)
        if value.isdigit():
            ts = int(value)
            if ts > 1_000_000_000_000:
                ts = ts // 1000
            return datetime.fromtimestamp(ts)
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
        return "text"

    def _infer_conversation_name(self, file_path: str) -> Optional[str]:
        base = os.path.splitext(os.path.basename(file_path))[0]
        return base if base else None
