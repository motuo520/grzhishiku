from sqlalchemy import Column, String, DateTime, Integer, Boolean, Float, Text, CheckConstraint, Table, ForeignKey, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base

content_tags = Table(
    'content_tags',
    Base.metadata,
    Column('content_id', String, nullable=False),
    Column('content_type', String, nullable=False),  # note / clip / knowledge
    Column('tag_id', String, ForeignKey('tags.id'), nullable=False),
    Column('created_at', DateTime, server_default=func.now()),
    CheckConstraint("content_type IN ('note', 'clip', 'knowledge')", name='ck_content_tags_content_type'),
)

class SummaryCache(Base):
    __tablename__ = "summary_cache"
    
    id = Column(String, primary_key=True)
    text_hash = Column(String, nullable=False, index=True)
    length = Column(String, nullable=False)
    summary = Column(Text, nullable=False)
    original_length = Column(Integer)
    compression_ratio = Column(Float)
    created_at = Column(DateTime, server_default=func.now())

class Tag(Base):
    __tablename__ = "tags"
    
    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False)
    name = Column(String, nullable=False)
    color = Column(String, default="#8b949e")
    description = Column(String)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

class Embedding(Base):
    __tablename__ = "embeddings"
    
    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False)
    content_type = Column(String, nullable=False)  # note / clip / knowledge / query / summary
    content_id = Column(String, nullable=False)
    text_preview = Column(String)  # first 200 chars for debugging
    embedding_json = Column(Text, nullable=False)  # JSON array of floats
    dimensions = Column(Integer, default=768)
    model = Column(String, default="qwen2.5:0.5b")  # model used for embedding
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        CheckConstraint("content_type IN ('note', 'clip', 'knowledge', 'query', 'summary')", name='ck_embeddings_content_type'),
    )


class User(Base):
    __tablename__ = "users"
    
    id = Column(String, primary_key=True)
    email = Column(String, nullable=False, unique=True)
    name = Column(String)
    username = Column(String, nullable=True)
    display_name = Column(String, nullable=True)
    avatar = Column(String)
    password_hash = Column(String)
    status = Column(String, default="active")
    subscription_tier = Column(String, default="free")
    subscription_status = Column(String, default="active")
    subscription_expires_at = Column(DateTime)
    storage_used = Column(Integer, default=0)
    storage_limit = Column(Integer, default=1073741824)
    last_login_at = Column(DateTime)
    last_login_ip = Column(String)
    mfa_enabled = Column(Boolean, default=False)
    settings = Column(Text, default='{}')
    active_brain = Column(String, default="personal")
    trial_credit_given = Column(Boolean, default=False)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    tenant_id = Column(String)

    __table_args__ = (
        Index('ix_users_email_status', 'email', 'status'),
        Index('ix_users_subscription', 'id', 'subscription_status'),
    )

class Note(Base):
    __tablename__ = "notes"
    
    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    brain_side = Column(String, default="personal")
    title = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    content_format = Column(String, default="markdown")
    backlinks = Column(Text)
    forward_links = Column(Text)
    mood_emotion = Column(String)
    mood_intensity = Column(Float)
    mood_energy_level = Column(Float)
    location = Column(String)
    weather = Column(String)
    capsule_refs = Column(Text)
    is_private = Column(Boolean, default=True)
    encryption_level = Column(String, default="local_aes")
    status = Column(String, default="active")
    flag_reason = Column(String)
    tenant_id = Column(String)
    origin_type = Column(String, default="self_practice")
    invoke_count = Column(Integer, default=0)
    last_invoked_at = Column(DateTime)
    practice_depth = Column(Integer, default=0)
    personal_relevance_score = Column(Float, default=0.5)
    evolution_stage = Column(String, default="collected")
    attached_practice_ids = Column(Text, default='[]')
    pipeline_stage = Column(String, default="raw")
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('ix_notes_user_status', 'user_id', 'status'),
        Index('ix_notes_evolution', 'user_id', 'evolution_stage'),
        Index('ix_notes_relevance', 'user_id', 'personal_relevance_score'),
        Index('ix_notes_pipeline', 'user_id', 'brain_side', 'pipeline_stage'),
    )

class Capsule(Base):
    __tablename__ = "capsules"
    
    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False)
    brain_side = Column(String, default="personal")
    content_type = Column(String)
    content_body = Column(Text, nullable=False)
    content_attachments = Column(Text)
    mood_emotion = Column(String)
    mood_intensity = Column(Float)
    mood_energy_level = Column(Float)
    mood_tags = Column(Text)  # JSON array of mood tags
    mood_trigger = Column(String)
    mood_weather = Column(String)
    mood_location = Column(String)
    sealed_at = Column(DateTime)
    privacy_level = Column(String, default="private")  # public, shared, private
    unlock_conditions = Column(Text)  # JSON detailed unlock conditions
    sealed_context = Column(Text)
    sealed_fingerprint = Column(String)
    unlock_type = Column(String)
    unlock_config = Column(Text, nullable=False)
    unlock_status = Column(String, default="locked")
    privacy_require_auth = Column(Boolean, default=False)
    privacy_allow_export = Column(Boolean, default=True)
    privacy_encryption_level = Column(String, default="local")
    status = Column(String, default="active")
    flag_reason = Column(String)
    tenant_id = Column(String)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

class CapsuleDialogue(Base):
    __tablename__ = "capsule_dialogues"
    
    id = Column(String, primary_key=True)
    capsule_id = Column(String, nullable=False)
    opened_at = Column(DateTime)
    opened_by = Column(String)
    present_context = Column(Text)
    present_mood = Column(Text)
    present_reflection = Column(Text)
    conversation = Column(Text)
    insights_pattern = Column(Text)
    insights_growth = Column(Text)
    insights_warning = Column(Text)
    insights_suggestion = Column(Text)
    closed_at = Column(DateTime)
    closure = Column(Text)

class BrowserClip(Base):
    __tablename__ = "browser_clips"
    
    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    brain_side = Column(String, default="network")
    title = Column(String, nullable=False)
    url = Column(String, nullable=False)
    domain = Column(String, nullable=False, index=True)
    excerpt = Column(Text)
    full_text = Column(Text)
    readability_score = Column(Float)
    author = Column(String)
    publish_date = Column(DateTime)
    site_type = Column(String)
    credibility_score = Column(Float)
    capture_timestamp = Column(DateTime, server_default=func.now())
    capture_method = Column(String)
    user_agent = Column(String)
    screenshot_url = Column(String)
    extracted = Column(Boolean, default=False)
    summarized = Column(Boolean, default=False)
    tagged = Column(Boolean, default=False)
    embedded = Column(Boolean, default=False)
    verification_status = Column(String, default="unverified")
    verification_consensus = Column(Float)
    status = Column(String, default="active")
    pipeline_stage = Column(String, default="raw")
    flag_reason = Column(String)
    tenant_id = Column(String)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('ix_clips_user_domain', 'user_id', 'domain'),
        Index('ix_clips_user_pipeline', 'user_id', 'pipeline_stage'),
    )

class KnowledgeUnit(Base):
    __tablename__ = "knowledge_units"
    
    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    brain_side = Column(String, default="network")
    content_raw = Column(Text, nullable=False)
    content_processed = Column(Text)
    content_type = Column(String)
    content_confidence = Column(Float)
    source_url = Column(String)
    source_title = Column(String)
    source_type = Column(String)
    source_author = Column(String)
    source_publish_date = Column(DateTime)
    source_access_date = Column(DateTime, server_default=func.now())
    source_credibility_score = Column(Float)
    source_bias_indicator = Column(String)
    source_funding_source = Column(String)
    verification_history = Column(Text, default='[]')
    verification_status = Column(String, default="unverified", index=True)
    verification_consensus = Column(Float)
    last_verified = Column(DateTime)
    next_scheduled = Column(DateTime)
    timeliness_status = Column(String)
    timeliness_half_life = Column(Integer)
    timeliness_deprecation_warning = Column(String)
    trust_level = Column(String, default="tentative")
    first_seen = Column(DateTime, server_default=func.now())
    last_reviewed = Column(DateTime)
    review_count = Column(Integer, default=0)
    status = Column(String, default="active")
    flag_reason = Column(String)
    tenant_id = Column(String)
    origin_type = Column(String, default="book_excerpt")
    invoke_count = Column(Integer, default=0)
    last_invoked_at = Column(DateTime)
    practice_depth = Column(Integer, default=0)
    personal_relevance_score = Column(Float, default=0.5)
    evolution_stage = Column(String, default="collected")
    attached_practice_ids = Column(Text, default='[]')
    pipeline_stage = Column(String, default="raw")
    content_subtype = Column(String, default="note")
    source_id = Column(String)
    source_content_type = Column(String)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('ix_knowledge_user_verification', 'user_id', 'verification_status'),
        Index('ix_knowledge_evolution', 'user_id', 'evolution_stage'),
        Index('ix_knowledge_invoke', 'user_id', 'invoke_count'),
        Index('ix_knowledge_pipeline', 'user_id', 'brain_side', 'pipeline_stage'),
        Index('ix_knowledge_subtype', 'user_id', 'content_subtype'),
        CheckConstraint("source_content_type IS NULL OR source_content_type IN ('note', 'knowledge')", name='ck_knowledge_source_content_type'),
    )

class PracticeRecord(Base):
    __tablename__ = "practice_records"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False)
    target_type = Column(String, nullable=False)
    target_id = Column(String, nullable=False)
    practice_type = Column(String, nullable=False)
    description = Column(Text, nullable=False)
    result = Column(Text)
    learned_lesson = Column(Text)
    context_snapshot = Column(Text)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('ix_practice_user_target', 'user_id', 'target_type', 'target_id'),
        Index('ix_practice_created', 'user_id', 'created_at'),
    )

class PipelineTransition(Base):
    __tablename__ = "pipeline_transitions"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    content_type = Column(String, nullable=False)
    content_id = Column(String, nullable=False)
    from_stage = Column(String, nullable=False)
    to_stage = Column(String, nullable=False)
    brain_side_before = Column(String)
    brain_side_after = Column(String)
    action = Column(String, default="transition")  # transition / extract / collide / review / brain_convert
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        Index('ix_pipeline_transition_user_content', 'user_id', 'content_type', 'content_id'),
        Index('ix_pipeline_transition_created', 'user_id', 'created_at'),
    )


class DailyReview(Base):
    __tablename__ = "daily_reviews"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False)
    review_date = Column(DateTime, nullable=False)
    content_summary = Column(Text)
    ai_reflection = Column(Text)
    gaps_found = Column(Text, default='[]')
    action_items = Column(Text, default='[]')
    praise_items = Column(Text, default='[]')
    status = Column(String, default="pending")
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('ix_daily_reviews_user_date', 'user_id', 'review_date'),
    )

class ContextGuide(Base):
    __tablename__ = "context_guides"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    title = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    scope = Column(String, default="both")  # personal / network / both
    is_active = Column(Boolean, default=True)
    version_tag = Column(String)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('ix_context_guides_user_active', 'user_id', 'is_active'),
    )


class ExperimentLog(Base):
    __tablename__ = "experiment_logs"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    title = Column(String, nullable=False)
    hypothesis = Column(Text, nullable=False)
    controlled_variable = Column(Text)
    expected_result = Column(Text)
    actual_result = Column(Text)
    conclusion = Column(Text)
    status = Column(String, default="planned")  # planned / running / completed / abandoned
    related_content_type = Column(String)  # note / knowledge_unit
    related_content_id = Column(String)
    brain_side = Column(String, default="both")
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('ix_experiment_logs_user_status', 'user_id', 'status'),
        CheckConstraint("related_content_type IS NULL OR related_content_type IN ('note', 'knowledge_unit')", name='ck_experiment_related_content_type'),
    )


class DepthCheckLog(Base):
    __tablename__ = "depth_check_logs"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    content_type = Column(String, nullable=False)  # note / knowledge_unit / text
    content_id = Column(String)
    content_preview = Column(String)
    depth_score = Column(Float, default=0.0)
    is_passed = Column(Boolean, default=False)
    feedback = Column(Text)
    suggestions = Column(Text, default='[]')  # JSON array
    model_used = Column(String)
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        Index('ix_depth_check_logs_user_created', 'user_id', 'created_at'),
        CheckConstraint("content_type IN ('note', 'knowledge_unit', 'text')", name='ck_depth_check_content_type'),
    )


class EvolutionReflection(Base):
    __tablename__ = "evolution_reflections"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    title = Column(String, nullable=False)
    discomfort_level = Column(Integer, default=1)  # 1-5
    pain_description = Column(Text)
    joy_description = Column(Text)
    learning = Column(Text)
    is_true_evolution = Column(Boolean, default=True)
    related_content_type = Column(String)  # note / knowledge_unit / experiment_log
    related_content_id = Column(String)
    brain_side = Column(String, default="personal")
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('ix_evolution_reflections_user_created', 'user_id', 'created_at'),
        CheckConstraint("related_content_type IS NULL OR related_content_type IN ('note', 'knowledge_unit', 'experiment_log')", name='ck_evolution_related_content_type'),
    )


class RssFeed(Base):
    __tablename__ = "rss_feeds"
    
    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    title = Column(String)
    url = Column(String, nullable=False)
    description = Column(Text)
    site_url = Column(String)
    language = Column(String)
    last_fetched_at = Column(DateTime)
    fetch_status = Column(String, default="pending")  # pending / success / error
    fetch_error = Column(Text)
    status = Column(String, default="active")
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    
    __table_args__ = (
        Index('ix_rss_feeds_user_status', 'user_id', 'status'),
    )

class RssEntry(Base):
    __tablename__ = "rss_entries"
    
    id = Column(String, primary_key=True)
    feed_id = Column(String, nullable=False, index=True)
    user_id = Column(String, nullable=False, index=True)
    title = Column(String)
    link = Column(String, nullable=False)
    summary = Column(Text)
    content = Column(Text)
    author = Column(String)
    published_at = Column(DateTime)
    is_read = Column(Boolean, default=False)
    is_saved = Column(Boolean, default=False)  # saved to clip/knowledge
    external_id = Column(String, index=True)  # guid / id from feed
    status = Column(String, default="active")
    pipeline_stage = Column(String, default="raw")
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    
    __table_args__ = (
        Index('ix_rss_entries_feed', 'feed_id', 'published_at'),
        Index('ix_rss_entries_user_saved', 'user_id', 'is_saved'),
        Index('ix_rss_entries_user_pipeline', 'user_id', 'pipeline_stage'),
    )

class AttentionActivity(Base):
    __tablename__ = "attention_activities"
    
    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    category_id = Column(String, nullable=False)
    category = Column(String, default="other")
    activity_source = Column(String, default="unknown")
    brain_side = Column(String)
    description = Column(String)
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime)
    actual_duration = Column(Integer)
    source = Column(String)
    metadata_url = Column(String)
    metadata_app = Column(String)
    metadata_title = Column(String)
    completion_status = Column(String)
    focus_score = Column(Float)
    focus_duration = Column(Float)
    focus_intensity = Column(Float)
    focus_recovery = Column(Float)
    focus_switching = Column(Float)
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        Index('ix_attention_user_created', 'user_id', 'created_at'),
    )

class AttentionCategory(Base):
    __tablename__ = "attention_categories"
    
    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False)
    name = Column(String, nullable=False)
    icon = Column(String)
    color = Column(String)
    brain_side = Column(String, default="personal")
    allocated_minutes = Column(Integer, nullable=False)
    min_required = Column(Integer)
    max_allowed = Column(Integer)
    priority = Column(String)
    auto_rebalance_from = Column(Text)
    notify_at = Column(Float)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

class AttentionGuardianRule(Base):
    __tablename__ = "attention_guardian_rules"
    
    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    type = Column(String, nullable=False)  # website | app | notification
    target = Column(String, nullable=False)
    mode = Column(String, nullable=False, default="block")  # block | limit
    limit_minutes = Column(Integer)
    active = Column(Boolean, default=True)
    schedule_days = Column(String)  # JSON list of ints 0-6
    schedule_start = Column(String)  # HH:MM
    schedule_end = Column(String)  # HH:MM
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

class AttentionRation(Base):
    __tablename__ = "attention_rations"
    
    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    source_type = Column(String, nullable=False)  # rss | social | email | clip
    source_id = Column(String)
    name = Column(String, nullable=False)
    daily_limit_minutes = Column(Integer, nullable=False)
    used_minutes = Column(Integer, default=0)
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

class DeepWorkSession(Base):
    __tablename__ = "deep_work_sessions"
    
    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False)
    brain_side = Column(String, default="personal")
    task = Column(String, nullable=False)
    planned_duration = Column(Integer, nullable=False)
    actual_duration = Column(Integer)
    started_at = Column(DateTime)
    ended_at = Column(DateTime)
    rules_block_notifications = Column(Boolean)
    rules_blocked_apps = Column(Text)
    rules_blocked_websites = Column(Text)
    rules_allowed_websites = Column(Text)
    rules_ambient_sound = Column(String)
    focus_score_avg = Column(Float)
    interruptions = Column(Integer, default=0)
    blocked_attempts = Column(Integer, default=0)
    completion_status = Column(String)
    end_reason = Column(String)

class AdminUser(Base):
    __tablename__ = "admin_users"
    
    id = Column(String, primary_key=True)
    email = Column(String, nullable=False, unique=True)
    name = Column(String, nullable=False)
    avatar = Column(String)
    password_hash = Column(String, nullable=False)
    role = Column(String, nullable=False)
    permissions = Column(Text)
    status = Column(String, default="pending")
    last_login_at = Column(DateTime)
    last_login_ip = Column(String)
    mfa_enabled = Column(Boolean, default=False)
    mfa_secret = Column(String)
    created_at = Column(DateTime, server_default=func.now())
    created_by = Column(String)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    tenant_id = Column(String)
    managed_tenants = Column(Text)

class AdminAuditLog(Base):
    __tablename__ = "admin_audit_logs"
    
    id = Column(String, primary_key=True)
    admin_id = Column(String, nullable=False)
    admin_name = Column(String)
    admin_role = Column(String)
    action = Column(String, nullable=False)
    resource_type = Column(String, nullable=False)
    resource_id = Column(String)
    before_state = Column(Text)
    after_state = Column(Text)
    changes = Column(Text)
    ip_address = Column(String)
    user_agent = Column(String)
    request_id = Column(String)
    risk_level = Column(String, default="low")
    risk_reason = Column(String)
    details = Column(Text)
    created_at = Column(DateTime, server_default=func.now())


class Tenant(Base):
    __tablename__ = "tenants"
    
    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    slug = Column(String, nullable=False, unique=True)
    description = Column(String)
    status = Column(String, default="active")
    plan = Column(String, default="free")
    max_users = Column(Integer, default=10)
    max_storage = Column(Integer, default=10737418240)
    owner_id = Column(String)
    settings = Column(Text)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class SystemConfig(Base):
    __tablename__ = "system_configs"
    
    id = Column(String, primary_key=True)
    key = Column(String, nullable=False, unique=True)
    value_json = Column(Text, nullable=False, default='{}')
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    updated_by = Column(String)


class GraphEdge(Base):
    __tablename__ = "graph_edges"
    
    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    source_id = Column(String, nullable=False, index=True)
    target_id = Column(String, nullable=False, index=True)
    source_brain_side = Column(String)
    target_brain_side = Column(String)
    edge_type = Column(String)
    strength = Column(Float, default=1.0)
    weight = Column(Float, default=1.0)
    context = Column(Text)
    cross_brain = Column(Boolean, default=False)
    auto_created = Column(Boolean, default=False)
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        Index('ix_graph_edges_user_source_target', 'user_id', 'source_id', 'target_id'),
    )

class EmergenceResult(Base):
    __tablename__ = "emergence_results"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False)
    type = Column(String, nullable=False)  # associate / collision / hybrid / counterfactual
    brain_side = Column(String, default="both")  # personal / network / both
    source_ids = Column(Text, default="[]")  # JSON array of source content ids
    source_types = Column(Text, default="[]")  # JSON array of source content types
    model_used = Column(String)  # actual LLM model used
    input_data = Column(Text, nullable=False)  # JSON
    output_data = Column(Text, nullable=False)  # JSON
    scores = Column(Text)  # JSON (optional)
    created_at = Column(DateTime, server_default=func.now())


class EmergenceIdea(Base):
    __tablename__ = "emergence_ideas"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False)
    title = Column(String, nullable=False)
    summary = Column(Text)
    brain_side = Column(String, default="both")  # personal / network / both
    source_result_ids = Column(Text, default="[]")  # JSON array of EmergenceResult.id
    tags = Column(Text, default="[]")  # JSON array
    status = Column(String, default="draft")  # draft / refining / converted
    target_type = Column(String)  # note / capsule / knowledge
    target_id = Column(String)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('ix_emergence_ideas_user_status', 'user_id', 'status'),
    )


class EmergenceCanvas(Base):
    __tablename__ = "emergence_canvases"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False)
    title = Column(String, nullable=False)
    description = Column(Text)
    brain_side = Column(String, default="both")  # personal / network / both
    nodes = Column(Text, default="[]")  # JSON array of canvas nodes
    edges = Column(Text, default="[]")  # JSON array of canvas edges
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('ix_emergence_canvases_user_updated', 'user_id', 'updated_at'),
    )


class SupportTicket(Base):
    __tablename__ = "support_tickets"
    
    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False)
    user_email = Column(String, nullable=False)
    subject = Column(String, nullable=False)
    description = Column(Text, nullable=False)
    status = Column(String, default="open")
    priority = Column(String, default="medium")
    category = Column(String, default="general")
    assigned_to = Column(String)
    satisfaction = Column(Integer, nullable=True)  # 1-5
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class SupportTicketReply(Base):
    __tablename__ = "support_ticket_replies"
    
    id = Column(String, primary_key=True)
    ticket_id = Column(String, nullable=False)
    user_id = Column(String, nullable=False)  # can be user or admin
    user_email = Column(String, nullable=False)
    is_admin = Column(Boolean, default=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, server_default=func.now())


class BiasDetectionRecord(Base):
    __tablename__ = "bias_detection_records"
    
    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    bias_type = Column(String, nullable=False)
    severity = Column(Integer, nullable=False)  # 1-5
    text_snippet = Column(Text, nullable=False)
    suggestion = Column(Text)
    source_content_id = Column(String)  # note_id or knowledge_id
    source_content_type = Column(String)  # note / knowledge
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        CheckConstraint("source_content_type IS NULL OR source_content_type IN ('note', 'knowledge')", name='ck_bias_source_content_type'),
    )


class EmailAccount(Base):
    __tablename__ = "email_accounts"
    
    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    provider = Column(String, nullable=False)  # gmail / outlook / qq / 163 / imap_other
    email_address = Column(String, nullable=False)
    imap_host = Column(String)
    imap_port = Column(Integer, default=993)
    imap_use_ssl = Column(Boolean, default=True)
    access_token = Column(Text)      # encrypted OAuth token or IMAP password/auth code
    refresh_token = Column(Text)     # encrypted OAuth refresh token
    sync_status = Column(String, default="pending")  # pending / syncing / success / error
    last_sync_at = Column(DateTime)
    last_error = Column(Text)
    sync_count = Column(Integer, default=0)
    status = Column(String, default="active")
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    
    __table_args__ = (
        Index('ix_email_accounts_user_status', 'user_id', 'status'),
    )


class EmailMessage(Base):
    __tablename__ = "email_messages"
    
    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    account_id = Column(String, nullable=False, index=True)
    message_uid = Column(String, nullable=False)  # IMAP UID or provider message id
    subject = Column(String)
    sender_name = Column(String)
    sender_email = Column(String, index=True)
    recipients_to = Column(Text)  # JSON
    recipients_cc = Column(Text)  # JSON
    body_text = Column(Text)
    body_html = Column(Text)
    received_at = Column(DateTime, index=True)
    is_read = Column(Boolean, default=False)
    labels = Column(Text)  # JSON array
    status = Column(String, default="active")  # active / imported_to_knowledge / archived
    knowledge_id = Column(String)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    
    __table_args__ = (
        Index('ix_email_messages_account_uid', 'account_id', 'message_uid', unique=True),
        Index('ix_email_messages_user_status', 'user_id', 'status'),
    )


class SocialAccount(Base):
    __tablename__ = "social_accounts"
    
    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    provider = Column(String, nullable=False)  # wechat / dingtalk / feishu
    account_name = Column(String)
    connection_type = Column(String, default="local_import")  # local_import / oauth_api
    oauth_token = Column(Text)
    oauth_refresh_token = Column(Text)
    oauth_expires_at = Column(DateTime)
    sync_status = Column(String, default="pending")  # pending / syncing / success / error
    last_sync_at = Column(DateTime)
    last_error = Column(Text)
    sync_count = Column(Integer, default=0)
    status = Column(String, default="active")
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    
    __table_args__ = (
        Index('ix_social_accounts_user_status', 'user_id', 'status'),
    )


class SocialMessage(Base):
    __tablename__ = "social_messages"
    
    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    account_id = Column(String, nullable=False, index=True)
    platform = Column(String, nullable=False)  # wechat / dingtalk / feishu
    conversation_id = Column(String)
    conversation_name = Column(String)
    message_uid = Column(String, nullable=False)
    sender_name = Column(String)
    sender_id = Column(String)
    content_raw = Column(Text)
    content_text = Column(Text)
    message_type = Column(String, default="text")  # text / image / file / link / system
    attachments = Column(Text)  # JSON
    sent_at = Column(DateTime)
    is_me = Column(Boolean, default=False)
    status = Column(String, default="active")  # active / imported_to_knowledge / deleted
    knowledge_id = Column(String)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    
    __table_args__ = (
        Index('ix_social_messages_account_uid', 'account_id', 'message_uid', unique=True),
        Index('ix_social_messages_user_status', 'user_id', 'status'),
    )


class ReadLaterItem(Base):
    __tablename__ = "read_later_items"
    
    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    title = Column(String)
    url = Column(String, nullable=False)
    domain = Column(String, index=True)
    excerpt = Column(Text)
    full_text = Column(Text)
    cover_image = Column(String)
    status = Column(String, default="unread")  # unread / reading / read / archived
    is_favorite = Column(Boolean, default=False)
    read_progress = Column(Integer, default=0)
    source = Column(String, default="manual")  # manual / extension / clipper
    item_status = Column(String, default="active")  # active / imported_to_knowledge / deleted
    knowledge_id = Column(String)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    
    __table_args__ = (
        Index('ix_read_later_user_status', 'user_id', 'item_status'),
        Index('ix_read_later_user_domain', 'user_id', 'domain'),
    )


class Document(Base):
    __tablename__ = "documents"
    
    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    title = Column(String)
    original_name = Column(String, nullable=False)
    file_path = Column(String, nullable=False)
    file_size = Column(Integer, default=0)
    file_type = Column(String)
    content_text = Column(Text)
    extraction_status = Column(String, default="pending")  # pending / success / error
    extraction_error = Column(Text)
    doc_status = Column(String, default="active")  # active / imported_to_knowledge / deleted
    knowledge_id = Column(String)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    
    __table_args__ = (
        Index('ix_documents_user_status', 'user_id', 'doc_status'),
        Index('ix_documents_user_type', 'user_id', 'file_type'),
    )


class DecisionAudit(Base):
    __tablename__ = "decision_audits"
    
    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    tenant_id = Column(String)
    title = Column(String, nullable=False)
    context = Column(Text, nullable=False)
    options = Column(Text, default='[]')  # JSON array
    expected_outcome = Column(Text)
    actual_outcome = Column(Text)
    decision_date = Column(DateTime)
    status = Column(String, default="pending")  # pending / reviewed / closed
    analysis_result = Column(Text, default='{}')  # JSON
    related_note_ids = Column(Text, default='[]')  # JSON array
    brain_side = Column(String, default="personal")
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    
    __table_args__ = (
        Index('ix_decision_audits_user_status', 'user_id', 'status'),
        Index('ix_decision_audits_user_created', 'user_id', 'created_at'),
    )


class FutureSimulation(Base):
    __tablename__ = "future_simulations"
    
    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    tenant_id = Column(String)
    title = Column(String, nullable=False)
    context = Column(Text, nullable=False)
    variables = Column(Text, default='[]')  # JSON array of variable names
    scenarios = Column(Text, default='[]')  # JSON array of scenario objects
    timeframes = Column(Text, default='[]')  # JSON array: ["1周", "1个月", "1年"]
    status = Column(String, default="pending")  # pending / simulated
    result = Column(Text, default='{}')  # JSON
    related_audit_id = Column(String)
    brain_side = Column(String, default="both")
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    
    __table_args__ = (
        Index('ix_future_simulations_user_status', 'user_id', 'status'),
        Index('ix_future_simulations_user_created', 'user_id', 'created_at'),
    )


class CognitiveChallenge(Base):
    __tablename__ = "cognitive_challenges"
    
    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    challenge_date = Column(DateTime, nullable=False, index=True)  # assigned date
    type = Column(String, nullable=False)  # bias_quiz / thought_experiment / reflection
    title = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    options = Column(Text, default='[]')  # JSON array for bias_quiz
    correct_answer = Column(String)
    explanation = Column(Text)
    user_answer = Column(String)
    is_correct = Column(Boolean)
    points = Column(Integer, default=0)
    completed_at = Column(DateTime)
    streak_before = Column(Integer, default=0)
    status = Column(String, default="pending")  # pending / completed / skipped
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    
    __table_args__ = (
        Index('ix_cognitive_challenges_user_date', 'user_id', 'challenge_date'),
        Index('ix_cognitive_challenges_user_status', 'user_id', 'status'),
    )


class CognitiveWeeklyReport(Base):
    __tablename__ = "cognitive_weekly_reports"
    
    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    week_start = Column(DateTime, nullable=False, index=True)
    week_end = Column(DateTime, nullable=False)
    health_score: int = Column(Integer, default=0)  # 0-100
    summary = Column(Text)
    dimensions = Column(Text, default='[]')  # JSON array of {name, score, trend}
    highlights = Column(Text, default='[]')  # JSON array of strings
    risks = Column(Text, default='[]')  # JSON array of strings
    suggestions = Column(Text, default='[]')  # JSON array of strings
    stats = Column(Text, default='{}')  # JSON: notes_count, knowledge_count, challenges_completed, decisions_audited, biases_found
    status = Column(String, default="generated")  # generated / archived
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    
    __table_args__ = (
        Index('ix_cognitive_weekly_reports_user_week', 'user_id', 'week_start'),
    )


