from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import List, Optional
import os

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.feature_guard import require_feature
from app.models.base import User
from app.models.storage import DataPackage
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
        from app.core.oauth_state import sign_state
        url = provider_cls.auth_url(sign_state(current_user.id))
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

    # state 为 HMAC 签名的 user_id（auth-url 处签发，10 分钟有效），防 CSRF 绑定他人账号。
    # 必须先验 state 再兑换 token，避免无效 state 提前消耗一次性授权码
    from app.core.oauth_state import verify_state
    user_id = verify_state(state)
    if not user_id:
        raise HTTPException(status_code=400, detail="state 无效或已过期，请重新发起授权")

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


# ─── E2EE 打包加密（客户端加密后回传） ──────────────────────────────────────────
#
# 流程：
#   1. 客户端调 POST /packages 让后端生成 ZIP（明文，存本机）
#   2. 客户端下载 ZIP（本链路，端到端本机，可接受明文）
#   3. 客户端在浏览器内用 PBKDF2 + AES-GCM 加密 ZIP → 密文 blob
#   4. 客户端调 PUT /packages/{id}/encrypted 把密文回传服务端
#   5. 后续网盘上传走密文文件（encrypted_path），服务端不再接触明文
#
# 安全边界：服务端在步骤 4 之后只有密文，无法解密（无用户口令）。
# 网盘上传的也是密文，第三方网盘同样无法读取内容。

ENCRYPTED_DIR = "uploads/packages_encrypted"
os.makedirs(ENCRYPTED_DIR, exist_ok=True)


class EncryptedPackageUpload(BaseModel):
    salt: str = Field(..., description="PBKDF2 salt（hex）")
    iv: str = Field(..., description="AES-GCM IV（hex）")
    # 密文通过 raw body 传入（不放在 JSON 里，避免 base64 膨胀 + 大对象 GC 抖动）
    # 这里只做 schema 字段；实际 body 用 Request.body() 读


@router.put("/packages/{package_id}/encrypted", summary="上传客户端加密后的打包密文")
async def upload_encrypted_package(
    package_id: str,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """客户端加密 ZIP 后回传密文。服务端只存密文，无法解密。

    Header:
        X-Sync-Salt: PBKDF2 salt（hex）
        X-Sync-IV: AES-GCM IV（hex）
    Body:
        raw bytes（AES-GCM 密文，含 auth tag）
    """
    pkg = db.query(DataPackage).filter(
        DataPackage.id == package_id, DataPackage.user_id == current_user.id
    ).first()
    if not pkg:
        raise HTTPException(status_code=404, detail="打包记录不存在")
    if pkg.status not in ("ready", "uploaded"):
        raise HTTPException(status_code=400, detail="打包文件尚未就绪")

    salt = request.headers.get("X-Sync-Salt", "").strip()
    iv = request.headers.get("X-Sync-IV", "").strip()
    if not salt or not iv:
        raise HTTPException(status_code=400, detail="缺少 X-Sync-Salt 或 X-Sync-IV 头")

    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="密文 body 为空")
    if len(body) > 100 * 1024 * 1024:  # 100 MB 上限
        raise HTTPException(status_code=413, detail="密文过大（>100MB）")

    # 存密文到专用目录
    enc_path = os.path.join(ENCRYPTED_DIR, f"{package_id}.enc")
    try:
        with open(enc_path, "wb") as f:
            f.write(body)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"密文写入失败：{e}")

    pkg.encrypted_path = enc_path
    pkg.encrypted_size = len(body)
    pkg.salt = salt
    pkg.iv = iv
    pkg.status = "encrypted"
    pkg.updated_at = None  # 触发 onupdate
    db.commit()
    db.refresh(pkg)

    return {
        "success": True,
        "id": package_id,
        "encrypted_size": len(body),
        "status": "encrypted",
    }


@router.get("/packages/{package_id}/encrypted", summary="下载客户端加密后的打包密文")
async def download_encrypted_package(
    package_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """下载密文打包。客户端用同步口令派生 key 解密。"""
    pkg = db.query(DataPackage).filter(
        DataPackage.id == package_id, DataPackage.user_id == current_user.id
    ).first()
    if not pkg:
        raise HTTPException(status_code=404, detail="打包记录不存在")
    if not pkg.encrypted_path or not os.path.exists(pkg.encrypted_path):
        raise HTTPException(status_code=404, detail="该打包尚未加密或密文已丢失")
    return Response(
        content=open(pkg.encrypted_path, "rb").read(),
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{pkg.filename}.enc"',
            "X-Sync-Salt": pkg.salt or "",
            "X-Sync-IV": pkg.iv or "",
        },
    )


@router.post("/packages/{package_id}/upload-encrypted-to-drive", summary="加密打包上传到网盘")
async def upload_encrypted_to_drive(
    package_id: str,
    provider: str = "",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """将已加密的打包（密文）上传到网盘。网盘看到的只是密文，无法读取内容。"""
    pkg = db.query(DataPackage).filter(
        DataPackage.id == package_id, DataPackage.user_id == current_user.id
    ).first()
    if not pkg:
        raise HTTPException(status_code=404, detail="打包记录不存在")
    if not pkg.encrypted_path or not os.path.exists(pkg.encrypted_path):
        raise HTTPException(status_code=400, detail="请先上传客户端加密后的密文（PUT /packages/{id}/encrypted）")

    drive = svc_drive = None
    from app.services.storage_service import StorageService
    svc = StorageService(db)
    drives = svc.list_drives(current_user.id)
    if provider:
        drive = next((d for d in drives if d.provider == provider and d.is_active), None)
    else:
        drive = next((d for d in drives if d.is_active), None)
    if not drive:
        raise HTTPException(status_code=400, detail=f"未绑定{f' {provider}' if provider else ''}网盘或网盘未激活")

    provider_cls = get_provider(drive.provider)
    if not provider_cls.is_configured():
        raise HTTPException(status_code=503, detail=f"{provider_cls.name} 尚未在服务端配置")

    remote_path = f"psb_backup/{pkg.filename}.enc"
    try:
        result = await provider_cls.upload_file(
            drive.access_token,
            remote_path,
            pkg.encrypted_path,
            f"{pkg.filename}.enc",
        )
        pkg.status = "uploaded"
        pkg.provider = drive.provider
        pkg.remote_path = result.get("path") or remote_path
        pkg.error_message = None
    except NetdiskError as e:
        pkg.status = "failed"
        pkg.error_message = str(e)
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        pkg.status = "failed"
        pkg.error_message = str(e)
        raise HTTPException(status_code=500, detail=f"上传失败: {e}")
    finally:
        pkg.updated_at = None
        db.commit()
        db.refresh(pkg)

    return {
        "success": True,
        "id": package_id,
        "provider": drive.provider,
        "remote_path": pkg.remote_path,
        "encrypted": True,
    }
