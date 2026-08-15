"""QA 实测缺陷回归测试（0.2.62 轮，开源精简版适配）：
N01 搜索中文 bigram 兜底、P04 fetch-metadata 线程池卸载、R06 身份块防复读、
S03 安全事件日志、Y06 注销内容硬删、A01 时间戳 UTC 标记、P06 嵌入线程有界。
（主仓同文件还含注册验证码限流日志用例——开源版无邮件验证码通道，未移植。）"""
import logging
import threading
import uuid

import pytest
from fastapi.testclient import TestClient

from app.models.base import (
    Note, BrowserClip, KnowledgeUnit, Capsule, Tag, RssFeed, RssEntry,
    ReadLaterItem, Embedding, content_tags,
)
from app.models.chat import ChatConversation, ChatMessage


class TestChineseBigramSearch:
    """N01：q 参数整串子串匹配对中文长句 0 命中，加 bigram 命中比例兜底。"""

    LONG_QUERY = "劳动合同纠纷的赔偿标准"
    HIT_CONTENT = "本院认为劳动合同纠纷中用人单位应支付经济补偿，具体赔偿标准按工作年限计算。"
    MISS_CONTENT = "今天天气不错，出门散步半小时，顺手买了点菜。"

    def test_notes_long_sentence_bigram_hit(self, client: TestClient, auth_headers):
        resp = client.post("/api/v1/notes/", headers=auth_headers, json={
            "title": "劳动维权记录", "content": self.HIT_CONTENT,
        })
        assert resp.status_code in (200, 201), resp.text
        resp = client.post("/api/v1/notes/", headers=auth_headers, json={
            "title": "无关笔记", "content": self.MISS_CONTENT,
        })
        assert resp.status_code in (200, 201), resp.text

        resp = client.get("/api/v1/notes/", headers=auth_headers, params={"q": self.LONG_QUERY})
        assert resp.status_code == 200, resp.text
        titles = [n["title"] for n in resp.json()]
        assert "劳动维权记录" in titles, "中文长句 bigram 兜底未命中"
        assert "无关笔记" not in titles, "bigram 兜底误中无关内容"

    def test_notes_short_query_unchanged(self, client: TestClient, auth_headers):
        resp = client.post("/api/v1/notes/", headers=auth_headers, json={
            "title": "短词命中", "content": "赔偿相关的短内容",
        })
        assert resp.status_code in (200, 201), resp.text
        note_id = resp.json()["id"]
        # 短查询（<4 字）维持原整串匹配口径
        resp = client.get("/api/v1/notes/", headers=auth_headers, params={"q": "赔偿"})
        assert resp.status_code == 200, resp.text
        assert any(n["id"] == note_id for n in resp.json())
        # 短查询无整串命中时不应被 bigram 兜底放大
        resp = client.get("/api/v1/notes/", headers=auth_headers, params={"q": "风筝"})
        assert resp.status_code == 200, resp.text
        assert not any(n["id"] == note_id for n in resp.json())

    def test_clips_long_sentence_bigram_hit(self, client: TestClient, auth_headers):
        resp = client.post("/api/v1/clips/", headers=auth_headers, json={
            "title": "判例剪藏", "url": "https://example.com/case-bigram",
            "excerpt": self.HIT_CONTENT,
        })
        assert resp.status_code in (200, 201), resp.text
        clip_id = resp.json()["id"]
        resp = client.get("/api/v1/clips/", headers=auth_headers, params={"q": self.LONG_QUERY})
        assert resp.status_code == 200, resp.text
        assert any(c["id"] == clip_id for c in resp.json()), "clips 中文长句 bigram 兜底未命中"

    def test_knowledge_long_sentence_bigram_hit(self, client: TestClient, auth_headers, db_session, test_user):
        ku = KnowledgeUnit(
            id=str(uuid.uuid4()), user_id=test_user.id,
            content_raw=self.HIT_CONTENT, status="active",
        )
        db_session.add(ku)
        db_session.commit()
        resp = client.get("/api/v1/knowledge/", headers=auth_headers, params={"q": self.LONG_QUERY})
        assert resp.status_code == 200, resp.text
        assert any(k["id"] == ku.id for k in resp.json()), "knowledge 中文长句 bigram 兜底未命中"


class TestFetchMetadataOffload:
    """P04：fetch-metadata 同步抓取拖死事件循环，卸载到线程池并发执行。"""

    def test_fetch_metadata_runs_in_executor(self, client: TestClient, auth_headers, monkeypatch):
        from app.api.v1.endpoints import clips as clips_module

        thread_names = []

        def fake_fetch(url):
            thread_names.append(threading.current_thread().name)
            return {"url": url, "title": f"T-{url}", "domain": "example.com", "excerpt": None, "error": None}

        monkeypatch.setattr(clips_module, "_fetch_url_metadata", fake_fetch)
        urls = ["https://a.example.com/1", "https://b.example.com/2", "https://c.example.com/3"]
        resp = client.post("/api/v1/clips/fetch-metadata", headers=auth_headers, json={"urls": urls})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert [r["url"] for r in body] == urls, "结果顺序应与请求 URL 顺序一致"
        assert thread_names and all("asyncio" in n for n in thread_names), \
            f"抓取未卸载到 executor 线程池: {thread_names}"


class TestIdentityPromptNoEcho:
    """R06：系统提示 [身份信息] 块须含禁止复述约束。"""

    def test_identity_prompt_forbids_echo(self):
        from app.api.v1.endpoints.llm import _build_identity_prompt
        prompt = _build_identity_prompt("platform:qwen2.5:0.5b")
        assert "[身份信息]" in prompt
        assert "qwen2.5:0.5b" in prompt and "platform:qwen" not in prompt
        assert "不要在回答中复述" in prompt


class TestSecurityEventLogs:
    """S03：登录失败/无效 token/吊销重放须落 logger.warning 安全日志。"""

    def test_login_failed_logged(self, client: TestClient, test_user, caplog):
        with caplog.at_level(logging.WARNING, logger="app.security"):
            resp = client.post("/api/v1/auth/login", json={
                "email": test_user.email, "password": "WrongPass123",
            })
        assert resp.status_code == 401, resp.text
        assert any("login_failed" in r.getMessage() for r in caplog.records), caplog.text
        # 不记密码本体
        assert "WrongPass123" not in caplog.text

    def test_invalid_token_logged(self, client: TestClient, caplog):
        with caplog.at_level(logging.WARNING, logger="app.security"):
            resp = client.get("/api/v1/notes/", headers={"Authorization": "Bearer not-a-token"})
        assert resp.status_code == 401, resp.text
        assert any("invalid_token" in r.getMessage() for r in caplog.records), caplog.text

    def test_revoked_token_replay_logged(self, client: TestClient, test_user, caplog):
        from datetime import timedelta
        from app.core.security import create_access_token
        # token_version 偏离当前用户值，模拟改密/登出后的旧 token 重放
        stale = create_access_token(
            data={"sub": test_user.id, "email": test_user.email},
            expires_delta=timedelta(days=1),
            token_version=int(getattr(test_user, "token_version", None) or 0) + 5,
        )
        with caplog.at_level(logging.WARNING, logger="app.security"):
            resp = client.get("/api/v1/notes/", headers={"Authorization": f"Bearer {stale}"})
        assert resp.status_code == 401, resp.text
        assert any("revoked_token_replay" in r.getMessage() for r in caplog.records), caplog.text
        # 不记 token 本体
        assert stale not in caplog.text


class TestAccountDeleteHardDeletesContent:
    """Y06：注销不能只软删用户行，其内容表记录须硬删干净。"""

    def test_delete_account_removes_all_content(self, client: TestClient, db_session, test_user, auth_headers):
        uid = test_user.id
        note_id, clip_id, ku_id, tag_id = (str(uuid.uuid4()) for _ in range(4))
        capsule_id, rl_id, feed_id, entry_id = (str(uuid.uuid4()) for _ in range(4))
        conv_id, msg_id, emb_id = (str(uuid.uuid4()) for _ in range(3))

        db_session.add(Note(id=note_id, user_id=uid, title="t", content="c", status="active"))
        db_session.add(BrowserClip(id=clip_id, user_id=uid, title="t", url="https://x.example", domain="x.example", status="active"))
        db_session.add(KnowledgeUnit(id=ku_id, user_id=uid, content_raw="k", status="active"))
        db_session.add(Capsule(id=capsule_id, user_id=uid, content_body="c", unlock_config="{}", unlock_status="locked", status="active"))
        db_session.add(Tag(id=tag_id, user_id=uid, name="标签"))
        db_session.add(ReadLaterItem(id=rl_id, user_id=uid, url="https://x.example/a"))
        db_session.add(RssFeed(id=feed_id, user_id=uid, url="https://x.example/feed"))
        db_session.add(RssEntry(id=entry_id, user_id=uid, feed_id=feed_id, link="https://x.example/e"))
        db_session.add(Embedding(id=emb_id, user_id=uid, content_type="note", content_id=note_id, embedding_json="[0.1]"))
        db_session.add(ChatConversation(id=conv_id, user_id=uid, title="会话"))
        db_session.add(ChatMessage(id=msg_id, conversation_id=conv_id, role="user", content="问"))
        db_session.commit()
        db_session.execute(content_tags.insert().values(
            content_id=note_id, content_type="note", tag_id=tag_id,
        ))
        db_session.commit()

        resp = client.request("DELETE", "/api/v1/users/me/account", headers=auth_headers, json={
            "password": "TestPass123", "confirmation": "删除我的账户",
        })
        assert resp.status_code == 200, resp.text

        db_session.expire_all()
        for model in (Note, BrowserClip, KnowledgeUnit, Capsule, Tag,
                      ReadLaterItem, RssFeed, RssEntry, Embedding, ChatConversation):
            remaining = db_session.query(model).filter(model.user_id == uid).count()
            assert remaining == 0, f"{model.__tablename__} 注销后残留 {remaining} 行"
        assert db_session.query(ChatMessage).filter(ChatMessage.conversation_id == conv_id).count() == 0
        assert db_session.execute(
            content_tags.select().where(content_tags.c.tag_id == tag_id)
        ).first() is None, "content_tags 关联注销后残留"
        # 账号本体仍是软删
        user = db_session.query(type(test_user)).filter_by(id=uid).first()
        assert user.status == "deleted"


class TestTimestampTimezone:
    """A01：API 返回的 datetime 须带 UTC 标记（Z 或 +00:00）。"""

    def test_notes_list_created_at_has_tz(self, client: TestClient, auth_headers, test_note):
        resp = client.get("/api/v1/notes/", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        item = next(n for n in resp.json() if n["id"] == test_note.id)
        created = item["created_at"]
        assert created.endswith("Z") or "+00:00" in created, f"naive 时间戳: {created}"


class TestNoteEmbedWorkersBounded:
    """P06：批量写入后嵌入派发须有界（固定 worker 池），不再逐条 spawn 线程。"""

    def test_enqueue_uses_bounded_worker_pool(self, monkeypatch):
        from app.services import note_embedding_service as nes

        processed = []
        lock = threading.Lock()

        def fake_embed(note_id, user_id=""):
            with lock:
                processed.append(note_id)

        monkeypatch.setattr(nes, "embed_note", fake_embed)
        ids = [str(uuid.uuid4()) for _ in range(50)]
        for nid in ids:
            nes._enqueue_embed(nid, "u")
        nes._embed_queue.join()
        assert sorted(processed) == sorted(ids), "有界派发不得丢笔记"
        workers = [t for t in threading.enumerate() if t.name.startswith("note-embed-")]
        assert 0 < len(workers) <= nes._EMBED_WORKERS, \
            f"worker 线程数必须有界: {[t.name for t in workers]}"
        assert all(t.daemon for t in workers)

    def test_duplicate_enqueue_deduped(self, monkeypatch):
        from app.services import note_embedding_service as nes

        gate = threading.Event()
        started = threading.Event()

        def slow_embed(note_id, user_id=""):
            started.set()
            gate.wait(timeout=5)

        monkeypatch.setattr(nes, "embed_note", slow_embed)
        nid = str(uuid.uuid4())
        try:
            nes._enqueue_embed(nid, "u")
            # 等 worker 取出（出队标记先清，跑着的这条占住 worker）
            assert started.wait(timeout=5)
            # worker 正在跑：此时入队应成功挂上（重嵌幂等允许补一次），
            # 但同一 id 已在队列里再入队必须去重
            nes._enqueue_embed(nid, "u")
            nes._enqueue_embed(nid, "u")
            assert nes._embed_queue.qsize() == 1
        finally:
            gate.set()
        nes._embed_queue.join()
