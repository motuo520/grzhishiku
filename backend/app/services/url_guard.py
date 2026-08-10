"""SSRF 防护：校验用户提供的待抓取 URL / 外联主机。

只允许 http/https，且解析出的所有 IP 都必须是公网地址——拒绝私网、
环回、链路本地（含 169.254.169.254 云元数据地址）、保留地址与 0.0.0.0。
open_checked_url 手动跟随重定向（上限 5 跳）并逐跳重新校验；
read_capped 限制响应体大小，避免超大响应撑爆内存。
"""
import ipaddress
import socket
import urllib.error
import urllib.parse
import urllib.request
from typing import Dict, List, Optional
from urllib.parse import urlparse

MAX_REDIRECTS = 5
MAX_RESPONSE_BYTES = 5 * 1024 * 1024  # 5MB

_REDIRECT_CODES = {301, 302, 303, 307, 308}


class UrlNotAllowed(ValueError):
    """URL 不符合抓取安全策略。"""


def _resolve_ips(host: str) -> List[ipaddress.IPv4Address]:
    try:
        addr_infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        raise UrlNotAllowed("域名解析失败，请检查 URL")
    return [ipaddress.ip_address(info[4][0]) for info in addr_infos]


def _check_ips(ips, allow_private: bool, reject_message: str) -> None:
    if not ips:
        raise UrlNotAllowed("域名解析失败，请检查 URL")
    # 任一解析结果命中拦截名单即拒绝，防止 DNS 轮询绕过
    for ip in ips:
        if (
            ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
            or (not allow_private and ip.is_private)
        ):
            raise UrlNotAllowed(reject_message)


def validate_fetch_url(url: str) -> str:
    """校验 URL 是否允许服务端抓取；不合法时抛出 UrlNotAllowed。"""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise UrlNotAllowed("仅允许 http/https 链接")
    host = parsed.hostname
    if not host:
        raise UrlNotAllowed("URL 缺少主机名")
    _check_ips(_resolve_ips(host), allow_private=False, reject_message="不允许访问内网或保留地址")
    return url


def validate_fetch_host(host: str, allow_private: bool = False) -> str:
    """裸 host（如 IMAP 服务器）连接前校验；不合法时抛出 UrlNotAllowed。

    allow_private=True 时放行 RFC1918 私网段（自托管场景，用户可能确有
    局域网邮件服务器），其余拦截规则不变。
    """
    _check_ips(_resolve_ips(host), allow_private=allow_private, reject_message="目标服务器地址不被允许")
    return host


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """禁用 urllib 自动重定向，由 open_checked_url 手动跟随并逐跳校验。"""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def open_checked_url(
    url: str,
    timeout: int,
    headers: Optional[Dict[str, str]] = None,
):
    """校验后发起 GET；重定向手动跟随（上限 5 跳），每一跳都重新过 validate_fetch_url。

    返回响应对象（调用方负责关闭/读取）。校验失败或重定向过多抛 UrlNotAllowed，
    网络错误按原样抛出 urllib.error.URLError / HTTPError。
    """
    opener = urllib.request.build_opener(_NoRedirectHandler)
    current = url
    for _ in range(MAX_REDIRECTS + 1):
        validate_fetch_url(current)
        req = urllib.request.Request(current, headers=headers or {})
        try:
            return opener.open(req, timeout=timeout)
        except urllib.error.HTTPError as e:
            location = e.headers.get("Location") if e.headers else None
            if e.code in _REDIRECT_CODES and location:
                current = urllib.parse.urljoin(current, location)
                continue
            raise
    raise UrlNotAllowed("重定向次数过多，无法访问该地址")


def read_capped(response, limit: int = MAX_RESPONSE_BYTES) -> bytes:
    """读取响应体并限制大小，超限抛 UrlNotAllowed。"""
    data = response.read(limit + 1)
    if len(data) > limit:
        raise UrlNotAllowed("返回内容过大，已放弃读取")
    return data
