# -*- coding: utf-8 -*-
"""素材池批量删除端点回归（08-20）：

6 类内容各补 DELETE /{prefix}/batch（body {"ids": [...]}，返回 {"deleted": n}）：
1. 批量删 2~3 条后列表不可见/单条 404（语义与各自单删一致：软删或硬删）；
2. 他人内容混入 ids 不被误删、不计数（空间口径幂等，只少删不报错）；
3. ids 超过 500 直接 422；
4. 路由可达：/batch 不被 /{xxx_id} 的 DELETE 抢路由（血泪 #10）——
   若被抢路由，响应会是 404/204 而非 {"deleted": n}，主用例天然覆盖。
"""
import uuid
from datetime import datetime, timezone

from app.core.security import get_password_hash
from app.models.base import (
    User, BrowserClip, KnowledgeUnit, Capsule,
    ReadLaterItem, Document, RssFeed, RssEntry,
)

_NOW = lambda: datetime.now(timezone.utc)


def _mk_user(db_session, email):
    """直建第二个用户，验证跨用户内容不被误删。"""
    user = User(
        id=str(uuid.uuid4()),
        email=email,
        name="Other User",
        password_hash=get_password_hash("TestPass123"),
        status="active",
        created_at=_NOW(),
    )
    db_session.add(user)
    db_session.commit()
    return user


def _mk_clip(db_session, user_id):
    c = BrowserClip(
        id=str(uuid.uuid4()), user_id=user_id, title="剪藏", url="https://example.com/a",
        domain="example.com", status="active", created_at=_NOW(),
    )
    db_session.add(c)
    db_session.commit()
    return c.id


def _mk_knowledge(db_session, user_id):
    k = KnowledgeUnit(
        id=str(uuid.uuid4()), user_id=user_id, content_raw="知识内容",
        verification_status="unverified", status="active", created_at=_NOW(),
    )
    db_session.add(k)
    db_session.commit()
    return k.id


def _mk_capsule(db_session, user_id):
    c = Capsule(
        id=str(uuid.uuid4()), user_id=user_id, content_body="胶囊内容",
        unlock_config='{"date": "2025-01-01"}', unlock_status="locked",
        status="active", created_at=_NOW(),
    )
    db_session.add(c)
    db_session.commit()
    return c.id


def _mk_read_later(db_session, user_id):
    i = ReadLaterItem(
        id=str(uuid.uuid4()), user_id=user_id, title="稍后再读",
        url="https://example.com/b", domain="example.com",
        status="unread", item_status="active", created_at=_NOW(),
    )
    db_session.add(i)
    db_session.commit()
    return i.id


def _mk_document(db_session, user_id):
    d = Document(
        id=str(uuid.uuid4()), user_id=user_id, title="文档",
        original_name="a.txt", file_path=f"uploads/{uuid.uuid4()}.txt",
        file_type="txt", doc_status="active", created_at=_NOW(),
    )
    db_session.add(d)
    db_session.commit()
    return d.id


def _mk_feed(db_session, user_id):
    f = RssFeed(
        id=str(uuid.uuid4()), user_id=user_id, title="订阅源",
        url="https://example.com/feed", status="active", created_at=_NOW(),
    )
    db_session.add(f)
    db_session.commit()
    return f.id


def _mk_entry(db_session, user_id, feed_id):
    e = RssEntry(
        id=str(uuid.uuid4()), feed_id=feed_id, user_id=user_id,
        title="条目", link=f"https://example.com/{uuid.uuid4()}",
        status="active", created_at=_NOW(),
    )
    db_session.add(e)
    db_session.commit()
    return e.id


class TestBatchDeleteClips:
    def test_batch_delete_clips(self, client, db_session, test_user, auth_headers):
        other = _mk_user(db_session, "other-clips@example.com")
        ids = [_mk_clip(db_session, test_user.id) for _ in range(3)]
        foreign_id = _mk_clip(db_session, other.id)

        r = client.request("DELETE", "/api/v1/clips/batch", json={"ids": ids + [foreign_id]}, headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["deleted"] == 3  # 他人的不计数
        for cid in ids:
            assert db_session.get(BrowserClip, cid).status == "deleted"
            assert client.get(f"/api/v1/clips/{cid}", headers=auth_headers).status_code == 404
        # 他人内容不被误删
        assert db_session.get(BrowserClip, foreign_id).status == "active"

    def test_ids_over_limit_422(self, client, test_user, auth_headers):
        r = client.request("DELETE", "/api/v1/clips/batch", json={"ids": [str(i) for i in range(501)]}, headers=auth_headers)
        assert r.status_code == 422


class TestBatchDeleteKnowledge:
    def test_batch_delete_knowledge(self, client, db_session, test_user, auth_headers):
        other = _mk_user(db_session, "other-knowledge@example.com")
        ids = [_mk_knowledge(db_session, test_user.id) for _ in range(2)]
        foreign_id = _mk_knowledge(db_session, other.id)

        r = client.request("DELETE", "/api/v1/knowledge/batch", json={"ids": ids + [foreign_id]}, headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["deleted"] == 2
        for kid in ids:
            assert db_session.get(KnowledgeUnit, kid).status == "deleted"
            assert client.get(f"/api/v1/knowledge/{kid}", headers=auth_headers).status_code == 404
        assert db_session.get(KnowledgeUnit, foreign_id).status == "active"

    def test_ids_over_limit_422(self, client, test_user, auth_headers):
        r = client.request("DELETE", "/api/v1/knowledge/batch", json={"ids": [str(i) for i in range(501)]}, headers=auth_headers)
        assert r.status_code == 422


class TestBatchDeleteCapsules:
    def test_batch_delete_capsules(self, client, db_session, test_user, auth_headers):
        other = _mk_user(db_session, "other-capsules@example.com")
        ids = [_mk_capsule(db_session, test_user.id) for _ in range(2)]
        foreign_id = _mk_capsule(db_session, other.id)

        r = client.request("DELETE", "/api/v1/capsules/batch", json={"ids": ids + [foreign_id]}, headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["deleted"] == 2
        for cid in ids:
            # 胶囊是硬删：行不存在 + 详情 404
            assert db_session.get(Capsule, cid) is None
            assert client.get(f"/api/v1/capsules/{cid}", headers=auth_headers).status_code == 404
        assert db_session.get(Capsule, foreign_id) is not None

    def test_ids_over_limit_422(self, client, test_user, auth_headers):
        r = client.request("DELETE", "/api/v1/capsules/batch", json={"ids": [str(i) for i in range(501)]}, headers=auth_headers)
        assert r.status_code == 422


class TestBatchDeleteReadLater:
    def test_batch_delete_read_later(self, client, db_session, test_user, auth_headers):
        other = _mk_user(db_session, "other-rl@example.com")
        ids = [_mk_read_later(db_session, test_user.id) for _ in range(3)]
        foreign_id = _mk_read_later(db_session, other.id)

        r = client.request("DELETE", "/api/v1/read-later/items/batch", json={"ids": ids + [foreign_id]}, headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["deleted"] == 3
        for iid in ids:
            assert db_session.get(ReadLaterItem, iid).item_status == "deleted"
            assert client.get(f"/api/v1/read-later/items/{iid}", headers=auth_headers).status_code == 404
        assert db_session.get(ReadLaterItem, foreign_id).item_status == "active"

    def test_ids_over_limit_422(self, client, test_user, auth_headers):
        r = client.request("DELETE", "/api/v1/read-later/items/batch", json={"ids": [str(i) for i in range(501)]}, headers=auth_headers)
        assert r.status_code == 422


class TestBatchDeleteDocuments:
    def test_batch_delete_documents(self, client, db_session, test_user, auth_headers):
        other = _mk_user(db_session, "other-docs@example.com")
        ids = [_mk_document(db_session, test_user.id) for _ in range(2)]
        foreign_id = _mk_document(db_session, other.id)

        r = client.request("DELETE", "/api/v1/documents/batch", json={"ids": ids + [foreign_id]}, headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["deleted"] == 2
        for did in ids:
            assert db_session.get(Document, did).doc_status == "deleted"
            assert client.get(f"/api/v1/documents/{did}", headers=auth_headers).status_code == 404
        assert db_session.get(Document, foreign_id).doc_status == "active"

    def test_ids_over_limit_422(self, client, test_user, auth_headers):
        r = client.request("DELETE", "/api/v1/documents/batch", json={"ids": [str(i) for i in range(501)]}, headers=auth_headers)
        assert r.status_code == 422


class TestBatchDeleteRssEntries:
    def test_batch_delete_entries(self, client, db_session, test_user, auth_headers):
        other = _mk_user(db_session, "other-rss@example.com")
        feed_id = _mk_feed(db_session, test_user.id)
        other_feed_id = _mk_feed(db_session, other.id)
        ids = [_mk_entry(db_session, test_user.id, feed_id) for _ in range(2)]
        foreign_id = _mk_entry(db_session, other.id, other_feed_id)

        r = client.request("DELETE", "/api/v1/rss/entries/batch", json={"ids": ids + [foreign_id]}, headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["deleted"] == 2
        # 列表不可见（entries 列表只出 active）
        r = client.get(f"/api/v1/rss/sources/{feed_id}/entries", headers=auth_headers)
        assert r.status_code == 200
        assert r.json() == []
        assert db_session.get(RssEntry, foreign_id).status == "active"

    def test_ids_over_limit_422(self, client, test_user, auth_headers):
        r = client.request("DELETE", "/api/v1/rss/entries/batch", json={"ids": [str(i) for i in range(501)]}, headers=auth_headers)
        assert r.status_code == 422
