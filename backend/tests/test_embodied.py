import pytest
import uuid
from unittest.mock import patch
from app.models.base import DepthCheckLog, EvolutionReflection, Capsule


def test_depth_check_logs_empty(client, auth_headers):
    response = client.get("/api/v1/embodied/depth-check/logs", headers=auth_headers)
    assert response.status_code == 200
    assert response.json() == []


def test_depth_check_requires_content(client, auth_headers):
    response = client.post("/api/v1/embodied/depth-check", json={"content": ""}, headers=auth_headers)
    assert response.status_code == 422


@patch("app.api.v1.endpoints.embodied.billed_chat_completion")
def test_depth_check_success(mock_llm, client, auth_headers, db_session):
    mock_llm.return_value = '{"depth_score": 0.8, "is_passed": true, "feedback": "有深度", "suggestions": ["继续保持"]}'
    response = client.post(
        "/api/v1/embodied/depth-check",
        json={"content": "这是一段经过认真思考的内容。", "content_type": "note"},
        headers=auth_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["depth_score"] == 0.8
    assert data["is_passed"] is True
    assert len(data["suggestions"]) == 1

    logs = db_session.query(DepthCheckLog).all()
    assert len(logs) == 1
    assert logs[0].content_type == "note"


@patch("app.api.v1.endpoints.embodied.billed_chat_completion")
def test_depth_check_success_with_chinese_preamble(mock_llm, client, auth_headers, db_session):
    """模型返回中文解释 + JSON 时，应能正确提取并解析。"""
    mock_llm.return_value = (
        "好的，我来进行评估。这段内容虽然有一些观点，但缺乏具体证据支撑，深度不足。"
        '{\n  "depth_score": 0.3,\n  "is_passed": false,\n  "feedback": "观点较浅",\n  "suggestions": ["补充案例", "加入反证思考"]\n}'
    )
    response = client.post(
        "/api/v1/embodied/depth-check",
        json={"content": "这是测试内容。", "content_type": "note"},
        headers=auth_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["depth_score"] == 0.3
    assert data["is_passed"] is False
    assert data["feedback"] == "观点较浅"
    assert data["suggestions"] == ["补充案例", "加入反证思考"]


@patch("app.api.v1.endpoints.embodied.billed_chat_completion")
def test_depth_check_error_on_failure(mock_llm, client, auth_headers):
    mock_llm.side_effect = Exception("LLM failed")
    response = client.post(
        "/api/v1/embodied/depth-check",
        json={"content": "测试内容。"},
        headers=auth_headers,
    )
    assert response.status_code == 500
    assert "失败" in response.json()["error"]["message"]


def test_evolution_reflection_crud(client, auth_headers, db_session):
    # Create
    response = client.post(
        "/api/v1/embodied/evolution-reflections",
        json={
            "title": "突破舒适区",
            "discomfort_level": 4,
            "pain_description": "很难",
            "joy_description": "完成后很爽",
            "learning": "成长需要痛苦",
            "is_true_evolution": True,
            "brain_side": "personal",
        },
        headers=auth_headers,
    )
    assert response.status_code == 201
    created = response.json()
    assert created["title"] == "突破舒适区"
    assert created["brain_side"] == "personal"

    # List
    response = client.get("/api/v1/embodied/evolution-reflections", headers=auth_headers)
    assert response.status_code == 200
    assert len(response.json()) == 1

    # Update
    reflection_id = created["id"]
    response = client.put(
        f"/api/v1/embodied/evolution-reflections/{reflection_id}",
        json={"title": "突破舒适区（更新）"},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json()["title"] == "突破舒适区（更新）"

    # Delete
    response = client.delete(f"/api/v1/embodied/evolution-reflections/{reflection_id}", headers=auth_headers)
    assert response.status_code == 204

    assert db_session.query(EvolutionReflection).filter(EvolutionReflection.id == reflection_id).first() is None


def test_evolution_reflection_brain_side_filter(client, auth_headers):
    client.post(
        "/api/v1/embodied/evolution-reflections",
        json={"title": "个人反思", "brain_side": "personal"},
        headers=auth_headers,
    )
    client.post(
        "/api/v1/embodied/evolution-reflections",
        json={"title": "网络反思", "brain_side": "network"},
        headers=auth_headers,
    )

    response = client.get("/api/v1/embodied/evolution-reflections?brain_side=personal", headers=auth_headers)
    assert response.status_code == 200
    items = response.json()
    assert len(items) == 1
    assert items[0]["brain_side"] == "personal"


@patch("app.api.v1.endpoints.embodied.billed_chat_completion")
def test_evolution_analysis(mock_llm, client, auth_headers):
    mock_llm.return_value = '{"summary": "整体在进化", "patterns": ["持续复盘"], "warnings": [], "next_steps": ["保持"]}'
    client.post(
        "/api/v1/embodied/evolution-reflections",
        json={"title": "反思1", "is_true_evolution": True, "brain_side": "personal"},
        headers=auth_headers,
    )
    response = client.post(
        "/api/v1/embodied/evolution-reflections/analyze",
        json={"brain_side": "personal"},
        headers=auth_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert "summary" in data
    assert data["true_evolution_ratio"] == 1.0


@patch("app.api.v1.endpoints.embodied.billed_chat_completion")
def test_evolution_analysis_error_on_failure(mock_llm, client, auth_headers):
    mock_llm.side_effect = Exception("LLM failed")
    response = client.post(
        "/api/v1/embodied/evolution-reflections/analyze",
        json={"brain_side": "personal"},
        headers=auth_headers,
    )
    assert response.status_code == 500
    assert "失败" in response.json()["error"]["message"]


def test_mood_location_aggregates_capsules(client, auth_headers, db_session, test_user):
    capsule = Capsule(
        id=str(uuid.uuid4()),
        user_id=test_user.id,
        content_body="今天心情不错",
        mood_emotion="开心",
        mood_location="家里",
        mood_tags='["放松"]',
        status="active",
        unlock_config='{"date": "2025-01-01"}',
    )
    db_session.add(capsule)
    db_session.commit()

    response = client.get("/api/v1/embodied/mood-location", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["stats"]["total"] == 1
    assert data["stats"]["mood_distribution"]["开心"] == 1
    assert data["stats"]["location_distribution"]["家里"] == 1
    assert len(data["items"]) == 1
    assert data["items"][0]["mood_tags"] == ["放松"]


def test_mood_location_brain_side_filter(client, auth_headers, db_session, test_user):
    personal = Capsule(
        id=str(uuid.uuid4()),
        user_id=test_user.id,
        content_body="个人",
        mood_emotion="平静",
        status="active",
        brain_side="personal",
        unlock_config='{"date": "2025-01-01"}',
    )
    network = Capsule(
        id=str(uuid.uuid4()),
        user_id=test_user.id,
        content_body="网络",
        mood_emotion="兴奋",
        status="active",
        brain_side="network",
        unlock_config='{"date": "2025-01-01"}',
    )
    db_session.add_all([personal, network])
    db_session.commit()

    response = client.get("/api/v1/embodied/mood-location?brain_side=network", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["stats"]["total"] == 1
    assert data["items"][0]["mood_emotion"] == "兴奋"
