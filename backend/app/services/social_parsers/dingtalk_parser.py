import os
import re
import csv
from datetime import datetime
from typing import List, Optional
from .base import BaseSocialParser, SocialMessageDict


class DingTalkParser(BaseSocialParser):
    platform = "dingtalk"

    # Patterns observed in DingTalk chat exports:
    # 张三 2023-01-15 14:32:00
    # hello
    # or
    # 2023-01-15 14:32:00 张三
    # hello
    HEADER_PATTERNS = [
        re.compile(r"^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?)\s+([^\n]+)$"),
        re.compile(r"^([^\n]+?)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?)$"),
    ]

    def parse(self, file_path: str, account_id: str, user_id: str) -> List[SocialMessageDict]:
        ext = os.path.splitext(file_path)[1].lower()
        if ext == ".csv":
            return self._parse_csv(file_path, account_id, user_id)
        if ext in (".html", ".htm"):
            return self._parse_html(file_path, account_id, user_id)
        if ext == ".txt":
            return self._parse_text(file_path, account_id, user_id)
        return self._parse_text(file_path, account_id, user_id)

    def _parse_csv(self, file_path: str, account_id: str, user_id: str) -> List[SocialMessageDict]:
        messages = []
        conversation_name = self._infer_conversation_name(file_path)
        with open(file_path, 'r', encoding='utf-8-sig', errors='replace') as f:
            reader = csv.DictReader(f)
            for i, row in enumerate(reader):
                time_str = row.get('时间') or row.get('Time') or row.get('time') or row.get('Date') or row.get('date') or ''
                sender = row.get('发送者') or row.get('Name') or row.get('name') or row.get('Sender') or row.get('sender') or '未知'
                content = row.get('内容') or row.get('Message') or row.get('message') or row.get('Content') or row.get('content') or ''
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
            header_match = None
            for pattern in self.HEADER_PATTERNS:
                m = pattern.match(line)
                if m:
                    header_match = m
                    break
            if header_match and i + 1 < len(lines):
                groups = header_match.groups()
                # Identify which group is time and which is sender
                time_str = groups[0] if self._looks_like_datetime(groups[0]) else groups[-1]
                sender = groups[-1] if self._looks_like_datetime(groups[0]) else groups[0]
                content = lines[i + 1]
                i += 2
                if not content.strip():
                    continue
                messages.append(self._normalize_message(
                    account_id=account_id,
                    user_id=user_id,
                    message_uid=f"{account_id}-{idx}-{hash(content) & 0xFFFFFFFF}",
                    sender_name=sender.strip() or None,
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
            header_match = None
            for pattern in self.HEADER_PATTERNS:
                m = pattern.match(line)
                if m:
                    header_match = m
                    break
            if header_match and i + 1 < len(lines):
                groups = header_match.groups()
                time_str = groups[0] if self._looks_like_datetime(groups[0]) else groups[-1]
                sender = groups[-1] if self._looks_like_datetime(groups[0]) else groups[0]
                content = lines[i + 1]
                i += 2
                if not content.strip():
                    continue
                messages.append(self._normalize_message(
                    account_id=account_id,
                    user_id=user_id,
                    message_uid=f"{account_id}-{idx}-{hash(content) & 0xFFFFFFFF}",
                    sender_name=sender.strip() or None,
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

    def _looks_like_datetime(self, value: str) -> bool:
        return bool(re.match(r"\d{4}[-/]\d{2}[-/]\d{2}", value.strip()))

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
        if "[图片]" in content or "[图片]" in content:
            return "image"
        if "[文件]" in content or "[文件]" in content:
            return "file"
        return "text"

    def _infer_conversation_name(self, file_path: str) -> Optional[str]:
        base = os.path.splitext(os.path.basename(file_path))[0]
        return base if base else None
