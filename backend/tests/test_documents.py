import io
import os
import uuid
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.base import User
from app.core.security import get_password_hash, create_access_token


def _make_user(db: Session, email: str) -> User:
    user = User(
        id=str(uuid.uuid4()),
        email=email,
        name="Test User",
        password_hash=get_password_hash("TestPass123"),
        status="active",
        subscription_tier="free",
        subscription_status="active",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _make_auth_headers(user: User) -> dict:
    token = create_access_token(data={"sub": user.id, "email": user.email})
    return {"Authorization": f"Bearer {token}"}


def test_upload_txt_document(client: TestClient, db_session: Session):
    user = _make_user(db_session, "doc1@example.com")
    headers = _make_auth_headers(user)
    file = io.BytesIO(b"Hello world from document.")
    res = client.post(
        "/api/v1/documents/",
        files={"file": ("test.txt", file, "text/plain")},
        headers=headers,
    )
    assert res.status_code == 201, res.text
    data = res.json()
    assert data["original_name"] == "test.txt"
    assert data["extraction_status"] == "success"
    assert "Hello world" in (data["content_text"] or "")


def test_upload_pdf_document(client: TestClient, db_session: Session):
    user = _make_user(db_session, "doc2@example.com")
    headers = _make_auth_headers(user)
    # Minimal valid PDF content
    pdf_content = b"%PDF-1.4\n1 0 obj\n<<\n/Type /Catalog\n/Pages 2 0 R\n>>\nendobj\n2 0 obj\n<<\n/Type /Pages\n/Kids []\n/Count 0\n>>\nendobj\nxref\n0 3\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \ntrailer\n<<\n/Size 3\n/Root 1 0 R\n>>\nstartxref\n112\n%%EOF\n"
    file = io.BytesIO(pdf_content)
    res = client.post(
        "/api/v1/documents/",
        files={"file": ("test.pdf", file, "application/pdf")},
        headers=headers,
    )
    assert res.status_code == 201, res.text
    data = res.json()
    assert data["original_name"] == "test.pdf"


def test_list_documents(client: TestClient, db_session: Session):
    user = _make_user(db_session, "doc3@example.com")
    headers = _make_auth_headers(user)
    client.post("/api/v1/documents/", files={"file": ("a.txt", io.BytesIO(b"a"), "text/plain")}, headers=headers)
    client.post("/api/v1/documents/", files={"file": ("b.txt", io.BytesIO(b"b"), "text/plain")}, headers=headers)
    res = client.get("/api/v1/documents/", headers=headers)
    assert res.status_code == 200
    assert len(res.json()) == 2


def test_delete_document(client: TestClient, db_session: Session):
    user = _make_user(db_session, "doc4@example.com")
    headers = _make_auth_headers(user)
    create_res = client.post("/api/v1/documents/", files={"file": ("c.txt", io.BytesIO(b"c"), "text/plain")}, headers=headers)
    doc_id = create_res.json()["id"]
    res = client.delete(f"/api/v1/documents/{doc_id}", headers=headers)
    assert res.status_code == 204
    get_res = client.get(f"/api/v1/documents/{doc_id}", headers=headers)
    assert get_res.status_code == 404


def test_save_document_to_knowledge(client: TestClient, db_session: Session):
    user = _make_user(db_session, "doc5@example.com")
    headers = _make_auth_headers(user)
    create_res = client.post(
        "/api/v1/documents/",
        files={"file": ("knowledge.txt", io.BytesIO(b"Document content for knowledge."), "text/plain")},
        headers=headers,
    )
    doc_id = create_res.json()["id"]
    res = client.post(f"/api/v1/documents/{doc_id}/save-to-knowledge", json={}, headers=headers)
    assert res.status_code == 200
    assert res.json()["knowledge_id"]


def test_unsupported_document_format(client: TestClient, db_session: Session):
    user = _make_user(db_session, "doc6@example.com")
    headers = _make_auth_headers(user)
    res = client.post(
        "/api/v1/documents/",
        files={"file": ("test.exe", io.BytesIO(b"binary"), "application/octet-stream")},
        headers=headers,
    )
    assert res.status_code == 400
