"""对话历史落库：会话 CRUD、用户隔离、/llm/chat 落库钩子。"""

import json
import uuid
from datetime import datetime, timezone

from fastapi.testclient import TestClient

from app.core.security import create_access_token, get_password_hash
from app.models.base import User
from app.models.chat import ChatConversation, ChatMessage
from app.api.v1.endpoints.chat import save_chat_turn


def _make_user(db_session, email: str) -> User:
    user = User(
        id=str(uuid.uuid4()),
        email=email,
        name="Other User",
        password_hash=get_password_hash("TestPass123"),
        status="active",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def _headers_for(user: User) -> dict:
    from datetime import timedelta
    token = create_access_token(
        data={"sub": user.id, "email": user.email},
        expires_delta=timedelta(days=1),
    )
    return {"Authorization": f"Bearer {token}"}


class TestConversationCRUD:
    def test_create_empty_and_with_title(self, client: TestClient, auth_headers):
        resp = client.post("/api/v1/chat/conversations", headers=auth_headers)
        assert resp.status_code == 201
        conv = resp.json()
        assert conv["id"]
        assert conv["title"] == ""

        resp = client.post("/api/v1/chat/conversations", headers=auth_headers, json={"title": "我的会话"})
        assert resp.status_code == 201
        assert resp.json()["title"] == "我的会话"

    def test_list_ordered_by_updated_desc(self, client: TestClient, auth_headers, db_session, test_user):
        c1 = client.post("/api/v1/chat/conversations", headers=auth_headers, json={"title": "旧"}).json()
        c2 = client.post("/api/v1/chat/conversations", headers=auth_headers, json={"title": "新"}).json()
        # 手动把 c1 的 updated_at 拨早，验证排序字段是 updated_at
        conv1 = db_session.query(ChatConversation).filter(ChatConversation.id == c1["id"]).first()
        conv1.updated_at = datetime(2020, 1, 1)
        db_session.commit()

        resp = client.get("/api/v1/chat/conversations", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2
        assert data["conversations"][0]["id"] == c2["id"]
        assert data["conversations"][0]["message_count"] == 0

    def test_get_detail_with_messages(self, client: TestClient, auth_headers, db_session, test_user):
        conv = client.post("/api/v1/chat/conversations", headers=auth_headers).json()
        save_chat_turn(
            db_session,
            db_session.query(ChatConversation).filter(ChatConversation.id == conv["id"]).first(),
            user_content="问题一",
            assistant_content="回答一",
            refs=[{"id": "k1", "title": "资料一", "source_type": "note"}],
            model="qwen2.5:0.5b",
        )
        resp = client.get(f"/api/v1/chat/conversations/{conv['id']}", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert [m["role"] for m in data["messages"]] == ["user", "assistant"]
        assert data["messages"][1]["model"] == "qwen2.5:0.5b"
        refs = json.loads(data["messages"][1]["refs"])
        assert refs[0]["title"] == "资料一"
        # 标题用首条用户消息前 20 字补齐
        assert data["title"] == "问题一"

    def test_rename_and_delete(self, client: TestClient, auth_headers, db_session):
        conv = client.post("/api/v1/chat/conversations", headers=auth_headers).json()
        resp = client.patch(
            f"/api/v1/chat/conversations/{conv['id']}",
            headers=auth_headers, json={"title": "改名后"},
        )
        assert resp.status_code == 200
        assert resp.json()["title"] == "改名后"

        save_chat_turn(
            db_session,
            db_session.query(ChatConversation).filter(ChatConversation.id == conv["id"]).first(),
            user_content="hi",
        )
        resp = client.delete(f"/api/v1/chat/conversations/{conv['id']}", headers=auth_headers)
        assert resp.status_code == 204
        # 消息连同删除
        assert db_session.query(ChatMessage).filter(ChatMessage.conversation_id == conv["id"]).count() == 0
        assert client.get(f"/api/v1/chat/conversations/{conv['id']}", headers=auth_headers).status_code == 404

    def test_unknown_conversation_404(self, client: TestClient, auth_headers):
        assert client.get("/api/v1/chat/conversations/nope", headers=auth_headers).status_code == 404


class TestUserIsolation:
    def test_cannot_read_patch_delete_others(self, client: TestClient, auth_headers, db_session, test_user):
        other = _make_user(db_session, "other@example.com")
        other_headers = _headers_for(other)

        conv = client.post("/api/v1/chat/conversations", headers=auth_headers, json={"title": "A 的会话"}).json()

        # B 的列表里没有 A 的会话
        resp = client.get("/api/v1/chat/conversations", headers=other_headers)
        assert resp.status_code == 200
        assert resp.json()["total"] == 0

        # B 读/改/删 A 的会话一律 404（不暴露存在性）
        assert client.get(f"/api/v1/chat/conversations/{conv['id']}", headers=other_headers).status_code == 404
        assert client.patch(
            f"/api/v1/chat/conversations/{conv['id']}", headers=other_headers, json={"title": "x"},
        ).status_code == 404
        assert client.delete(f"/api/v1/chat/conversations/{conv['id']}", headers=other_headers).status_code == 404
        # A 的会话仍在
        assert client.get(f"/api/v1/chat/conversations/{conv['id']}", headers=auth_headers).status_code == 200


class TestChatPersistenceHook:
    def test_chat_persists_turn(self, client: TestClient, auth_headers, db_session, test_user, monkeypatch):
        """带 conversation_id 的 /llm/chat：用户消息先落库，流式回答连同引用/模型落库。"""
        from app.api.v1.endpoints.llm import llm_service as _svc

        async def fake_chat(**kwargs):
            yield "你好，"
            yield "这是回答。"

        monkeypatch.setattr(_svc, "chat", fake_chat)

        conv = client.post("/api/v1/chat/conversations", headers=auth_headers).json()
        resp = client.post(
            "/api/v1/llm/chat",
            headers=auth_headers,
            json={
                "message": "什么是 PARA 方法？",
                "preferred_model": "qwen2.5:0.5b",
                "conversation_id": conv["id"],
            },
        )
        assert resp.status_code == 200
        assert '\\u8fd9\\u662f\\u56de\\u7b54' in resp.text  # SSE chunk（中文按 JSON 转义输出）

        detail = client.get(f"/api/v1/chat/conversations/{conv['id']}", headers=auth_headers).json()
        assert [m["role"] for m in detail["messages"]] == ["user", "assistant"]
        assert detail["messages"][0]["content"] == "什么是 PARA 方法？"
        assert detail["messages"][1]["content"] == "你好，这是回答。"
        assert detail["messages"][1]["model"] == "qwen2.5:0.5b"
        # 标题取首条用户消息前 20 字
        assert detail["title"] == "什么是 PARA 方法？"

    def test_chat_without_conversation_id_unchanged(self, client: TestClient, auth_headers, db_session, test_user, monkeypatch):
        """不传 conversation_id：行为与旧版一致，不落库。"""
        from app.api.v1.endpoints.llm import llm_service as _svc

        async def fake_chat(**kwargs):
            yield "ok"

        monkeypatch.setattr(_svc, "chat", fake_chat)

        resp = client.post(
            "/api/v1/llm/chat",
            headers=auth_headers,
            json={"message": "hi", "preferred_model": "qwen2.5:0.5b"},
        )
        assert resp.status_code == 200
        assert "ok" in resp.text
        assert db_session.query(ChatMessage).count() == 0

    def test_chat_foreign_conversation_404(self, client: TestClient, auth_headers, db_session, test_user):
        other = _make_user(db_session, "other2@example.com")
        conv = ChatConversation(id=str(uuid.uuid4()), user_id=other.id, title="B 的")
        db_session.add(conv)
        db_session.commit()
        resp = client.post(
            "/api/v1/llm/chat",
            headers=auth_headers,
            json={
                "message": "hi",
                "preferred_model": "qwen2.5:0.5b",
                "conversation_id": conv.id,
            },
        )
        assert resp.status_code == 404


class TestSaveChatTurn:
    def test_skips_empty_and_error_content(self, db_session, test_user):
        conv = ChatConversation(id=str(uuid.uuid4()), user_id=test_user.id, title="")
        db_session.add(conv)
        db_session.commit()

        save_chat_turn(db_session, conv, assistant_content="")
        save_chat_turn(db_session, conv, assistant_content="[Error: 模型不可用]")
        assert db_session.query(ChatMessage).filter(ChatMessage.conversation_id == conv.id).count() == 0

        save_chat_turn(db_session, conv, user_content="一个很长很长很长很长很长很长很长很长的用户问题超过二十个字", assistant_content="答")
        msgs = db_session.query(ChatMessage).filter(ChatMessage.conversation_id == conv.id).all()
        assert len(msgs) == 2
        assert len(conv.title) == 20

    def test_title_not_overwritten(self, db_session, test_user):
        conv = ChatConversation(id=str(uuid.uuid4()), user_id=test_user.id, title="已有标题")
        db_session.add(conv)
        db_session.commit()
        save_chat_turn(db_session, conv, user_content="新问题")
        assert conv.title == "已有标题"
