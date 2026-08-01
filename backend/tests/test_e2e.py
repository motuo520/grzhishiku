import pytest
import uuid
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.core.database import Base, get_db
from app.core.security import get_password_hash
from app.models.base import User

# Setup test database (in-memory, shared across connections via StaticPool)
TEST_DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)

@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_conn, connection_record):
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()

TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base.metadata.create_all(bind=engine)

def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db

client = TestClient(app)


def _register(email: str, password: str):
    """Register a user directly (no email verification in the open-source edition)."""
    return client.post("/api/v1/auth/register", json={
        "email": email,
        "password": password,
    })


class TestAuthFlow:
    """End-to-end test: Registration -> Login -> Access protected routes"""

    def test_register(self):
        response = _register("test@example.com", "Password123")
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"
    
    def test_login(self):
        response = client.post("/api/v1/auth/login", json={
            "email": "test@example.com",
            "password": "Password123"
        })
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        return data["access_token"]
    
    def test_get_me(self):
        token = self.test_login()
        response = client.get("/api/v1/users/me", headers={
            "Authorization": f"Bearer {token}"
        })
        assert response.status_code == 200
        data = response.json()
        assert data["email"] == "test@example.com"
        # Registration derives the display name from the email prefix
        assert data["name"] == "test"

class TestCapsuleFlow:
    """End-to-end test: Create capsule -> List -> Unlock -> Dialogue"""
    
    @pytest.fixture
    def auth_token(self):
        _register("capsule@example.com", "Password123")
        response = client.post("/api/v1/auth/login", json={
            "email": "capsule@example.com",
            "password": "Password123"
        })
        return response.json()["access_token"]
    
    def test_create_capsule(self, auth_token):
        response = client.post("/api/v1/capsules", json={
            "content_type": "text",
            "content_body": "My first time capsule",
            "unlock_type": "temporal",
            "unlock_config": {"unlock_date": "2026-01-01T00:00:00"}
        }, headers={"Authorization": f"Bearer {auth_token}"})
        assert response.status_code == 201
        data = response.json()
        assert data["content_body"] == "My first time capsule"
        return data["id"]
    
    def test_list_capsules(self, auth_token):
        response = client.get("/api/v1/capsules", headers={
            "Authorization": f"Bearer {auth_token}"
        })
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
    
    def test_unlock_capsule(self, auth_token):
        capsule_id = self.test_create_capsule(auth_token)
        response = client.post(f"/api/v1/capsules/{capsule_id}/unlock", headers={
            "Authorization": f"Bearer {auth_token}"
        })
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True

class TestKnowledgeFlow:
    """End-to-end test: Add knowledge -> Verify -> Stats"""
    
    @pytest.fixture
    def auth_token(self):
        _register("knowledge@example.com", "Password123")
        response = client.post("/api/v1/auth/login", json={
            "email": "knowledge@example.com",
            "password": "Password123"
        })
        return response.json()["access_token"]
    
    def test_add_knowledge(self, auth_token):
        response = client.post("/api/v1/knowledge", json={
            "content_raw": "React 19 introduces new compiler features",
            "source_url": "https://react.dev",
            "source_title": "React Documentation"
        }, headers={"Authorization": f"Bearer {auth_token}"})
        assert response.status_code == 201
        data = response.json()
        assert data["content_raw"] == "React 19 introduces new compiler features"
        return data["id"]
    
    def test_verify_knowledge(self, auth_token):
        unit_id = self.test_add_knowledge(auth_token)
        response = client.post(f"/api/v1/knowledge/{unit_id}/verify", headers={
            "Authorization": f"Bearer {auth_token}"
        })
        assert response.status_code == 200
        data = response.json()
        assert "status" in data
    
    def test_knowledge_stats(self, auth_token):
        response = client.get("/api/v1/knowledge/stats", headers={
            "Authorization": f"Bearer {auth_token}"
        })
        assert response.status_code == 200
        data = response.json()
        assert "both" in data
        assert "total" in data["both"]

class TestAttentionFlow:
    """End-to-end test: Start deep work -> End -> Dashboard"""
    
    @pytest.fixture
    def auth_token(self):
        _register("attention@example.com", "Password123")
        response = client.post("/api/v1/auth/login", json={
            "email": "attention@example.com",
            "password": "Password123"
        })
        return response.json()["access_token"]
    
    def test_start_deep_work(self, auth_token):
        response = client.post("/api/v1/attention/deep-work", json={
            "task": "Focus testing",
            "planned_duration": 25
        }, headers={"Authorization": f"Bearer {auth_token}"})
        assert response.status_code == 201
        data = response.json()
        assert data["task"] == "Focus testing"
        return data["id"]
    
    def test_end_deep_work(self, auth_token):
        session_id = self.test_start_deep_work(auth_token)
        response = client.post(f"/api/v1/attention/deep-work/{session_id}/end", headers={
            "Authorization": f"Bearer {auth_token}"
        })
        assert response.status_code == 200
    
    def test_dashboard(self, auth_token):
        response = client.get("/api/v1/attention/dashboard", headers={
            "Authorization": f"Bearer {auth_token}"
        })
        assert response.status_code == 200
        data = response.json()
        assert "total_focus_today" in data

class TestHealth:
    def test_health_check(self):
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"
    
    def test_root(self):
        response = client.get("/")
        assert response.status_code == 200
        assert "Wenmo API" in response.json()["message"]
