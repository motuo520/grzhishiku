import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock, AsyncMock


class TestLLM:
    def test_llm_health(self, client: TestClient, auth_headers):
        resp = client.get("/api/v1/llm/health", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "connected" in data or "active_provider" in data

    def test_summarize_mock(self, client: TestClient, auth_headers):
        with patch("app.api.v1.endpoints.llm.chat_completion", new=AsyncMock(return_value="summary text")):
            resp = client.post("/api/v1/llm/summarize", headers=auth_headers, json={
                "text": "This is a long text that needs summarization. " * 20,
                "length": "short",
            })
            assert resp.status_code == 200
            data = resp.json()
            assert "summary" in data

    def test_extract_tags_mock(self, client: TestClient, auth_headers):
        with patch("app.api.v1.endpoints.llm.chat_completion", new=AsyncMock(return_value="python, fastapi, testing")):
            resp = client.post("/api/v1/llm/extract-tags", headers=auth_headers, json={
                "text": "Building APIs with Python and FastAPI is fun.",
            })
            assert resp.status_code == 200
            data = resp.json()
            assert "tags" in data
            assert isinstance(data["tags"], list)

    def test_routing_test(self, client: TestClient, auth_headers):
        resp = client.post("/api/v1/llm/route-test", headers=auth_headers, json={
            "message": "Hello",
            "brain_side": "both",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "provider" in data
        assert "model" in data

    def test_embed_mock(self, client: TestClient, auth_headers):
        with patch("app.services.llm_service.LLMService.embed") as mock_embed:
            mock_embed.return_value = [0.1] * 768
            resp = client.post("/api/v1/llm/embed", headers=auth_headers, json={
                "text": "Embedding test",
                "store": False,
            })
            assert resp.status_code == 200
            data = resp.json()
            assert "embedding" in data
            assert len(data["embedding"]) == 768

    def test_embed_batch_mock(self, client: TestClient, auth_headers):
        from app.services.llm_service import llm_service
        with patch.object(llm_service, "batch_embed", new=AsyncMock(return_value=[[0.1] * 768, [0.2] * 768])):
            resp = client.post("/api/v1/llm/embed-batch", headers=auth_headers, json={
                "texts": ["first", "second"],
            })
            assert resp.status_code == 200
            data = resp.json()
            assert data["count"] == 2
            assert len(data["embeddings"]) == 2
