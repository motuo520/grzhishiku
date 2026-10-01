from sqlalchemy import Column, String, DateTime, Integer, Boolean, Float, Text, CheckConstraint, Table, ForeignKey, Index
from sqlalchemy.sql import func
from app.core.database import Base

__all__ = [
    "SummaryCache", "Tag", "content_tags", "Embedding",
    "Note", "BrowserClip", "ReadLaterItem", "Document",
]

content_tags = Table(
    'content_tags',
    Base.metadata,
    Column('content_id', String, nullable=False),
    Column('content_type', String, nullable=False),  # note / clip / knowledge / document（09-11 文档纳入打标）
    Column('tag_id', String, ForeignKey('tags.id'), nullable=False),
    # 来源标记：auto=自动打标 / manual=人工（手填/改名/导入）。「重打自动标签」只清 auto，
    # 人工成果不动；存量行迁移默认 manual——宁可漏重打，不可误伤
    Column('source', String, server_default='manual'),
    Column('created_at', DateTime, server_default=func.now()),
    CheckConstraint("content_type IN ('note', 'clip', 'knowledge', 'document')", name='ck_content_tags_content_type'),
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
    tenant_id = Column(String)  # 团队标签（可空）：非空=团队空间共享，空=个人空间
    name = Column(String, nullable=False)
    color = Column(String, default="#8b949e")
    description = Column(String)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

class Embedding(Base):
    __tablename__ = "embeddings"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False)
    content_type = Column(String, nullable=False)  # note / clip / knowledge / query / summary / document / wiki
    content_id = Column(String, nullable=False)
    text_preview = Column(String)  # first 200 chars for debugging
    embedding_json = Column(Text, nullable=False)  # JSON array of floats
    dimensions = Column(Integer, default=1024)
    model = Column(String, default="bge-m3")  # model used for embedding
    # 父子块结构（RAG 切分层改造）：4 列全可空，存量行 NULL = 旧平铺块/整文档向量
    parent_content_id = Column(String)  # 父块 id：{doc_id}::chunk::{p}
    chunk_index = Column(Integer)       # 父内子块序号（从 0 起）
    chunk_text = Column(Text)           # 子块全文（块全文落库，preview 不再只靠 200 字截断）
    parent_text = Column(Text)          # 父块全文（反范式冗余，检索端零回表取上下文窗口）
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        CheckConstraint("content_type IN ('note', 'clip', 'knowledge', 'query', 'summary', 'document', 'wiki')", name='ck_embeddings_content_type'),
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
    folder_id = Column(String, index=True)  # 所属文件夹，空=未归档
    # 仓库模式（09-19）：只进检索层（FTS/向量/SQL 直查，RAG 照常可答），
    # 不进语义加工层（图谱/wiki/自动打标/复盘）；消费方过滤走 tenant_scope.semantic_visible
    index_only = Column(Boolean, default=False)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('ix_notes_user_status', 'user_id', 'status'),
        Index('ix_notes_evolution', 'user_id', 'evolution_stage'),
        Index('ix_notes_relevance', 'user_id', 'personal_relevance_score'),
        Index('ix_notes_pipeline', 'user_id', 'brain_side', 'pipeline_stage'),
    )

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
    folder_id = Column(String, index=True)  # 所属文件夹，空=未归档（剪藏进树，08-22）
    # 仓库模式（09-19）：只进检索层，不进语义加工层（同 Note.index_only）
    index_only = Column(Boolean, default=False)
    flag_reason = Column(String)
    tenant_id = Column(String)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('ix_clips_user_domain', 'user_id', 'domain'),
        Index('ix_clips_user_pipeline', 'user_id', 'pipeline_stage'),
    )

class ReadLaterItem(Base):
    __tablename__ = "read_later_items"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    tenant_id = Column(String)  # 团队空间归属（可空）：非空=团队共享，空=个人空间
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
    tenant_id = Column(String)  # 团队空间归属（可空）：非空=团队共享，空=个人空间
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
    brain_side = Column(String, default="personal")  # 所属脑（手动归档的归属校验用）
    folder_id = Column(String, index=True)  # 所属文件夹，空=未归档（文档进树：只手动归档，不进规则引擎）
    # 仓库模式（09-19）：只进检索层，不进语义加工层（同 Note.index_only）
    index_only = Column(Boolean, default=False)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('ix_documents_user_status', 'user_id', 'doc_status'),
        Index('ix_documents_user_type', 'user_id', 'file_type'),
    )
