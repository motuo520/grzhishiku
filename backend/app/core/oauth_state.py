"""OAuth state 参数签名：防止 CSRF 把攻击者的第三方账号绑到受害者账户。

背景：网盘 OAuth 回调身份原先直接取 state 当 user_id，攻击者可以构造
回调链接（自己的授权 code + 受害者 user_id）让受害者把自己的备份
上传到攻击者的网盘。

格式：base64url(payload.timestamp).hmac_sha256_truncated，默认 10 分钟有效。

已知取舍：一次性消费记录（_USED_STATES）是进程内内存，不跨 worker 共享——
多 worker 部署下同一 state 打到不同进程仍存在重放窗口。当前保持单机口径
不上 Redis；多副本部署时应把 state 消费移到共享存储或加网关黏性。
"""
import base64
import hashlib
import hmac
import threading
import time
from typing import Optional

from app.core.config import settings

_DEFAULT_MAX_AGE = 600  # 秒
_USED_STATES = {}
_USED_STATES_LOCK = threading.Lock()


def _consume_state(state: str, expires_at: float) -> bool:
    """一次性消费 state：重复使用（10 分钟内重放）返回 False。"""
    now = time.time()
    with _USED_STATES_LOCK:
        # 每次消费顺手清掉过期项：state 有效期短、调用频率低，全量扫一遍很廉价，
        # 避免等表涨过阈值才清理导致内存随攻击流量膨胀
        for key, item_expires_at in list(_USED_STATES.items()):
            if item_expires_at <= now:
                _USED_STATES.pop(key, None)
        if state in _USED_STATES and _USED_STATES[state] > now:
            return False
        _USED_STATES[state] = expires_at
        return True


def _b64e(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode("ascii")


def _b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _sig(body: str) -> str:
    return hmac.new(settings.SECRET_KEY.encode("utf-8"), body.encode("utf-8"), hashlib.sha256).hexdigest()[:32]


def sign_state(payload: str) -> str:
    body = f"{payload}.{int(time.time())}"
    return f"{_b64e(body.encode('utf-8'))}.{_sig(body)}"


def verify_state(state: str, max_age: int = _DEFAULT_MAX_AGE) -> Optional[str]:
    """验签并校验时效；通过返回 payload，任何异常返回 None。"""
    try:
        body_b64, sig = state.rsplit(".", 1)
        body = _b64d(body_b64).decode("utf-8")
        payload, ts_s = body.rsplit(".", 1)
        ts = int(ts_s)
    except Exception:
        return None
    if not hmac.compare_digest(_sig(body), sig):
        return None
    if time.time() - ts > max_age:
        return None
    if not _consume_state(state, ts + max_age):
        return None
    return payload
