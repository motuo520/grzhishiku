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
from app.models.llm_billing import LLMModel

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

# Seed system LLM models so billed AI endpoints have valid catalog rows.
def _seed_test_models():
    session = TestingSessionLocal(bind=engine.connect())
    try:
        models = [
            LLMModel(id="gpt-4", name="GPT-4", provider="openai", provider_model_id="gpt-4",
                     is_active=True, is_system=True, supports_streaming=True, context_length=8192,
                     cost_input_per_1k=0, cost_output_per_1k=0, price_input_per_1k=0, price_output_per_1k=0, currency="CNY"),
            LLMModel(id="ollama-qwen2.5", name="Ollama Qwen2.5", provider="ollama", provider_model_id="qwen2.5",
                     is_active=True, is_system=True, supports_streaming=True, context_length=8192,
                     cost_input_per_1k=0, cost_output_per_1k=0, price_input_per_1k=0, price_output_per_1k=0, currency="CNY"),
            LLMModel(id="ollama-nomic", name="Ollama Nomic Embed", provider="ollama", provider_model_id="nomic-embed-text",
                     is_active=True, is_system=True, supports_streaming=False, context_length=2048,
                     cost_input_per_1k=0, cost_output_per_1k=0, price_input_per_1k=0, price_output_per_1k=0, currency="CNY"),
            LLMModel(id="deepseek-v4-pro", name="DeepSeek V4 Pro", provider="deepseek", provider_model_id="deepseek-v4-pro",
                     is_active=True, is_system=True, supports_streaming=True, context_length=128000,
                     cost_input_per_1k=0, cost_output_per_1k=0, price_input_per_1k=0, price_output_per_1k=0, currency="CNY"),
            LLMModel(id="deepseek-v4-flash", name="DeepSeek V4 Flash", provider="deepseek", provider_model_id="deepseek-v4-flash",
                     is_active=True, is_system=True, supports_streaming=True, context_length=128000,
                     cost_input_per_1k=0, cost_output_per_1k=0, price_input_per_1k=0, price_output_per_1k=0, currency="CNY"),
        ]
        existing = {m.id for m in session.query(LLMModel.id).filter(
            LLMModel.id.in_(["gpt-4", "ollama-qwen2.5", "ollama-nomic", "deepseek-v4-pro", "deepseek-v4-flash"])
        ).all()}
        for model in models:
            if model.id not in existing:
                session.add(model)
        session.commit()
    finally:
        session.close()

_seed_test_models()

def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db

client = TestClient(app)

class TestAuthFlow:
    """End-to-end test: Registration -> Login -> Access protected routes"""
    
    def test_register(self):
        response = client.post("/api/v1/auth/register", json={
            "email": "test@example.com",
            "password": "Password123",
            "name": "Test User"
        })
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
        assert data["name"] == "Test User"

class TestCapsuleFlow:
    """End-to-end test: Create capsule -> List -> Unlock -> Dialogue"""
    
    @pytest.fixture
    def auth_token(self):
        client.post("/api/v1/auth/register", json={
            "email": "capsule@example.com",
            "password": "Password123",
            "name": "Capsule User"
        })
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
        client.post("/api/v1/auth/register", json={
            "email": "knowledge@example.com",
            "password": "Password123",
            "name": "Knowledge User"
        })
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
        client.post("/api/v1/auth/register", json={
            "email": "attention@example.com",
            "password": "Password123",
            "name": "Attention User"
        })
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
        assert "Personal Second Brain" in response.json()["message"]
