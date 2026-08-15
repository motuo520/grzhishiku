"""BUG-R02 回归：笔记向量化——事件监听挂载、长文档分块、先删后写幂等、存量回填。"""
import json
import threading
import uuid

import pytest
from sqlalchemy.orm import sessionmaker

from app.models.base import Note, Embedding as EmbeddingModel
from app.services import note_embedding_service as nes
from app.services.chunking import CHUNK_ID_SEP
from app.services.embedding_service import embedding_service


def _make_note(db_session, user_id, title="测试笔记", content="测试内容", status="active") -> Note:
    note = Note(
        id=str(uuid.uuid4()), user_id=user_id,
        title=title, content=content, status=status,
    )
    db_session.add(note)
    db_session.commit()
    return note


@pytest.fixture
def embed_env(db_session, monkeypatch):
    """把 note_embedding_service 的会话与 embedding_service 的写库路径引进测试事务，
    并用确定性假向量替代本机 Ollama。"""
    factory = sessionmaker(autocommit=False, autoflush=False)

    def new_session():
        return factory(bind=db_session.get_bind())

    monkeypatch.setattr(nes, "SessionLocal", new_session)

    async def fake_embed(text, store=False, content_type="query", content_id="", user_id=""):
        return {"embedding": [0.1, 0.2, 0.3], "dimensions": 3, "model_used": "ollama/test"}

    def fake_store(text, embedding, content_type, content_id, user_id, model):
        s = new_session()
        try:
            s.add(EmbeddingModel(
                id=str(uuid.uuid4()), user_id=user_id, content_type=content_type,
                content_id=content_id, text_preview=text[:200],
                embedding_json=json.dumps(embedding), dimensions=len(embedding), model=model,
            ))
            s.commit()
        finally:
            s.close()

    monkeypatch.setattr(embedding_service, "embed", fake_embed)
    monkeypatch.setattr(embedding_service, "_store_embedding", fake_store)
    return new_session


def _note_rows(db_session, note_id):
    return db_session.query(EmbeddingModel).filter(
        EmbeddingModel.content_type == "note",
        (EmbeddingModel.content_id == note_id)
        | (EmbeddingModel.content_id.like(f"{note_id}{CHUNK_ID_SEP}%")),
    ).all()


class TestEmbedNote:
    def test_short_note_single_embedding(self, db_session, test_user, embed_env):
        note = _make_note(db_session, test_user.id, title="牛奶清单", content="今天买了牛奶和鸡蛋")
        stored = nes.embed_note(note.id, test_user.id)
        assert stored == 1
        rows = _note_rows(db_session, note.id)
        assert len(rows) == 1
        assert rows[0].content_id == note.id  # 短文档一文档一向量，无块后缀

    def test_long_note_chunked_with_overlap(self, db_session, test_user, embed_env):
        # 超过 CHUNK_SIZE_THRESHOLD(1500) 的长文档按 ~1000 字切块
        content = "开头段落。" + "这是填充内容。" * 400  # ~2800 字
        note = _make_note(db_session, test_user.id, title="长文档", content=content)
        stored = nes.embed_note(note.id, test_user.id)
        assert stored > 1
        rows = _note_rows(db_session, note.id)
        assert len(rows) == stored
        assert any(CHUNK_ID_SEP in r.content_id for r in rows)
        # 块向量归属回原文档 id
        assert all(r.content_id.split(CHUNK_ID_SEP, 1)[0] == note.id for r in rows)

    def test_update_replaces_old_embeddings(self, db_session, test_user, embed_env):
        note = _make_note(db_session, test_user.id, title="版本笔记", content="旧内容版本")
        nes.embed_note(note.id, test_user.id)
        note.content = "新内容版本替换旧文"
        db_session.commit()
        stored = nes.embed_note(note.id, test_user.id)
        assert stored == 1
        rows = _note_rows(db_session, note.id)
        assert len(rows) == 1  # 先删后写：旧向量不留残渣
        assert "新内容版本" in rows[0].text_preview

    def test_archived_note_embeddings_removed(self, db_session, test_user, embed_env):
        note = _make_note(db_session, test_user.id)
        nes.embed_note(note.id, test_user.id)
        assert len(_note_rows(db_session, note.id)) == 1
        note.status = "archived"
        db_session.commit()
        stored = nes.embed_note(note.id, test_user.id)
        assert stored == 0  # 只处理 status='active'
        assert _note_rows(db_session, note.id) == []

    def test_deleted_note_embeddings_removed(self, db_session, test_user, embed_env):
        note = _make_note(db_session, test_user.id)
        note_id = note.id
        nes.embed_note(note_id, test_user.id)
        assert len(_note_rows(db_session, note_id)) == 1
        db_session.delete(note)
        db_session.commit()
        stored = nes.embed_note(note_id, test_user.id)
        assert stored == 0
        assert _note_rows(db_session, note_id) == []

    def test_mock_fallback_stores_nothing(self, db_session, test_user, embed_env, monkeypatch):
        """Ollama 不可用（mock 假向量）时不写库、静默跳过，不阻塞主流程。"""
        async def mock_embed(text, **kwargs):
            return {"embedding": [0.0, 0.1], "dimensions": 2, "model_used": "mock/fallback"}

        monkeypatch.setattr(embedding_service, "embed", mock_embed)
        note = _make_note(db_session, test_user.id)
        assert nes.embed_note(note.id, test_user.id) == 0
        assert _note_rows(db_session, note.id) == []


class TestBackfill:
    def test_backfill_only_missing_and_idempotent(self, db_session, test_user, embed_env):
        covered = _make_note(db_session, test_user.id, title="已覆盖笔记", content="已有向量")
        missing = _make_note(db_session, test_user.id, title="未覆盖笔记", content="缺向量")
        nes.embed_note(covered.id, test_user.id)

        done = nes.backfill_missing_note_embeddings()
        assert done == 1  # 只补缺失的那篇
        assert len(_note_rows(db_session, covered.id)) == 1
        assert len(_note_rows(db_session, missing.id)) == 1

        # 幂等：再跑一轮没有可补的
        assert nes.backfill_missing_note_embeddings() == 0
        assert len(_note_rows(db_session, missing.id)) == 1


class TestListener:
    def test_register_idempotent(self):
        nes.register_note_embedding_listener()
        nes.register_note_embedding_listener()  # 重复挂载必须空转
        assert nes._listener_registered is True

    def test_commit_and_update_trigger_embed(self, monkeypatch):
        """before_commit 捕获 + after_commit 投递：新增与更新各触发一次重嵌。"""
        fired = []
        done_event = threading.Event()

        def fake_embed_note(note_id, user_id=""):
            fired.append(note_id)
            done_event.set()

        monkeypatch.setattr(nes, "embed_note", fake_embed_note)
        nes.register_note_embedding_listener()

        from app.core.database import SessionLocal as GlobalSession

        note_id = str(uuid.uuid4())
        session = GlobalSession()
        try:
            session.add(Note(
                id=note_id, user_id="listener-test-user",
                title="监听测试", content="新增触发", status="active",
            ))
            session.commit()
            assert done_event.wait(timeout=5), "新增提交未触发笔记向量化"
            assert note_id in fired

            # 更新（dirty）同样触发
            done_event.clear()
            note = session.query(Note).filter(Note.id == note_id).first()
            note.content = "更新触发"
            session.commit()
            assert done_event.wait(timeout=5), "更新提交未触发笔记向量化"
            assert fired.count(note_id) >= 2
        finally:
            session.close()
            # 清理：监听挂的是全局 SessionLocal（文件库），不留垃圾行
            cleanup = GlobalSession()
            try:
                cleanup.query(Note).filter(Note.id == note_id).delete()
                cleanup.commit()
            finally:
                cleanup.close()
