from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict


class CommunityPostUser(BaseModel):
    id: str
    name: str | None = None
    display_name: str | None = None


class CommunityPostCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=1000)


class CommunityPostOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str
    content: str
    is_spam: bool
    created_at: datetime
    updated_at: datetime
    user: CommunityPostUser


class CommunityPostList(BaseModel):
    total: int
    posts: list[CommunityPostOut]
