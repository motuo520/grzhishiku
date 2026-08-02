"""RAG evaluation gate: release is blocked if the 50-question eval set fails."""

import pytest


@pytest.mark.rag_eval
def test_rag_evaluation_meets_release_threshold(client, auth_headers, test_user, db_session):
    """Seed the registration sample data and run the 50-question RAG eval set.

    The eval set (app/data/rag_eval_set.json) is written against the
    registration seeding corpus (app.services.sample_data_service). Without
    stored embeddings the vector channel silently degrades to keyword-only,
    still above the 0.7 threshold, so this gate also works without Ollama.
    """
    from app.services.sample_data_service import seed_sample_data
    seed_sample_data(db_session, test_user.id)
    db_session.commit()

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
        f"Passed {result['passed']}/{result['total']}. "
        f"Failed: {[r['id'] for r in result['results'] if not r['passed']]}"
    )
    assert release_ready is True
