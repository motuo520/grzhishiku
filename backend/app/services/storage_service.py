"""
Storage service: package user data and upload to third-party netdisks.
"""
import json
import logging
import os
import uuid
import zipfile
import tempfile
import shutil
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from urllib.parse import urlencode, parse_qs

import httpx
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.config import settings, _data_dir_from_database_url
from app.core.crypto import encrypt_secret, decrypt_secret
from app.core.database import get_db
from app.models.base import User, Note, Capsule, BrowserClip, KnowledgeUnit
from app.models.storage import DataPackage, UserCloudDrive

logger = logging.getLogger(__name__)


# 备份包包含用户全量数据，必须放在静态托管的 uploads/ 之外：
# 与数据库同目录（docker 下为挂载的 /data，即仓库根 server-data/，已被 gitignore）
PACKAGE_DIR = os.path.join(_data_dir_from_database_url(settings.DATABASE_URL), "packages")
os.makedirs(PACKAGE_DIR, exist_ok=True)


class NetdiskError(Exception):
    pass


class NetdiskProvider:
    """网盘提供商抽象基类"""

    name: str = ""
    provider: str = ""

    @classmethod
    def is_configured(cls) -> bool:
        return False

    @classmethod
    def auth_url(cls, state: str) -> str:
        raise NotImplementedError

    @classmethod
    async def exchange_token(cls, code: str) -> Dict[str, Any]:
        raise NotImplementedError

    @classmethod
    async def get_user_info(cls, access_token: str) -> Dict[str, Any]:
        raise NotImplementedError

    @classmethod
    async def upload_file(cls, access_token: str, remote_path: str, local_path: str, filename: str) -> Dict[str, Any]:
        raise NotImplementedError


class BaiduNetdiskProvider(NetdiskProvider):
    """百度网盘开放 API"""

    name = "百度网盘"
    provider = "baidu"

    AUTH_BASE = "https://openapi.baidu.com/oauth/2.0/authorize"
    TOKEN_URL = "https://openapi.baidu.com/oauth/2.0/token"
    UPLOAD_HOST = "https://d.pcs.baidu.com"
    USER_INFO_URL = "https://openapi.baidu.com/rest/2.0/passport/users/getInfo"

    @classmethod
    def is_configured(cls) -> bool:
        return bool(settings.BAIDU_NETDISK_CLIENT_ID and settings.BAIDU_NETDISK_CLIENT_SECRET)

    @classmethod
    def auth_url(cls, state: str) -> str:
        redirect_uri = settings.BAIDU_NETDISK_REDIRECT_URI or f"{settings.API_BASE_URL}/api/v1/storage/drives/baidu/callback"
        params = {
            "client_id": settings.BAIDU_NETDISK_CLIENT_ID,
            "response_type": "code",
            "redirect_uri": redirect_uri,
            "scope": "netdisk",
            "state": state,
            "display": "page",
        }
        return f"{cls.AUTH_BASE}?{urlencode(params)}"

    @classmethod
    async def exchange_token(cls, code: str) -> Dict[str, Any]:
        redirect_uri = settings.BAIDU_NETDISK_REDIRECT_URI or f"{settings.API_BASE_URL}/api/v1/storage/drives/baidu/callback"
        params = {
            "grant_type": "authorization_code",
            "code": code,
            "client_id": settings.BAIDU_NETDISK_CLIENT_ID,
            "client_secret": settings.BAIDU_NETDISK_CLIENT_SECRET,
            "redirect_uri": redirect_uri,
        }
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(cls.TOKEN_URL, params=params)
            data = resp.json()
        if "access_token" not in data:
            raise NetdiskError(data.get("error_description") or data.get("error") or "百度授权失败")
        return data

    @classmethod
    async def get_user_info(cls, access_token: str) -> Dict[str, Any]:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(cls.USER_INFO_URL, params={"access_token": access_token})
            return resp.json()

    @classmethod
    async def upload_file(cls, access_token: str, remote_path: str, local_path: str, filename: str) -> Dict[str, Any]:
        # 上传到 /apps/你的应用名/... 才能被应用访问；这里用网盘根目录路径
        target = f"/apps/psb_backup/{remote_path.strip('/')}"
        url = f"{cls.UPLOAD_HOST}/rest/2.0/pcs/file?method=upload&access_token={access_token}&path={target}&ondup=overwrite"
        async with httpx.AsyncClient(timeout=120) as client:
            with open(local_path, "rb") as f:
                files = {"file": (filename, f, "application/zip")}
                resp = await client.post(url, files=files)
        try:
            data = resp.json()
        except Exception:
            raise NetdiskError(f"百度网盘上传失败: {resp.text}")
        if "path" not in data and "error_code" in data:
            raise NetdiskError(f"百度网盘上传失败: {data}")
        return data


class AliyunNetdiskProvider(NetdiskProvider):
    """
    阿里云盘开放平台。
    文档：https://www.yuque.com/aliyundrive/zpfszx
    目前仅实现 OAuth 授权与基本信息获取；文件上传需申请开放平台权限后完善。
    """

    name = "阿里云盘"
    provider = "aliyun"

    AUTH_BASE = "https://openapi.aliyundrive.com/oauth/authorize"
    TOKEN_URL = "https://openapi.aliyundrive.com/oauth/token"
    USER_INFO_URL = "https://openapi.aliyundrive.com/v2/user/get"

    @classmethod
    def is_configured(cls) -> bool:
        return bool(settings.ALIYUN_NETDISK_CLIENT_ID and settings.ALIYUN_NETDISK_CLIENT_SECRET)

    @classmethod
    def auth_url(cls, state: str) -> str:
        redirect_uri = settings.ALIYUN_NETDISK_REDIRECT_URI or f"{settings.API_BASE_URL}/api/v1/storage/drives/aliyun/callback"
        params = {
            "client_id": settings.ALIYUN_NETDISK_CLIENT_ID,
            "response_type": "code",
            "redirect_uri": redirect_uri,
            "scope": "user:base,file:all:write",
            "state": state,
        }
        return f"{cls.AUTH_BASE}?{urlencode(params)}"

    @classmethod
    async def exchange_token(cls, code: str) -> Dict[str, Any]:
        redirect_uri = settings.ALIYUN_NETDISK_REDIRECT_URI or f"{settings.API_BASE_URL}/api/v1/storage/drives/aliyun/callback"
        payload = {
            "grant_type": "authorization_code",
            "code": code,
            "client_id": settings.ALIYUN_NETDISK_CLIENT_ID,
            "client_secret": settings.ALIYUN_NETDISK_CLIENT_SECRET,
            "redirect_uri": redirect_uri,
        }
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(cls.TOKEN_URL, json=payload)
            data = resp.json()
        if "access_token" not in data:
            raise NetdiskError(data.get("message") or data.get("error") or "阿里云盘授权失败")
        return data

    @classmethod
    async def get_user_info(cls, access_token: str) -> Dict[str, Any]:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                cls.USER_INFO_URL,
                headers={"Authorization": f"Bearer {access_token}"},
                json={},
            )
            return resp.json()

    @classmethod
    async def upload_file(cls, access_token: str, remote_path: str, local_path: str, filename: str) -> Dict[str, Any]:
        # 阿里云盘上传需要：创建文件 -> 获取上传 URL -> 分片上传 -> 完成上传。
        # 在拿到真实开放平台权限前，先给出明确提示，避免误导用户。
        raise NetdiskError("阿里云盘上传接口需要真实开放平台权限，当前为凭证占位模式")


PROVIDERS: Dict[str, type[NetdiskProvider]] = {
    "baidu": BaiduNetdiskProvider,
    "aliyun": AliyunNetdiskProvider,
}


def get_provider(provider: str) -> type[NetdiskProvider]:
    if provider not in PROVIDERS:
        raise HTTPException(status_code=400, detail=f"不支持的网盘: {provider}")
    return PROVIDERS[provider]


class StorageService:
    def __init__(self, db: Session):
        self.db = db

    def package_user_data(self, user_id: str) -> DataPackage:
        """打包用户所有数据为 ZIP，返回 DataPackage 记录。"""
        package_id = str(uuid.uuid4())
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"psb_backup_{user_id[:8]}_{timestamp}.zip"
        file_path = os.path.join(PACKAGE_DIR, package_id + ".zip")

        pkg = DataPackage(
            id=package_id,
            user_id=user_id,
            filename=filename,
            file_path=file_path,
            status="pending",
        )
        self.db.add(pkg)
        self.db.commit()
        self.db.refresh(pkg)

        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                data_dir = os.path.join(tmpdir, "data")
                os.makedirs(data_dir, exist_ok=True)

                # 导出笔记
                notes = self.db.query(Note).filter(Note.user_id == user_id).all()
                self._write_json(data_dir, "notes.json", [self._note_to_dict(n) for n in notes])

                # 导出胶囊
                capsules = self.db.query(Capsule).filter(Capsule.user_id == user_id).all()
                self._write_json(data_dir, "capsules.json", [self._capsule_to_dict(c) for c in capsules])

                # 导出剪藏
                clips = self.db.query(BrowserClip).filter(BrowserClip.user_id == user_id).all()
                self._write_json(data_dir, "clips.json", [self._clip_to_dict(c) for c in clips])

                # 导出知识单元
                knowledge = self.db.query(KnowledgeUnit).filter(KnowledgeUnit.user_id == user_id).all()
                self._write_json(data_dir, "knowledge.json", [self._knowledge_to_dict(k) for k in knowledge])

                # 元数据
                meta = {
                    "version": "1.0",
                    "exported_at": datetime.utcnow().isoformat(),
                    "user_id": user_id,
                    "counts": {
                        "notes": len(notes),
                        "capsules": len(capsules),
                        "clips": len(clips),
                        "knowledge": len(knowledge),
                    },
                }
                self._write_json(data_dir, "meta.json", meta)

                # 打包
                with zipfile.ZipFile(file_path, "w", zipfile.ZIP_DEFLATED) as zf:
                    for root, _, files in os.walk(data_dir):
                        for f in files:
                            full = os.path.join(root, f)
                            arcname = os.path.relpath(full, data_dir)
                            zf.write(full, arcname)

            pkg.status = "ready"
            pkg.file_size = os.path.getsize(file_path)
            pkg.error_message = None
        except Exception as e:
            pkg.status = "failed"
            pkg.error_message = str(e)
        finally:
            pkg.updated_at = datetime.utcnow()
            self.db.commit()
            self.db.refresh(pkg)

        return pkg

    def _write_json(self, directory: str, filename: str, data: Any):
        path = os.path.join(directory, filename)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2, default=str)

    def _note_to_dict(self, note: Note) -> Dict[str, Any]:
        return {
            "id": note.id,
            "title": note.title,
            "content": note.content,
            "content_format": note.content_format,
            "brain_side": note.brain_side,
            "mood_emotion": note.mood_emotion,
            "mood_intensity": note.mood_intensity,
            "mood_energy_level": note.mood_energy_level,
            "location": note.location,
            "weather": note.weather,
            "status": note.status,
            "created_at": note.created_at.isoformat() if note.created_at else None,
            "updated_at": note.updated_at.isoformat() if note.updated_at else None,
        }

    def _capsule_to_dict(self, capsule: Capsule) -> Dict[str, Any]:
        return {
            "id": capsule.id,
            "content_type": capsule.content_type,
            "content_body": capsule.content_body,
            "content_attachments": capsule.content_attachments,
            "brain_side": capsule.brain_side,
            "mood_emotion": capsule.mood_emotion,
            "mood_intensity": capsule.mood_intensity,
            "mood_energy_level": capsule.mood_energy_level,
            "mood_tags": capsule.mood_tags,
            "mood_location": capsule.mood_location,
            "sealed_at": capsule.sealed_at.isoformat() if capsule.sealed_at else None,
            "unlock_type": capsule.unlock_type,
            "unlock_config": capsule.unlock_config,
            "unlock_status": capsule.unlock_status,
            "created_at": capsule.created_at.isoformat() if capsule.created_at else None,
            "updated_at": capsule.updated_at.isoformat() if capsule.updated_at else None,
        }

    def _clip_to_dict(self, clip: BrowserClip) -> Dict[str, Any]:
        return {
            "id": clip.id,
            "title": clip.title,
            "url": clip.url,
            "domain": clip.domain,
            "excerpt": clip.excerpt,
            "full_text": clip.full_text,
            "author": clip.author,
            "site_type": clip.site_type,
            "status": clip.status,
            "created_at": clip.created_at.isoformat() if clip.created_at else None,
            "updated_at": clip.updated_at.isoformat() if clip.updated_at else None,
        }

    def _knowledge_to_dict(self, ku: KnowledgeUnit) -> Dict[str, Any]:
        return {
            "id": ku.id,
            "content_raw": ku.content_raw,
            "content_processed": ku.content_processed,
            "content_type": ku.content_type,
            "source_url": ku.source_url,
            "source_title": ku.source_title,
            "source_type": ku.source_type,
            "brain_side": ku.brain_side,
            "verification_status": ku.verification_status,
            "created_at": ku.created_at.isoformat() if ku.created_at else None,
            "updated_at": ku.updated_at.isoformat() if ku.updated_at else None,
        }

    def list_packages(self, user_id: str) -> List[DataPackage]:
        return self.db.query(DataPackage).filter(DataPackage.user_id == user_id).order_by(DataPackage.created_at.desc()).all()

    def get_package(self, user_id: str, package_id: str) -> Optional[DataPackage]:
        return self.db.query(DataPackage).filter(
            DataPackage.user_id == user_id,
            DataPackage.id == package_id
        ).first()

    def delete_package(self, user_id: str, package_id: str) -> bool:
        pkg = self.get_package(user_id, package_id)
        if not pkg:
            return False
        if pkg.file_path and os.path.exists(pkg.file_path):
            try:
                os.remove(pkg.file_path)
            except OSError:
                pass
        self.db.delete(pkg)
        self.db.commit()
        return True

    # ─── 网盘授权 ───

    def get_drive(self, user_id: str, provider: str) -> Optional[UserCloudDrive]:
        return self.db.query(UserCloudDrive).filter(
            UserCloudDrive.user_id == user_id,
            UserCloudDrive.provider == provider,
        ).first()

    def list_drives(self, user_id: str) -> List[UserCloudDrive]:
        return self.db.query(UserCloudDrive).filter(UserCloudDrive.user_id == user_id).all()

    def save_drive_token(
        self,
        user_id: str,
        provider: str,
        access_token: str,
        refresh_token: Optional[str] = None,
        expires_in: Optional[int] = None,
        scope: Optional[str] = None,
        account_name: Optional[str] = None,
    ) -> UserCloudDrive:
        drive = self.get_drive(user_id, provider)
        if not drive:
            drive = UserCloudDrive(
                id=str(uuid.uuid4()),
                user_id=user_id,
                provider=provider,
            )
            self.db.add(drive)

        drive.access_token = encrypt_secret(access_token)
        drive.refresh_token = encrypt_secret(refresh_token)
        if expires_in:
            drive.expires_at = datetime.utcnow() + timedelta(seconds=expires_in)
        drive.scope = scope
        drive.account_name = account_name
        drive.is_active = True
        drive.updated_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(drive)
        return drive

    def disconnect_drive(self, user_id: str, provider: str) -> bool:
        drive = self.get_drive(user_id, provider)
        if not drive:
            return False
        drive.is_active = False
        self.db.commit()
        return True

    async def upload_to_drive(self, user_id: str, provider: str, package_id: str) -> DataPackage:
        pkg = self.get_package(user_id, package_id)
        if not pkg:
            raise HTTPException(status_code=404, detail="打包记录不存在")
        if pkg.status != "ready":
            raise HTTPException(status_code=400, detail="打包文件尚未就绪或已失败")

        drive = self.get_drive(user_id, provider)
        if not drive or not drive.is_active:
            raise HTTPException(status_code=400, detail=f"未绑定 {provider} 网盘")

        provider_cls = get_provider(provider)
        if not provider_cls.is_configured():
            raise HTTPException(status_code=503, detail=f"{provider_cls.name} 尚未在服务端配置")

        remote_path = f"psb_backup/{pkg.filename}"
        try:
            result = await provider_cls.upload_file(
                decrypt_secret(drive.access_token),
                remote_path,
                pkg.file_path,
                pkg.filename,
            )
            pkg.status = "uploaded"
            pkg.provider = provider
            pkg.remote_path = result.get("path") or remote_path
            pkg.error_message = None
        except NetdiskError as e:
            pkg.status = "failed"
            pkg.error_message = str(e)
            raise HTTPException(status_code=502, detail=str(e))
        except Exception:
            pkg.status = "failed"
            pkg.error_message = "上传失败，请查看服务端日志"
            logger.exception("上传网盘失败 user_id=%s provider=%s", user_id, provider)
            raise HTTPException(status_code=500, detail="上传失败，请查看服务端日志")
        finally:
            pkg.updated_at = datetime.utcnow()
            self.db.commit()
            self.db.refresh(pkg)

        return pkg
