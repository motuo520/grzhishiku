import pytest
from fastapi.testclient import TestClient


class TestNotes:
    def test_create_note(self, client: TestClient, auth_headers):
        resp = client.post("/api/v1/notes", headers=auth_headers, json={
            "title": "My Note",
            "content": "Note content here",
            "tags": ["tag1", "tag2"],
        })
        assert resp.status_code in (200, 201)
        data = resp.json()
        assert data["title"] == "My Note"

    def test_create_note_too_long_title(self, client: TestClient, auth_headers):
        resp = client.post("/api/v1/notes", headers=auth_headers, json={
            "title": "x" * 201,
            "content": "content",
        })
        assert resp.status_code == 422

    def test_list_notes(self, client: TestClient, test_note, auth_headers):
        resp = client.get("/api/v1/notes", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert any(n["id"] == test_note.id for n in data)

    def test_get_note_detail(self, client: TestClient, test_note, auth_headers):
        resp = client.get(f"/api/v1/notes/{test_note.id}", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == test_note.id

    def test_update_note(self, client: TestClient, test_note, auth_headers):
        resp = client.patch(f"/api/v1/notes/{test_note.id}", headers=auth_headers, json={
            "title": "Updated Title",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["title"] == "Updated Title"

    def test_delete_note(self, client: TestClient, test_note, auth_headers):
        resp = client.delete(f"/api/v1/notes/{test_note.id}", headers=auth_headers)
        assert resp.status_code in (200, 204)

    def test_search_notes(self, client: TestClient, test_note, auth_headers):
        resp = client.get("/api/v1/notes?q=test", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)

    def test_note_tags_association(self, client: TestClient, auth_headers):
        # Create a note with tags
        resp = client.post("/api/v1/notes", headers=auth_headers, json={
            "title": "Tagged Note",
            "content": "content",
            "tags": ["python", "ai"],
        })
        assert resp.status_code in (200, 201)
        data = resp.json()
        tag_names = [t["name"] for t in data.get("tags", [])]
        assert "python" in tag_names or "ai" in tag_names
