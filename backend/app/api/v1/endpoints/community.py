from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc
from datetime import datetime
import uuid
from typing import Optional

from app.core.database import get_db
from app.core.security import get_current_user, get_current_user_optional
from app.core.xss_sanitizer import sanitize_markdown
from app.models.base import User
from app.models.community import CommunityPost
from app.schemas.community import CommunityPostCreate, CommunityPostOut, CommunityPostList
from app.services.spam_filter import is_spam

router = APIRouter()


def _post_response(post: CommunityPost) -> dict:
    return {
        "id": post.id,
        "user_id": post.user_id,
        "content": post.content,
        "is_spam": post.is_spam,
        "created_at": post.created_at,
        "updated_at": post.updated_at,
        "user": {
            "id": post.user.id,
            "name": post.user.name,
            "display_name": post.user.display_name,
        },
    }


@router.get("/", response_model=CommunityPostList, summary="List community posts", description="Get public community posts, newest first. Spam posts are hidden.")
async def list_posts(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional),
):
    query = db.query(CommunityPost).filter(CommunityPost.is_spam == False)
    total = query.count()
    posts = (
        query
        .order_by(desc(CommunityPost.created_at))
        .offset(skip)
        .limit(limit)
        .all()
    )
    return {"total": total, "posts": [_post_response(p) for p in posts]}


@router.post("/", response_model=CommunityPostOut, status_code=status.HTTP_201_CREATED, summary="Create community post", description="Post a message to the community. Spam content is rejected.")
async def create_post(
    data: CommunityPostCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    content = sanitize_markdown(data.content.strip())
    if not content:
        raise HTTPException(status_code=400, detail="内容不能为空")

    if is_spam(content):
        raise HTTPException(status_code=400, detail="内容包含垃圾信息，已被屏蔽")

    post = CommunityPost(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        content=content,
        is_spam=False,
    )
    db.add(post)
    db.commit()
    db.refresh(post)
    return _post_response(post)


@router.delete("/{post_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete community post", description="Delete your own community post.")
async def delete_post(
    post_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    post = db.query(CommunityPost).filter(CommunityPost.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="帖子不存在")
    if post.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="只能删除自己发布的内容")
    db.delete(post)
    db.commit()
    return None
