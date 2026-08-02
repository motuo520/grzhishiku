from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr, Field, field_validator
from app.core.database import get_db
from app.core.security import verify_password, get_password_hash, create_access_token, decode_token
from app.core.config import settings
from app.core.config_loader import get_system_config
from app.models.base import User
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import logging
import uuid
from datetime import timedelta

router = APIRouter()
security = HTTPBearer(auto_error=False)
logger = logging.getLogger(__name__)

class UserRegister(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)

    @field_validator('password')
    @classmethod
    def validate_password_complexity(cls, v: str) -> str:
        import re
        if not re.search(r'[A-Z]', v):
            raise ValueError('密码必须包含至少一个大写字母')
        if not re.search(r'[a-z]', v):
            raise ValueError('密码必须包含至少一个小写字母')
        if not re.search(r'\d', v):
            raise ValueError('密码必须包含至少一个数字')
        return v

class UserLogin(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=128)

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int

class RefreshTokenRequest(BaseModel):
    refresh_token: str

class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=1, max_length=128)
    new_password: str = Field(..., min_length=8, max_length=128)
    
    @field_validator('new_password')
    @classmethod
    def validate_password_complexity(cls, v: str) -> str:
        import re
        if not re.search(r'[A-Z]', v):
            raise ValueError('密码必须包含至少一个大写字母')
        if not re.search(r'[a-z]', v):
            raise ValueError('密码必须包含至少一个小写字母')
        if not re.search(r'\d', v):
            raise ValueError('密码必须包含至少一个数字')
        return v

@router.post("/register", response_model=TokenResponse, summary="User registration", description="Register a new user with email and password.")
async def register(user_data: UserRegister, db: Session = Depends(get_db)):
    # Check whether registration is open
    sys_config = get_system_config(db)
    if not sys_config.registration_open:
        raise HTTPException(status_code=403, detail="Registration is currently closed")

    existing = db.query(User).filter(User.email == user_data.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        id=str(uuid.uuid4()),
        email=user_data.email,
        name=user_data.email.split('@')[0],
        password_hash=get_password_hash(user_data.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # 新账号播种轻量示例数据（每个功能 1-2 条），失败不阻断注册
    try:
        from app.services.sample_data_service import seed_sample_data
        seed_sample_data(db, user.id)
    except Exception as e:
        logger.warning("sample data seeding failed for user %s: %s", user.id, e)

    access_token = create_access_token(
        data={"sub": user.id, "email": user.email},
        expires_delta=timedelta(days=7)
    )
    return TokenResponse(access_token=access_token, expires_in=60 * 60 * 24 * 7)

@router.post("/login", response_model=TokenResponse, summary="User login", description="Authenticate with email and password. Returns an access token.")
async def login(user_data: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == user_data.email).first()
    if not user or not verify_password(user_data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    if user.status != "active":
        raise HTTPException(status_code=403, detail="Account disabled")

    access_token = create_access_token(
        data={"sub": user.id, "email": user.email},
        expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    return TokenResponse(access_token=access_token, expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60)

@router.post("/refresh", response_model=TokenResponse, summary="Refresh access token", description="Exchange a valid refresh token for a new access token.")
async def refresh_token(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
):
    if not credentials:
        raise HTTPException(status_code=401, detail="No refresh token provided")
    
    payload = decode_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.status != "active":
        raise HTTPException(status_code=403, detail="Account disabled")
    
    new_access_token = create_access_token(
        data={"sub": user.id, "email": user.email},
        expires_delta=timedelta(days=7)
    )
    return TokenResponse(access_token=new_access_token, expires_in=60 * 60 * 24 * 7)

@router.post("/logout", summary="User logout", description="Invalidate the current access token. Client should discard the token.")
async def logout(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(security)
):
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    payload = decode_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    return {"success": True, "message": "Logged out successfully"}

@router.post("/change-password", summary="Change password", description="Change the current user's password.")
async def change_password(
    req: ChangePasswordRequest,
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
):
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
    
    if not verify_password(req.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect.")
    if len(req.new_password) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters.")

    user.password_hash = get_password_hash(req.new_password)
    db.commit()
    db.refresh(user)
    return {"success": True, "message": "Password updated successfully."}
