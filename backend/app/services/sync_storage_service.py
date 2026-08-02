"""Encrypted sync blob storage backend (S3-compatible, e.g. MinIO).

The server only handles opaque bytes; encryption/decryption happens on the
client.  This module is intentionally thin so it can be stubbed in tests.
"""

import uuid
from functools import lru_cache
from typing import Optional

import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import ClientError

from app.core.config import settings


@lru_cache()
def get_s3_client():
    s3_config = BotoConfig(
        s3={"addressing_style": "path" if settings.S3_PATH_STYLE else "auto"},
    )
    return boto3.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
        region_name=settings.S3_REGION or "us-east-1",
        use_ssl=settings.S3_USE_SSL,
        config=s3_config,
    )


def _ensure_bucket():
    client = get_s3_client()
    try:
        client.head_bucket(Bucket=settings.S3_BUCKET)
    except ClientError as exc:
        error_code = exc.response.get("Error", {}).get("Code", "Unknown")
        if error_code in ("404", "NoSuchBucket", "BucketNotFound"):
            client.create_bucket(Bucket=settings.S3_BUCKET)
        else:
            raise


def upload_encrypted_blob(user_id: str, device_id: str, data) -> str:
    """Upload an encrypted blob and return its S3 key.

    `data` may be raw bytes or a binary file object (streamed to S3 without
    loading the whole blob into memory).
    """
    _ensure_bucket()
    snapshot_id = uuid.uuid4().hex
    s3_key = f"sync/{user_id}/{snapshot_id}.enc"
    client = get_s3_client()
    client.put_object(
        Bucket=settings.S3_BUCKET,
        Key=s3_key,
        Body=data,
        ContentType="application/octet-stream",
        Metadata={"user-id": user_id, "device-id": device_id},
    )
    return s3_key


def download_encrypted_blob(s3_key: str) -> bytes:
    """Download raw encrypted bytes by S3 key."""
    client = get_s3_client()
    response = client.get_object(Bucket=settings.S3_BUCKET, Key=s3_key)
    return response["Body"].read()


def get_download_url(s3_key: str, expires_in: int = 300) -> str:
    """Generate a presigned URL for direct client download."""
    client = get_s3_client()
    return client.generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.S3_BUCKET, "Key": s3_key},
        ExpiresIn=expires_in,
    )


def delete_blob(s3_key: Optional[str]) -> None:
    if not s3_key:
        return
    client = get_s3_client()
    try:
        client.delete_object(Bucket=settings.S3_BUCKET, Key=s3_key)
    except ClientError:
        # Idempotent: ignore missing-object errors in cleanup paths.
        pass
