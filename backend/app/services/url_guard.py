"""SSRF 防护：校验用户提供的待抓取 URL。

只允许 http/https，且解析出的所有 IP 都必须是公网地址——拒绝私网、
环回、链路本地（含 169.254.169.254 云元数据地址）、保留地址与 0.0.0.0。
"""
import ipaddress
import socket
from urllib.parse import urlparse


class UrlNotAllowed(ValueError):
    """URL 不符合抓取安全策略。"""


def validate_fetch_url(url: str) -> str:
    """校验 URL 是否允许服务端抓取；不合法时抛出 UrlNotAllowed。"""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise UrlNotAllowed("仅允许 http/https 链接")
    host = parsed.hostname
    if not host:
        raise UrlNotAllowed("URL 缺少主机名")
    try:
        addr_infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        raise UrlNotAllowed("域名解析失败，请检查 URL")
    for info in addr_infos:
        ip = ipaddress.ip_address(info[4][0])
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
        ):
            raise UrlNotAllowed("不允许访问内网或保留地址")
    return url
