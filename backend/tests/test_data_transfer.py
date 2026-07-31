"""数据导出/导入（云同步快照底层）测试。"""
import uuid
from datetime import datetime, timezone

from app.models.base import Note, Tag, content_tags


def _make_tag(db_session, user_id, name="测试标签"):
    tag = Tag(id=str(uuid.uuid4()), user_id=user_id, name=name,
              created_at=datetime.now(timezone.utc))
    db_session.add(tag)
    db_session.commit()
    return tag


def test_export_contains_notes_and_content_tags(client, auth_headers, db_session, test_user, test_note):
    tag = _make_tag(db_session, test_user.id)
    db_session.execute(content_tags.insert().values(
        content_id=test_note.id, content_type="note", tag_id=tag.id))
    db_session.commit()

    resp = client.post("/api/v1/users/me/export", headers=auth_headers)
    assert resp.status_code == 200
    payload = resp.json()
    note_ids = [n["id"] for n in payload["data"]["notes"]]
    assert test_note.id in note_ids
    links = payload["data"]["content_tags"]
    assert any(l["content_id"] == test_note.id and l["tag_id"] == tag.id for l in links)


def test_import_restores_deleted_note(client, auth_headers, db_session, test_user, test_note):
    payload = client.post("/api/v1/users/me/export", headers=auth_headers).json()

    db_session.query(Note).filter(Note.id == test_note.id).delete()
    db_session.commit()
    assert db_session.query(Note).filter(Note.id == test_note.id).first() is None

    resp = client.post("/api/v1/users/me/import", json=payload, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["inserted"] >= 1
    restored = db_session.query(Note).filter(Note.id == test_note.id).first()
    assert restored is not None and restored.title == "Test Note"
    assert restored.user_id == test_user.id


def test_import_newer_wins(client, auth_headers, db_session, test_user, test_note):
    payload = client.post("/api/v1/users/me/export", headers=auth_headers).json()
    row = next(n for n in payload["data"]["notes"] if n["id"] == test_note.id)
    row["title"] = "云端新标题"
    row["updated_at"] = "2999-01-01T00:00:00"  # 明显比本地新

    resp = client.post("/api/v1/users/me/import", json=payload, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["updated"] >= 1
    db_session.expire_all()
    assert db_session.query(Note).filter(Note.id == test_note.id).first().title == "云端新标题"


def test_import_older_does_not_overwrite(client, auth_headers, db_session, test_user, test_note):
    payload = client.post("/api/v1/users/me/export", headers=auth_headers).json()
    row = next(n for n in payload["data"]["notes"] if n["id"] == test_note.id)
    row["title"] = "云端旧标题"
    row["updated_at"] = "2000-01-01T00:00:00"  # 明显比本地旧

    resp = client.post("/api/v1/users/me/import", json=payload, headers=auth_headers)
    assert resp.status_code == 200
    db_session.expire_all()
    assert db_session.query(Note).filter(Note.id == test_note.id).first().title == "Test Note"


def test_import_forces_current_user(client, auth_headers, db_session, test_user):
    payload = {"data": {"notes": [{
        "id": str(uuid.uuid4()),
        "user_id": "someone-else",
        "title": "越权测试",
        "content": "x",
        "status": "active",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }]}}
    resp = client.post("/api/v1/users/me/import", json=payload, headers=auth_headers)
    assert resp.status_code == 200
    note = db_session.query(Note).filter(Note.title == "越权测试").first()
    assert note is not None and note.user_id == test_user.id


def test_import_bad_payload(client, auth_headers):
    resp = client.post("/api/v1/users/me/import", json={"foo": "bar"}, headers=auth_headers)
    assert resp.status_code == 400


def test_import_requires_auth(client):
    resp = client.post("/api/v1/users/me/import", json={"data": {}})
    assert resp.status_code in (401, 403)
