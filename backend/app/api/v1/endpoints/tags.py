from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, and_
from typing import List, Optional
from datetime import datetime
import uuid

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.xss_sanitizer import sanitize_markdown
from app.models.base import User, Tag, content_tags, Note
from app.schemas.tag import TagCreate, TagUpdate, TagResponse, TagMergeRequest, TagAssociationsResponse
from app.services import tag_service

router = APIRouter()


def _build_tag_response(tag: Tag, db: Session) -> dict:
    usage_breakdown = tag_service.get_tag_usage_breakdown(db, tag.id, tag.user_id)
    return {
        "id": tag.id,
        "user_id": tag.user_id,
        "name": tag.name,
        "color": tag.color or "#8b949e",
        "description": tag.description,
        "usage_count": sum(usage_breakdown.values()),
        "usage_breakdown": usage_breakdown,
        "created_at": tag.created_at,
        "updated_at": tag.updated_at,
    }


@router.get("/", response_model=List[TagResponse], summary="List tags", description="Get all tags for the current user with usage count.")
async def list_tags(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    tags = db.query(Tag).filter(Tag.user_id == current_user.id).order_by(Tag.name.asc()).all()
    return [_build_tag_response(t, db) for t in tags]


@router.post("/", response_model=TagResponse, status_code=status.HTTP_201_CREATED, summary="Create tag", description="Create a new tag for the current user.")
async def create_tag(
    tag_data: TagCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    existing = db.query(Tag).filter(Tag.user_id == current_user.id, Tag.name == tag_data.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Tag with this name already exists")
    
    tag = Tag(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        name=sanitize_markdown(tag_data.name),
        color=tag_data.color or "#8b949e",
        description=sanitize_markdown(tag_data.description) if tag_data.description else None,
    )
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return _build_tag_response(tag, db)


@router.get("/{tag_id}", response_model=TagResponse, summary="Get tag", description="Get a specific tag by ID.")
async def get_tag(
    tag_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    tag = db.query(Tag).filter(Tag.id == tag_id, Tag.user_id == current_user.id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    return _build_tag_response(tag, db)


@router.put("/{tag_id}", response_model=TagResponse, summary="Update tag", description="Update a tag by ID.")
async def update_tag(
    tag_id: str,
    tag_data: TagUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    tag = db.query(Tag).filter(Tag.id == tag_id, Tag.user_id == current_user.id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    
    if tag_data.name is not None:
        existing = db.query(Tag).filter(
            Tag.user_id == current_user.id,
            Tag.name == tag_data.name,
            Tag.id != tag_id
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="Tag with this name already exists")
        tag.name = sanitize_markdown(tag_data.name)
    if tag_data.color is not None:
        tag.color = tag_data.color
    if tag_data.description is not None:
        tag.description = sanitize_markdown(tag_data.description)
    
    tag.updated_at = datetime.now()
    db.commit()
    db.refresh(tag)
    return _build_tag_response(tag, db)


@router.delete("/{tag_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete tag", description="Delete a tag. Fails if the tag is still associated with content.")
async def delete_tag(
    tag_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    tag = db.query(Tag).filter(Tag.id == tag_id, Tag.user_id == current_user.id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    
    usage = _get_tag_usage_count(db, tag_id)
    if usage > 0:
        raise HTTPException(status_code=400, detail=f"Tag is still used by {usage} content items. Please remove associations first.")
    
    db.delete(tag)
    db.commit()
    return None


@router.post("/{tag_id}/merge", response_model=TagResponse, summary="Merge tag", description="Merge a tag into another tag. All associations are moved to the target tag.")
async def merge_tag(
    tag_id: str,
    request: TagMergeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    source = db.query(Tag).filter(Tag.id == tag_id, Tag.user_id == current_user.id).first()
    if not source:
        raise HTTPException(status_code=404, detail="Source tag not found")
    
    target = db.query(Tag).filter(Tag.id == request.target_tag_id, Tag.user_id == current_user.id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Target tag not found")
    
    if source.id == target.id:
        raise HTTPException(status_code=400, detail="Cannot merge a tag into itself")
    
    tag_service.merge_tags(db, source.id, target.id)
    db.commit()
    db.refresh(target)
    return _build_tag_response(target, db)


@router.delete("/orphaned", response_model=dict, summary="Cleanup orphaned tags", description="Delete all tags with zero associations for the current user.")
async def cleanup_orphaned_tags(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    deleted = tag_service.cleanup_orphaned_tags(db, current_user.id)
    db.commit()
    return {"success": True, "deleted_count": deleted}


@router.get("/{tag_id}/associations", response_model=TagAssociationsResponse, summary="Get tag associations", description="Get all content items associated with a tag.")
async def get_tag_associations(
    tag_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    tag = db.query(Tag).filter(Tag.id == tag_id, Tag.user_id == current_user.id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    
    associations = tag_service.get_tag_associations(db, tag_id, current_user.id)
    return {
        "tag_id": tag_id,
        "note": associations.get("note", []),
        "clip": associations.get("clip", []),
        "knowledge": associations.get("knowledge", []),
    }
