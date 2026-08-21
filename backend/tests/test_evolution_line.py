"""知识自进化线：争议决议（dispute_resolution）、进化流水（evolution_transitions）、
RAG 引用计数、知识列表 content_subtype 过滤。

（移植自主仓 d437275 的 test_evolution_line.py，适配开源版：无游客演示账号用例、
LLM 走本地模型口径、无租户维度。）
"""

import json
import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.core.security import create_access_token, get_password_hash
from app.models.base import User
from app.models.knowledge import KnowledgeUnit, EvolutionTransition


def _make_ku(db_session, user_id: str, content: str, **kwargs) -> KnowledgeUnit:
    kwargs.setdefault("verification_status", "unverified")
    kwargs.setdefault("verification_history", "[]")
    kwargs.setdefault("status", "active")
    ku = KnowledgeUnit(
        id=str(uuid.uuid4()),
        user_id=user_id,
        brain_side="network",
        content_raw=content,
        created_at=datetime.now(timezone.utc),
        **kwargs,
    )
    db_session.add(ku)
    db_session.commit()
    return ku


def _get_ku(db_session, unit_id: str) -> KnowledgeUnit:
    # commit 后属性会 expire，取值一律重新查询（savepoint 桥接口径）
    return db_session.query(KnowledgeUnit).filter(KnowledgeUnit.id == unit_id).first()


class TestDisputeResolution:
    def test_counter_evidence_wall_unresolved_only(self, client: TestClient, auth_headers, db_session, test_user):
        """提交反证 → 上墙（未决议），响应带 latest_evidence 正文。"""
        ku = _make_ku(db_session, test_user.id, "待争议的知识单元")

        resp = client.post(
            f"/api/v1/knowledge/{ku.id}/counter-evidence",
            headers=auth_headers,
            json={"evidence_text": "这条知识已被新论文推翻", "evidence_url": "https://example.com/paper"},
        )
        assert resp.status_code == 200

        wall = client.get("/api/v1/knowledge/counter-evidence", headers=auth_headers).json()
        hit = [u for u in wall if u["id"] == ku.id]
        assert len(hit) == 1
        assert hit[0]["verification_status"] == "disputed"
        assert hit[0]["dispute_resolution"] is None
        assert hit[0]["latest_evidence"]["evidence_text"] == "这条知识已被新论文推翻"
        assert hit[0]["latest_evidence"]["evidence_url"] == "https://example.com/paper"
        assert hit[0]["latest_evidence"]["created_at"]

    def test_kept_keeps_disputed_and_leaves_wall(self, client: TestClient, auth_headers, db_session, test_user):
        """kept（保留观察）：status 保持 disputed 不动，只记决议，下墙。"""
        ku = _make_ku(db_session, test_user.id, "保留观察的知识")
        client.post(
            f"/api/v1/knowledge/{ku.id}/counter-evidence",
            headers=auth_headers,
            json={"evidence_text": "反证正文"},
        )

        resp = client.post(
            f"/api/v1/knowledge/{ku.id}/dispute-resolution",
            headers=auth_headers,
            json={"resolution": "kept"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["verification_status"] == "disputed"  # 不再抹回 unverified
        assert body["dispute_resolution"] == "kept"

        # 默认墙（未决议）不再列出；include_resolved=true 能再看到
        wall = client.get("/api/v1/knowledge/counter-evidence", headers=auth_headers).json()
        assert all(u["id"] != ku.id for u in wall)
        wall_all = client.get(
            "/api/v1/knowledge/counter-evidence?include_resolved=true", headers=auth_headers
        ).json()
        hit = [u for u in wall_all if u["id"] == ku.id]
        assert len(hit) == 1
        assert hit[0]["dispute_resolution"] == "kept"

    def test_rejected_restores_pre_dispute_status(self, client: TestClient, auth_headers, db_session, test_user):
        """rejected（驳回反证）：恢复反证前 verdict，history 追加决议留痕，下墙。"""
        history = [
            {"timestamp": "2026-01-01T00:00:00", "verdict": "confirmed", "confidence": 0.9},
            {"timestamp": "2026-02-01T00:00:00", "type": "counter_evidence",
             "evidence_text": "反证正文", "evidence_url": None, "created_at": "2026-02-01T00:00:00"},
        ]
        ku = _make_ku(
            db_session, test_user.id, "被误判的知识",
            verification_status="disputed", trust_level="suspicious",
            verification_history=json.dumps(history, ensure_ascii=False),
        )

        resp = client.post(
            f"/api/v1/knowledge/{ku.id}/dispute-resolution",
            headers=auth_headers,
            json={"resolution": "rejected"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["verification_status"] == "confirmed"  # 恢复反证前的 verdict
        assert body["dispute_resolution"] == "rejected"

        # 决议留痕：history 里必须有 dispute_resolution 条目
        entries = json.loads(body["verification_history"])
        resolutions = [e for e in entries if e.get("type") == "dispute_resolution"]
        assert len(resolutions) == 1
        assert resolutions[0]["resolution"] == "rejected"
        assert resolutions[0]["created_at"]

        # 下墙
        wall = client.get("/api/v1/knowledge/counter-evidence", headers=auth_headers).json()
        assert all(u["id"] != ku.id for u in wall)

    def test_rejected_without_prior_verdict_falls_back_unverified(
        self, client: TestClient, auth_headers, db_session, test_user
    ):
        """history 里找不到非反证 verdict 时，rejected 恢复为 unverified。"""
        ku = _make_ku(db_session, test_user.id, "无历史的知识")
        client.post(
            f"/api/v1/knowledge/{ku.id}/counter-evidence",
            headers=auth_headers,
            json={"evidence_text": "反证正文"},
        )
        resp = client.post(
            f"/api/v1/knowledge/{ku.id}/dispute-resolution",
            headers=auth_headers,
            json={"resolution": "rejected"},
        )
        assert resp.status_code == 200
        assert resp.json()["verification_status"] == "unverified"

    def test_resolution_rejects_invalid_value(self, client: TestClient, auth_headers, db_session, test_user):
        ku = _make_ku(db_session, test_user.id, "校验知识")
        resp = client.post(
            f"/api/v1/knowledge/{ku.id}/dispute-resolution",
            headers=auth_headers,
            json={"resolution": "bogus"},
        )
        assert resp.status_code == 422

    def test_detail_history_keeps_counter_evidence_fields(
        self, client: TestClient, auth_headers, db_session, test_user
    ):
        """GET 详情：verification_history 里 counter_evidence 条目透出 evidence_text/evidence_url/created_at。"""
        ku = _make_ku(db_session, test_user.id, "详情页的知识")
        client.post(
            f"/api/v1/knowledge/{ku.id}/counter-evidence",
            headers=auth_headers,
            json={"evidence_text": "反证正文内容", "evidence_url": "https://example.com/ev"},
        )
        resp = client.get(f"/api/v1/knowledge/{ku.id}", headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        entries = json.loads(body["verification_history"])
        ce = [e for e in entries if e.get("type") == "counter_evidence"]
        assert len(ce) == 1
        assert ce[0]["evidence_text"] == "反证正文内容"
        assert ce[0]["evidence_url"] == "https://example.com/ev"
        assert ce[0]["created_at"]
        assert body["dispute_resolution"] is None
        assert body["latest_evidence"]["evidence_text"] == "反证正文内容"

    def test_verify_confirmed_marks_corrected(
        self, client: TestClient, auth_headers, db_session, test_user, monkeypatch
    ):
        """修正重验：disputed 单元裁决 confirmed → dispute_resolution='corrected'。"""
        async def fake_verification(*args, **kwargs):
            return {
                "verdict": "confirmed", "confidence": 0.95,
                "source_reliability": 0.8, "bias_indicators": [], "reasoning": "ok",
            }

        monkeypatch.setattr(
            "app.api.v1.endpoints.knowledge._run_llm_verification", fake_verification
        )
        ku = _make_ku(db_session, test_user.id, "修正后重验的知识", verification_status="disputed")

        resp = client.post(f"/api/v1/knowledge/{ku.id}/verify", headers=auth_headers, json={})
        assert resp.status_code == 200
        ku = _get_ku(db_session, ku.id)
        assert ku.verification_status == "confirmed"
        assert ku.dispute_resolution == "corrected"

    def test_verify_still_disputed_clears_resolution(
        self, client: TestClient, auth_headers, db_session, test_user, monkeypatch
    ):
        """修正重验仍有争议：resolution 清回 NULL，条目留在墙上。"""
        async def fake_verification(*args, **kwargs):
            return {
                "verdict": "disputed", "confidence": 0.4,
                "source_reliability": 0.5, "bias_indicators": [], "reasoning": "仍有争议",
            }

        monkeypatch.setattr(
            "app.api.v1.endpoints.knowledge._run_llm_verification", fake_verification
        )
        ku = _make_ku(
            db_session, test_user.id, "重验仍争议的知识",
            verification_status="disputed", dispute_resolution="kept",
        )

        resp = client.post(f"/api/v1/knowledge/{ku.id}/verify", headers=auth_headers, json={})
        assert resp.status_code == 200
        ku = _get_ku(db_session, ku.id)
        assert ku.verification_status == "disputed"
        assert ku.dispute_resolution is None


class TestEvolutionTransitions:
    def test_practice_record_advances_stage_with_transition(
        self, client: TestClient, auth_headers, db_session, test_user
    ):
        """POST 践行记录推进 stage → transitions 有 from→to 且 trigger=practice。"""
        ku = _make_ku(db_session, test_user.id, "践行推进的知识单元内容")
        resp = client.post(
            "/api/v1/jianghu/practice-records",
            headers=auth_headers,
            json={
                "target_type": "knowledge_unit",
                "target_id": ku.id,
                "practice_type": "applied",
                "description": "把这个方法用到了实际项目里",
            },
        )
        assert resp.status_code == 201

        ku = _get_ku(db_session, ku.id)
        assert ku.evolution_stage == "understood"

        rows = db_session.query(EvolutionTransition).filter(
            EvolutionTransition.content_id == ku.id
        ).all()
        assert len(rows) == 1
        assert rows[0].from_stage == "collected"
        assert rows[0].to_stage == "understood"
        assert rows[0].trigger == "practice"
        assert rows[0].content_type == "knowledge_unit"

    def test_manual_stage_change_and_same_value_skip(
        self, client: TestClient, auth_headers, db_session, test_user
    ):
        """手动 PUT 改 stage → trigger=manual；同值重写不记。"""
        ku = _make_ku(db_session, test_user.id, "手动改阶段的知识")

        resp = client.put(
            f"/api/v1/knowledge/{ku.id}",
            headers=auth_headers,
            json={"evolution_stage": "validated"},
        )
        assert resp.status_code == 200
        rows = db_session.query(EvolutionTransition).filter(
            EvolutionTransition.content_id == ku.id
        ).all()
        assert len(rows) == 1
        assert rows[0].from_stage == "collected"
        assert rows[0].to_stage == "validated"
        assert rows[0].trigger == "manual"

        # 同值重写不记流水
        resp = client.put(
            f"/api/v1/knowledge/{ku.id}",
            headers=auth_headers,
            json={"evolution_stage": "validated"},
        )
        assert resp.status_code == 200
        rows = db_session.query(EvolutionTransition).filter(
            EvolutionTransition.content_id == ku.id
        ).all()
        assert len(rows) == 1

    def test_transitions_endpoint_returns_title(
        self, client: TestClient, auth_headers, db_session, test_user
    ):
        """GET /jianghu/evolution-transitions：按时间倒序，knowledge_unit 标题取正文前 60 字。"""
        content = "进化流水端点标题测试：" + "长" * 100
        ku = _make_ku(db_session, test_user.id, content)
        client.put(
            f"/api/v1/knowledge/{ku.id}",
            headers=auth_headers,
            json={"evolution_stage": "practiced"},
        )

        resp = client.get("/api/v1/jianghu/evolution-transitions", headers=auth_headers)
        assert resp.status_code == 200
        rows = [r for r in resp.json() if r["content_id"] == ku.id]
        assert len(rows) == 1
        row = rows[0]
        assert row["content_type"] == "knowledge_unit"
        assert row["title"] == content[:60]
        assert row["from_stage"] == "collected"
        assert row["to_stage"] == "practiced"
        assert row["trigger"] == "manual"
        assert row["created_at"]

    def test_note_manual_stage_change_recorded(
        self, client: TestClient, auth_headers, db_session, test_user, test_note
    ):
        """Note 手动 PUT 改 stage 同样记流水（content_type=note）。"""
        resp = client.put(
            f"/api/v1/notes/{test_note.id}",
            headers=auth_headers,
            json={"evolution_stage": "internalized"},
        )
        assert resp.status_code == 200
        rows = db_session.query(EvolutionTransition).filter(
            EvolutionTransition.content_id == test_note.id
        ).all()
        assert len(rows) == 1
        assert rows[0].content_type == "note"
        assert rows[0].to_stage == "internalized"
        assert rows[0].trigger == "manual"

        wall = client.get("/api/v1/jianghu/evolution-transitions", headers=auth_headers).json()
        hit = [r for r in wall if r["content_id"] == test_note.id]
        assert hit and hit[0]["title"] == "Test Note"


class TestRagInvokeCounting:
    def _patch_stream_session(self, monkeypatch, db_session):
        """流式生成器内的独立 SessionLocal 映射到测试会话（同 test_chat 口径）。"""

        class _NoCloseSession:
            def __init__(self, session):
                self._session = session

            def __getattr__(self, name):
                return getattr(self._session, name)

            def close(self):
                pass

        monkeypatch.setattr(
            "app.api.v1.endpoints.llm.SessionLocal", lambda: _NoCloseSession(db_session)
        )

    def _patch_chat(self, monkeypatch, cited_ids):
        """最薄 mock 点：检索函数直接返回指定知识单元（跳过关键词/向量/重排三段管线），
        llm_service.chat 换成假流——计数逻辑在检索之后、prompt 拼装处，与模型无关。"""
        from app.api.v1.endpoints.llm import llm_service as _svc

        sources = [
            {
                "id": kid, "title": "被引用的知识", "preview": "预览",
                "source_type": "knowledge", "content_raw": "正文", "chunk": None,
            }
            for kid in cited_ids
        ]

        async def fake_retrieve(**kwargs):
            return sources

        async def fake_chat(**kwargs):
            yield "回答"

        monkeypatch.setattr(
            "app.api.v1.endpoints.llm._retrieve_knowledge_sources", fake_retrieve
        )
        monkeypatch.setattr(_svc, "chat", fake_chat)

    def test_rag_citation_increments_invoke_count(
        self, client: TestClient, auth_headers, db_session, test_user, monkeypatch
    ):
        """知识单元被检索进 RAG 上下文 → invoke_count+1、记 last_invoked_at；同请求重复引用只计一次。"""
        ku = _make_ku(db_session, test_user.id, "会被 AI 引用的知识")
        self._patch_chat(monkeypatch, [ku.id, ku.id])  # 同一单元重复进上下文
        self._patch_stream_session(monkeypatch, db_session)

        resp = client.post(
            "/api/v1/llm/chat",
            headers=auth_headers,
            json={"message": "相关问题", "preferred_model": "qwen2.5:0.5b"},
        )
        assert resp.status_code == 200

        ku = _get_ku(db_session, ku.id)
        assert ku.invoke_count == 1  # 每对话每单元只计一次
        assert ku.last_invoked_at is not None


class TestContentSubtypeFilter:
    def test_filter_collision_result(self, client: TestClient, auth_headers, db_session, test_user):
        """content_subtype=collision_result 只回碰撞产物，普通单元被过滤。"""
        _make_ku(db_session, test_user.id, "普通知识单元", content_subtype="note")
        collision = _make_ku(
            db_session, test_user.id, "碰撞产物知识单元", content_subtype="collision_result"
        )

        resp = client.get(
            "/api/v1/knowledge/?content_subtype=collision_result", headers=auth_headers
        )
        assert resp.status_code == 200
        items = resp.json()
        assert len(items) == 1
        assert items[0]["id"] == collision.id
        assert items[0]["content_subtype"] == "collision_result"
