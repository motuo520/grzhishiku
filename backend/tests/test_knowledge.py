import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock


class TestKnowledge:
    def test_list_knowledge(self, client: TestClient, test_knowledge, auth_headers):
        resp = client.get("/api/v1/knowledge", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)

    def test_create_knowledge(self, client: TestClient, auth_headers):
        resp = client.post("/api/v1/knowledge", headers=auth_headers, json={
            "content_raw": "New knowledge content",
            "source_url": "https://example.com/source",
        })
        assert resp.status_code in (200, 201)
        data = resp.json()
        assert data["content_raw"] == "New knowledge content"

    def test_verify_knowledge_mock(self, client: TestClient, test_knowledge, auth_headers):
        with patch("app.services.llm_service.LLMService.chat") as mock_chat:
            mock_chat.return_value = iter(["verified"])
            resp = client.post(f"/api/v1/knowledge/{test_knowledge.id}/verify", headers=auth_headers)
            assert resp.status_code in (200, 202)

    def test_source_trace(self, client: TestClient, test_knowledge, auth_headers):
        resp = client.get(f"/api/v1/knowledge/{test_knowledge.id}/source", headers=auth_headers)
        assert resp.status_code in (200, 404)  # May not exist

    def test_domain_credibility(self, client: TestClient, auth_headers):
        resp = client.get("/api/v1/knowledge/domain/example.com", headers=auth_headers)
        assert resp.status_code in (200, 404)
