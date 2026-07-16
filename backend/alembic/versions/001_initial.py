"""Initial migration - create all core tables

Revision ID: 001_initial
Revises: 
Create Date: 2025-04-27 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import Text, DateTime, String, Integer, Boolean, Float

# revision identifiers
revision = '001_initial'
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    # users
    op.create_table(
        'users',
        sa.Column('id', String, primary_key=True),
        sa.Column('email', String, nullable=False, unique=True),
        sa.Column('name', String),
        sa.Column('avatar', String),
        sa.Column('password_hash', String),
        sa.Column('status', String, default='active'),
        sa.Column('subscription_tier', String, default='free'),
        sa.Column('subscription_status', String, default='active'),
        sa.Column('subscription_expires_at', DateTime),
        sa.Column('storage_used', Integer, default=0),
        sa.Column('storage_limit', Integer, default=1073741824),
        sa.Column('last_login_at', DateTime),
        sa.Column('last_login_ip', String),
        sa.Column('mfa_enabled', Boolean, default=False),
        sa.Column('created_at', DateTime, server_default=sa.func.now()),
        sa.Column('updated_at', DateTime, server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.Column('tenant_id', String),
    )

    # notes
    op.create_table(
        'notes',
        sa.Column('id', String, primary_key=True),
        sa.Column('user_id', String, nullable=False),
        sa.Column('brain_side', String, default='personal'),
        sa.Column('title', String, nullable=False),
        sa.Column('content', Text, nullable=False),
        sa.Column('content_format', String, default='markdown'),
        sa.Column('backlinks', Text),
        sa.Column('forward_links', Text),
        sa.Column('mood_emotion', String),
        sa.Column('mood_intensity', Float),
        sa.Column('mood_energy_level', Float),
        sa.Column('location', String),
        sa.Column('weather', String),
        sa.Column('capsule_refs', Text),
        sa.Column('is_private', Boolean, default=True),
        sa.Column('encryption_level', String, default='local_aes'),
        sa.Column('created_at', DateTime, server_default=sa.func.now()),
        sa.Column('updated_at', DateTime, server_default=sa.func.now(), onupdate=sa.func.now()),
    )
    op.create_index('idx_notes_user', 'notes', ['user_id'])

    # capsules
    op.create_table(
        'capsules',
        sa.Column('id', String, primary_key=True),
        sa.Column('user_id', String, nullable=False),
        sa.Column('brain_side', String, default='personal'),
        sa.Column('content_type', String),
        sa.Column('content_body', Text, nullable=False),
        sa.Column('content_attachments', Text),
        sa.Column('mood_emotion', String),
        sa.Column('mood_intensity', Float),
        sa.Column('mood_energy_level', Float),
        sa.Column('mood_trigger', String),
        sa.Column('mood_weather', String),
        sa.Column('mood_location', String),
        sa.Column('sealed_at', DateTime),
        sa.Column('sealed_context', Text),
        sa.Column('sealed_fingerprint', String),
        sa.Column('unlock_type', String),
        sa.Column('unlock_config', Text, nullable=False),
        sa.Column('unlock_status', String, default='locked'),
        sa.Column('privacy_require_auth', Boolean, default=False),
        sa.Column('privacy_allow_export', Boolean, default=True),
        sa.Column('privacy_encryption_level', String, default='local'),
        sa.Column('created_at', DateTime, server_default=sa.func.now()),
        sa.Column('updated_at', DateTime, server_default=sa.func.now(), onupdate=sa.func.now()),
    )
    op.create_index('idx_capsules_user_status', 'capsules', ['user_id', 'unlock_status'])

    # capsule_dialogues
    op.create_table(
        'capsule_dialogues',
        sa.Column('id', String, primary_key=True),
        sa.Column('capsule_id', String, nullable=False),
        sa.Column('opened_at', DateTime),
        sa.Column('opened_by', String, default='user'),
        sa.Column('present_context', Text),
        sa.Column('present_mood', Text),
        sa.Column('present_reflection', Text),
        sa.Column('conversation', Text),
        sa.Column('insights_pattern', Text),
        sa.Column('insights_growth', Text),
        sa.Column('insights_warning', Text),
        sa.Column('insights_suggestion', Text),
        sa.Column('closed_at', DateTime),
        sa.Column('closure', Text),
    )

    # browser_clips
    op.create_table(
        'browser_clips',
        sa.Column('id', String, primary_key=True),
        sa.Column('user_id', String, nullable=False),
        sa.Column('brain_side', String, default='network'),
        sa.Column('title', String, nullable=False),
        sa.Column('url', String, nullable=False),
        sa.Column('domain', String, nullable=False),
        sa.Column('excerpt', Text),
        sa.Column('full_text', Text),
        sa.Column('readability_score', Float),
        sa.Column('author', String),
        sa.Column('publish_date', DateTime),
        sa.Column('site_type', String),
        sa.Column('credibility_score', Float),
        sa.Column('capture_timestamp', DateTime, server_default=sa.func.now()),
        sa.Column('capture_method', String),
        sa.Column('user_agent', String),
        sa.Column('screenshot_url', String),
        sa.Column('extracted', Boolean, default=False),
        sa.Column('summarized', Boolean, default=False),
        sa.Column('tagged', Boolean, default=False),
        sa.Column('embedded', Boolean, default=False),
        sa.Column('verification_status', String, default='unverified'),
        sa.Column('verification_consensus', Float),
        sa.Column('created_at', DateTime, server_default=sa.func.now()),
        sa.Column('updated_at', DateTime, server_default=sa.func.now(), onupdate=sa.func.now()),
    )
    op.create_index('idx_browser_clips_user', 'browser_clips', ['user_id'])
    op.create_index('idx_browser_clips_domain', 'browser_clips', ['domain'])
    op.create_index('idx_browser_clips_verification', 'browser_clips', ['verification_status'])

    # knowledge_units
    op.create_table(
        'knowledge_units',
        sa.Column('id', String, primary_key=True),
        sa.Column('user_id', String, nullable=False),
        sa.Column('brain_side', String, default='network'),
        sa.Column('content_raw', Text, nullable=False),
        sa.Column('content_processed', Text),
        sa.Column('content_type', String),
        sa.Column('content_confidence', Float),
        sa.Column('source_url', String),
        sa.Column('source_title', String),
        sa.Column('source_type', String),
        sa.Column('source_author', String),
        sa.Column('source_publish_date', DateTime),
        sa.Column('source_access_date', DateTime, server_default=sa.func.now()),
        sa.Column('source_credibility_score', Float),
        sa.Column('source_bias_indicator', String),
        sa.Column('source_funding_source', String),
        sa.Column('verification_status', String, default='unverified'),
        sa.Column('verification_consensus', Float),
        sa.Column('last_verified', DateTime),
        sa.Column('next_scheduled', DateTime),
        sa.Column('timeliness_status', String),
        sa.Column('timeliness_half_life', Integer),
        sa.Column('timeliness_deprecation_warning', String),
        sa.Column('trust_level', String, default='tentative'),
        sa.Column('first_seen', DateTime, server_default=sa.func.now()),
        sa.Column('last_reviewed', DateTime),
        sa.Column('review_count', Integer, default=0),
        sa.Column('created_at', DateTime, server_default=sa.func.now()),
        sa.Column('updated_at', DateTime, server_default=sa.func.now(), onupdate=sa.func.now()),
    )
    op.create_index('idx_knowledge_user_status', 'knowledge_units', ['user_id', 'verification_status'])
    op.create_index('idx_knowledge_brain', 'knowledge_units', ['brain_side'])

    # attention_activities
    op.create_table(
        'attention_activities',
        sa.Column('id', String, primary_key=True),
        sa.Column('user_id', String, nullable=False),
        sa.Column('category_id', String, nullable=False),
        sa.Column('activity_source', String, default='unknown'),
        sa.Column('brain_side', String),
        sa.Column('description', String),
        sa.Column('start_time', DateTime, nullable=False),
        sa.Column('end_time', DateTime),
        sa.Column('actual_duration', Integer),
        sa.Column('source', String),
        sa.Column('metadata_url', String),
        sa.Column('metadata_app', String),
        sa.Column('metadata_title', String),
        sa.Column('completion_status', String),
        sa.Column('focus_score', Float),
        sa.Column('focus_duration', Float),
        sa.Column('focus_intensity', Float),
        sa.Column('focus_recovery', Float),
        sa.Column('focus_switching', Float),
        sa.Column('created_at', DateTime, server_default=sa.func.now()),
    )
    op.create_index('idx_activities_user_time', 'attention_activities', ['user_id', 'start_time'])
    op.create_index('idx_activities_brain', 'attention_activities', ['brain_side'])

    # attention_categories
    op.create_table(
        'attention_categories',
        sa.Column('id', String, primary_key=True),
        sa.Column('user_id', String, nullable=False),
        sa.Column('name', String, nullable=False),
        sa.Column('icon', String),
        sa.Column('color', String),
        sa.Column('allocated_minutes', Integer, nullable=False),
        sa.Column('min_required', Integer),
        sa.Column('max_allowed', Integer),
        sa.Column('priority', String),
        sa.Column('auto_rebalance_from', Text),
        sa.Column('notify_at', Float),
        sa.Column('created_at', DateTime, server_default=sa.func.now()),
        sa.Column('updated_at', DateTime, server_default=sa.func.now(), onupdate=sa.func.now()),
    )

    # deep_work_sessions
    op.create_table(
        'deep_work_sessions',
        sa.Column('id', String, primary_key=True),
        sa.Column('user_id', String, nullable=False),
        sa.Column('task', String, nullable=False),
        sa.Column('planned_duration', Integer, nullable=False),
        sa.Column('actual_duration', Integer),
        sa.Column('started_at', DateTime),
        sa.Column('ended_at', DateTime),
        sa.Column('rules_block_notifications', Boolean),
        sa.Column('rules_blocked_apps', Text),
        sa.Column('rules_blocked_websites', Text),
        sa.Column('rules_allowed_websites', Text),
        sa.Column('rules_ambient_sound', String),
        sa.Column('focus_score_avg', Float),
        sa.Column('interruptions', Integer, default=0),
        sa.Column('blocked_attempts', Integer, default=0),
        sa.Column('completion_status', String),
        sa.Column('end_reason', String),
    )

    # admin_users
    op.create_table(
        'admin_users',
        sa.Column('id', String, primary_key=True),
        sa.Column('email', String, nullable=False, unique=True),
        sa.Column('name', String, nullable=False),
        sa.Column('avatar', String),
        sa.Column('password_hash', String, nullable=False),
        sa.Column('role', String, nullable=False),
        sa.Column('permissions', Text),
        sa.Column('status', String, default='pending'),
        sa.Column('last_login_at', DateTime),
        sa.Column('last_login_ip', String),
        sa.Column('mfa_enabled', Boolean, default=False),
        sa.Column('mfa_secret', String),
        sa.Column('created_at', DateTime, server_default=sa.func.now()),
        sa.Column('created_by', String),
        sa.Column('updated_at', DateTime, server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.Column('tenant_id', String),
        sa.Column('managed_tenants', Text),
    )
    op.create_index('idx_admin_users_role', 'admin_users', ['role'])
    op.create_index('idx_admin_users_status', 'admin_users', ['status'])

    # admin_audit_logs
    op.create_table(
        'admin_audit_logs',
        sa.Column('id', String, primary_key=True),
        sa.Column('admin_id', String, nullable=False),
        sa.Column('admin_name', String),
        sa.Column('admin_role', String),
        sa.Column('action', String, nullable=False),
        sa.Column('resource_type', String, nullable=False),
        sa.Column('resource_id', String),
        sa.Column('before_state', Text),
        sa.Column('after_state', Text),
        sa.Column('changes', Text),
        sa.Column('ip_address', String),
        sa.Column('user_agent', String),
        sa.Column('request_id', String),
        sa.Column('risk_level', String, default='low'),
        sa.Column('risk_reason', String),
        sa.Column('created_at', DateTime, server_default=sa.func.now()),
    )
    op.create_index('idx_admin_audit_logs_admin', 'admin_audit_logs', ['admin_id'])
    op.create_index('idx_admin_audit_logs_action', 'admin_audit_logs', ['action', 'resource_type'])
    op.create_index('idx_admin_audit_logs_risk', 'admin_audit_logs', ['risk_level'])

    # FTS5 virtual table for knowledge search
    op.execute("""
        CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
            content_raw,
            content='knowledge_units',
            content_rowid='rowid'
        )
    """)

    # FTS5 sync triggers
    op.execute("""
        CREATE TRIGGER IF NOT EXISTS knowledge_fts_insert AFTER INSERT ON knowledge_units BEGIN
            INSERT INTO knowledge_fts(rowid, content_raw) VALUES (new.rowid, new.content_raw);
        END
    """)
    op.execute("""
        CREATE TRIGGER IF NOT EXISTS knowledge_fts_update AFTER UPDATE ON knowledge_units BEGIN
            UPDATE knowledge_fts SET content_raw = new.content_raw WHERE rowid = new.rowid;
        END
    """)
    op.execute("""
        CREATE TRIGGER IF NOT EXISTS knowledge_fts_delete AFTER DELETE ON knowledge_units BEGIN
            DELETE FROM knowledge_fts WHERE rowid = old.rowid;
        END
    """)

def downgrade():
    op.execute("DROP TRIGGER IF EXISTS knowledge_fts_delete")
    op.execute("DROP TRIGGER IF EXISTS knowledge_fts_update")
    op.execute("DROP TRIGGER IF EXISTS knowledge_fts_insert")
    op.execute("DROP TABLE IF EXISTS knowledge_fts")
    op.drop_index('idx_admin_audit_logs_risk', table_name='admin_audit_logs')
    op.drop_index('idx_admin_audit_logs_action', table_name='admin_audit_logs')
    op.drop_index('idx_admin_audit_logs_admin', table_name='admin_audit_logs')
    op.drop_table('admin_audit_logs')
    op.drop_index('idx_admin_users_status', table_name='admin_users')
    op.drop_index('idx_admin_users_role', table_name='admin_users')
    op.drop_table('admin_users')
    op.drop_table('deep_work_sessions')
    op.drop_table('attention_categories')
    op.drop_index('idx_activities_brain', table_name='attention_activities')
    op.drop_index('idx_activities_user_time', table_name='attention_activities')
    op.drop_table('attention_activities')
    op.drop_index('idx_knowledge_brain', table_name='knowledge_units')
    op.drop_index('idx_knowledge_user_status', table_name='knowledge_units')
    op.drop_table('knowledge_units')
    op.drop_index('idx_browser_clips_verification', table_name='browser_clips')
    op.drop_index('idx_browser_clips_domain', table_name='browser_clips')
    op.drop_index('idx_browser_clips_user', table_name='browser_clips')
    op.drop_table('browser_clips')
    op.drop_table('capsule_dialogues')
    op.drop_index('idx_capsules_user_status', table_name='capsules')
    op.drop_table('capsules')
    op.drop_index('idx_notes_user', table_name='notes')
    op.drop_table('notes')
    op.drop_table('users')
