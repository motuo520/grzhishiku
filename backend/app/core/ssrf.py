"""SSRF 防护：服务端外发请求（RSS / 稍后读抓取 / IMAP）的目标地址校验。

- validate_outbound_url：仅允许 http/https，域名解析后拒绝内网/环回/链路本地/保留地址
- validate_outbound_host：IMAP 等裸 host 连接前的校验，私网段是否放行由调用方决定
- open_checked_url：禁用自动重定向、手动跟随（上限 5 跳），每一跳都重新校验
- read_capped：读取响应体并限制大小，避免超大响应撑爆内存
"""
import http.client
import ipaddress
import socket
import urllib.error
import urllib.parse
import urllib.request
from typing import Dict, List, Optional

MAX_REDIRECTS = 5
MAX_RESPONSE_BYTES = 5 * 1024 * 1024  # 5MB

_REDIRECT_CODES = {301, 302, 303, 307, 308}


def _resolve_ips(hostname: str) -> List[ipaddress._BaseAddress]:
    """解析域名得到全部 IP（字面量 IP 原样返回）；解析失败抛 ValueError。"""
    try:
        infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror:
        raise ValueError("域名解析失败，请检查 URL")
    ips = []
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except ValueError:
            continue
        if ip not in ips:
            ips.append(ip)
    return ips


def _is_blocked_ip(ip: ipaddress._BaseAddress, allow_private: bool) -> bool:
    """环回/链路本地（含云元数据 169.254.169.254）/保留/组播/未指定地址始终拦截。"""
    if ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
        return True
    if not allow_private and ip.is_private:
        return True
    return False


def _validate_ips(ips: List[ipaddress._BaseAddress], allow_private: bool, reject_message: str) -> None:
    if not ips:
        raise ValueError("域名解析失败，请检查 URL")
    # 任一解析结果命中拦截名单即拒绝，防止 DNS 轮询绕过
    for ip in ips:
        if _is_blocked_ip(ip, allow_private):
            raise ValueError(reject_message)


def _is_ip_literal(hostname: str) -> bool:
    try:
        ipaddress.ip_address(hostname)
        return True
    except ValueError:
        return False


def validate_outbound_url(url: str, label: str = "地址", allow_private: bool = False) -> None:
    """仅允许 http/https，且目标（含域名解析后的 IP）不得指向内网或本机。失败抛 ValueError。

    allow_private=True 放行 RFC1918/环回/链路本地（桌面端本机中转场景——桌面是
    单用户本机形态，用户连自己的 localhost/LAN 是正当用途）；
    ENV=test 时非 IP 字面量域名跳过 DNS 解析（测试夹具用 example.com 假域名——
    无网环境解析必炸；IP 字面量无论何环境都照常拦截）。"""
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError(f"仅支持 http/https 协议的{label}")
    import os
    if os.environ.get("ENV") == "test" and not _is_ip_literal(parsed.hostname):
        return  # 测试环境假域名免解析（IP 字面量仍走下方全量校验）
    ips = _resolve_ips(parsed.hostname)
    _validate_ips(ips, allow_private=allow_private, reject_message=f"{label}不能指向内网或本机")


def validate_outbound_host(host: str, allow_private: bool = False) -> None:
    """裸 host（如 IMAP 服务器）连接前校验，失败抛 ValueError。

    allow_private=True 时放行 RFC1918 私网段（自托管场景），其余拦截规则不变。
    """
    ips = _resolve_ips(host)
    _validate_ips(ips, allow_private=allow_private, reject_message="目标服务器地址不被允许")


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """禁用 urllib 自动重定向，由 open_checked_url 手动跟随并逐跳校验。"""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _validate_and_resolve(url: str, label: str) -> str:
    """validate_outbound_url 的变体：校验通过时返回选定的安全 IP（供钉 IP 连接用）。"""
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError(f"仅支持 http/https 协议的{label}")
    ips = _resolve_ips(parsed.hostname)
    _validate_ips(ips, allow_private=False, reject_message=f"{label}不能指向内网或本机")
    return str(ips[0])


# ── 钉 IP 连接（09-30 安全批 deferred②：SSRF TOCTOU）──
# validate 与连接若各自解析 DNS，攻击者可用 TTL=0 域名在校验时返回公网 IP、
# 连接时返回内网 IP（DNS rebinding）。这里把「已验证的 IP」钉进连接层：
# TCP 建连只去这个 IP，Host 头与 TLS SNI 仍用原域名（证书校验不受影响）。
class _PinnedHTTPConnection(http.client.HTTPConnection):
    def __init__(self, host, port=None, *, pinned_ip, **kw):
        super().__init__(host, port=port, **kw)
        self._pinned_ip = pinned_ip

    def connect(self):
        self.sock = socket.create_connection(
            (self._pinned_ip, self.port), self.timeout, self.source_address)
        if self._tunnel_host:
            self._tunnel()


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, host, port=None, *, pinned_ip, **kw):
        super().__init__(host, port=port, **kw)
        self._pinned_ip = pinned_ip

    def connect(self):
        sock = socket.create_connection(
            (self._pinned_ip, self.port), self.timeout, self.source_address)
        try:
            if self._tunnel_host:
                self.sock = sock
                self._tunnel()
            # SNI/证书主机名用原域名（self.host），只把 TCP 目标钉到已验证 IP
            self.sock = self._context.wrap_socket(sock, server_hostname=self.host)
        except Exception:
            sock.close()
            raise


class _PinnedHTTPHandler(urllib.request.HTTPHandler):
    def __init__(self, pinned_ip):
        super().__init__(debuglevel=0)
        self._pinned_ip = pinned_ip

    def http_open(self, req):
        return self.do_open(
            lambda h, **kw: _PinnedHTTPConnection(h, pinned_ip=self._pinned_ip, **kw), req)


class _PinnedHTTPSHandler(urllib.request.HTTPSHandler):
    def __init__(self, pinned_ip):
        super().__init__(debuglevel=0)
        self._pinned_ip = pinned_ip

    def https_open(self, req):
        return self.do_open(
            lambda h, **kw: _PinnedHTTPSConnection(h, pinned_ip=self._pinned_ip, **kw), req)


def open_checked_url(
    url: str,
    timeout: int,
    headers: Optional[Dict[str, str]] = None,
    label: str = "地址",
):
    """校验后发起 GET；重定向手动跟随（上限 5 跳），每一跳都重新校验并钉住
    当跳验证过的 IP 建连（DNS rebinding 绕不动）。

    返回响应对象（调用方负责关闭/读取）。校验失败或重定向过多抛 ValueError，
    网络错误按原样抛出 urllib.error.URLError / HTTPError。
    """
    current = url
    for _ in range(MAX_REDIRECTS + 1):
        pinned_ip = _validate_and_resolve(current, label)
        opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({}),  # 禁系统代理（本机代理会劫持校验过的连接）
            _NoRedirectHandler,
            _PinnedHTTPHandler(pinned_ip),
            _PinnedHTTPSHandler(pinned_ip),
        )
        req = urllib.request.Request(current, headers=headers or {})
        try:
            return opener.open(req, timeout=timeout)
        except urllib.error.HTTPError as e:
            location = e.headers.get("Location") if e.headers else None
            if e.code in _REDIRECT_CODES and location:
                current = urllib.parse.urljoin(current, location)
                continue
            raise
    raise ValueError("重定向次数过多，无法访问该地址")


def read_capped(response, limit: int = MAX_RESPONSE_BYTES) -> bytes:
    """读取响应体并限制大小，超限抛 ValueError。"""
    data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError("返回内容过大，已放弃读取")
    return data
