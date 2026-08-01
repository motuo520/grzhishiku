import io
import os
import uuid
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.base import SocialAccount, SocialMessage, User
from app.core.security import get_password_hash, create_access_token


def _make_auth_headers(user: User) -> dict:
    token = create_access_token(data={"sub": user.id, "email": user.email})
    return {"Authorization": f"Bearer {token}"}


def _make_user(db: Session, email: str) -> User:
    user = User(
        id=str(uuid.uuid4()),
        email=email,
        name="Test User",
        password_hash=get_password_hash("TestPass123"),
        status="active",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def test_create_social_account(client: TestClient, db_session: Session):
    user = _make_user(db_session, "social1@example.com")
    headers = _make_auth_headers(user)

    res = client.post("/api/v1/social/accounts", json={
        "provider": "wechat",
        "account_name": "家庭群"
    }, headers=headers)
    assert res.status_code == 201
    data = res.json()
    assert data["provider"] == "wechat"
    assert data["account_name"] == "家庭群"
    assert data["connection_type"] == "local_import"


def test_list_social_accounts(client: TestClient, db_session: Session):
    user = _make_user(db_session, "social2@example.com")
    headers = _make_auth_headers(user)

    client.post("/api/v1/social/accounts", json={"provider": "dingtalk"}, headers=headers)
    res = client.get("/api/v1/social/accounts", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert len(data) == 1
    assert data[0]["provider"] == "dingtalk"


def test_delete_social_account(client: TestClient, db_session: Session):
    user = _make_user(db_session, "social3@example.com")
    headers = _make_auth_headers(user)

    create_res = client.post("/api/v1/social/accounts", json={"provider": "feishu"}, headers=headers)
    account_id = create_res.json()["id"]

    del_res = client.delete(f"/api/v1/social/accounts/{account_id}", headers=headers)
    assert del_res.status_code == 204

    res = client.get("/api/v1/social/accounts", headers=headers)
    assert len(res.json()) == 0


def test_upload_wechat_txt(client: TestClient, db_session: Session):
    user = _make_user(db_session, "social4@example.com")
    headers = _make_auth_headers(user)

    create_res = client.post("/api/v1/social/accounts", json={
        "provider": "wechat",
        "account_name": "测试群"
    }, headers=headers)
    account_id = create_res.json()["id"]

    chat_text = """2023-01-15 14:32 张三: 大家好
2023-01-15 14:33 李四: 你好呀
2023-01-15 14:34 张三: https://example.com 这个链接看看"""

    file = io.BytesIO(chat_text.encode("utf-8"))
    res = client.post(
        f"/api/v1/social/accounts/{account_id}/upload",
        files={"file": ("chat.txt", file, "text/plain")},
        headers=headers,
    )
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["success"] is True
    assert data["parsed_count"] == 3

    messages_res = client.get("/api/v1/social/messages", headers=headers)
    assert messages_res.status_code == 200
    messages = messages_res.json()
    assert len(messages) == 3
    assert messages[0]["sender_name"] == "张三"
    assert "https://example.com" in messages[0]["content_text"]


def test_upload_dingtalk_csv(client: TestClient, db_session: Session):
    user = _make_user(db_session, "social5@example.com")
    headers = _make_auth_headers(user)

    create_res = client.post("/api/v1/social/accounts", json={
        "provider": "dingtalk",
        "account_name": "工作群"
    }, headers=headers)
    account_id = create_res.json()["id"]

    csv_text = "时间,发送者,内容\n2023-01-15 14:32,张三,今晚开会\n2023-01-15 14:33,李四,好的"
    file = io.BytesIO(csv_text.encode("utf-8-sig"))
    res = client.post(
        f"/api/v1/social/accounts/{account_id}/upload",
        files={"file": ("chat.csv", file, "text/csv")},
        headers=headers,
    )
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["parsed_count"] == 2


def test_upload_feishu_json(client: TestClient, db_session: Session):
    user = _make_user(db_session, "social6@example.com")
    headers = _make_auth_headers(user)

    create_res = client.post("/api/v1/social/accounts", json={
        "provider": "feishu",
        "account_name": "项目群"
    }, headers=headers)
    account_id = create_res.json()["id"]

    json_text = """[
        {"message_id": "msg1", "sender_name": "张三", "content": "需求文档已更新", "sent_at": "2023-01-15 14:32:00"},
        {"message_id": "msg2", "sender_name": "李四", "content": "收到", "sent_at": "2023-01-15 14:33:00"}
    ]"""
    file = io.BytesIO(json_text.encode("utf-8"))
    res = client.post(
        f"/api/v1/social/accounts/{account_id}/upload",
        files={"file": ("chat.json", file, "application/json")},
        headers=headers,
    )
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["parsed_count"] == 2


def test_message_deduplication(client: TestClient, db_session: Session):
    user = _make_user(db_session, "social7@example.com")
    headers = _make_auth_headers(user)

    create_res = client.post("/api/v1/social/accounts", json={"provider": "wechat"}, headers=headers)
    account_id = create_res.json()["id"]

    chat_text = "2023-01-15 14:32 张三: 重复内容\n2023-01-15 14:33 李四: 重复内容"

    # First upload
    file1 = io.BytesIO(chat_text.encode("utf-8"))
    res1 = client.post(
        f"/api/v1/social/accounts/{account_id}/upload",
        files={"file": ("chat.txt", file1, "text/plain")},
        headers=headers,
    )
    assert res1.json()["parsed_count"] == 2

    # Second upload of same content should skip all
    file2 = io.BytesIO(chat_text.encode("utf-8"))
    res2 = client.post(
        f"/api/v1/social/accounts/{account_id}/upload",
        files={"file": ("chat.txt", file2, "text/plain")},
        headers=headers,
    )
    assert res2.json()["parsed_count"] == 0
    assert res2.json()["skipped_count"] == 2


def test_save_message_to_knowledge(client: TestClient, db_session: Session):
    user = _make_user(db_session, "social8@example.com")
    headers = _make_auth_headers(user)

    create_res = client.post("/api/v1/social/accounts", json={"provider": "wechat"}, headers=headers)
    account_id = create_res.json()["id"]

    chat_text = "2023-01-15 14:32 张三: 这条消息要保存到知识库"
    file = io.BytesIO(chat_text.encode("utf-8"))
    upload_res = client.post(
        f"/api/v1/social/accounts/{account_id}/upload",
        files={"file": ("chat.txt", file, "text/plain")},
        headers=headers,
    )
    assert upload_res.status_code == 200
    message_id = upload_res.json()["parsed_count"] and client.get("/api/v1/social/messages", headers=headers).json()[0]["id"]

    res = client.post(
        f"/api/v1/social/messages/{message_id}/save-to-knowledge",
        json={},
        headers=headers,
    )
    assert res.status_code == 200, res.text
    assert res.json()["knowledge_id"]

    msg_res = client.get(f"/api/v1/social/messages/{message_id}", headers=headers)
    assert msg_res.json()["status"] == "imported_to_knowledge"


def test_delete_message(client: TestClient, db_session: Session):
    user = _make_user(db_session, "social9@example.com")
    headers = _make_auth_headers(user)

    create_res = client.post("/api/v1/social/accounts", json={"provider": "wechat"}, headers=headers)
    account_id = create_res.json()["id"]

    chat_text = "2023-01-15 14:32 张三: 临时消息"
    file = io.BytesIO(chat_text.encode("utf-8"))
    client.post(
        f"/api/v1/social/accounts/{account_id}/upload",
        files={"file": ("chat.txt", file, "text/plain")},
        headers=headers,
    )
    messages = client.get("/api/v1/social/messages", headers=headers).json()
    message_id = messages[0]["id"]

    del_res = client.delete(f"/api/v1/social/messages/{message_id}", headers=headers)
    assert del_res.status_code == 204

    msg_res = client.get(f"/api/v1/social/messages/{message_id}", headers=headers)
    assert msg_res.status_code == 404


def test_unsupported_file_extension(client: TestClient, db_session: Session):
    user = _make_user(db_session, "social10@example.com")
    headers = _make_auth_headers(user)

    create_res = client.post("/api/v1/social/accounts", json={"provider": "wechat"}, headers=headers)
    account_id = create_res.json()["id"]

    file = io.BytesIO(b"invalid")
    res = client.post(
        f"/api/v1/social/accounts/{account_id}/upload",
        files={"file": ("chat.pdf", file, "application/pdf")},
        headers=headers,
    )
    assert res.status_code == 400
    body = res.json()
    detail = body.get("detail") or body.get("message") or str(body)
    assert "不支持的文件格式" in detail
