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

    def test_refresh_token(self, client: TestClient, test_user_token, test_user):
        # access token 不能续期（防无限续期）
        resp = client.post("/api/v1/auth/refresh", headers={
            "Authorization": f"Bearer {test_user_token}"
        })
        assert resp.status_code == 401

        # refresh token 正常换新
        from app.core.security import create_access_token
        from datetime import timedelta
        refresh = create_access_token(
            data={"sub": test_user.id, "email": test_user.email, "token_use": "refresh"},
            expires_delta=timedelta(days=30),
        )
        resp = client.post("/api/v1/auth/refresh", headers={
            "Authorization": f"Bearer {refresh}"
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert data.get("refresh_token")

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


class TestTokenVersionRevocation:
    """BUG-Y05/S02：改密/登出后旧 token 必须失效（token_version 机制）。"""

    def test_change_password_revokes_old_token(self, client: TestClient, test_user):
        login = client.post("/api/v1/auth/login", json={
            "email": test_user.email,
            "password": "TestPass123",
        })
        assert login.status_code == 200
        old_token = login.json()["access_token"]
        old_headers = {"Authorization": f"Bearer {old_token}"}

        resp = client.post("/api/v1/auth/change-password", headers=old_headers, json={
            "current_password": "TestPass123",
            "new_password": "NewPass456",
        })
        assert resp.status_code == 200

        # 旧 token 重放应 401
        resp = client.get("/api/v1/users/me", headers=old_headers)
        assert resp.status_code == 401

        # 新密码登录拿到的新 token 可用
        login2 = client.post("/api/v1/auth/login", json={
            "email": test_user.email,
            "password": "NewPass456",
        })
        assert login2.status_code == 200
        new_headers = {"Authorization": f"Bearer {login2.json()['access_token']}"}
        resp = client.get("/api/v1/users/me", headers=new_headers)
        assert resp.status_code == 200

    def test_change_password_revokes_old_refresh_token(self, client: TestClient, test_user):
        login = client.post("/api/v1/auth/login", json={
            "email": test_user.email,
            "password": "TestPass123",
        })
        assert login.status_code == 200
        tokens = login.json()

        resp = client.post("/api/v1/auth/change-password", headers={
            "Authorization": f"Bearer {tokens['access_token']}"
        }, json={
            "current_password": "TestPass123",
            "new_password": "NewPass456",
        })
        assert resp.status_code == 200

        # 旧 refresh token 也应失效，否则改密可被绕过
        resp = client.post("/api/v1/auth/refresh", headers={
            "Authorization": f"Bearer {tokens['refresh_token']}"
        })
        assert resp.status_code == 401

    def test_logout_revokes_old_token(self, client: TestClient, test_user):
        login = client.post("/api/v1/auth/login", json={
            "email": test_user.email,
            "password": "TestPass123",
        })
        assert login.status_code == 200
        old_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

        resp = client.post("/api/v1/auth/logout", headers=old_headers)
        assert resp.status_code == 200

        # 登出后旧 token 重放应 401
        resp = client.get("/api/v1/users/me", headers=old_headers)
        assert resp.status_code == 401

    def test_fresh_token_still_valid(self, client: TestClient, test_user):
        # 未改密/登出时 token 正常使用（回归保护：版本校验不误伤）
        login = client.post("/api/v1/auth/login", json={
            "email": test_user.email,
            "password": "TestPass123",
        })
        assert login.status_code == 200
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        resp = client.get("/api/v1/users/me", headers=headers)
        assert resp.status_code == 200


class TestEmailNormalization:
    """BUG-Y01：注册/登录邮箱统一 strip+lower，禁止大小写变体重复注册。"""

    def test_register_duplicate_email_different_case(self, client: TestClient, register_user):
        resp = register_user("CaseDup@example.com", "TestPass123")
        assert resp.status_code == 200
        assert resp.json()["access_token"]

        resp2 = register_user("casedup@example.com", "TestPass123")
        assert resp2.status_code == 400

    def test_register_stores_lowercase_email(self, client: TestClient, register_user, db_session):
        from app.models.base import User
        resp = register_user("MixedCase@Example.COM", "TestPass123")
        assert resp.status_code == 200
        user = db_session.query(User).filter(User.email == "mixedcase@example.com").first()
        assert user is not None

    def test_login_email_case_insensitive(self, client: TestClient, register_user):
        resp = register_user("caselogin@example.com", "TestPass123")
        assert resp.status_code == 200

        login = client.post("/api/v1/auth/login", json={
            "email": "CaseLogin@Example.com",
            "password": "TestPass123",
        })
        assert login.status_code == 200
        assert "access_token" in login.json()
