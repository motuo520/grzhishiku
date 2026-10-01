from sqlalchemy import Column, String, DateTime, Integer, Boolean, Float, Text, CheckConstraint, Index
from sqlalchemy.sql import func
from datetime import datetime
from app.core.database import Base

__all__ = [
    "KnowledgeUnit", "PracticeRecord", "PipelineTransition", "DailyReview",
    "ContextGuide", "ExperimentLog", "DepthCheckLog", "EvolutionReflection",
    "CognitivePotentialResult", "EvolutionTransition", "WikiEntry",
]


class KnowledgeUnit(Base):
    __tablename__ = "knowledge_units"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    brain_side = Column(String, default="network")
    content_raw = Column(Text, nullable=False)
    content_processed = Column(Text)
    title = Column(String)  # 单元自身标题（09-16：生成时填+存量回填；source_title 是来源内容的标题，两码事）
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
    # 争议决议：corrected（修正重验通过）/ kept（保留观察）/ rejected（驳回反证），NULL=未决议；
    # 反证墙默认只列未决议条目，决议后下墙但 verification_status 不再被抹回 unverified
    dispute_resolution = Column(String, nullable=True)
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
    invoke_count = Column(Integer, default=0)  # 人主动打开（详情页浏览）
    # AI 引用分账（09-26 R6 观察者效应实捕：评测/问答流量把「被 AI 引用」刷进
    # invoke_count——碰撞 201→222，价值信号被测量行为污染）：被写进 RAG 上下文
    # 计这里，不进 invoke_count；排名/价值信号读 invoke_count 即人打开纯口径
    ai_invoke_count = Column(Integer, default=0)
    last_invoked_at = Column(DateTime)
    practice_depth = Column(Integer, default=0)
    personal_relevance_score = Column(Float, default=0.5)
    evolution_stage = Column(String, default="collected")
    attached_practice_ids = Column(Text, default='[]')
    pipeline_stage = Column(String, default="raw")
    folder_id = Column(String, index=True)  # 所属文件夹，空=未归档（与笔记共用同一套树）
    content_subtype = Column(String, default="note")
    source_id = Column(String)
    source_content_type = Column(String)
    # 碰撞产物的双亲出处（JSON 列表 [{id,title},...]，仅 collision_result 有值）：
    # 「这条洞见是由 A×B 撞出来的」可溯源、可点击回查（08-21 拍板）
    collision_parents = Column(Text)
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
    tenant_id = Column(String)  # NULL=个人空间；团队空间践行记录归团队
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
    tenant_id = Column(String)  # NULL=个人空间；口径与 EvolutionTransition 一致（随内容归属空间）
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


class EvolutionTransition(Base):
    """evolution_stage 变化流水：每次进阶/回退记一条 from→to（trigger=practice/manual）。

    stage 字段本身是覆盖写，没有这张表之前「什么时候、被什么推到当前阶段」完全无痕。
    tenant_id 口径与内容一致：团队空间记租户 id，个人空间为 NULL。
    """
    __tablename__ = "evolution_transitions"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    tenant_id = Column(String)
    content_type = Column(String, nullable=False)  # note / knowledge_unit
    content_id = Column(String, nullable=False, index=True)
    from_stage = Column(String)
    to_stage = Column(String, nullable=False)
    trigger = Column(String, nullable=False)  # practice / manual
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        Index('ix_evolution_transitions_user_content', 'user_id', 'content_type', 'content_id'),
    )


class DailyReview(Base):
    __tablename__ = "daily_reviews"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False)
    # 复盘是个人空间功能（素材只收本人个人行，见 daily_review_service），恒 NULL；
    # 列留着只为统一 scope_condition 口径——团队空间里复盘列表自然为空
    tenant_id = Column(String)
    review_date = Column(DateTime, nullable=False)
    content_summary = Column(Text)
    ai_reflection = Column(Text)
    gaps_found = Column(Text, default='[]')
    action_items = Column(Text, default='[]')
    praise_items = Column(Text, default='[]')
    # 当日输入与存量的关联（向量库/图谱/标签三路证据，09-01 复盘富化）
    connections = Column(Text, default='[]')
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
    tenant_id = Column(String)  # NULL=个人空间；团队空间引导文件归团队
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
    tenant_id = Column(String)  # NULL=个人空间；团队空间实验日志归团队
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


class CognitivePotentialResult(Base):
    """认知资产分析结果落库（每 用户×空间×脑侧 只留最新一份，重跑即替换）。

    解决「分析结果不能保存、切换模型/离开页面就丢」：分析是计费调用，
    结果必须可回看。tenant_id 口径与内容一致：团队空间的分析归团队
    （成员共享可见），个人空间为 NULL。
    """
    __tablename__ = "cognitive_potential_results"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    tenant_id = Column(String, index=True)  # NULL=个人空间
    brain_side = Column(String, default="both")
    result_json = Column(Text, nullable=False)  # CognitivePotentialResponse 序列化
    model_used = Column(String)
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        Index('ix_cog_potential_scope', 'user_id', 'tenant_id', 'brain_side'),
    )


class DepthCheckLog(Base):
    __tablename__ = "depth_check_logs"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    tenant_id = Column(String)  # NULL=个人空间；团队空间评估流水归团队
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
    tenant_id = Column(String)  # NULL=个人空间；团队空间反思归团队
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


class WikiEntry(Base):
    """LLM Wiki 条目（09-05 立项）：摄入时编译的主题级知识页。

    与概念卡的分工：概念卡是单来源抽取，wiki 条目是跨来源综合。
    - source_ids：溯源清单 JSON [{type: note/knowledge/clip, id}]——引用只认原文层
    - source_hash：成员内容指纹（lint 用，变了即 stale）
    - status: fresh/stale；verification_status 复用验证三轨（unverified/confirmed/disputed/debunked）
    - 编译是手动触发（平台按量/BYOK），自动链路只跑规则 lint（零模型，血泪#29）
    """
    __tablename__ = "wiki_entries"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    tenant_id = Column(String, index=True)  # NULL=个人空间
    title = Column(String, nullable=False)
    aliases = Column(Text, default='[]')  # JSON list：别名/常见叫法（检索钩子）
    content_md = Column(Text, nullable=False)
    summary = Column(Text)  # 一句话摘要（列表页/检索 preview 用）
    source_ids = Column(Text, default='[]')  # JSON [{type, id, title}]
    source_hash = Column(String)  # 成员内容指纹（lint 失效判定）
    community_id = Column(String)  # 出生时的图谱社区 id（可空）
    status = Column(String, default="fresh")  # fresh / stale / review / orphaned
    verification_status = Column(String, default="unverified")
    # 验证流水（09-05 拍板：验证带批注、批注回流编译）：JSON [{ts, status, note, by}]
    verification_notes = Column(Text, default='[]')
    compile_model = Column(String)  # 本次编译用的模型（透明可查）
    compile_cost = Column(Float, default=0.0)  # 本次编译花费（元）
    version = Column(Integer, default=1)
    last_compiled_at = Column(DateTime)
    # 语义深检轮换覆盖（09-13）：上次被深检复核的时间；NULL=从未检过（最优先）
    last_deep_linted_at = Column(DateTime)
    # 目录归类（09-21 WeKnora 借鉴⑨）：taxonomy 单调用整批归目录；NULL=未归目录
    # （只写 NULL 行，用户手调过的目录永不被覆盖）
    category = Column(String)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index('ix_wiki_entries_user_status', 'user_id', 'status'),
    )


class WikiLintReport(Base):
    """语义深检报告（09-13）：LLM 趟结果落库——页面读最新报告而非当次输出，
    出处（模型/复核了哪些条目/评估了哪些候选/时间）随报告可查。

    - checked：本次复核的条目 [{id, title, status}]（轮换覆盖：最久没检的 5 条）
    - issues：复核出的问题 [{entry, issue}]；suggestions：值得建条目的概念 [str]
    - candidates：参与裁决的概念候选全集 [str]（suggestions 是其中的子集）
    """
    __tablename__ = "wiki_lint_reports"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    tenant_id = Column(String, index=True)  # NULL=个人空间
    model = Column(String)  # 本次深检用的模型（出处透明）
    checked = Column(Text, default='[]')
    issues = Column(Text, default='[]')
    suggestions = Column(Text, default='[]')
    candidates = Column(Text, default='[]')
    # 应用侧微秒时间戳：server_default CURRENT_TIMESTAMP 只到秒，连跑两次深检
    # 会同秒撞序，latest 查询可能拿回旧报告（09-13 测试实捕）
    created_at = Column(DateTime, default=datetime.now)


class WikiEntryVersion(Base):
    """条目版本史（09-16 五期）：每次编译/回滚把条目内容存一行快照（每版一行，含 v1），
    版本号绝不复用——回滚也是写新版本（内容抄自目标快照），可再回滚撤销。

    - aliases/source_ids：JSON 列，写法与 WikiEntry 同款
    - source_hash 随快照回滚：回滚后规则 lint 指纹比对不误标 stale
    - 回滚零模型不计费（compile_model/compile_cost 记录的是该版出生时的出处）
    """
    __tablename__ = "wiki_entry_versions"

    id = Column(String, primary_key=True)
    entry_id = Column(String, nullable=False, index=True)
    version = Column(Integer, nullable=False)
    content_md = Column(Text, nullable=False)
    summary = Column(Text)
    aliases = Column(Text, default='[]')  # JSON list（同 WikiEntry.aliases）
    source_ids = Column(Text, default='[]')  # JSON [{type, id, title}]（同 WikiEntry.source_ids）
    source_hash = Column(String)
    compile_model = Column(String)  # 该版出生时的编译模型（回滚版=被回滚条的当前模型）
    compile_cost = Column(Float, default=0.0)
    created_at = Column(DateTime, default=datetime.now)  # 应用侧时间戳（同 WikiLintReport 口径）
