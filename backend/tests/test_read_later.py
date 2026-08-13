import uuid
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.base import User, ReadLaterItem
from app.core.security import get_password_hash, create_access_token


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


def _make_auth_headers(user: User) -> dict:
    token = create_access_token(data={"sub": user.id, "email": user.email})
    return {"Authorization": f"Bearer {token}"}


def test_create_read_later_item(client: TestClient, db_session: Session):
    user = _make_user(db_session, "rl1@example.com")
    headers = _make_auth_headers(user)
    res = client.post("/api/v1/read-later/items", json={
        "url": "https://example.com/article",
        "title": "Test Article",
    }, headers=headers)
    assert res.status_code == 201
    data = res.json()
    assert data["url"] == "https://example.com/article"
    assert data["title"] == "Test Article"
    assert data["status"] == "unread"


def test_list_read_later_items(client: TestClient, db_session: Session):
    user = _make_user(db_session, "rl2@example.com")
    headers = _make_auth_headers(user)
    client.post("/api/v1/read-later/items", json={"url": "https://example.com/a"}, headers=headers)
    client.post("/api/v1/read-later/items", json={"url": "https://example.com/b"}, headers=headers)
    res = client.get("/api/v1/read-later/items", headers=headers)
    assert res.status_code == 200
    assert len(res.json()) == 2


def test_update_read_later_item(client: TestClient, db_session: Session):
    user = _make_user(db_session, "rl3@example.com")
    headers = _make_auth_headers(user)
    create_res = client.post("/api/v1/read-later/items", json={"url": "https://example.com/c"}, headers=headers)
    item_id = create_res.json()["id"]
    res = client.put(f"/api/v1/read-later/items/{item_id}", json={"status": "read"}, headers=headers)
    assert res.status_code == 200
    assert res.json()["status"] == "read"
    assert res.json()["read_progress"] == 100


def test_delete_read_later_item(client: TestClient, db_session: Session):
    user = _make_user(db_session, "rl4@example.com")
    headers = _make_auth_headers(user)
    create_res = client.post("/api/v1/read-later/items", json={"url": "https://example.com/d"}, headers=headers)
    item_id = create_res.json()["id"]
    res = client.delete(f"/api/v1/read-later/items/{item_id}", headers=headers)
    assert res.status_code == 204
    get_res = client.get(f"/api/v1/read-later/items/{item_id}", headers=headers)
    assert get_res.status_code == 404


def test_save_read_later_to_knowledge(client: TestClient, db_session: Session):
    user = _make_user(db_session, "rl5@example.com")
    headers = _make_auth_headers(user)
    create_res = client.post("/api/v1/read-later/items", json={
        "url": "https://example.com/e",
        "title": "Knowledge Article",
        "excerpt": "This is the excerpt."
    }, headers=headers)
    item_id = create_res.json()["id"]
    res = client.post(f"/api/v1/read-later/items/{item_id}/save-to-knowledge", json={}, headers=headers)
    assert res.status_code == 200
    assert res.json()["knowledge_id"]


def test_create_read_later_duplicate_url_409(client: TestClient, db_session: Session):
    """稍后读防重：同用户同 URL 未归档条目重复添加返回 409。"""
    user = _make_user(db_session, "rl-dup@example.com")
    headers = _make_auth_headers(user)
    res1 = client.post("/api/v1/read-later/items", json={"url": "https://example.com/dup"}, headers=headers)
    assert res1.status_code == 201
    res2 = client.post("/api/v1/read-later/items", json={"url": "https://example.com/dup"}, headers=headers)
    assert res2.status_code == 409
