import pytest
from fastapi.testclient import TestClient


class TestBrain:
    def test_get_brain_status(self, client: TestClient, auth_headers):
        resp = client.get("/api/v1/brain/status", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "active_brain" in data

    def test_switch_brain(self, client: TestClient, auth_headers):
        resp = client.post("/api/v1/brain/switch", headers=auth_headers, json={
            "target_brain": "network",
        })
        assert resp.status_code in (200, 400)
        if resp.status_code == 200:
            data = resp.json()
            assert data.get("active_brain") == "network"

    def test_fusion_search(self, client: TestClient, auth_headers):
        resp = client.get("/api/v1/brain/search?q=test", headers=auth_headers)
        assert resp.status_code in (200, 422)
        if resp.status_code == 200:
            data = resp.json()
            assert "results" in data

    def test_fusion_search_post(self, client: TestClient, auth_headers):
        resp = client.post("/api/v1/brain/search", headers=auth_headers, json={
            "query": "test query",
            "limit": 10,
        })
        assert resp.status_code in (200, 422)
        if resp.status_code == 200:
            data = resp.json()
            assert "results" in data

    def test_brain_stats(self, client: TestClient, auth_headers):
        resp = client.get("/api/v1/brain/stats", headers=auth_headers)
        assert resp.status_code in (200, 404)
        if resp.status_code == 200:
            data = resp.json()
            assert "personal" in data or "network" in data

    def test_cross_links(self, client: TestClient, auth_headers):
        resp = client.get("/api/v1/brain/cross-links", headers=auth_headers)
        assert resp.status_code in (200, 404)
