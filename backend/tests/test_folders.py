"""每脑文件夹树回归测试：
v1 创建 / 树列表带计数 / 重命名 / 移动防环 / 删除上提 / 归档归属校验 /
未归档语义（both 笔记归档在另一脑文件夹算未归档）/ 越权；
v2 知识单元（KU）纳入同一套树：归档 / 跨脑 400 / 未归档语义 / 删除上提 / 双计数。"""
import uuid
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app.core.security import create_access_token
from app.models.base import User, Note, KnowledgeUnit
from app.core.security import get_password_hash
from datetime import datetime, timezone


def _create_folder(client: TestClient, headers, name="文件夹", brain_side="personal", parent_id=None):
    payload = {"name": name, "brain_side": brain_side}
    if parent_id:
        payload["parent_id"] = parent_id
    resp = client.post("/api/v1/folders/", headers=headers, json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _create_note(client: TestClient, headers, title, brain_side="personal", folder_id=None):
    payload = {"title": title, "content": f"{title} 内容", "brain_side": brain_side}
    if folder_id:
        payload["folder_id"] = folder_id
    resp = client.post("/api/v1/notes/", headers=headers, json=payload)
    assert resp.status_code in (200, 201), resp.text
    return resp.json()


class TestFolderCRUD:
    def test_create_and_list_with_note_count(self, client: TestClient, auth_headers):
        folder = _create_folder(client, auth_headers, name="工作")
        assert folder["brain_side"] == "personal"
        assert folder["note_count"] == 0
        _create_note(client, auth_headers, "笔记A", folder_id=folder["id"])
        _create_note(client, auth_headers, "笔记B", folder_id=folder["id"])

        resp = client.get("/api/v1/folders/", headers=auth_headers, params={"brain_side": "personal"})
        assert resp.status_code == 200, resp.text
        items = resp.json()
        assert len(items) == 1
        assert items[0]["name"] == "工作"
        assert items[0]["note_count"] == 2
        # 另一个脑看不到
        resp = client.get("/api/v1/folders/", headers=auth_headers, params={"brain_side": "network"})
        assert resp.json() == []

    def test_create_child_folder(self, client: TestClient, auth_headers):
        parent = _create_folder(client, auth_headers, name="父夹")
        child = _create_folder(client, auth_headers, name="子夹", parent_id=parent["id"])
        assert child["parent_id"] == parent["id"]

    def test_create_parent_brain_mismatch_400(self, client: TestClient, auth_headers):
        net_folder = _create_folder(client, auth_headers, name="网夹", brain_side="network")
        resp = client.post("/api/v1/folders/", headers=auth_headers, json={
            "name": "错脑子夹", "brain_side": "personal", "parent_id": net_folder["id"],
        })
        assert resp.status_code == 400, resp.text

    def test_create_name_validation(self, client: TestClient, auth_headers):
        resp = client.post("/api/v1/folders/", headers=auth_headers, json={
            "name": "", "brain_side": "personal",
        })
        assert resp.status_code == 422, resp.text
        resp = client.post("/api/v1/folders/", headers=auth_headers, json={
            "name": "x" * 101, "brain_side": "personal",
        })
        assert resp.status_code == 422, resp.text

    def test_rename(self, client: TestClient, auth_headers):
        folder = _create_folder(client, auth_headers, name="旧名")
        resp = client.put(f"/api/v1/folders/{folder['id']}", headers=auth_headers, json={"name": "新名"})
        assert resp.status_code == 200, resp.text
        assert resp.json()["name"] == "新名"

    def test_move_cycle_prevented(self, client: TestClient, auth_headers):
        a = _create_folder(client, auth_headers, name="A")
        b = _create_folder(client, auth_headers, name="B", parent_id=a["id"])
        # A 移到自己下面
        resp = client.put(f"/api/v1/folders/{a['id']}", headers=auth_headers, json={"parent_id": a["id"]})
        assert resp.status_code == 400, resp.text
        # A 移到自己的后代 B 下面
        resp = client.put(f"/api/v1/folders/{a['id']}", headers=auth_headers, json={"parent_id": b["id"]})
        assert resp.status_code == 400, resp.text
        # B 移到根级合法
        resp = client.put(f"/api/v1/folders/{b['id']}", headers=auth_headers, json={"parent_id": None})
        assert resp.status_code == 200, resp.text
        assert resp.json()["parent_id"] is None

    def test_delete_promotes_children_and_notes(self, client: TestClient, auth_headers, db_session):
        parent = _create_folder(client, auth_headers, name="父夹")
        child = _create_folder(client, auth_headers, name="子夹", parent_id=parent["id"])
        note = _create_note(client, auth_headers, "夹内笔记", folder_id=parent["id"])

        resp = client.delete(f"/api/v1/folders/{parent['id']}", headers=auth_headers)
        assert resp.status_code == 200, resp.text

        # 子文件夹上提到根级（被删文件夹父级为空）
        resp = client.get("/api/v1/folders/", headers=auth_headers, params={"brain_side": "personal"})
        items = {f["id"]: f for f in resp.json()}
        assert parent["id"] not in items
        assert items[child["id"]]["parent_id"] is None
        # 笔记上提为未归档
        db_note = db_session.query(Note).filter(Note.id == note["id"]).first()
        assert db_note.folder_id is None

    def test_delete_promotes_to_grandparent(self, client: TestClient, auth_headers, db_session):
        grand = _create_folder(client, auth_headers, name="祖夹")
        parent = _create_folder(client, auth_headers, name="父夹", parent_id=grand["id"])
        child = _create_folder(client, auth_headers, name="子夹", parent_id=parent["id"])
        note = _create_note(client, auth_headers, "夹内笔记", folder_id=parent["id"])

        resp = client.delete(f"/api/v1/folders/{parent['id']}", headers=auth_headers)
        assert resp.status_code == 200, resp.text

        resp = client.get("/api/v1/folders/", headers=auth_headers, params={"brain_side": "personal"})
        items = {f["id"]: f for f in resp.json()}
        assert items[child["id"]]["parent_id"] == grand["id"]
        db_note = db_session.query(Note).filter(Note.id == note["id"]).first()
        assert db_note.folder_id == grand["id"]


class TestNoteFolderOwnership:
    def test_personal_note_into_network_folder_400(self, client: TestClient, auth_headers):
        net_folder = _create_folder(client, auth_headers, name="网夹", brain_side="network")
        resp = client.post("/api/v1/notes/", headers=auth_headers, json={
            "title": "个人笔记", "content": "内容", "brain_side": "personal",
            "folder_id": net_folder["id"],
        })
        assert resp.status_code == 400, resp.text

    def test_update_move_to_wrong_brain_folder_400(self, client: TestClient, auth_headers):
        net_folder = _create_folder(client, auth_headers, name="网夹", brain_side="network")
        note = _create_note(client, auth_headers, "个人笔记", brain_side="personal")
        resp = client.put(f"/api/v1/notes/{note['id']}", headers=auth_headers, json={
            "folder_id": net_folder["id"],
        })
        assert resp.status_code == 400, resp.text

    def test_both_note_can_go_any_brain(self, client: TestClient, auth_headers):
        net_folder = _create_folder(client, auth_headers, name="网夹", brain_side="network")
        note = _create_note(client, auth_headers, "双脑笔记", brain_side="both", folder_id=net_folder["id"])
        assert note["id"]

    def test_move_out_to_unfiled_with_null(self, client: TestClient, auth_headers, db_session):
        folder = _create_folder(client, auth_headers, name="工作")
        note = _create_note(client, auth_headers, "笔记", folder_id=folder["id"])
        resp = client.put(f"/api/v1/notes/{note['id']}", headers=auth_headers, json={"folder_id": None})
        assert resp.status_code == 200, resp.text
        db_note = db_session.query(Note).filter(Note.id == note["id"]).first()
        assert db_note.folder_id is None

    def test_folder_of_other_user_404(self, client: TestClient, auth_headers, db_session):
        other = User(
            id=str(uuid.uuid4()), email="other@example.com", name="Other",
            password_hash=get_password_hash("TestPass123"), status="active",
            created_at=datetime.now(timezone.utc),
        )
        db_session.add(other)
        db_session.commit()
        other_token = create_access_token(data={"sub": other.id, "email": other.email}, expires_delta=timedelta(days=1))
        other_headers = {"Authorization": f"Bearer {other_token}"}
        other_folder = _create_folder(client, other_headers, name="他人文件夹")

        # 用他人的 folder_id 归档自己的笔记 → 404
        resp = client.post("/api/v1/notes/", headers=auth_headers, json={
            "title": "笔记", "content": "内容", "folder_id": other_folder["id"],
        })
        assert resp.status_code == 404, resp.text
        # 操作他人文件夹 → 404
        resp = client.put(f"/api/v1/folders/{other_folder['id']}", headers=auth_headers, json={"name": "改名"})
        assert resp.status_code == 404, resp.text
        resp = client.delete(f"/api/v1/folders/{other_folder['id']}", headers=auth_headers)
        assert resp.status_code == 404, resp.text


class TestFolderFilterSemantics:
    def test_list_by_folder_id(self, client: TestClient, auth_headers):
        folder = _create_folder(client, auth_headers, name="工作")
        in_note = _create_note(client, auth_headers, "夹内", folder_id=folder["id"])
        _create_note(client, auth_headers, "夹外")
        resp = client.get("/api/v1/notes/", headers=auth_headers, params={"folder_id": folder["id"]})
        assert resp.status_code == 200, resp.text
        ids = [n["id"] for n in resp.json()]
        assert ids == [in_note["id"]]

    def test_unfiled_semantics(self, client: TestClient, auth_headers):
        p_folder = _create_folder(client, auth_headers, name="个人夹", brain_side="personal")
        n_folder = _create_folder(client, auth_headers, name="网络夹", brain_side="network")
        unfiled = _create_note(client, auth_headers, "未归档个人", brain_side="personal")
        filed_p = _create_note(client, auth_headers, "已归档个人", brain_side="personal", folder_id=p_folder["id"])
        # both 笔记归档在网络脑文件夹 → 在个人脑视图算未归档
        both_in_network = _create_note(client, auth_headers, "双脑归网络", brain_side="both", folder_id=n_folder["id"])

        resp = client.get("/api/v1/notes/", headers=auth_headers,
                          params={"brain_side": "personal", "folder_id": "none"})
        assert resp.status_code == 200, resp.text
        ids = [n["id"] for n in resp.json()]
        assert unfiled["id"] in ids
        assert both_in_network["id"] in ids, "both 笔记归档在另一脑文件夹应算未归档"
        assert filed_p["id"] not in ids

        # 网络脑视图：both_in_network 已归档，不算未归档
        resp = client.get("/api/v1/notes/", headers=auth_headers,
                          params={"brain_side": "network", "folder_id": "none"})
        ids = [n["id"] for n in resp.json()]
        assert both_in_network["id"] not in ids
        assert unfiled["id"] not in ids, "纯个人脑笔记不在网络脑未归档视图"

    def test_folder_filter_combines_with_search(self, client: TestClient, auth_headers):
        folder = _create_folder(client, auth_headers, name="工作")
        hit = _create_note(client, auth_headers, "赔偿记录", folder_id=folder["id"])
        _create_note(client, auth_headers, "赔偿记录夹外")
        resp = client.get("/api/v1/notes/", headers=auth_headers,
                          params={"folder_id": folder["id"], "q": "赔偿"})
        ids = [n["id"] for n in resp.json()]
        assert ids == [hit["id"]]


class TestBrainSideChangeUnfiles:
    """边角封堵（08-16）：单改 brain_side 不重传 folder_id 时，
    既有文件夹与新脑侧不兼容 → 自动移出（未归档），不留跨脑脏数据。"""

    def test_brain_side_change_unfiles_incompatible(self, client: TestClient, auth_headers):
        p_folder = _create_folder(client, auth_headers, name="个人夹", brain_side="personal")
        note = _create_note(client, auth_headers, "迁移笔记", brain_side="personal", folder_id=p_folder["id"])
        # 改成网络脑，不传 folder_id → 应自动移出
        r = client.put(f"/api/v1/notes/{note['id']}", headers=auth_headers, json={"brain_side": "network"})
        assert r.status_code == 200, r.text
        assert r.json().get("folder_id") is None

    def test_brain_side_change_to_both_keeps_folder(self, client: TestClient, auth_headers):
        p_folder = _create_folder(client, auth_headers, name="个人夹", brain_side="personal")
        note = _create_note(client, auth_headers, "双向笔记", brain_side="personal", folder_id=p_folder["id"])
        # 改成 both → 兼容，保留归档
        r = client.put(f"/api/v1/notes/{note['id']}", headers=auth_headers, json={"brain_side": "both"})
        assert r.status_code == 200, r.text
        assert r.json().get("folder_id") == p_folder["id"]


def _create_ku(db_session, user_id, brain_side="network", folder_id=None, content=None):
    """直接落库建知识单元（避开 POST 的查重合并路径）。"""
    ku = KnowledgeUnit(
        id=str(uuid.uuid4()), user_id=user_id,
        content_raw=content or f"知识内容 {uuid.uuid4()}",
        brain_side=brain_side, status="active", folder_id=folder_id,
    )
    db_session.add(ku)
    db_session.commit()
    db_session.refresh(ku)
    return ku


class TestKnowledgeFolder:
    """v2：知识单元纳入同一套文件夹树。"""

    def test_ku_assign_folder_and_dual_counts(self, client: TestClient, auth_headers, db_session, test_user):
        folder = _create_folder(client, auth_headers, name="工作")
        ku = _create_ku(db_session, test_user.id, brain_side="personal")
        resp = client.put(f"/api/v1/knowledge/{ku.id}", headers=auth_headers, json={"folder_id": folder["id"]})
        assert resp.status_code == 200, resp.text
        assert resp.json()["folder_id"] == folder["id"]
        _create_note(client, auth_headers, "同夹笔记", folder_id=folder["id"])

        resp = client.get("/api/v1/folders/", headers=auth_headers, params={"brain_side": "personal"})
        item = resp.json()[0]
        assert item["note_count"] == 1
        assert item["knowledge_count"] == 1

    def test_ku_wrong_brain_folder_400(self, client: TestClient, auth_headers, db_session, test_user):
        p_folder = _create_folder(client, auth_headers, name="个人夹", brain_side="personal")
        ku = _create_ku(db_session, test_user.id, brain_side="network")
        resp = client.put(f"/api/v1/knowledge/{ku.id}", headers=auth_headers, json={"folder_id": p_folder["id"]})
        assert resp.status_code == 400, resp.text

    def test_ku_move_out_with_explicit_null(self, client: TestClient, auth_headers, db_session, test_user):
        n_folder = _create_folder(client, auth_headers, name="网络夹", brain_side="network")
        ku = _create_ku(db_session, test_user.id, brain_side="network", folder_id=n_folder["id"])
        resp = client.put(f"/api/v1/knowledge/{ku.id}", headers=auth_headers, json={"folder_id": None})
        assert resp.status_code == 200, resp.text
        db_session.refresh(ku)
        assert ku.folder_id is None

    def test_ku_list_by_folder_id(self, client: TestClient, auth_headers, db_session, test_user):
        n_folder = _create_folder(client, auth_headers, name="网络夹", brain_side="network")
        in_ku = _create_ku(db_session, test_user.id, brain_side="network", folder_id=n_folder["id"])
        _create_ku(db_session, test_user.id, brain_side="network")
        resp = client.get("/api/v1/knowledge/", headers=auth_headers, params={"folder_id": n_folder["id"]})
        assert resp.status_code == 200, resp.text
        ids = [u["id"] for u in resp.json()]
        assert ids == [in_ku.id]

    def test_ku_unfiled_semantics(self, client: TestClient, auth_headers, db_session, test_user):
        p_folder = _create_folder(client, auth_headers, name="个人夹", brain_side="personal")
        n_folder = _create_folder(client, auth_headers, name="网络夹", brain_side="network")
        unfiled = _create_ku(db_session, test_user.id, brain_side="personal")
        filed_p = _create_ku(db_session, test_user.id, brain_side="personal", folder_id=p_folder["id"])
        # both 知识单元归档在网络脑文件夹 → 在个人脑视图算未归档
        both_in_network = _create_ku(db_session, test_user.id, brain_side="both", folder_id=n_folder["id"])

        resp = client.get("/api/v1/knowledge/", headers=auth_headers,
                          params={"brain_side": "personal", "folder_id": "none"})
        ids = [u["id"] for u in resp.json()]
        assert unfiled.id in ids
        assert both_in_network.id in ids, "both 知识单元归档在另一脑文件夹应算未归档"
        assert filed_p.id not in ids

        resp = client.get("/api/v1/knowledge/", headers=auth_headers,
                          params={"brain_side": "network", "folder_id": "none"})
        ids = [u["id"] for u in resp.json()]
        assert both_in_network.id not in ids
        assert unfiled.id not in ids, "纯个人脑知识单元不在网络脑未归档视图"

    def test_ku_promoted_on_folder_delete(self, client: TestClient, auth_headers, db_session, test_user):
        grand = _create_folder(client, auth_headers, name="祖夹")
        parent = _create_folder(client, auth_headers, name="父夹", parent_id=grand["id"])
        ku = _create_ku(db_session, test_user.id, brain_side="personal", folder_id=parent["id"])

        resp = client.delete(f"/api/v1/folders/{parent['id']}", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        db_session.refresh(ku)
        assert ku.folder_id == grand["id"]

        # 再删祖夹 → 上提到未归档
        resp = client.delete(f"/api/v1/folders/{grand['id']}", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        db_session.refresh(ku)
        assert ku.folder_id is None

    def test_ku_brain_side_change_evicts_incompatible_folder(self, client: TestClient, auth_headers, db_session, test_user):
        n_folder = _create_folder(client, auth_headers, name="网络夹", brain_side="network")
        ku = _create_ku(db_session, test_user.id, brain_side="network", folder_id=n_folder["id"])
        # 单改脑侧为 personal → 与既有网络脑文件夹不兼容，自动移出（同 notes 兜底）
        resp = client.put(f"/api/v1/knowledge/{ku.id}", headers=auth_headers, json={"brain_side": "personal"})
        assert resp.status_code == 200, resp.text
        assert resp.json()["brain_side"] == "personal"
        assert resp.json()["folder_id"] is None
