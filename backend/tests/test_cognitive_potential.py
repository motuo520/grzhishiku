# -*- coding: utf-8 -*-
"""认知势能分析：口径 / 结果持久化回归（移植自主仓 f8d7611，去租户用例）。

修的根因：
1. knowledge 查询未滤 status='deleted'，已删条目分析得出、点开 404；
2. 分析结果不落库，换模型/重进页面即丢。
（开源版无租户/团队空间，分析池口径保持 user_id。）
"""
import json
import re
import uuid
from datetime import datetime, timezone

import pytest

from app.models.base import User, Note, KnowledgeUnit
from app.core.security import get_password_hash, create_access_token


def _make_user(db_session, email: str) -> User:
    user = User(
        id=str(uuid.uuid4()),
        email=email,
        name=email.split("@")[0],
        password_hash=get_password_hash("Pass12345"),
        status="active",
    )
    db_session.add(user)
    db_session.commit()
    return user


def _headers(user: User) -> dict:
    return {"Authorization": f"Bearer {create_access_token({'sub': user.id})}"}


def _mk_note(db_session, user_id, title, status="active", brain_side="personal"):
    n = Note(
        id=str(uuid.uuid4()), user_id=user_id, title=title, content=f"{title} 正文",
        status=status, brain_side=brain_side,
        created_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc),
    )
    db_session.add(n)
    db_session.commit()
    return n.id


def _mk_ku(db_session, user_id, content, status="active", brain_side="personal"):
    k = KnowledgeUnit(
        id=str(uuid.uuid4()), user_id=user_id, content_raw=content,
        status=status, brain_side=brain_side,
        created_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc),
    )
    db_session.add(k)
    db_session.commit()
    return k.id


class _FakeLLM:
    """假 LLM：把 prompt 里出现的所有 [id:xxx] 原样塞进 sinkable 返回。

    借此断言「分析池里有哪些条目」——返回什么 id 完全由 prompt 决定，
    prompt 里没有什么 id 就说明查询口径把它排除了。
    """

    def __init__(self):
        self.prompts = []

    async def __call__(self, prompt, task_type=None, system_prompt=None, preferred_model=None, **kw):
        self.prompts.append(prompt)
        ids = re.findall(r"\[id:([^\]]+)\]", prompt)
        items = [
            {
                "content_id": i, "content_type": "note", "title": "t",
                "score": 0.8, "reason": "r", "suggested_action": "a",
            }
            for i in ids
        ]
        return json.dumps({
            "summary": f"整体判断{len(self.prompts)}",
            "sinkable": items, "outputable": [], "monetizable": [],
        })


@pytest.fixture
def fake_llm(monkeypatch):
    fake = _FakeLLM()
    monkeypatch.setattr("app.api.v1.endpoints.jianghu.chat_completion", fake)
    return fake


class TestScopeFiltering:
    """分析池不得含已删/他人条目——否则点击条目必 404。"""

    def test_personal_scope_excludes_deleted_and_foreign(self, client, db_session, test_user, auth_headers, fake_llm):
        own = _mk_note(db_session, test_user.id, "自己的笔记")
        deleted_ku = _mk_ku(db_session, test_user.id, "已删知识", status="deleted")
        other = _make_user(db_session, "other@example.com")
        foreign = _mk_note(db_session, other.id, "别人的笔记")

        resp = client.post("/api/v1/jianghu/cognitive-potential", headers=auth_headers, json={"brain_side": "personal"})
        assert resp.status_code == 200, resp.text
        got = {i["content_id"] for i in resp.json()["sinkable"]}
        assert own in got
        assert deleted_ku not in got  # 已删条目不进分析池（修前会进，点开 404）
        assert foreign not in got


class TestResultPersistence:
    """分析结果落库：换模型/重进页面可回看，重跑替换。"""

    def test_latest_roundtrip_and_replace(self, client, db_session, test_user, auth_headers, fake_llm):
        _mk_note(db_session, test_user.id, "笔记甲")
        # 无结果时 404
        r0 = client.get("/api/v1/jianghu/cognitive-potential/latest", headers=auth_headers, params={"brain_side": "both"})
        assert r0.status_code == 404

        client.post("/api/v1/jianghu/cognitive-potential", headers=auth_headers, json={"brain_side": "both"})
        r1 = client.get("/api/v1/jianghu/cognitive-potential/latest", headers=auth_headers, params={"brain_side": "both"})
        assert r1.status_code == 200
        body1 = r1.json()
        assert body1["summary"] == "整体判断1"
        assert body1["analyzed_at"]
        assert body1["model_used"] == "ollama-qwen2.5-0.5b"
        assert len(body1["sinkable"]) == 1

        # 重跑替换（summary 变 2，且仍只有一条记录）
        client.post("/api/v1/jianghu/cognitive-potential", headers=auth_headers, json={"brain_side": "both", "preferred_model": "ollama-qwen2.5-0.5b"})
        r2 = client.get("/api/v1/jianghu/cognitive-potential/latest", headers=auth_headers, params={"brain_side": "both"})
        assert r2.json()["summary"] == "整体判断2"

        # 脑侧隔离：personal 维度仍无结果
        r3 = client.get("/api/v1/jianghu/cognitive-potential/latest", headers=auth_headers, params={"brain_side": "personal"})
        assert r3.status_code == 404

    def test_latest_isolated_between_users(self, client, db_session, test_user, auth_headers, fake_llm):
        _mk_note(db_session, test_user.id, "笔记乙")
        client.post("/api/v1/jianghu/cognitive-potential", headers=auth_headers, json={"brain_side": "both"})
        other = _make_user(db_session, "third@example.com")
        r = client.get("/api/v1/jianghu/cognitive-potential/latest", headers=_headers(other), params={"brain_side": "both"})
        assert r.status_code == 404
