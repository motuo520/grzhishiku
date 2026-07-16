from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
import os

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.feature_guard import require_feature
from app.models.base import User
from app.services.storage_service import StorageService, get_provider, NetdiskError

router = APIRouter()


class PackageOut(BaseModel):
    id: str
    filename: str
    file_size: int
    status: str
    provider: Optional[str]
    remote_path: Optional[str]
    error_message: Optional[str]
    created_at: Optional[str]
    updated_at: Optional[str]

    class Config:
        from_attributes = True


class DriveOut(BaseModel):
    id: str
    provider: str
    account_name: Optional[str]
    scope: Optional[str]
    is_active: bool
    created_at: Optional[str]
    updated_at: Optional[str]

    class Config:
        from_attributes = True


class AuthUrlOut(BaseModel):
    url: str


class UploadResultOut(BaseModel):
    success: bool
    package: PackageOut


@router.get("/packages", response_model=List[PackageOut], summary="List data packages")
async def list_packages(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    svc = StorageService(db)
    packages = svc.list_packages(current_user.id)
    return [
        PackageOut(
            id=p.id,
            filename=p.filename,
            file_size=p.file_size or 0,
            status=p.status,
            provider=p.provider,
            remote_path=p.remote_path,
            error_message=p.error_message,
            created_at=p.created_at.isoformat() if p.created_at else None,
            updated_at=p.updated_at.isoformat() if p.updated_at else None,
        )
        for p in packages
    ]


@router.post("/packages", response_model=PackageOut, summary="Create data package")
async def create_package(
    current_user: User = Depends(require_feature("cloud_backup")),
    db: Session = Depends(get_db),
):
    svc = StorageService(db)
    pkg = svc.package_user_data(current_user.id)
    return PackageOut(
        id=pkg.id,
        filename=pkg.filename,
        file_size=pkg.file_size or 0,
        status=pkg.status,
        provider=pkg.provider,
        remote_path=pkg.remote_path,
        error_message=pkg.error_message,
        created_at=pkg.created_at.isoformat() if pkg.created_at else None,
        updated_at=pkg.updated_at.isoformat() if pkg.updated_at else None,
    )


@router.get("/packages/{package_id}/download", summary="Download data package")
async def download_package(
    package_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    svc = StorageService(db)
    pkg = svc.get_package(current_user.id, package_id)
    if not pkg:
        raise HTTPException(status_code=404, detail="打包记录不存在")
    if pkg.status != "ready" and pkg.status != "uploaded":
        raise HTTPException(status_code=400, detail="文件尚未就绪")
    if not pkg.file_path or not os.path.exists(pkg.file_path):
        raise HTTPException(status_code=404, detail="文件不存在或已被清理")
    return FileResponse(
        path=pkg.file_path,
        filename=pkg.filename,
        media_type="application/zip",
    )


@router.delete("/packages/{package_id}", summary="Delete a data package")
async def delete_package(
    package_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    svc = StorageService(db)
    ok = svc.delete_package(current_user.id, package_id)
    if not ok:
        raise HTTPException(status_code=404, detail="打包记录不存在")
    return {"success": True}


# ─── 网盘授权 ───

@router.get("/drives", response_model=List[DriveOut], summary="List connected cloud drives")
async def list_drives(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    svc = StorageService(db)
    drives = svc.list_drives(current_user.id)
    return [
        DriveOut(
            id=d.id,
            provider=d.provider,
            account_name=d.account_name,
            scope=d.scope,
            is_active=d.is_active,
            created_at=d.created_at.isoformat() if d.created_at else None,
            updated_at=d.updated_at.isoformat() if d.updated_at else None,
        )
        for d in drives
    ]


@router.get("/drives/{provider}/auth-url", response_model=AuthUrlOut, summary="Get OAuth URL")
async def get_auth_url(
    provider: str,
    current_user: User = Depends(get_current_user),
):
    provider_cls = get_provider(provider)
    if not provider_cls.is_configured():
        raise HTTPException(status_code=503, detail=f"{provider_cls.name} 尚未在服务端配置")
    try:
        url = provider_cls.auth_url(current_user.id)
    except NetdiskError as e:
        raise HTTPException(status_code=503, detail=str(e))
    return AuthUrlOut(url=url)


@router.get("/drives/{provider}/callback", summary="OAuth callback")
async def oauth_callback(
    provider: str,
    code: str,
    state: str,
    db: Session = Depends(get_db),
):
    provider_cls = get_provider(provider)
    if not provider_cls.is_configured():
        raise HTTPException(status_code=503, detail=f"{provider_cls.name} 尚未在服务端配置")

    try:
        token_data = await provider_cls.exchange_token(code)
    except NetdiskError as e:
        raise HTTPException(status_code=400, detail=str(e))

    access_token = token_data.get("access_token")
    refresh_token = token_data.get("refresh_token")
    expires_in = token_data.get("expires_in")
    scope = token_data.get("scope")

    if not access_token:
        raise HTTPException(status_code=400, detail="授权失败，未获取到 access_token")

    # state 中存放 user_id
    user_id = state

    account_name = None
    try:
        info = await provider_cls.get_user_info(access_token)
        account_name = info.get("username") or info.get("uname") or info.get("userid")
    except Exception:
        pass

    svc = StorageService(db)
    svc.save_drive_token(
        user_id=user_id,
        provider=provider,
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=expires_in,
        scope=scope,
        account_name=account_name,
    )

    return {"success": True, "provider": provider, "account_name": account_name}


@router.post("/drives/{provider}/upload/{package_id}", response_model=UploadResultOut, summary="Upload package to drive")
async def upload_to_drive(
    provider: str,
    package_id: str,
    current_user: User = Depends(require_feature("cloud_backup")),
    db: Session = Depends(get_db),
):
    svc = StorageService(db)
    pkg = await svc.upload_to_drive(current_user.id, provider, package_id)
    return UploadResultOut(
        success=pkg.status == "uploaded",
        package=PackageOut(
            id=pkg.id,
            filename=pkg.filename,
            file_size=pkg.file_size or 0,
            status=pkg.status,
            provider=pkg.provider,
            remote_path=pkg.remote_path,
            error_message=pkg.error_message,
            created_at=pkg.created_at.isoformat() if pkg.created_at else None,
            updated_at=pkg.updated_at.isoformat() if pkg.updated_at else None,
        ),
    )


@router.delete("/drives/{provider}", summary="Disconnect cloud drive")
async def disconnect_drive(
    provider: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    svc = StorageService(db)
    ok = svc.disconnect_drive(current_user.id, provider)
    if not ok:
        raise HTTPException(status_code=404, detail="未找到该网盘绑定")
    return {"success": True}
