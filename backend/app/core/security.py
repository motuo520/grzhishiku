from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
import bcrypt
import logging
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
import re

from app.core.config import settings
from app.core.database import get_db
from app.models.base import User

security = HTTPBearer(auto_error=False)

# 安全事件统一走该 logger（登录失败/无效 token/吊销重放/限流触发等），
# 便于运维按名字过滤；只记事件类型+来源 IP+账号标识，绝不记密码/token 本体。
security_logger = logging.getLogger("app.security")


def _client_ip(request: Optional[Request]) -> str:
    if request is None or request.client is None:
        return "unknown"
    return request.client.host

# Password complexity regex patterns
PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 128
PASSWORD_COMPLEXITY_RE = re.compile(
    r'^(?=.*[A-Z])(?=.*[a-z])(?=.*\d).{8,128}$'
)


def validate_password_complexity(password: str) -> bool:
    """Validate password meets complexity requirements."""
    if len(password) < PASSWORD_MIN_LENGTH or len(password) > PASSWORD_MAX_LENGTH:
        return False
    return bool(PASSWORD_COMPLEXITY_RE.match(password))


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify password using bcrypt with timing-attack-safe comparison."""
    if not plain_password or not hashed_password:
        return False
    try:
        return bcrypt.checkpw(
            # 与 get_password_hash 同口径截断 72 字节——bcrypt 5.x 超长直接抛异常，
            # 不对称曾导致超长密码永远「密码不正确」（含登录/注销/改密全链路）
            plain_password.encode('utf-8')[:72],
            hashed_password.encode('utf-8')
        )
    except Exception as e:
        # 空/非法 bcrypt hash（脏数据）不应导致 500；但必须留痕（静默吞异常血泪）
        logging.getLogger(__name__).warning("verify_password swallowed error: %s", e)
        return False


def get_password_hash(password: str) -> str:
    """Hash password using bcrypt. Truncates to 72 bytes if necessary."""
    password_bytes = password.encode('utf-8')[:72]
    return bcrypt.hashpw(password_bytes, bcrypt.gensalt(rounds=12)).decode('utf-8')


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None, is_admin: bool = False, token_version: Optional[int] = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire, "type": "admin" if is_admin else "user"})
    if token_version is not None:
        to_encode["token_version"] = token_version
    secret = settings.ADMIN_SECRET_KEY if is_admin else settings.SECRET_KEY
    encoded_jwt = jwt.encode(to_encode, secret, algorithm=settings.ALGORITHM)
    return encoded_jwt


def decode_token(token: str, is_admin: bool = False) -> Optional[dict]:
    try:
        secret = settings.ADMIN_SECRET_KEY if is_admin else settings.SECRET_KEY
        payload = jwt.decode(token, secret, algorithms=[settings.ALGORITHM])
        return payload
    except JWTError:
        return None


def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> User:
    ip = _client_ip(request)
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_token(credentials.credentials)
    if not payload:
        security_logger.warning("security_event type=invalid_token ip=%s", ip)
        raise HTTPException(status_code=401, detail="Invalid token")
    if payload.get("type") != "user":
        security_logger.warning("security_event type=invalid_token_type ip=%s", ip)
        raise HTTPException(status_code=401, detail="Invalid token")
    # refresh token（30 天有效）不得当 access token 用，否则 token_use 区分形同虚设
    if payload.get("token_use") == "refresh":
        security_logger.warning("security_event type=refresh_token_as_access ip=%s", ip)
        raise HTTPException(status_code=401, detail="Invalid token")
    user_id = payload.get("sub")
    if not user_id:
        security_logger.warning("security_event type=invalid_token_payload ip=%s", ip)
        raise HTTPException(status_code=401, detail="Invalid token")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        security_logger.warning("security_event type=token_user_missing ip=%s", ip)
        raise HTTPException(status_code=401, detail="Invalid token")
    # token_version 不一致说明改密/登出后已失效，拒绝重放旧 token
    if int(payload.get("token_version") or 0) != int(getattr(user, "token_version", None) or 0):
        security_logger.warning("security_event type=revoked_token_replay ip=%s user_id=%s", ip, user.id)
        raise HTTPException(status_code=401, detail="Token has been revoked")
    if user.status != "active":
        security_logger.warning("security_event type=disabled_account_access ip=%s user_id=%s", ip, user.id)
        raise HTTPException(status_code=403, detail="Account disabled")
    return user


def get_current_user_optional(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> Optional[User]:
    """Return the current user if authenticated, otherwise None."""
    if not credentials:
        return None
    payload = decode_token(credentials.credentials)
    if not payload:
        return None
    if payload.get("type") != "user":
        return None
    if payload.get("token_use") == "refresh":
        return None
    user_id = payload.get("sub")
    if not user_id:
        return None
    user = db.query(User).filter(User.id == user_id).first()
    if not user or user.status != "active":
        return None
    if int(payload.get("token_version") or 0) != int(getattr(user, "token_version", None) or 0):
        return None
    return user
