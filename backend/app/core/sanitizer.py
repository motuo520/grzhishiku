import bleach
from markupsafe import escape as html_escape
from typing import Any, Dict

class DataSanitizer:
    """Sanitize sensitive data from logs and exports, and sanitize user input for XSS prevention."""
    
    PII_PATTERNS = {
        "email": re.compile(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'),
        "phone": re.compile(r'\b1[3-9]\d{9}\b'),
        "id_card": re.compile(r'\b\d{17}[\dXx]\b'),
        "ip_address": re.compile(r'\b(?:\d{1,3}\.){3}\d{1,3}\b'),
    }
    
    ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'a', 'blockquote', 'code', 'pre']
    ALLOWED_ATTRIBUTES = {
        'a': ['href', 'title'],
        'code': ['class'],
    }
    
    @classmethod
    def sanitize(cls, text: str) -> str:
        """Remove PII from text."""
        if not text:
            return text
        
        for name, pattern in cls.PII_PATTERNS.items():
            text = pattern.sub(f'[{name}_REDACTED]', text)
        
        return text
    
    @classmethod
    def sanitize_html(cls, text: str) -> str:
        """Clean user-submitted HTML to prevent XSS."""
        if not text:
            return text
        return bleach.clean(text, tags=cls.ALLOWED_TAGS, attributes=cls.ALLOWED_ATTRIBUTES, strip=True)
    
    @classmethod
    def escape_text(cls, text: str) -> str:
        """Escape plain text for safe storage."""
        if not text:
            return text
        return html_escape(text)
    
    @classmethod
    def sanitize_dict(cls, data: Dict[str, Any]) -> Dict[str, Any]:
        """Recursively sanitize all string values in a dict."""
        result = {}
        for key, value in data.items():
            if key in ("password", "password_hash", "mfa_secret", "token"):
                result[key] = "[REDACTED]"
            elif isinstance(value, str):
                result[key] = cls.sanitize(value)
            elif isinstance(value, dict):
                result[key] = cls.sanitize_dict(value)
            elif isinstance(value, list):
                result[key] = [
                    cls.sanitize_dict(item) if isinstance(item, dict) else 
                    cls.sanitize(item) if isinstance(item, str) else item
                    for item in value
                ]
            else:
                result[key] = value
        return result
