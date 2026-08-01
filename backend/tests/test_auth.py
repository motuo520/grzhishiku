import pytest
from fastapi.testclient import TestClient


class TestAuth:
    def test_register_success(self, client: TestClient, register_user):
        resp = register_user("newuser@example.com", "NewPass123")
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"

    def test_register_weak_password(self, client: TestClient):
        resp = client.post("/api/v1/auth/register", json={
            "email": "weak@example.com",
            "password": "weak",
            "name": "Weak",
        })
        assert resp.status_code == 422

    def test_register_missing_uppercase(self, client: TestClient):
        resp = client.post("/api/v1/auth/register", json={
            "email": "weak2@example.com",
            "password": "weakpass123",
            "name": "Weak",
        })
        assert resp.status_code == 422

    def test_login_success(self, client: TestClient, test_user):
        resp = client.post("/api/v1/auth/login", json={
            "email": test_user.email,
            "password": "TestPass123",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data

    def test_login_wrong_password(self, client: TestClient, test_user):
        resp = client.post("/api/v1/auth/login", json={
            "email": test_user.email,
            "password": "WrongPass123",
        })
        assert resp.status_code == 401

    def test_refresh_token(self, client: TestClient, test_user_token):
        resp = client.post("/api/v1/auth/refresh", headers={
            "Authorization": f"Bearer {test_user_token}"
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data

    def test_logout(self, client: TestClient, test_user_token):
        resp = client.post("/api/v1/auth/logout", headers={
            "Authorization": f"Bearer {test_user_token}"
        })
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_change_password_success(self, client: TestClient, test_user, auth_headers):
        resp = client.post("/api/v1/auth/change-password", headers=auth_headers, json={
            "current_password": "TestPass123",
            "new_password": "NewPass456",
        })
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_change_password_wrong_current(self, client: TestClient, test_user, auth_headers):
        resp = client.post("/api/v1/auth/change-password", headers=auth_headers, json={
            "current_password": "WrongPass123",
            "new_password": "NewPass456",
        })
        assert resp.status_code == 400

    def test_change_password_weak_new(self, client: TestClient, test_user, auth_headers):
        resp = client.post("/api/v1/auth/change-password", headers=auth_headers, json={
            "current_password": "TestPass123",
            "new_password": "weak",
        })
        assert resp.status_code == 422

    def test_me_endpoint(self, client: TestClient, test_user, auth_headers):
        resp = client.get("/api/v1/users/me", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["email"] == test_user.email
