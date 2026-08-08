from pydantic import BaseModel, Field, EmailStr
from datetime import datetime
from typing import Optional, List, Dict, Any

# Username/display name regex: letters, digits, underscore, Chinese characters
USERNAME_PATTERN = r'^[a-zA-Z0-9_\u4e00-\u9fff]+$'

class UserBase(BaseModel):
    email: EmailStr = Field(..., description="User email address (unique)")
    name: Optional[str] = Field(None, max_length=200, description="Display name")

class UserCreate(UserBase):
    password: str = Field(..., min_length=8, max_length=128, description="User password (min 8 chars)")
    name: str = Field(..., max_length=200, pattern=USERNAME_PATTERN, description="Display name (letters, digits, underscore, Chinese)")

class UserResponse(UserBase):
    id: str = Field(..., description="Unique user ID (UUID)")
    status: str = Field("active", description="Account status: active / suspended / deleted")
    storage_used: int = Field(0, description="Storage used in bytes")
    storage_limit: int = Field(1073741824, description="Storage limit in bytes (1GB default)")
    last_login_at: Optional[datetime] = Field(None, description="Last login timestamp")
    created_at: datetime = Field(..., description="Account creation timestamp")
    updated_at: datetime = Field(..., description="Last update timestamp")

    class Config:
        from_attributes = True

class UserUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=200, pattern=USERNAME_PATTERN, description="New display name")
    avatar: Optional[str] = Field(None, max_length=2048, description="Avatar URL or base64")
    display_name: Optional[str] = Field(None, max_length=200, pattern=USERNAME_PATTERN, description="Display name")
    username: Optional[str] = Field(None, max_length=200, pattern=USERNAME_PATTERN, description="Username")

class TokenResponse(BaseModel):
    access_token: str = Field(..., description="JWT access token")
    token_type: str = Field("bearer", description="Token type")
    expires_in: int = Field(..., description="Token expiry in seconds")
    refresh_token: Optional[str] = Field(None, description="JWT refresh token")
    refresh_expires_in: Optional[int] = Field(None, description="Refresh token expiry in seconds")

class UserLogin(BaseModel):
    email: EmailStr = Field(..., description="User email address")
    password: str = Field(..., min_length=1, max_length=128, description="User password")

class PasswordChangeRequest(BaseModel):
    current_password: str = Field(..., min_length=1, max_length=128)
    new_password: str = Field(..., min_length=8, max_length=128, description="New password (min 8 chars)")


class AISettings(BaseModel):
    active_provider: Optional[str] = Field(None, description="Active LLM provider slug")
    active_model: Optional[str] = Field(None, description="Active LLM model identifier")
    model: Optional[str] = Field(None, description="Legacy selected model id, e.g. ollama")
    temperature: Optional[float] = Field(None, description="Sampling temperature (0.0 - 1.0)")
    max_tokens: Optional[int] = Field(None, description="Maximum tokens per generation")
    local_enabled: Optional[bool] = Field(None, description="Whether local/Ollama models are enabled")
    model_routing_enabled: Optional[bool] = Field(None, description="Whether intelligent model routing is enabled")
    ollama_url: Optional[str] = Field(None, description="User-level Ollama base URL")
    ollama_model: Optional[str] = Field(None, description="User-level selected Ollama model name")


class SettingsUpdate(BaseModel):
    ai: Optional[AISettings] = None
    privacy: Optional[Dict[str, Any]] = None
    sync: Optional[Dict[str, Any]] = None
    appearance: Optional[Dict[str, Any]] = None
    plugins: Optional[Dict[str, Any]] = None
