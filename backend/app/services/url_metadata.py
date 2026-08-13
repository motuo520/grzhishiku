import logging
import urllib.error
import re
from typing import Optional
from pydantic import BaseModel

from app.services.url_guard import validate_fetch_url, UrlNotAllowed, open_checked_url, read_capped

logger = logging.getLogger(__name__)


class UrlMetadata(BaseModel):
    url: str
    title: str
    domain: str
    excerpt: Optional[str] = None
    cover_image: Optional[str] = None
    error: Optional[str] = None


def extract_domain(url: str) -> str:
    try:
        from urllib.parse import urlparse
        parsed = urlparse(url)
        domain = parsed.netloc
        if domain.startswith("www."):
            domain = domain[4:]
        return domain or url
    except Exception:
        return url


def fetch_url_metadata(url: str, timeout: int = 8) -> UrlMetadata:
    try:
        validate_fetch_url(url)
    except UrlNotAllowed as e:
        return UrlMetadata(url=url, title=url, domain=extract_domain(url), error=str(e))
    try:
        # SSRF 防护：重定向逐跳校验，响应体限 5MB
        with open_checked_url(
            url,
            timeout=timeout,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            },
        ) as response:
            html = read_capped(response).decode("utf-8", errors="ignore")
        
        title_match = re.search(r"<title[^>]*>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
        title = title_match.group(1).strip() if title_match else url
        title = re.sub(r"\s+", " ", title)
        
        desc_match = (
            re.search(r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)["\']', html, re.IGNORECASE)
            or re.search(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+name=["\']description["\']', html, re.IGNORECASE)
            or re.search(r'<meta[^>]+property=["\']og:description["\'][^>]+content=["\']([^"\']+)["\']', html, re.IGNORECASE)
        )
        excerpt = desc_match.group(1).strip() if desc_match else None
        if excerpt:
            excerpt = re.sub(r"\s+", " ", excerpt)
        
        image_match = re.search(r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']', html, re.IGNORECASE)
        cover_image = image_match.group(1).strip() if image_match else None
        
        return UrlMetadata(
            url=url,
            title=title,
            domain=extract_domain(url),
            excerpt=excerpt,
            cover_image=cover_image,
        )
    except urllib.error.HTTPError as e:
        return UrlMetadata(url=url, title=url, domain=extract_domain(url), error=f"HTTP {e.code}")
    except urllib.error.URLError as e:
        # reason 原文可能含内网地址等细节，只进日志；对外固定文案
        logger.info("URL metadata fetch failed url=%s reason=%s", url, e.reason)
        return UrlMetadata(url=url, title=url, domain=extract_domain(url), error="无法访问该地址")
    except ValueError as e:
        # core.ssrf 的校验提示本身是对外口径（如"地址不能指向内网或本机"），可直接透出
        return UrlMetadata(url=url, title=url, domain=extract_domain(url), error=str(e))
    except Exception as e:
        logger.warning("URL metadata fetch unexpected error url=%s: %s", url, e)
        return UrlMetadata(url=url, title=url, domain=extract_domain(url), error="获取失败，请稍后重试")
