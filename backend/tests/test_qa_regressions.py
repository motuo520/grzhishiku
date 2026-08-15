"""QA 实测缺陷回归测试（开源精简版适配）：标签删除 500、Obsidian 导入/导出 500、
导入通道存储型 XSS、auto_link 同步误 await。
（主仓同文件还含批量配额/剪藏防重/批量 domain 用例——开源版无计费配额，未移植。）"""
import uuid

import pytest
from fastapi.testclient import TestClient

from app.models.base import Note, GraphEdge


class TestTagDelete:
    """Bug 1: tags.py 删除路径 NameError: _get_tag_usage_count -> 500。"""

    def test_delete_unused_tag(self, client: TestClient, auth_headers):
        resp = client.post("/api/v1/tags/", headers=auth_headers, json={"name": "待删除标签"})
        assert resp.status_code in (200, 201), resp.text
        tag_id = resp.json()["id"]
        resp = client.delete(f"/api/v1/tags/{tag_id}", headers=auth_headers)
        assert resp.status_code == 204, resp.text

    def test_delete_tag_in_use_conflict(self, client: TestClient, auth_headers):
        resp = client.post("/api/v1/notes/", headers=auth_headers, json={
            "title": "占用标签的笔记", "content": "正文", "tags": ["被占用"],
        })
        assert resp.status_code in (200, 201), resp.text
        tags = resp.json()["tags"]
        tag_id = next(t["id"] for t in tags if t["name"] == "被占用")
        resp = client.delete(f"/api/v1/tags/{tag_id}", headers=auth_headers)
        assert resp.status_code == 400, resp.text
        # 被占用的标签仍在
        resp = client.get(f"/api/v1/tags/{tag_id}", headers=auth_headers)
        assert resp.status_code == 200, resp.text


class TestObsidianBridge:
    """Bug 6: Obsidian 导入通道笔记正文未净化（存储型 XSS）。"""

    @pytest.fixture
    def obsidian_roots(self, tmp_path):
        # Settings 是 pydantic BaseSettings，monkeypatch teardown 的 delattr 会炸，
        # 直接操作实例 __dict__
        from app.core.config import settings
        settings.__dict__["OBSIDIAN_VAULT_ROOT"] = str(tmp_path)
        settings.__dict__["OBSIDIAN_EXPORT_ROOT"] = str(tmp_path)
        yield tmp_path
        settings.__dict__.pop("OBSIDIAN_VAULT_ROOT", None)
        settings.__dict__.pop("OBSIDIAN_EXPORT_ROOT", None)

    def _make_vault(self, tmp_path):
        vault = tmp_path / "vault"
        vault.mkdir()
        (vault / "a.md").write_text(
            "# 笔记A\n\n正文 <script>alert(1)</script> 引用 [[b]]\n", encoding="utf-8"
        )
        (vault / "b.md").write_text("# 笔记B\n\n内容\n", encoding="utf-8")
        return vault

    def test_import_obsidian(self, client: TestClient, auth_headers, db_session, obsidian_roots):
        vault = self._make_vault(obsidian_roots)
        resp = client.post("/api/v1/import/obsidian", headers=auth_headers, json={"vault_path": str(vault)})
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["notes_created"] == 2
        assert data["edges_created"] == 1
        # 存储型 XSS：正文中的 <script> 必须被转义
        note_a = db_session.query(Note).filter(Note.title == "a").first()
        assert note_a is not None
        assert "<script>" not in note_a.content
        assert "&lt;script&gt;" in note_a.content

    def test_export_markdown(self, client: TestClient, auth_headers, test_note, obsidian_roots):
        target = obsidian_roots / "out"
        resp = client.post("/api/v1/export/markdown", headers=auth_headers, json={"target_dir": str(target)})
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["exported_notes"] >= 1
        assert (target / "notes").is_dir()


class TestImportXss:
    """Bug 6: POST /users/me/import 笔记正文原始 HTML 直写库（存储型 XSS）。"""

    def test_users_import_sanitizes_note_content(self, client: TestClient, auth_headers):
        from datetime import datetime, timezone
        note_id = str(uuid.uuid4())
        payload = {"data": {"notes": [{
            "id": note_id,
            "title": "导入<script>alert(1)</script>",
            "content": "正文<script>alert(2)</script><iframe src=x>",
            "status": "active",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }]}}
        resp = client.post("/api/v1/users/me/import", headers=auth_headers, json=payload)
        assert resp.status_code == 200, resp.text
        assert resp.json()["inserted"] == 1
        resp = client.get(f"/api/v1/notes/{note_id}", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        note = resp.json()
        assert "<script>" not in note["content"]
        assert "<iframe" not in note["content"]
        assert "&lt;script&gt;" in note["content"]
        assert "<script>" not in note["title"]


class TestAutoLink:
    """Bug 7: 同步 auto_link_note 被 await -> 每条笔记创建抛 TypeError、图谱边不落库。"""

    def test_create_note_creates_graph_edges(self, client: TestClient, auth_headers, db_session, test_user):
        kw = "alpha beta gamma delta"
        resp1 = client.post("/api/v1/notes/", headers=auth_headers, json={
            "title": f"笔记一 {kw}", "content": f"正文 {kw}",
        })
        assert resp1.status_code in (200, 201), resp1.text
        resp2 = client.post("/api/v1/notes/", headers=auth_headers, json={
            "title": f"笔记二 {kw}", "content": f"正文 {kw} epsilon",
        })
        assert resp2.status_code in (200, 201), resp2.text
        edges = db_session.query(GraphEdge).filter(GraphEdge.user_id == test_user.id).all()
        assert len(edges) >= 1, "auto_link 未生成图谱边（同步函数被 await 的回归）"
