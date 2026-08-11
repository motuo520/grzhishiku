from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
import bcrypt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
import re

from app.core.config import settings
from app.core.database import get_db
from app.models.base import User

security = HTTPBearer(auto_error=False)

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
    return bcrypt.checkpw(
        plain_password.encode('utf-8'),
        hashed_password.encode('utf-8')
    )


def get_password_hash(password: str) -> str:
    """Hash password using bcrypt. Truncates to 72 bytes if necessary."""
    password_bytes = password.encode('utf-8')[:72]
    return bcrypt.hashpw(password_bytes, bcrypt.gensalt(rounds=12)).decode('utf-8')


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None, is_admin: bool = False) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire, "type": "admin" if is_admin else "user"})
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
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> User:
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.status != "active":
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
    user_id = payload.get("sub")
    if not user_id:
        return None
    user = db.query(User).filter(User.id == user_id).first()
    if not user or user.status != "active":
        return None
    return user
