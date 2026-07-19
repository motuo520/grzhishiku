"""RAG evaluation gate: release is blocked if the 50-question eval set fails."""

import pytest


@pytest.mark.rag_eval
def test_rag_evaluation_meets_release_threshold(client, auth_headers):
    """Seed the demo brain and run the 50-question RAG eval set.

    The eval endpoint does NOT call the LLM; it only checks retrieval recall
    and keyword coverage. This test is marked as `rag_eval` so CI can run it
    separately from the fast unit-test suite.
    """
    # Seed demo brain (200 sample notes) for the authenticated test user.
    seed_resp = client.post(
        "/api/v1/knowledge/seed-demo",
        json={"overwrite": True},
        headers=auth_headers,
    )
    assert seed_resp.status_code == 200, seed_resp.text
    assert seed_resp.json()["seeded"] > 0

    # Run the 50-question evaluation set.
    eval_resp = client.post("/api/v1/knowledge/rag-eval", headers=auth_headers)
    assert eval_resp.status_code == 200, eval_resp.text

    result = eval_resp.json()
    score = result["score"]
    threshold = result["threshold"]
    release_ready = result["release_ready"]

    assert result["total"] == 50, "expected 50 evaluation questions"
    assert score >= threshold, (
        f"RAG eval score {score} below release threshold {threshold}. "
        f"Passed {result['passed']}/{result['total']}."
    )
    assert release_ready is True
