"""QA 实测缺陷回归测试（0.2.63 轮，开源精简版适配）：
M03 管理端审核覆盖社区帖子、M04 思维指纹聚合过滤软删内容。
（主仓同文件还含 M01 胶囊落库加密 / M02 未到期详情脱敏用例——开源版不带胶囊加密体系，未移植。）"""
import uuid

import pytest
from fastapi.testclient import TestClient

from app.core.security import create_access_token, get_password_hash
from app.models.base import AdminAuditLog, AdminUser, KnowledgeUnit, Note
from app.models.community import CommunityPost


class TestAdminModerateCommunityPost:
    """M03：admin/content/{id}/moderate 必须覆盖 CommunityPost，并留审计日志。"""

    def _admin_headers(self, db_session):
        admin = AdminUser(
            id=str(uuid.uuid4()),
            email=f"admin-{uuid.uuid4().hex[:8]}@example.com",
            name="Admin",
            password_hash=get_password_hash("AdminPass123"),
            role="super_admin",
            status="active",
        )
        db_session.add(admin)
        db_session.commit()
        token = create_access_token({"sub": admin.id}, is_admin=True)
        return {"Authorization": f"Bearer {token}"}, admin

    def _create_post(self, db_session, test_user) -> CommunityPost:
        post = CommunityPost(
            id=str(uuid.uuid4()),
            user_id=test_user.id,
            content="社区帖子正文",
            is_spam=False,
        )
        db_session.add(post)
        db_session.commit()
        return post

    def test_moderate_community_post_reject_and_approve(
        self, client: TestClient, db_session, test_user
    ):
        headers, admin = self._admin_headers(db_session)
        post = self._create_post(db_session, test_user)

        resp = client.post(
            f"/api/admin/content/{post.id}/moderate", headers=headers, json={"action": "reject"}
        )
        assert resp.status_code == 200, resp.text
        db_session.refresh(post)
        assert post.is_spam is True

        resp = client.post(
            f"/api/admin/content/{post.id}/moderate", headers=headers, json={"action": "approve"}
        )
        assert resp.status_code == 200, resp.text
        db_session.refresh(post)
        assert post.is_spam is False

        logs = db_session.query(AdminAuditLog).filter(
            AdminAuditLog.resource_type == "community_post",
            AdminAuditLog.resource_id == post.id,
            AdminAuditLog.action == "MODERATE_CONTENT",
        ).all()
        assert len(logs) == 2
        assert all(log.admin_id == admin.id for log in logs)

    def test_moderate_unknown_id_still_404(self, client: TestClient, db_session):
        headers, _ = self._admin_headers(db_session)
        resp = client.post(
            f"/api/admin/content/{uuid.uuid4()}/moderate", headers=headers, json={"action": "reject"}
        )
        assert resp.status_code == 404, resp.text


class TestCognitiveAggregateExcludesSoftDeleted:
    """M04：思维指纹等内容聚合只统计 status='active' 的笔记与知识单元。"""

    def test_aggregate_filters_soft_deleted(self, db_session, test_user):
        from app.api.v1.endpoints.cognitive import _aggregate_user_content

        active_note = Note(
            id=str(uuid.uuid4()), user_id=test_user.id,
            title="有效笔记", content="有效内容", status="active",
        )
        deleted_note = Note(
            id=str(uuid.uuid4()), user_id=test_user.id,
            title="已删笔记", content="已删内容", status="deleted",
        )
        active_ku = KnowledgeUnit(
            id=str(uuid.uuid4()), user_id=test_user.id,
            content_raw="有效知识", status="active",
        )
        deleted_ku = KnowledgeUnit(
            id=str(uuid.uuid4()), user_id=test_user.id,
            content_raw="已删知识", status="deleted",
        )
        db_session.add_all([active_note, deleted_note, active_ku, deleted_ku])
        db_session.commit()

        items = _aggregate_user_content(test_user, db_session, 50, "both")
        ids = {i["id"] for i in items}
        assert active_note.id in ids
        assert active_ku.id in ids
        assert deleted_note.id not in ids
        assert deleted_ku.id not in ids
