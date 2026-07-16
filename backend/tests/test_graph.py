import pytest
from app.models.base import GraphEdge


def test_get_nodes(client, auth_headers, test_note, test_clip, test_knowledge):
    response = client.get("/api/v1/graph/nodes", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["total"] >= 3
    ids = {n["id"] for n in data["nodes"]}
    assert test_note.id in ids
    assert test_clip.id in ids
    assert test_knowledge.id in ids

    note_node = next(n for n in data["nodes"] if n["id"] == test_note.id)
    assert note_node["brain_side"] == "personal"
    assert note_node["source_type"] == "manual_input"
    assert "created_at" in note_node

    clip_node = next(n for n in data["nodes"] if n["id"] == test_clip.id)
    assert clip_node["brain_side"] == "network"


def test_get_nodes_brain_side_filter(client, auth_headers, test_note, test_clip):
    response = client.get("/api/v1/graph/nodes?brain_side=personal", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert all(n["brain_side"] == "personal" for n in data["nodes"])
    ids = {n["id"] for n in data["nodes"]}
    assert test_note.id in ids
    assert test_clip.id not in ids


# NOTE: GET /api/v1/graph/network and /api/v1/graph/brain-stats were removed from
# the product API. Their coverage lives on in test_get_nodes / test_get_bridges
# (this file) and tests/test_brain.py::test_brain_stats (GET /api/v1/brain/stats).


def test_get_bridges(client, auth_headers, test_note, test_clip, db_session):
    edge = GraphEdge(
        id="edge-bridge-1",
        user_id=test_note.user_id,
        source_id=test_note.id,
        target_id=test_clip.id,
        source_brain_side="personal",
        target_brain_side="network",
        edge_type="reference",
        strength=0.9,
        cross_brain=True,
    )
    db_session.add(edge)
    db_session.commit()

    response = client.get("/api/v1/graph/bridges", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["total"] >= 1
    bridge = data["bridges"][0]
    assert bridge["personal_node"]["id"] == test_note.id
    assert bridge["network_node"]["id"] == test_clip.id
