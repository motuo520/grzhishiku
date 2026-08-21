# -*- coding: utf-8 -*-
"""标签清理修复回归（08-20）：

1. 幽灵关联行（内容已删/不存在，content_tags 行残留）不再让「空标签」删不掉——
   用量统计只数活内容；
2. DELETE /tags/orphaned 路由顺序回归：静态段必须先于 /{tag_id}（血泪 #10），
   否则清理按钮 404 假死；
3. 删除标签连带清关联行；清理/日扫顺带清幽灵行。
"""
import uuid
from datetime import datetime, timedelta

from app.models.base import Tag, Note, content_tags
from app.services import tag_service


def _mk_tag(db_session, user_id, name, created_at=None):
    t = Tag(id=str(uuid.uuid4()), user_id=user_id, name=name,
            created_at=created_at or datetime.now())
    db_session.add(t)
    db_session.commit()
    return t.id


def _mk_note(db_session, user_id, title="笔记", status="active"):
    n = Note(id=str(uuid.uuid4()), user_id=user_id, title=title, content="c",
             status=status, brain_side="personal",
             created_at=datetime.now(), updated_at=datetime.now())
    db_session.add(n)
    db_session.commit()
    return n.id


def _link(db_session, tag_id, content_id, ctype="note"):
    db_session.execute(
        content_tags.insert().values(tag_id=tag_id, content_id=content_id, content_type=ctype)
    )
    db_session.commit()


class TestGhostAssociation:
    def test_ghost_does_not_block_delete(self, client, db_session, test_user, auth_headers):
        """幽灵行（内容不存在）：标签可视上为空，删除必须放行。"""
        tid = _mk_tag(db_session, test_user.id, "ghost-tag")
        _link(db_session, tid, str(uuid.uuid4()))  # 指向不存在的笔记
        assert tag_service.get_tag_usage_count(db_session, tid) == 0  # 活口径为 0
        r = client.delete(f"/api/v1/tags/{tid}", headers=auth_headers)
        assert r.status_code == 204

    def test_deleted_content_does_not_block_delete(self, client, db_session, test_user, auth_headers):
        """内容软删后残留的行同样不算用量。"""
        tid = _mk_tag(db_session, test_user.id, "半幽灵")
        nid = _mk_note(db_session, test_user.id, status="deleted")
        _link(db_session, tid, nid)
        assert tag_service.get_tag_usage_count(db_session, tid) == 0
        r = client.delete(f"/api/v1/tags/{tid}", headers=auth_headers)
        assert r.status_code == 204

    def test_live_association_still_blocks(self, client, db_session, test_user, auth_headers):
        """活关联照常拦截删除（防误删语义不变）。"""
        tid = _mk_tag(db_session, test_user.id, "活标签")
        nid = _mk_note(db_session, test_user.id)
        _link(db_session, tid, nid)
        assert tag_service.get_tag_usage_count(db_session, tid) == 1
        r = client.delete(f"/api/v1/tags/{tid}", headers=auth_headers)
        assert r.status_code == 400

    def test_delete_tag_cascades_rows(self, client, db_session, test_user, auth_headers):
        """删除标签连带清 content_tags 行（含幽灵行），不留无头引用。"""
        tid = _mk_tag(db_session, test_user.id, "连根拔")
        _link(db_session, tid, str(uuid.uuid4()))
        r = client.delete(f"/api/v1/tags/{tid}", headers=auth_headers)
        assert r.status_code == 204
        n = db_session.query(content_tags).filter(content_tags.c.tag_id == tid).count()
        assert n == 0


class TestOrphanedRoute:
    def test_orphaned_route_reachable(self, client, db_session, test_user, auth_headers):
        """回归：/orphaned 曾在 /{tag_id} 之后注册被抢路由 404（血泪 #10）。"""
        tid = _mk_tag(db_session, test_user.id, "空标签甲")
        r = client.delete("/api/v1/tags/orphaned", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["deleted_count"] >= 1
        assert db_session.query(Tag).filter(Tag.id == tid).first() is None

    def test_cleanup_purges_ghost_rows(self, client, db_session, test_user, auth_headers):
        """清理顺带清幽灵行；只挂幽灵行的标签视为空标签回收。"""
        tid = _mk_tag(db_session, test_user.id, "幽灵独占")
        _link(db_session, tid, str(uuid.uuid4()))
        r = client.delete("/api/v1/tags/orphaned", headers=auth_headers)
        assert r.status_code == 200
        assert db_session.query(Tag).filter(Tag.id == tid).first() is None
        n = db_session.query(content_tags).filter(content_tags.c.tag_id == tid).count()
        assert n == 0


class TestSweep:
    def test_sweep_stale_empty_tags(self, db_session, test_user):
        """日扫：30 天以上的空标签回收；新空标签/有活关联的保留。"""
        old_empty = _mk_tag(db_session, test_user.id, "老空标签",
                            created_at=datetime.now() - timedelta(days=45))
        fresh_empty = _mk_tag(db_session, test_user.id, "新空标签")
        used = _mk_tag(db_session, test_user.id, "在用的老标签",
                       created_at=datetime.now() - timedelta(days=60))
        nid = _mk_note(db_session, test_user.id)
        _link(db_session, used, nid)

        deleted = tag_service.sweep_stale_empty_tags(db_session)
        db_session.commit()
        names = {t.name for t in db_session.query(Tag).filter(Tag.user_id == test_user.id)}
        assert "老空标签" not in names
        assert "新空标签" in names
        assert "在用的老标签" in names
        assert deleted >= 1
