"""认知镜像 API — 思维指纹分析与认知偏差检测

Day 11-14 后端实现
"""
import asyncio
import json
import uuid
import zlib
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
# NOTE: cognitive endpoints are billed via LLM prepaid balance, not subscription tier.
from app.models.base import KnowledgeUnit, Note, User, DecisionAudit, FutureSimulation, CognitiveChallenge, CognitiveWeeklyReport
from app.services.llm_billing_service import billed_chat_completion

router = APIRouter()

BrainSide = Optional[str]  # "personal" | "network" | "both"


# ─────────────────────────── Pydantic Models ───────────────────────────

class FingerprintRequest(BaseModel):
    content_limit: int = Field(default=50, ge=1, le=200, description="最多分析的笔记/知识单元数量")


class RadarDimension(BaseModel):
    name: str
    score: float = Field(..., ge=0, le=100)


class TrendPoint(BaseModel):
    date: str
    analysis_depth: float
    creativity: float
    logic: float
    emotional_expression: float
    structure: float
    critical_thinking: float


class TopicPreference(BaseModel):
    topic: str
    percentage: float


class FingerprintResponse(BaseModel):
    radar_dimensions: List[RadarDimension]
    trends: List[TrendPoint]
    topics: List[TopicPreference]
    decision_style: str
    thinking_speed: str
    vocabulary_diversity: float
    logic_preference: str
    emotional_tendency: Dict[str, float]
    suggestions: List[str]
    analyzed_items_count: int
    degraded: bool = False  # True 表示 AI 分析失败，展示的是本地估算结果


class BiasDetectionRequest(BaseModel):
    content_limit: int = Field(default=50, ge=1, le=200)


class BiasItem(BaseModel):
    bias_type: str
    severity: int = Field(..., ge=1, le=5)
    text_snippet: str
    suggestion: str
    source_id: str
    source_type: str


class BiasDetectionResponse(BaseModel):
    detected_biases: List[BiasItem]
    total_analyzed: int
    bias_count: int


class BiasSummaryItem(BaseModel):
    bias_type: str
    count: int
    average_severity: float
    max_severity: int


class BiasSummaryResponse(BaseModel):
    summaries: List[BiasSummaryItem]
    total_detected: int


# ─────────────────────────── Helpers ───────────────────────────

def _det_offset(seed: str, span: int) -> int:
    """确定性伪随机偏移（-span..span）。降级数据必须稳定，不能每次刷新都跳变。"""
    return zlib.crc32(seed.encode("utf-8")) % (2 * span + 1) - span


def _raise_if_payment_error(exc: HTTPException) -> None:
    """余额不足（402）必须透传给前端，不能静默降级为假数据。"""
    if exc.status_code == 402:
        raise exc

def _aggregate_user_content(
    user: User,
    db: Session,
    limit: int = 50,
    brain_side: BrainSide = "both",
) -> List[Dict[str, Any]]:
    """聚合用户内容。brain_side 控制来源：personal 只查 Note，network 只查 KnowledgeUnit，both 保持原样。"""
    items = []

    if brain_side in ("both", "personal", None):
        notes = (
            db.query(Note)
            .filter(Note.user_id == user.id)
            .order_by(Note.created_at.desc())
            .limit(limit)
            .all()
        )
        for n in notes:
            items.append({
                "id": n.id,
                "type": "note",
                "title": n.title or "",
                "content": n.content or "",
                "created_at": n.created_at.isoformat() if n.created_at else "",
                "mood_emotion": n.mood_emotion or "",
            })

    if brain_side in ("both", "network", None):
        knowledge = (
            db.query(KnowledgeUnit)
            .filter(KnowledgeUnit.user_id == user.id)
            .order_by(KnowledgeUnit.created_at.desc())
            .limit(limit)
            .all()
        )
        for k in knowledge:
            items.append({
                "id": k.id,
                "type": "knowledge",
                "title": k.source_title or "",
                "content": k.content_raw or "",
                "created_at": k.created_at.isoformat() if k.created_at else "",
                "source_url": k.source_url or "",
            })

    return items


# deepseek reasoning models can stream for minutes (SSE heartbeats defeat
# httpx's per-chunk read timeout), so bound the TOTAL call time here. On timeout
# we raise 504, which the endpoints' existing HTTPException fallbacks convert
# into heuristic/degraded results instead of hanging the page.
LLM_JSON_TIMEOUT = 75


async def _llm_json(
    prompt: str,
    *,
    preferred_model: Optional[str] = None,
    db: Session,
    user_id: str,
) -> Dict[str, Any]:
    """调用 LLM 并尝试解析 JSON 返回。调用走计费链路。解析失败自动重试一次。"""
    system_prompt = "你是一个专业的认知分析专家。请严格按照用户要求的 JSON 格式输出，不要添加任何 markdown 代码块标记或其他解释性文字。"
    last_raw = ""
    for attempt in range(2):
        try:
            raw = await asyncio.wait_for(
                billed_chat_completion(
                    db=db,
                    user_id=user_id,
                    model_id=preferred_model or "deepseek-v4-pro",
                    task_type="analysis",
                    prompt=prompt if attempt == 0 else prompt + "\n\n再次提醒：只输出纯 JSON，不要任何其他文字。",
                    system_prompt=system_prompt,
                ),
                timeout=LLM_JSON_TIMEOUT,
            )
        except asyncio.TimeoutError:
            raise HTTPException(status_code=504, detail="AI 分析超时，已切换为本地估算")
        except ValueError as e:
            if "余额不足" in str(e):
                raise HTTPException(status_code=402, detail=str(e))
            raise
        raw = raw.strip()

        # 尝试去除 markdown 代码块
        if raw.startswith("```json"):
            raw = raw[7:]
        if raw.startswith("```"):
            raw = raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = raw.strip()
        last_raw = raw

        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            # fallback: 尝试提取第一个 { ... } 块
            start = raw.find("{")
            end = raw.rfind("}")
            if start != -1 and end != -1 and end > start:
                try:
                    return json.loads(raw[start:end + 1])
                except json.JSONDecodeError:
                    pass
    raise HTTPException(status_code=500, detail=f"LLM returned invalid JSON: {last_raw[:200]}")


# ─────────────────────────── 思维指纹 ───────────────────────────

@router.post("/fingerprint", response_model=FingerprintResponse, summary="生成思维指纹报告")
async def generate_fingerprint(
    req: FingerprintRequest,
    brain_side: BrainSide = Query("both", description="personal=个人脑, network=网络脑, both=双脑"),
    preferred_model: Optional[str] = Query(None, description="Preferred LLM model identifier"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    items = _aggregate_user_content(user, db, req.content_limit, brain_side)
    if not items:
        # 空数据返回默认值
        return FingerprintResponse(
            radar_dimensions=[
                RadarDimension(name="分析深度", score=50.0),
                RadarDimension(name="创造性", score=50.0),
                RadarDimension(name="逻辑性", score=50.0),
                RadarDimension(name="情感表达", score=50.0),
                RadarDimension(name="结构化", score=50.0),
                RadarDimension(name="批判性思维", score=50.0),
            ],
            trends=[],
            topics=[TopicPreference(topic="未分类", percentage=100.0)],
            decision_style="未知",
            thinking_speed="未知",
            vocabulary_diversity=0.5,
            logic_preference="未知",
            emotional_tendency={"positive": 0.33, "neutral": 0.34, "negative": 0.33},
            suggestions=["开始记录笔记以获取思维指纹分析。"],
            analyzed_items_count=0,
        )

    # 构建分析文本
    text_blocks = []
    for idx, item in enumerate(items[:30]):  # 最多取30条给 LLM 分析
        text_blocks.append(f"[{idx + 1}] {item['title']}\n{item['content'][:500]}")
    combined_text = "\n\n".join(text_blocks)

    prompt = f"""请分析以下用户的笔记和知识内容，生成思维指纹报告。

分析要求：
1. 词汇多样性（type-token ratio）—— 估算一个 0-1 之间的数值
2. 思维速度 —— 根据内容长度和时间分布，判断为 "快速"、"中等" 或 "深度"
3. 主题偏好 TOP 5 —— 列出前5个主题及占比（百分比之和为100）
4. 决策风格 —— 从 ["谨慎型", "直觉型", "分析型"] 中选一个最主要风格
5. 逻辑结构偏好 —— 从 ["演绎型", "归纳型", "类比型", "混合型"] 中判断
6. 情感倾向 —— 积极、中性、消极的比例（三个数值之和为1.0）
7. 雷达图 6 维度评分（0-100）：分析深度、创造性、逻辑性、情感表达、结构化、批判性思维
8. 最近30天的每日评分趋势（如果内容不足30天，用合理推算填充）—— 每天给出6个维度评分
9. 3-5 条改进建议

请严格按以下 JSON 格式输出（不要添加 markdown 标记）：
{{
  "vocabulary_diversity": 0.65,
  "thinking_speed": "深度",
  "topics": [{{"topic": "主题1", "percentage": 30.0}}, ...],
  "decision_style": "分析型",
  "logic_preference": "归纳型",
  "emotional_tendency": {{"positive": 0.4, "neutral": 0.5, "negative": 0.1}},
  "radar_dimensions": [
    {{"name": "分析深度", "score": 72}},
    {{"name": "创造性", "score": 65}},
    {{"name": "逻辑性", "score": 80}},
    {{"name": "情感表达", "score": 55}},
    {{"name": "结构化", "score": 70}},
    {{"name": "批判性思维", "score": 68}}
  ],
  "trends": [
    {{"date": "2024-01-01", "analysis_depth": 70, "creativity": 60, "logic": 75, "emotional_expression": 50, "structure": 65, "critical_thinking": 60}}
  ],
  "suggestions": ["建议1", "建议2", "建议3"]
}}

用户内容：
{combined_text[:8000]}
"""

    try:
        data = await _llm_json(prompt, preferred_model=preferred_model, db=db, user_id=user.id)
        degraded = False
    except HTTPException as e:
        _raise_if_payment_error(e)
        # LLM 失败时回退到基于统计的生成
        data = _fallback_fingerprint(items)
        degraded = True

    # 归一化主题百分比
    topics = data.get("topics", [])
    if topics:
        total = sum(t.get("percentage", 0) for t in topics)
        if total > 0:
            for t in topics:
                t["percentage"] = round(t.get("percentage", 0) / total * 100, 1)

    # 归一化情感倾向
    emotional = data.get("emotional_tendency", {})
    etotal = sum(emotional.values())
    if etotal > 0:
        emotional = {k: round(v / etotal, 2) for k, v in emotional.items()}

    # 构建趋势数据（如果不足30天，填充）
    trends = data.get("trends", [])
    if len(trends) < 30:
        # 用随机波动填充到30天
        base_scores = {d["name"]: d["score"] for d in data.get("radar_dimensions", [])}
        base = {
            "analysis_depth": base_scores.get("分析深度", 50),
            "creativity": base_scores.get("创造性", 50),
            "logic": base_scores.get("逻辑性", 50),
            "emotional_expression": base_scores.get("情感表达", 50),
            "structure": base_scores.get("结构化", 50),
            "critical_thinking": base_scores.get("批判性思维", 50),
        }
        end_date = datetime.now()
        for i in range(30 - len(trends)):
            d = (end_date - timedelta(days=i)).strftime("%Y-%m-%d")
            trends.insert(0, {
                "date": d,
                "analysis_depth": max(0, min(100, base["analysis_depth"] + _det_offset(d + "ad", 8))),
                "creativity": max(0, min(100, base["creativity"] + _det_offset(d + "cr", 8))),
                "logic": max(0, min(100, base["logic"] + _det_offset(d + "lg", 8))),
                "emotional_expression": max(0, min(100, base["emotional_expression"] + _det_offset(d + "ee", 8))),
                "structure": max(0, min(100, base["structure"] + _det_offset(d + "st", 8))),
                "critical_thinking": max(0, min(100, base["critical_thinking"] + _det_offset(d + "ct", 8))),
            })
        trends = trends[:30]

    return FingerprintResponse(
        radar_dimensions=[
            RadarDimension(name=d["name"], score=max(0, min(100, float(d.get("score", 50)))))
            for d in data.get("radar_dimensions", [])
        ] or [
            RadarDimension(name="分析深度", score=50),
            RadarDimension(name="创造性", score=50),
            RadarDimension(name="逻辑性", score=50),
            RadarDimension(name="情感表达", score=50),
            RadarDimension(name="结构化", score=50),
            RadarDimension(name="批判性思维", score=50),
        ],
        trends=[
            TrendPoint(
                date=t["date"],
                analysis_depth=float(t.get("analysis_depth", 50)),
                creativity=float(t.get("creativity", 50)),
                logic=float(t.get("logic", 50)),
                emotional_expression=float(t.get("emotional_expression", 50)),
                structure=float(t.get("structure", 50)),
                critical_thinking=float(t.get("critical_thinking", 50)),
            )
            for t in trends
        ],
        topics=[TopicPreference(topic=t["topic"], percentage=t.get("percentage", 0)) for t in topics]
        or [TopicPreference(topic="未分类", percentage=100.0)],
        decision_style=data.get("decision_style", "未知"),
        thinking_speed=data.get("thinking_speed", "未知"),
        vocabulary_diversity=float(data.get("vocabulary_diversity", 0.5)),
        logic_preference=data.get("logic_preference", "未知"),
        emotional_tendency=emotional or {"positive": 0.33, "neutral": 0.34, "negative": 0.33},
        suggestions=data.get("suggestions", ["多记录不同类型的内容以丰富分析。"]),
        analyzed_items_count=len(items),
        degraded=degraded,
    )


def _fallback_fingerprint(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    """当 LLM 失败时，基于简单统计生成回退数据。"""
    all_text = " ".join(i["content"] for i in items)
    words = all_text.split()
    unique_words = set(w.lower() for w in words if len(w) > 1)
    diversity = round(len(unique_words) / max(len(words), 1), 3)

    # 简单主题提取（按关键词）
    topic_keywords = {
        "技术": ["代码", "编程", "python", "javascript", "api", "数据库", "算法", "前端", "后端", "开发", "软件", "系统"],
        "学术": ["论文", "研究", "理论", "实验", "分析", "数据", "文献", "模型", "方法"],
        "商业": ["市场", "产品", "用户", "增长", "营收", "战略", "竞争", "投资", "创业", "商业模式"],
        "生活": ["健康", "饮食", "运动", "旅行", "家庭", "心理", "读书", "电影", "音乐"],
        "创意": ["设计", "艺术", "写作", "音乐", "摄影", "灵感", "创作", "画画"],
        "管理": ["计划", "目标", "时间管理", "效率", "复盘", "总结", "笔记", "日程"],
    }
    topic_counts = {t: 0 for t in topic_keywords}
    for item in items:
        text = item["content"].lower()
        for topic, kws in topic_keywords.items():
            for kw in kws:
                if kw in text:
                    topic_counts[topic] += 1
                    break

    sorted_topics = sorted(topic_counts.items(), key=lambda x: x[1], reverse=True)
    total = sum(c for _, c in sorted_topics) or 1
    topics = [{"topic": t, "percentage": round(c / total * 100, 1)} for t, c in sorted_topics[:5] if c > 0]
    if not topics:
        topics = [{"topic": "综合", "percentage": 100.0}]

    # 情感倾向简单判断
    positive_words = ["好", "优秀", "成功", "喜欢", "快乐", "棒", "赞", "great", "good", "excellent", "love", "happy"]
    negative_words = ["差", "失败", "讨厌", "难过", "糟糕", "坏", "bad", "fail", "hate", "sad", "terrible"]
    pos = sum(1 for w in positive_words if w in all_text.lower())
    neg = sum(1 for w in negative_words if w in all_text.lower())
    neu = max(1, len(items) - pos - neg)
    etotal = pos + neg + neu
    emotional = {
        "positive": round(pos / etotal, 2),
        "neutral": round(neu / etotal, 2),
        "negative": round(neg / etotal, 2),
    }

    return {
        "vocabulary_diversity": diversity,
        "thinking_speed": "中等",
        "topics": topics,
        "decision_style": "分析型",
        "logic_preference": "混合型",
        "emotional_tendency": emotional,
        "radar_dimensions": [
            {"name": "分析深度", "score": 55 + _det_offset(all_text[:200] + "ad", 8)},
            {"name": "创造性", "score": 50 + _det_offset(all_text[:200] + "cr", 8)},
            {"name": "逻辑性", "score": 55 + _det_offset(all_text[:200] + "lg", 8)},
            {"name": "情感表达", "score": 45 + _det_offset(all_text[:200] + "ee", 8)},
            {"name": "结构化", "score": 50 + _det_offset(all_text[:200] + "st", 8)},
            {"name": "批判性思维", "score": 50 + _det_offset(all_text[:200] + "ct", 8)},
        ],
        "trends": [],
        "suggestions": [
            "尝试记录更多决策过程，提升分析深度。",
            "引入反面观点，增强批判性思维。",
            "使用结构化框架（如金字塔原理）组织内容。",
        ],
    }


# ─────────────────────────── 认知偏差检测 ───────────────────────────

BIAS_TYPES = [
    "确认偏误 (Confirmation Bias)",
    "锚定效应 (Anchoring Bias)",
    "幸存者偏差 (Survivorship Bias)",
    "归因错误 (Fundamental Attribution Error)",
    "可得性启发 (Availability Heuristic)",
    "达克效应 (Dunning-Kruger Effect)",
]


@router.post("/bias-detection", response_model=BiasDetectionResponse, summary="检测认知偏差")
async def detect_bias(
    req: BiasDetectionRequest,
    brain_side: BrainSide = Query("both", description="personal=个人脑, network=网络脑, both=双脑"),
    preferred_model: Optional[str] = Query(None, description="Preferred LLM model identifier"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    items = _aggregate_user_content(user, db, req.content_limit, brain_side)
    if not items:
        return BiasDetectionResponse(detected_biases=[], total_analyzed=0, bias_count=0)

    # 取最多 15 条内容给 LLM，避免过长
    selected = items[:15]
    text_blocks = []
    for idx, item in enumerate(selected):
        text_blocks.append(f"[{idx}] ID:{item['id']} TYPE:{item['type']}\n{item['content'][:600]}")
    combined_text = "\n\n".join(text_blocks)

    prompt = f"""请分析以下用户笔记内容，检测其中可能存在的认知偏差。

可检测的偏差类型（必须严格使用以下名称）：
1. 确认偏误 (Confirmation Bias)
2. 锚定效应 (Anchoring Bias)
3. 幸存者偏差 (Survivorship Bias)
4. 归因错误 (Fundamental Attribution Error)
5. 可得性启发 (Availability Heuristic)
6. 达克效应 (Dunning-Kruger Effect)

对于每条检测到的偏差，请给出：
- bias_type: 偏差类型（严格使用上述名称）
- severity: 严重程度 1-5（1最轻，5最重）
- text_snippet: 触发偏差的原文片段（30-100字）
- suggestion: 改进建议（一句话）
- source_id: 内容ID
- source_type: 内容类型（note 或 knowledge）

请严格按以下 JSON 格式输出（不要 markdown 标记）：
{{
  "biases": [
    {{
      "bias_type": "确认偏误 (Confirmation Bias)",
      "severity": 3,
      "text_snippet": "...",
      "suggestion": "...",
      "source_id": "...",
      "source_type": "note"
    }}
  ]
}}

如果未检测到明显偏差，返回 {{"biases": []}}。

用户内容：
{combined_text[:7000]}
"""

    try:
        data = await _llm_json(prompt, preferred_model=preferred_model, db=db, user_id=user.id)
        biases = data.get("biases", [])
    except HTTPException as e:
        _raise_if_payment_error(e)
        # LLM 失败时使用简单启发式检测
        biases = _heuristic_bias_detection(selected)

    # 清洗和验证
    cleaned = []
    for b in biases:
        bt = b.get("bias_type", "")
        # 匹配最接近的偏差类型
        matched = None
        for valid in BIAS_TYPES:
            if valid.lower() in bt.lower() or bt.lower() in valid.lower():
                matched = valid
                break
        if not matched:
            continue
        severity = max(1, min(5, int(b.get("severity", 3))))
        cleaned.append(BiasItem(
            bias_type=matched,
            severity=severity,
            text_snippet=b.get("text_snippet", "")[:200],
            suggestion=b.get("suggestion", "注意多角度思考，引入反面证据。"),
            source_id=b.get("source_id", ""),
            source_type=b.get("source_type", "note"),
        ))

    return BiasDetectionResponse(
        detected_biases=cleaned,
        total_analyzed=len(selected),
        bias_count=len(cleaned),
    )


def _heuristic_bias_detection(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """简单启发式偏差检测，作为 LLM 失败时的回退。"""
    biases = []
    for item in items:
        text = item["content"]
        lower = text.lower()

        # 确认偏误关键词
        confirmation_markers = [
            "显然", "毫无疑问", "绝对", "肯定", "一定", " obviously", " definitely",
            " always", " never", " proves that", " confirms that",
        ]
        for marker in confirmation_markers:
            if marker in lower:
                idx = lower.find(marker)
                snippet = text[max(0, idx - 30):idx + 70]
                biases.append({
                    "bias_type": "确认偏误 (Confirmation Bias)",
                    "severity": 2,
                    "text_snippet": snippet,
                    "suggestion": "尝试寻找反面证据，验证这一结论的可靠性。",
                    "source_id": item["id"],
                    "source_type": item["type"],
                })
                break  # 每条内容只检测一种偏差

        # 锚定效应关键词
        anchoring_markers = ["第一个", "最初", "一开始", " anchor", " initial", " first impression"]
        for marker in anchoring_markers:
            if marker in lower:
                idx = lower.find(marker)
                snippet = text[max(0, idx - 30):idx + 70]
                biases.append({
                    "bias_type": "锚定效应 (Anchoring Bias)",
                    "severity": 2,
                    "text_snippet": snippet,
                    "suggestion": "重新审视初始信息，考虑后续数据是否已改变判断。",
                    "source_id": item["id"],
                    "source_type": item["type"],
                })
                break

        # 达克效应关键词
        dunning_markers = ["很简单", "太容易了", "毫不费力", " easy", " trivial", " effortless", " obvious"]
        for marker in dunning_markers:
            if marker in lower:
                idx = lower.find(marker)
                snippet = text[max(0, idx - 30):idx + 70]
                biases.append({
                    "bias_type": "达克效应 (Dunning-Kruger Effect)",
                    "severity": 3,
                    "text_snippet": snippet,
                    "suggestion": "对简单判断保持警惕，寻求专家反馈或深入学习。",
                    "source_id": item["id"],
                    "source_type": item["type"],
                })
                break

    return biases[:20]  # 限制数量


@router.get("/bias-summary", response_model=BiasSummaryResponse, summary="偏差分布统计")
async def bias_summary(
    brain_side: BrainSide = Query("both", description="personal=个人脑, network=网络脑, both=双脑"),
    preferred_model: Optional[str] = Query(None, description="Preferred LLM model identifier"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # 先运行检测（不存储，每次都实时分析）
    items = _aggregate_user_content(user, db, 50, brain_side)
    if not items:
        return BiasSummaryResponse(summaries=[], total_detected=0)

    selected = items[:15]
    prompt = f"""请分析以下用户内容，检测认知偏差并给出统计。

可检测偏差：确认偏误 (Confirmation Bias)、锚定效应 (Anchoring Bias)、幸存者偏差 (Survivorship Bias)、归因错误 (Fundamental Attribution Error)、可得性启发 (Availability Heuristic)、达克效应 (Dunning-Kruger Effect)

请严格按以下 JSON 输出（不要 markdown）：
{{
  "summaries": [
    {{"bias_type": "确认偏误 (Confirmation Bias)", "count": 3, "average_severity": 2.5, "max_severity": 4}}
  ]
}}

内容：
"""
    for item in selected:
        prompt += f"\n{item['content'][:400]}"

    try:
        data = await _llm_json(prompt, preferred_model=preferred_model, db=db, user_id=user.id)
        summaries_raw = data.get("summaries", [])
    except HTTPException as e:
        _raise_if_payment_error(e)
        # 回退到启发式
        biases = _heuristic_bias_detection(selected)
        from collections import defaultdict
        stats_map = defaultdict(lambda: {"count": 0, "total_severity": 0, "max": 0})
        for b in biases:
            bt = b["bias_type"]
            stats_map[bt]["count"] += 1
            stats_map[bt]["total_severity"] += b["severity"]
            stats_map[bt]["max"] = max(stats_map[bt]["max"], b["severity"])
        summaries_raw = [
            {
                "bias_type": bt,
                "count": s["count"],
                "average_severity": round(s["total_severity"] / s["count"], 1),
                "max_severity": s["max"],
            }
            for bt, s in stats_map.items()
        ]

    # 补充未检测到的偏差类型（count=0）
    seen = set(s["bias_type"] for s in summaries_raw)
    for bt in BIAS_TYPES:
        if bt not in seen:
            summaries_raw.append({"bias_type": bt, "count": 0, "average_severity": 0.0, "max_severity": 0})

    summaries = []
    for s in summaries_raw:
        summaries.append(BiasSummaryItem(
            bias_type=s["bias_type"],
            count=int(s.get("count", 0)),
            average_severity=float(s.get("average_severity", 0.0)),
            max_severity=int(s.get("max_severity", 0)),
        ))

    return BiasSummaryResponse(
        summaries=summaries,
        total_detected=sum(s.count for s in summaries),
    )


# ─────────────────────────── 双脑对比与冲突发现 ───────────────────────────

class ContrastMetric(BaseModel):
    dimension: str
    personal: float = Field(..., ge=0, le=100)
    network: float = Field(..., ge=0, le=100)
    gap: float
    winner: str


class BrainContrastResponse(BaseModel):
    metrics: List[ContrastMetric]
    personal_summary: Dict[str, Any]
    network_summary: Dict[str, Any]
    dominant_brain: str
    synergy_score: float = Field(..., ge=0, le=100)
    conflict_count: int
    insights: List[str]
    degraded: bool = False  # True 表示 AI 分析失败，展示的是本地估算结果


class ConflictItem(BaseModel):
    id: str
    title: str
    personal_position: str
    network_position: str
    conflict_type: str
    severity: int = Field(..., ge=1, le=5)
    suggested_resolution: str
    source_ids: List[str]


class CognitiveConflictResponse(BaseModel):
    conflicts: List[ConflictItem]
    total: int
    categories: List[Dict[str, Any]]


@router.get("/brain-contrast", response_model=BrainContrastResponse, summary="个人脑与网络脑对比")
async def brain_contrast(
    brain_side: BrainSide = Query("both", description="personal=个人脑, network=网络脑, both=双脑"),
    preferred_model: Optional[str] = Query(None, description="Preferred LLM model identifier"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    personal_items = _aggregate_user_content(user, db, 40, "personal") if brain_side in ("both", "personal") else []
    network_items = _aggregate_user_content(user, db, 40, "network") if brain_side in ("both", "network") else []

    # 若筛选后无内容
    if not personal_items and not network_items:
        return BrainContrastResponse(
            metrics=[],
            personal_summary={},
            network_summary={},
            dominant_brain="unknown",
            synergy_score=0.0,
            conflict_count=0,
            insights=["记录个人笔记或采集网络内容后，即可查看脑侧对比。"],
        )

    personal_text = "\n\n".join(f"[{i['type']}] {i['title']}\n{i['content'][:500]}" for i in personal_items[:20])
    network_text = "\n\n".join(f"[{i['type']}] {i['title']}\n{i['content'][:500]}" for i in network_items[:20])

    if brain_side == "both":
        prompt = f"""请对比以下两组内容，左侧为"个人脑"（用户自己的笔记/想法），右侧为"网络脑"（用户采集的外部知识/文章）。

从以下 6 个维度分别给个人脑和网络脑打分（0-100），并计算差距、判断哪侧更强：
分析深度、创造性、逻辑性、情感表达、结构化、批判性思维

同时输出：
1. personal_summary: 个人脑一句话总结 + 关键词数组
2. network_summary: 网络脑一句话总结 + 关键词数组
3. dominant_brain: 整体更强的一侧，"personal" | "network" | "balanced"
4. synergy_score: 双脑互补度 0-100
5. conflict_count: 明显观点冲突数（整数）
6. insights: 3-5 条洞察建议

严格按以下 JSON 输出（不要 markdown）：
{{
  "metrics": [
    {{"dimension": "分析深度", "personal": 70, "network": 65, "gap": 5, "winner": "personal"}}
  ],
  "personal_summary": {{"tagline": "...", "keywords": ["..."]}},
  "network_summary": {{"tagline": "...", "keywords": ["..."]}},
  "dominant_brain": "personal",
  "synergy_score": 78,
  "conflict_count": 2,
  "insights": ["..."]
}}

个人脑内容：
{personal_text[:5000]}

网络脑内容：
{network_text[:5000]}
"""
    else:
        side_label = "个人脑" if brain_side == "personal" else "网络脑"
        content_text = personal_text if brain_side == "personal" else network_text
        prompt = f"""请分析以下"{side_label}"内容，从以下 6 个维度分别打分（0-100）：
分析深度、创造性、逻辑性、情感表达、结构化、批判性思维

同时输出：
1. summary: 一句话总结 + 关键词数组
2. dominant_brain: "{brain_side}"
3. synergy_score: 0
4. conflict_count: 0
5. insights: 2-3 条针对该脑侧的建议

严格按以下 JSON 输出（不要 markdown），未选择的一侧分数填 0：
{{
  "metrics": [
    {{"dimension": "分析深度", "personal": 70, "network": 0, "gap": 70, "winner": "personal"}}
  ],
  "personal_summary": {{"tagline": "...", "keywords": ["..."]}},
  "network_summary": {{"tagline": "...", "keywords": ["..."]}},
  "dominant_brain": "{brain_side}",
  "synergy_score": 0,
  "conflict_count": 0,
  "insights": ["..."]
}}

{side_label}内容：
{content_text[:5000]}
"""

    try:
        data = await _llm_json(prompt, preferred_model=preferred_model, db=db, user_id=user.id)
        degraded = False
    except HTTPException as e:
        _raise_if_payment_error(e)
        data = _fallback_brain_contrast(personal_items, network_items, brain_side)
        degraded = True

    metrics_raw = data.get("metrics", [])
    metrics = []
    for m in metrics_raw:
        p = max(0.0, min(100.0, float(m.get("personal", 50))))
        n = max(0.0, min(100.0, float(m.get("network", 50))))
        gap = abs(p - n)
        winner = m.get("winner") or ("personal" if p > n + 3 else "network" if n > p + 3 else "balanced")
        metrics.append(ContrastMetric(
            dimension=m.get("dimension", "未知"),
            personal=p,
            network=n,
            gap=gap,
            winner=winner,
        ))

    if not metrics:
        default_p = 50 if brain_side in ("both", "personal") else 0
        default_n = 50 if brain_side in ("both", "network") else 0
        metrics = [ContrastMetric(dimension=d, personal=default_p, network=default_n, gap=abs(default_p - default_n), winner="balanced") for d in
                   ["分析深度", "创造性", "逻辑性", "情感表达", "结构化", "批判性思维"]]

    return BrainContrastResponse(
        metrics=metrics,
        personal_summary=data.get("personal_summary", {}),
        network_summary=data.get("network_summary", {}),
        dominant_brain=data.get("dominant_brain", brain_side),
        synergy_score=max(0.0, min(100.0, float(data.get("synergy_score", 0 if brain_side != "both" else 50)))),
        conflict_count=int(data.get("conflict_count", 0)),
        insights=data.get("insights", ["继续记录与采集，脑侧对比会更清晰。"]),
        degraded=degraded,
    )


def _fallback_brain_contrast(personal_items: List[Dict], network_items: List[Dict], brain_side: BrainSide = "both") -> Dict[str, Any]:
    """双脑对比 LLM 失败回退。"""
    plen = max(len(personal_items), 1)
    nlen = max(len(network_items), 1)
    # 文本量作为粗略指标
    p_volume = sum(len(i.get("content", "")) for i in personal_items)
    n_volume = sum(len(i.get("content", "")) for i in network_items)
    total = max(p_volume + n_volume, 1)
    p_ratio = p_volume / total if brain_side in ("both", "personal") else 0
    n_ratio = n_volume / total if brain_side in ("both", "network") else 0

    dimensions = ["分析深度", "创造性", "逻辑性", "情感表达", "结构化", "批判性思维"]
    metrics = []
    for d in dimensions:
        base_p = 45 + int(p_ratio * 30) + _det_offset(d + "p", 5) if brain_side in ("both", "personal") else 0
        base_n = 45 + int(n_ratio * 30) + _det_offset(d + "n", 5) if brain_side in ("both", "network") else 0
        metrics.append({
            "dimension": d,
            "personal": max(0, min(100, base_p)),
            "network": max(0, min(100, base_n)),
            "gap": abs(base_p - base_n),
            "winner": "personal" if base_p > base_n else "network" if base_n > base_p else "balanced",
        })

    if brain_side == "both":
        personal_summary = {"tagline": "个人笔记反映的内在思维", "keywords": ["自我", "反思"]}
        network_summary = {"tagline": "外部信息采集", "keywords": ["资讯", "学习"]}
        dominant_brain = "personal" if p_ratio > n_ratio + 0.1 else "network" if n_ratio > p_ratio + 0.1 else "balanced"
        synergy_score = 50 + int(50 - abs(p_ratio - n_ratio) * 50)
    elif brain_side == "personal":
        personal_summary = {"tagline": "个人笔记反映的内在思维", "keywords": ["自我", "反思"]}
        network_summary = {"tagline": "", "keywords": []}
        dominant_brain = "personal"
        synergy_score = 0
    else:
        personal_summary = {"tagline": "", "keywords": []}
        network_summary = {"tagline": "外部信息采集", "keywords": ["资讯", "学习"]}
        dominant_brain = "network"
        synergy_score = 0

    return {
        "metrics": metrics,
        "personal_summary": personal_summary,
        "network_summary": network_summary,
        "dominant_brain": dominant_brain,
        "synergy_score": synergy_score,
        "conflict_count": 0,
        "insights": [
            "个人笔记越多，思维画像越准确。",
            "外部信息采集越丰富，网络脑画像越立体。",
            "尝试让个人想法与外部观点对话，可激发新洞察。",
        ],
    }


@router.post("/cognitive-conflict", response_model=CognitiveConflictResponse, summary="发现个人脑与网络脑的认知冲突")
async def cognitive_conflict(
    brain_side: BrainSide = Query("both", description="personal=个人脑内部冲突, network=网络脑内部冲突, both=双脑冲突"),
    preferred_model: Optional[str] = Query(None, description="Preferred LLM model identifier"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    personal_items = _aggregate_user_content(user, db, 30, "personal") if brain_side in ("both", "personal") else []
    network_items = _aggregate_user_content(user, db, 30, "network") if brain_side in ("both", "network") else []

    if brain_side == "both" and (not personal_items or not network_items):
        return CognitiveConflictResponse(conflicts=[], total=0, categories=[])
    if brain_side == "personal" and len(personal_items) < 2:
        return CognitiveConflictResponse(conflicts=[], total=0, categories=[])
    if brain_side == "network" and len(network_items) < 2:
        return CognitiveConflictResponse(conflicts=[], total=0, categories=[])

    if brain_side == "both":
        personal_text = "\n\n".join(f"ID:{i['id']} {i['title']}\n{i['content'][:600]}" for i in personal_items[:12])
        network_text = "\n\n".join(f"ID:{i['id']} {i['title']}\n{i['content'][:600]}" for i in network_items[:12])
        prompt = f"""请分析以下"个人脑"笔记与"网络脑"外部内容，找出它们之间的认知冲突、观点张力或信息缺口。

冲突类型可包括：观点冲突、证据冲突、优先级冲突、价值观冲突、信息缺口。

对每条冲突输出：
- title: 冲突标题
- personal_position: 个人脑立场/观点（20-50字）
- network_position: 网络脑立场/观点（20-50字）
- conflict_type: 冲突类型
- severity: 严重程度 1-5
- suggested_resolution: 建议的调和/验证方式
- source_ids: 涉及的 source_id 数组（字符串）

严格按以下 JSON 输出（不要 markdown）：
{{
  "conflicts": [
    {{
      "id": "c1",
      "title": "...",
      "personal_position": "...",
      "network_position": "...",
      "conflict_type": "观点冲突",
      "severity": 3,
      "suggested_resolution": "...",
      "source_ids": ["id1", "id2"]
    }}
  ],
  "categories": [
    {{"type": "观点冲突", "count": 1}}
  ]
}}

个人脑：
{personal_text[:5000]}

网络脑：
{network_text[:5000]}
"""
    else:
        side_label = "个人脑" if brain_side == "personal" else "网络脑"
        items = personal_items if brain_side == "personal" else network_items
        content_text = "\n\n".join(f"ID:{i['id']} {i['title']}\n{i['content'][:600]}" for i in items[:15])
        prompt = f"""请分析以下"{side_label}"中的多条内容，找出它们内部的认知冲突、观点张力或信息缺口（例如早期想法与近期想法不一致、不同笔记观点矛盾等）。

冲突类型可包括：观点冲突、证据冲突、优先级冲突、价值观冲突、信息缺口。

对每条冲突输出：
- title: 冲突标题
- personal_position: 观点 A 立场/来源（20-50字）
- network_position: 观点 B 立场/来源（20-50字）
- conflict_type: 冲突类型
- severity: 严重程度 1-5
- suggested_resolution: 建议的调和/验证方式
- source_ids: 涉及的 source_id 数组（字符串）

严格按以下 JSON 输出（不要 markdown）：
{{
  "conflicts": [
    {{
      "id": "c1",
      "title": "...",
      "personal_position": "...",
      "network_position": "...",
      "conflict_type": "观点冲突",
      "severity": 3,
      "suggested_resolution": "...",
      "source_ids": ["id1", "id2"]
    }}
  ],
  "categories": [
    {{"type": "观点冲突", "count": 1}}
  ]
}}

{side_label}内容：
{content_text[:6000]}
"""

    try:
        data = await _llm_json(prompt, preferred_model=preferred_model, db=db, user_id=user.id)
    except HTTPException as e:
        _raise_if_payment_error(e)
        # LLM 失败不能假装"没有冲突"，如实报错让前端提示重试
        raise HTTPException(status_code=502, detail="AI 冲突分析暂时失败，请稍后重试")

    conflicts_raw = data.get("conflicts", [])
    conflicts = []
    for idx, c in enumerate(conflicts_raw):
        conflicts.append(ConflictItem(
            id=c.get("id") or f"conflict-{idx}",
            title=c.get("title", "未命名冲突"),
            personal_position=c.get("personal_position", "")[:200],
            network_position=c.get("network_position", "")[:200],
            conflict_type=c.get("conflict_type", "观点冲突"),
            severity=max(1, min(5, int(c.get("severity", 3)))),
            suggested_resolution=c.get("suggested_resolution", "进一步验证双方观点。"),
            source_ids=c.get("source_ids", []) or [],
        ))

    categories = data.get("categories", []) or []
    if not categories and conflicts:
        from collections import Counter
        counter = Counter(c.conflict_type for c in conflicts)
        categories = [{"type": t, "count": n} for t, n in counter.items()]

    return CognitiveConflictResponse(
        conflicts=conflicts,
        total=len(conflicts),
        categories=categories,
    )


# ─────────────────────────── 决策审计 ───────────────────────────

class DecisionOption(BaseModel):
    id: str
    text: str
    pros: Optional[str] = None
    cons: Optional[str] = None


class DecisionAuditCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    context: str = Field(..., min_length=10)
    options: List[DecisionOption] = Field(default_factory=list)
    expected_outcome: Optional[str] = None
    actual_outcome: Optional[str] = None
    decision_date: Optional[str] = None  # ISO date
    related_note_ids: List[str] = Field(default_factory=list)
    brain_side: str = Field(default="personal")


class DecisionAuditUpdate(BaseModel):
    title: Optional[str] = None
    context: Optional[str] = None
    options: Optional[List[DecisionOption]] = None
    expected_outcome: Optional[str] = None
    actual_outcome: Optional[str] = None
    decision_date: Optional[str] = None
    status: Optional[str] = None
    related_note_ids: Optional[List[str]] = None
    brain_side: Optional[str] = None


class DecisionAnalysisResult(BaseModel):
    confidence: float = Field(..., ge=0, le=100)
    biases: List[str]
    risks: List[str]
    suggestions: List[str]
    verdict: str
    option_scores: Optional[Dict[str, Any]] = None


class DecisionAuditResponse(BaseModel):
    id: str
    title: str
    context: str
    options: List[Dict[str, Any]]
    expected_outcome: Optional[str]
    actual_outcome: Optional[str]
    decision_date: Optional[str]
    status: str
    analysis_result: DecisionAnalysisResult
    related_note_ids: List[str]
    brain_side: str
    created_at: str
    updated_at: str


class DecisionAuditListResponse(BaseModel):
    items: List[DecisionAuditResponse]
    total: int


def _serialize_audit(audit: DecisionAudit) -> Dict[str, Any]:
    import json
    options = json.loads(audit.options) if audit.options else []
    analysis = json.loads(audit.analysis_result) if audit.analysis_result else None
    if not analysis:
        analysis = {
            "confidence": 0,
            "biases": [],
            "risks": [],
            "suggestions": [],
            "verdict": "待分析",
            "option_scores": {},
        }
    related = json.loads(audit.related_note_ids) if audit.related_note_ids else []
    return {
        "id": audit.id,
        "title": audit.title,
        "context": audit.context,
        "options": options,
        "expected_outcome": audit.expected_outcome,
        "actual_outcome": audit.actual_outcome,
        "decision_date": audit.decision_date.isoformat() if audit.decision_date else None,
        "status": audit.status,
        "analysis_result": analysis,
        "related_note_ids": related,
        "brain_side": audit.brain_side,
        "created_at": audit.created_at.isoformat() if audit.created_at else "",
        "updated_at": audit.updated_at.isoformat() if audit.updated_at else "",
    }


@router.post("/decision-audits", response_model=DecisionAuditResponse, summary="创建决策审计")
async def create_decision_audit(
    req: DecisionAuditCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from app.models.base import DecisionAudit
    audit = DecisionAudit(
        id=str(uuid.uuid4()),
        user_id=user.id,
        tenant_id=getattr(user, "tenant_id", None),
        title=req.title,
        context=req.context,
        options=json.dumps([o.model_dump() for o in req.options], ensure_ascii=False),
        expected_outcome=req.expected_outcome,
        actual_outcome=req.actual_outcome,
        decision_date=datetime.fromisoformat(req.decision_date) if req.decision_date else datetime.now(),
        status="pending",
        analysis_result=json.dumps({
            "confidence": 0,
            "biases": [],
            "risks": [],
            "suggestions": [],
            "verdict": "待分析",
            "option_scores": {},
        }, ensure_ascii=False),
        related_note_ids=json.dumps(req.related_note_ids, ensure_ascii=False),
        brain_side=req.brain_side,
    )
    db.add(audit)
    db.commit()
    db.refresh(audit)
    return _serialize_audit(audit)


@router.get("/decision-audits", response_model=DecisionAuditListResponse, summary="决策审计列表")
async def list_decision_audits(
    status: Optional[str] = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from app.models.base import DecisionAudit
    query = db.query(DecisionAudit).filter(DecisionAudit.user_id == user.id)
    if status:
        query = query.filter(DecisionAudit.status == status)
    total = query.count()
    audits = query.order_by(DecisionAudit.created_at.desc()).offset(offset).limit(limit).all()
    return DecisionAuditListResponse(items=[_serialize_audit(a) for a in audits], total=total)


@router.get("/decision-audits/{audit_id}", response_model=DecisionAuditResponse, summary="决策审计详情")
async def get_decision_audit(
    audit_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from app.models.base import DecisionAudit
    audit = db.query(DecisionAudit).filter(
        DecisionAudit.id == audit_id,
        DecisionAudit.user_id == user.id,
    ).first()
    if not audit:
        raise HTTPException(status_code=404, detail="Decision audit not found")
    return _serialize_audit(audit)


@router.put("/decision-audits/{audit_id}", response_model=DecisionAuditResponse, summary="更新决策审计")
async def update_decision_audit(
    audit_id: str,
    req: DecisionAuditUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from app.models.base import DecisionAudit
    audit = db.query(DecisionAudit).filter(
        DecisionAudit.id == audit_id,
        DecisionAudit.user_id == user.id,
    ).first()
    if not audit:
        raise HTTPException(status_code=404, detail="Decision audit not found")

    if req.title is not None:
        audit.title = req.title
    if req.context is not None:
        audit.context = req.context
    if req.options is not None:
        audit.options = json.dumps([o.model_dump() for o in req.options], ensure_ascii=False)
    if req.expected_outcome is not None:
        audit.expected_outcome = req.expected_outcome
    if req.actual_outcome is not None:
        audit.actual_outcome = req.actual_outcome
    if req.decision_date is not None:
        audit.decision_date = datetime.fromisoformat(req.decision_date)
    if req.status is not None:
        audit.status = req.status
    if req.related_note_ids is not None:
        audit.related_note_ids = json.dumps(req.related_note_ids, ensure_ascii=False)
    if req.brain_side is not None:
        audit.brain_side = req.brain_side

    db.commit()
    db.refresh(audit)
    return _serialize_audit(audit)


@router.delete("/decision-audits/{audit_id}", summary="删除决策审计")
async def delete_decision_audit(
    audit_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from app.models.base import DecisionAudit
    audit = db.query(DecisionAudit).filter(
        DecisionAudit.id == audit_id,
        DecisionAudit.user_id == user.id,
    ).first()
    if not audit:
        raise HTTPException(status_code=404, detail="Decision audit not found")
    db.delete(audit)
    db.commit()
    return {"success": True}


@router.post("/decision-audits/{audit_id}/analyze", response_model=DecisionAuditResponse, summary="分析决策审计")
async def analyze_decision_audit(
    audit_id: str,
    preferred_model: Optional[str] = Query(None, description="Preferred LLM model identifier"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from app.models.base import DecisionAudit
    audit = db.query(DecisionAudit).filter(
        DecisionAudit.id == audit_id,
        DecisionAudit.user_id == user.id,
    ).first()
    if not audit:
        raise HTTPException(status_code=404, detail="Decision audit not found")

    options = json.loads(audit.options) if audit.options else []
    option_text = "\n".join(
        f"选项 {idx + 1}: {opt.get('text', '')}\n  优点: {opt.get('pros', '')}\n  缺点: {opt.get('cons', '')}"
        for idx, opt in enumerate(options)
    )

    prompt = f"""你是一位决策分析专家。请对以下决策进行审计分析。

决策背景：
{audit.context[:3000]}

可选方案：
{option_text[:2000]}

预期结果：
{audit.expected_outcome or '未填写'}

实际结果：
{audit.actual_outcome or '未填写'}

请从以下维度给出分析，严格按 JSON 输出（不要 markdown）：
{{
  "confidence": 70,
  "biases": ["确认偏误", "锚定效应"],
  "risks": ["风险1", "风险2"],
  "suggestions": ["建议1", "建议2"],
  "verdict": "总体评价：...",
  "option_scores": {{"方案1": 75, "方案2": 60}}
}}
"""

    try:
        data = await _llm_json(prompt, preferred_model=preferred_model, db=db, user_id=user.id)
    except HTTPException as e:
        _raise_if_payment_error(e)
        # LLM 失败时不能把"信息不足"的假分析写库并标记为已审计
        raise HTTPException(status_code=502, detail="AI 决策分析暂时失败，请稍后重试")

    analysis = {
        "confidence": max(0, min(100, float(data.get("confidence", 50)))),
        "biases": data.get("biases", [])[:10],
        "risks": data.get("risks", [])[:10],
        "suggestions": data.get("suggestions", [])[:10],
        "verdict": data.get("verdict", "")[:500],
        "option_scores": data.get("option_scores", {}),
    }

    audit.analysis_result = json.dumps(analysis, ensure_ascii=False)
    audit.status = "reviewed"
    db.commit()
    db.refresh(audit)
    return _serialize_audit(audit)


# ─────────────────────────── 未来模拟 ───────────────────────────

class Scenario(BaseModel):
    name: str
    assumptions: List[str]
    probability: float = Field(..., ge=0, le=100)


class FutureSimulationCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    context: str = Field(..., min_length=10)
    variables: List[str] = Field(default_factory=list)
    scenarios: List[Scenario] = Field(default_factory=list)
    timeframes: List[str] = Field(default=["1周", "1个月", "1年"])
    related_audit_id: Optional[str] = None
    brain_side: str = Field(default="both")


class FutureSimulationUpdate(BaseModel):
    title: Optional[str] = None
    context: Optional[str] = None
    variables: Optional[List[str]] = None
    scenarios: Optional[List[Scenario]] = None
    timeframes: Optional[List[str]] = None
    related_audit_id: Optional[str] = None
    brain_side: Optional[str] = None


class SimulationOutcome(BaseModel):
    scenario: str
    probability: float
    short_term: str
    medium_term: str
    long_term: str
    key_indicators: List[str]
    risks: List[str]
    opportunities: List[str]


class FutureSimulationResult(BaseModel):
    summary: str
    outcomes: List[SimulationOutcome]
    recommendation: str
    confidence: float = Field(..., ge=0, le=100)


class FutureSimulationResponse(BaseModel):
    id: str
    title: str
    context: str
    variables: List[str]
    scenarios: List[Dict[str, Any]]
    timeframes: List[str]
    status: str
    result: FutureSimulationResult
    related_audit_id: Optional[str]
    brain_side: str
    created_at: str
    updated_at: str


class FutureSimulationListResponse(BaseModel):
    items: List[FutureSimulationResponse]
    total: int


def _serialize_simulation(sim: FutureSimulation) -> Dict[str, Any]:
    result = json.loads(sim.result) if sim.result else None
    if not result:
        result = {"summary": "", "outcomes": [], "recommendation": "", "confidence": 0}
    return {
        "id": sim.id,
        "title": sim.title,
        "context": sim.context,
        "variables": json.loads(sim.variables) if sim.variables else [],
        "scenarios": json.loads(sim.scenarios) if sim.scenarios else [],
        "timeframes": json.loads(sim.timeframes) if sim.timeframes else [],
        "status": sim.status,
        "result": result,
        "related_audit_id": sim.related_audit_id,
        "brain_side": sim.brain_side,
        "created_at": sim.created_at.isoformat() if sim.created_at else "",
        "updated_at": sim.updated_at.isoformat() if sim.updated_at else "",
    }


@router.post("/future-simulations", response_model=FutureSimulationResponse, summary="创建未来模拟")
async def create_future_simulation(
    req: FutureSimulationCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from app.models.base import FutureSimulation
    sim = FutureSimulation(
        id=str(uuid.uuid4()),
        user_id=user.id,
        tenant_id=getattr(user, "tenant_id", None),
        title=req.title,
        context=req.context,
        variables=json.dumps(req.variables, ensure_ascii=False),
        scenarios=json.dumps([s.model_dump() for s in req.scenarios], ensure_ascii=False),
        timeframes=json.dumps(req.timeframes, ensure_ascii=False),
        status="pending",
        result=json.dumps({
            "summary": "",
            "outcomes": [],
            "recommendation": "",
            "confidence": 0,
        }, ensure_ascii=False),
        related_audit_id=req.related_audit_id,
        brain_side=req.brain_side,
    )
    db.add(sim)
    db.commit()
    db.refresh(sim)
    return _serialize_simulation(sim)


@router.get("/future-simulations", response_model=FutureSimulationListResponse, summary="未来模拟列表")
async def list_future_simulations(
    status: Optional[str] = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from app.models.base import FutureSimulation
    query = db.query(FutureSimulation).filter(FutureSimulation.user_id == user.id)
    if status:
        query = query.filter(FutureSimulation.status == status)
    total = query.count()
    sims = query.order_by(FutureSimulation.created_at.desc()).offset(offset).limit(limit).all()
    return FutureSimulationListResponse(items=[_serialize_simulation(s) for s in sims], total=total)


@router.get("/future-simulations/{sim_id}", response_model=FutureSimulationResponse, summary="未来模拟详情")
async def get_future_simulation(
    sim_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from app.models.base import FutureSimulation
    sim = db.query(FutureSimulation).filter(
        FutureSimulation.id == sim_id,
        FutureSimulation.user_id == user.id,
    ).first()
    if not sim:
        raise HTTPException(status_code=404, detail="Future simulation not found")
    return _serialize_simulation(sim)


@router.put("/future-simulations/{sim_id}", response_model=FutureSimulationResponse, summary="更新未来模拟")
async def update_future_simulation(
    sim_id: str,
    req: FutureSimulationUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from app.models.base import FutureSimulation
    sim = db.query(FutureSimulation).filter(
        FutureSimulation.id == sim_id,
        FutureSimulation.user_id == user.id,
    ).first()
    if not sim:
        raise HTTPException(status_code=404, detail="Future simulation not found")

    if req.title is not None:
        sim.title = req.title
    if req.context is not None:
        sim.context = req.context
    if req.variables is not None:
        sim.variables = json.dumps(req.variables, ensure_ascii=False)
    if req.scenarios is not None:
        sim.scenarios = json.dumps([s.model_dump() for s in req.scenarios], ensure_ascii=False)
    if req.timeframes is not None:
        sim.timeframes = json.dumps(req.timeframes, ensure_ascii=False)
    if req.related_audit_id is not None:
        sim.related_audit_id = req.related_audit_id
    if req.brain_side is not None:
        sim.brain_side = req.brain_side

    db.commit()
    db.refresh(sim)
    return _serialize_simulation(sim)


@router.delete("/future-simulations/{sim_id}", summary="删除未来模拟")
async def delete_future_simulation(
    sim_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from app.models.base import FutureSimulation
    sim = db.query(FutureSimulation).filter(
        FutureSimulation.id == sim_id,
        FutureSimulation.user_id == user.id,
    ).first()
    if not sim:
        raise HTTPException(status_code=404, detail="Future simulation not found")
    db.delete(sim)
    db.commit()
    return {"success": True}


@router.post("/future-simulations/{sim_id}/run", response_model=FutureSimulationResponse, summary="运行未来模拟")
async def run_future_simulation(
    sim_id: str,
    preferred_model: Optional[str] = Query(None, description="Preferred LLM model identifier"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from app.models.base import FutureSimulation
    sim = db.query(FutureSimulation).filter(
        FutureSimulation.id == sim_id,
        FutureSimulation.user_id == user.id,
    ).first()
    if not sim:
        raise HTTPException(status_code=404, detail="Future simulation not found")

    scenarios = json.loads(sim.scenarios) if sim.scenarios else []
    variables = json.loads(sim.variables) if sim.variables else []
    timeframes = json.loads(sim.timeframes) if sim.timeframes else ["1周", "1个月", "1年"]

    scenario_text = "\n\n".join(
        f"情景：{s.get('name', '')}\n假设：{', '.join(s.get('assumptions', []))}\n发生概率：{s.get('probability', 50)}%"
        for s in scenarios
    ) or "未定义具体情景，请基于背景自由推演。"

    prompt = f"""你是一位未来情景推演专家。请基于以下决策背景与情景，推演不同时间尺度的可能结果。

决策背景：
{sim.context[:3000]}

关键变量：{', '.join(variables) or '无'}

{scenario_text}

时间尺度：{', '.join(timeframes)}

请严格按以下 JSON 输出（不要 markdown）：
{{
  "summary": "总体推演结论（100字以内）",
  "outcomes": [
    {{
      "scenario": "情景名称",
      "probability": 50,
      "short_term": "短期（{timeframes[0] if timeframes else '1周'}）结果",
      "medium_term": "中期（{timeframes[1] if len(timeframes) > 1 else '1个月'}）结果",
      "long_term": "长期（{timeframes[2] if len(timeframes) > 2 else '1年'}）结果",
      "key_indicators": ["关键指标1", "关键指标2"],
      "risks": ["风险1"],
      "opportunities": ["机会1"]
    }}
  ],
  "recommendation": "综合建议",
  "confidence": 70
}}
"""

    try:
        data = await _llm_json(prompt, preferred_model=preferred_model, db=db, user_id=user.id)
    except HTTPException as e:
        _raise_if_payment_error(e)
        # LLM 失败时不能把空推演写库并标记为已模拟
        raise HTTPException(status_code=502, detail="AI 情景推演暂时失败，请稍后重试")

    outcomes_raw = data.get("outcomes", [])
    outcomes = []
    for o in outcomes_raw:
        outcomes.append({
            "scenario": o.get("scenario", "未命名情景"),
            "probability": max(0, min(100, float(o.get("probability", 50)))),
            "short_term": o.get("short_term", "")[:300],
            "medium_term": o.get("medium_term", "")[:300],
            "long_term": o.get("long_term", "")[:300],
            "key_indicators": o.get("key_indicators", [])[:8],
            "risks": o.get("risks", [])[:8],
            "opportunities": o.get("opportunities", [])[:8],
        })

    result = {
        "summary": (data.get("summary", "") or "")[:300],
        "outcomes": outcomes,
        "recommendation": (data.get("recommendation", "") or "")[:500],
        "confidence": max(0, min(100, float(data.get("confidence", 50)))),
    }

    sim.result = json.dumps(result, ensure_ascii=False)
    sim.status = "simulated"
    db.commit()
    db.refresh(sim)
    return _serialize_simulation(sim)



# ─────────────────────────── 认知挑战（可玩性）──────────────────────────

CHALLENGE_POOL = [
    {
        "type": "bias_quiz",
        "title": "确认偏误识别",
        "content": "小明只关注支持他观点的新闻，并认为反对意见都是无知的。这最可能是哪种认知偏差？",
        "options": ["确认偏误", "锚定效应", "幸存者偏差", "达克效应"],
        "correct_answer": "确认偏误",
        "explanation": "确认偏误是指人们倾向于寻找、解释和记忆能支持自己已有信念的信息，而忽视反面证据。",
        "points": 10,
    },
    {
        "type": "bias_quiz",
        "title": "锚定效应识别",
        "content": "在谈判中，先出价的一方往往能让最终成交价更靠近自己的报价。这种现象叫什么？",
        "options": ["锚定效应", "可得性启发", "归因错误", "锚定偏差"],
        "correct_answer": "锚定效应",
        "explanation": "锚定效应是指人们过度依赖最先获得的信息（锚点）来做后续判断。",
        "points": 10,
    },
    {
        "type": "bias_quiz",
        "title": "幸存者偏差",
        "content": "只研究成功企业家的辍学经历，就认为辍学容易成功，忽略了大量失败的辍学者。这是什么偏差？",
        "options": ["幸存者偏差", "确认偏误", "可得性启发", "锚定效应"],
        "correct_answer": "幸存者偏差",
        "explanation": "幸存者偏差只关注成功或存活下来的样本，而忽略失败或消失的样本，导致错误结论。",
        "points": 10,
    },
    {
        "type": "thought_experiment",
        "title": "反事实思考",
        "content": "回想最近一次让你后悔的小决定。如果当时选择了另一个方案，现在最可能发生的三件事是什么？",
        "options": [],
        "correct_answer": "",
        "explanation": "反事实思考能帮助你理解决策的偶然性，避免过度归因于自己的能力或运气。",
        "points": 15,
    },
    {
        "type": "thought_experiment",
        "title": "二阶思维练习",
        "content": "如果你决定每天减少一小时睡眠来工作，一阶结果可能是更多产出。请写出三个二阶后果（后果的后果）。",
        "options": [],
        "correct_answer": "",
        "explanation": "二阶思维要求你思考后果的后果，帮助避免短期收益带来的长期损失。",
        "points": 15,
    },
    {
        "type": "reflection",
        "title": "信念检验",
        "content": "写下你最近坚信的一个观点，然后列出三条可能推翻它的证据或反例。",
        "options": [],
        "correct_answer": "",
        "explanation": "主动寻找反面证据是减少确认偏误、提升思维弹性的有效训练。",
        "points": 20,
    },
    {
        "type": "bias_quiz",
        "title": "可得性启发",
        "content": "看完空难新闻后，人们往往会高估飞行的危险性。这种判断方式叫什么？",
        "options": ["可得性启发", "确认偏误", "锚定效应", "归因错误"],
        "correct_answer": "可得性启发",
        "explanation": "可得性启发是指人们根据记忆中容易想起的事例来判断事件发生的概率。",
        "points": 10,
    },
    {
        "type": "bias_quiz",
        "title": "归因错误",
        "content": "看到别人迟到就认为他懒散，而自己迟到则归因于堵车。这种双重标准是什么偏差？",
        "options": ["归因错误", "确认偏误", "锚定效应", "达克效应"],
        "correct_answer": "归因错误",
        "explanation": "基本归因错误是指人们倾向于把他人行为归因于性格，而把自己的行为归因于情境。",
        "points": 10,
    },
    {
        "type": "thought_experiment",
        "title": "机会成本清单",
        "content": "你现在正在做的最重要的一件事是什么？如果停止做它，你能把时间和注意力投入到哪三件高价值的事上？",
        "options": [],
        "correct_answer": "",
        "explanation": "明确机会成本能帮你判断当前投入是否真的值得。",
        "points": 15,
    },
    {
        "type": "reflection",
        "title": "情绪标记",
        "content": "最近一次你因为情绪而做出冲动决定是什么时候？当时如果等 24 小时再决定，结果可能有何不同？",
        "options": [],
        "correct_answer": "",
        "explanation": "情绪会显著影响决策质量，延迟反应是避免情绪劫持的有效策略。",
        "points": 20,
    },
    {
        "type": "bias_quiz",
        "title": "达克效应",
        "content": "能力欠缺者往往会高估自己的能力水平，而高手反而容易低估自己。这叫什么效应？",
        "options": ["达克效应", "邓宁-克鲁格效应", "过度自信", "以上皆是"],
        "correct_answer": "以上皆是",
        "explanation": "达克效应（Dunning-Kruger Effect）又称邓宁-克鲁格效应，核心表现之一就是能力越低的人越容易过度自信。",
        "points": 10,
    },
    {
        "type": "thought_experiment",
        "title": "预验尸法",
        "content": "假设你当前最重要的项目一年后彻底失败了，请写下三个最可能导致失败的原因。",
        "options": [],
        "correct_answer": "",
        "explanation": "预验尸法（Premortem）能帮你提前识别潜在风险，而不是盲目乐观。",
        "points": 15,
    },
]


class ChallengeResponse(BaseModel):
    id: str
    type: str
    title: str
    content: str
    options: List[str]
    status: str
    points: int
    explanation: Optional[str] = None
    completed_at: Optional[str] = None
    user_answer: Optional[str] = None
    is_correct: Optional[bool] = None


class ChallengeStats(BaseModel):
    total_completed: int
    total_points: int
    current_streak: int
    longest_streak: int
    accuracy_rate: float
    today_completed: bool


class ChallengeAnswerRequest(BaseModel):
    answer: str


class ChallengeAnswerResponse(BaseModel):
    success: bool
    is_correct: Optional[bool]
    correct_answer: Optional[str]
    explanation: Optional[str]
    points_earned: int
    streak: int
    total_points: int


def _get_or_create_daily_challenge(db: Session, user: User) -> CognitiveChallenge:
    """获取或创建用户今日挑战。跳过的挑战会被忽略，以便生成新题目。"""
    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    challenge = (
        db.query(CognitiveChallenge)
        .filter(
            CognitiveChallenge.user_id == user.id,
            CognitiveChallenge.challenge_date >= today,
            CognitiveChallenge.status != "skipped",
        )
        .order_by(CognitiveChallenge.created_at.desc())
        .first()
    )
    if challenge:
        return challenge

    # 基于用户历史挑战总数选题：跳过也消耗序号，避免跳过后下一题仍是同一道
    used_count = db.query(CognitiveChallenge).filter(
        CognitiveChallenge.user_id == user.id,
    ).count()
    pool_index = used_count % len(CHALLENGE_POOL)
    template = CHALLENGE_POOL[pool_index]

    challenge = CognitiveChallenge(
        id=str(uuid.uuid4()),
        user_id=user.id,
        challenge_date=today,
        type=template["type"],
        title=template["title"],
        content=template["content"],
        options=json.dumps(template.get("options", []), ensure_ascii=False),
        correct_answer=template.get("correct_answer"),
        explanation=template.get("explanation"),
        points=template.get("points", 10),
        status="pending",
    )
    db.add(challenge)
    db.commit()
    db.refresh(challenge)
    return challenge


def _calculate_streak(db: Session, user: User) -> int:
    """计算连续完成天数。今天尚未打卡不中断连续记录（从今天或昨天往前数）。"""
    completed = (
        db.query(CognitiveChallenge)
        .filter(
            CognitiveChallenge.user_id == user.id,
            CognitiveChallenge.status == "completed",
        )
        .order_by(CognitiveChallenge.challenge_date.desc())
        .all()
    )
    dates = sorted(set(
        c.challenge_date.replace(hour=0, minute=0, second=0, microsecond=0)
        for c in completed if c.challenge_date
    ), reverse=True)
    if not dates:
        return 0
    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    # 最近一次完成比昨天还早，连续记录已断
    if dates[0] < today - timedelta(days=1):
        return 0
    streak = 1
    for i in range(1, len(dates)):
        if dates[i] == dates[i - 1] - timedelta(days=1):
            streak += 1
        else:
            break
    return streak


def _serialize_challenge(c: CognitiveChallenge) -> Dict[str, Any]:
    return {
        "id": c.id,
        "type": c.type,
        "title": c.title,
        "content": c.content,
        "options": json.loads(c.options) if c.options else [],
        "status": c.status,
        "points": c.points,
        "explanation": c.explanation,
        "completed_at": c.completed_at.isoformat() if c.completed_at else None,
        "user_answer": c.user_answer,
        "is_correct": c.is_correct,
    }


@router.get("/challenge/daily", response_model=ChallengeResponse, summary="获取今日认知挑战")
async def get_daily_challenge(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    challenge = _get_or_create_daily_challenge(db, user)
    return _serialize_challenge(challenge)


@router.post("/challenge/{challenge_id}/answer", response_model=ChallengeAnswerResponse, summary="提交挑战答案")
async def submit_challenge_answer(
    challenge_id: str,
    req: ChallengeAnswerRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    challenge = db.query(CognitiveChallenge).filter(
        CognitiveChallenge.id == challenge_id,
        CognitiveChallenge.user_id == user.id,
    ).first()
    if not challenge:
        raise HTTPException(status_code=404, detail="Challenge not found")
    if challenge.status == "completed":
        return ChallengeAnswerResponse(
            success=False,
            is_correct=challenge.is_correct,
            correct_answer=challenge.correct_answer,
            explanation=challenge.explanation,
            points_earned=0,
            streak=_calculate_streak(db, user),
            total_points=_calculate_total_points(db, user),
        )

    is_correct = None
    points_earned = 0
    if challenge.type == "bias_quiz":
        is_correct = req.answer.strip() == (challenge.correct_answer or "").strip()
        points_earned = challenge.points if is_correct else 0
    else:
        # 思考题/反思题只要作答即得分
        points_earned = challenge.points if req.answer.strip() else 0
        is_correct = True if req.answer.strip() else False

    challenge.user_answer = req.answer.strip()
    challenge.is_correct = is_correct
    challenge.status = "completed"
    challenge.completed_at = datetime.now()
    challenge.streak_before = _calculate_streak(db, user)
    db.commit()
    db.refresh(challenge)

    streak = _calculate_streak(db, user)
    total = _calculate_total_points(db, user)

    return ChallengeAnswerResponse(
        success=True,
        is_correct=is_correct,
        correct_answer=challenge.correct_answer,
        explanation=challenge.explanation,
        points_earned=points_earned,
        streak=streak,
        total_points=total,
    )


def _calculate_total_points(db: Session, user: User) -> int:
    return (
        db.query(func.sum(CognitiveChallenge.points))
        .filter(
            CognitiveChallenge.user_id == user.id,
            CognitiveChallenge.status == "completed",
        )
        .scalar() or 0
    )


@router.get("/challenge/stats", response_model=ChallengeStats, summary="认知挑战统计")
async def get_challenge_stats(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    completed = (
        db.query(CognitiveChallenge)
        .filter(
            CognitiveChallenge.user_id == user.id,
            CognitiveChallenge.status == "completed",
        )
        .all()
    )
    total_completed = len(completed)
    total_points = sum(c.points for c in completed)
    quiz_count = sum(1 for c in completed if c.type == "bias_quiz")
    # 正确率只统计测验题（思考/反思题答了即算对，不纳入分母）
    correct_count = sum(1 for c in completed if c.type == "bias_quiz" and c.is_correct)
    accuracy = correct_count / quiz_count if quiz_count > 0 else 1.0

    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    today_completed = any(
        c.challenge_date and c.challenge_date.replace(hour=0, minute=0, second=0, microsecond=0) == today
        for c in completed
    )

    # longest streak
    dates = sorted(set(
        c.challenge_date.replace(hour=0, minute=0, second=0, microsecond=0)
        for c in completed if c.challenge_date
    ), reverse=True)
    longest = 0
    current = 0
    prev = None
    for d in dates:
        if prev is None or d == prev - timedelta(days=1):
            current += 1
        else:
            longest = max(longest, current)
            current = 1
        prev = d
    longest = max(longest, current)

    return ChallengeStats(
        total_completed=total_completed,
        total_points=total_points,
        current_streak=_calculate_streak(db, user),
        longest_streak=longest,
        accuracy_rate=round(accuracy, 2),
        today_completed=today_completed,
    )


@router.get("/challenge/history", response_model=List[ChallengeResponse], summary="认知挑战历史")
async def get_challenge_history(
    limit: int = Query(30, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    challenges = (
        db.query(CognitiveChallenge)
        .filter(CognitiveChallenge.user_id == user.id)
        .order_by(CognitiveChallenge.challenge_date.desc())
        .limit(limit)
        .all()
    )
    return [_serialize_challenge(c) for c in challenges]


@router.post("/challenge/{challenge_id}/skip", summary="跳过今日挑战")
async def skip_challenge(
    challenge_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    challenge = db.query(CognitiveChallenge).filter(
        CognitiveChallenge.id == challenge_id,
        CognitiveChallenge.user_id == user.id,
    ).first()
    if not challenge:
        raise HTTPException(status_code=404, detail="Challenge not found")
    if challenge.status == "pending":
        challenge.status = "skipped"
        db.commit()
    return {"success": True}



# ─────────────────────────── 认知健康周报 ───────────────────────────

class WeeklyDimension(BaseModel):
    name: str
    score: float = Field(..., ge=0, le=100)
    trend: str  # up / down / stable


class WeeklyStats(BaseModel):
    notes_count: int
    knowledge_count: int
    challenges_completed: int
    decisions_audited: int
    biases_found: int
    simulations_run: int


class WeeklyReportResponse(BaseModel):
    id: str
    week_start: str
    week_end: str
    health_score: int
    summary: str
    dimensions: List[WeeklyDimension]
    highlights: List[str]
    risks: List[str]
    suggestions: List[str]
    stats: WeeklyStats
    status: str
    created_at: str


class WeeklyReportListResponse(BaseModel):
    items: List[WeeklyReportResponse]
    total: int


def _get_week_boundaries(dt: datetime) -> tuple:
    """返回指定日期所在周的开始（周一）和结束（周日）。"""
    weekday = dt.weekday()
    start = dt - timedelta(days=weekday)
    start = start.replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=6, hours=23, minutes=59, seconds=59)
    return start, end


def _serialize_weekly_report(report: CognitiveWeeklyReport) -> Dict[str, Any]:
    stats = json.loads(report.stats) if report.stats else None
    if not stats:
        stats = {
            "notes_count": 0,
            "knowledge_count": 0,
            "challenges_completed": 0,
            "decisions_audited": 0,
            "biases_found": 0,
            "simulations_run": 0,
        }
    return {
        "id": report.id,
        "week_start": report.week_start.isoformat() if report.week_start else "",
        "week_end": report.week_end.isoformat() if report.week_end else "",
        "health_score": report.health_score,
        "summary": report.summary or "",
        "dimensions": json.loads(report.dimensions) if report.dimensions else [],
        "highlights": json.loads(report.highlights) if report.highlights else [],
        "risks": json.loads(report.risks) if report.risks else [],
        "suggestions": json.loads(report.suggestions) if report.suggestions else [],
        "stats": stats,
        "status": report.status,
        "created_at": report.created_at.isoformat() if report.created_at else "",
    }


@router.post("/weekly-reports/generate", response_model=WeeklyReportResponse, summary="生成本周认知健康报告")
async def generate_weekly_report(
    force: bool = Query(False, description="强制重新生成本周周报"),
    preferred_model: Optional[str] = Query(None, description="Preferred LLM model identifier"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    now = datetime.now()
    week_start, week_end = _get_week_boundaries(now)

    # 检查是否已生成
    existing = (
        db.query(CognitiveWeeklyReport)
        .filter(
            CognitiveWeeklyReport.user_id == user.id,
            CognitiveWeeklyReport.week_start == week_start,
        )
        .first()
    )
    if existing and not force:
        return _serialize_weekly_report(existing)
    # 注意：force 重新生成时先不删旧报告，等新报告全部生成成功后再替换，
    # 避免 AI 失败时旧报告也被删掉。

    # 统计本周数据
    notes_count = db.query(Note).filter(
        Note.user_id == user.id,
        Note.created_at >= week_start,
        Note.created_at <= week_end,
    ).count()

    knowledge_count = db.query(KnowledgeUnit).filter(
        KnowledgeUnit.user_id == user.id,
        KnowledgeUnit.created_at >= week_start,
        KnowledgeUnit.created_at <= week_end,
    ).count()

    challenges_completed = db.query(CognitiveChallenge).filter(
        CognitiveChallenge.user_id == user.id,
        CognitiveChallenge.status == "completed",
        CognitiveChallenge.completed_at >= week_start,
        CognitiveChallenge.completed_at <= week_end,
    ).count()

    decisions_audited = db.query(DecisionAudit).filter(
        DecisionAudit.user_id == user.id,
        DecisionAudit.status == "reviewed",
        DecisionAudit.updated_at >= week_start,
        DecisionAudit.updated_at <= week_end,
    ).count()

    simulations_run = db.query(FutureSimulation).filter(
        FutureSimulation.user_id == user.id,
        FutureSimulation.status == "simulated",
        FutureSimulation.updated_at >= week_start,
        FutureSimulation.updated_at <= week_end,
    ).count()

    # 简单统计偏差：本周检测到的偏差（复用 bias_summary 逻辑，取 both）
    items = _aggregate_user_content(user, db, 50, "both")
    biases_found = 0
    if items:
        selected = items[:15]
        prompt_bias = f"""请分析以下用户内容，统计本周可能存在的认知偏差类型数量。
可检测偏差：确认偏误、锚定效应、幸存者偏差、归因错误、可得性启发、达克效应。
请严格按 JSON 输出：{{"total_count": 3}}
内容：
"""
        for item in selected:
            prompt_bias += f"\n{item['content'][:300]}"
        try:
            bias_data = await _llm_json(prompt_bias, preferred_model=preferred_model, db=db, user_id=user.id)
            biases_found = int(bias_data.get("total_count", 0))
        except HTTPException as e:
            _raise_if_payment_error(e)
            biases_found = 0

    stats = {
        "notes_count": notes_count,
        "knowledge_count": knowledge_count,
        "challenges_completed": challenges_completed,
        "decisions_audited": decisions_audited,
        "biases_found": biases_found,
        "simulations_run": simulations_run,
    }

    # 生成报告内容
    prompt = f"""你是一位认知健康分析师。请基于以下用户本周数据，生成一份认知健康周报。

本周数据：
- 新增笔记：{notes_count} 篇
- 新增知识单元：{knowledge_count} 个
- 完成认知挑战：{challenges_completed} 次
- 决策审计：{decisions_audited} 次
- 未来模拟：{simulations_run} 次
- 检测到潜在认知偏差：{biases_found} 处

请输出 JSON：
{{
  "health_score": 78,
  "summary": "本周认知健康总体评价（100字以内）",
  "dimensions": [
    {{"name": "输入丰富度", "score": 80, "trend": "up"}},
    {{"name": "反思深度", "score": 65, "trend": "stable"}},
    {{"name": "决策质量", "score": 70, "trend": "up"}},
    {{"name": "偏差觉察", "score": 55, "trend": "down"}},
    {{"name": "未来视野", "score": 60, "trend": "stable"}}
  ],
  "highlights": ["亮点1", "亮点2"],
  "risks": ["风险1", "风险2"],
  "suggestions": ["建议1", "建议2", "建议3"]
}}

严格按 JSON 输出（不要 markdown）：
"""

    try:
        data = await _llm_json(prompt, preferred_model=preferred_model, db=db, user_id=user.id)
    except HTTPException as e:
        _raise_if_payment_error(e)
        data = {
            "health_score": 60,
            "summary": "本周认知活动数据较少，建议增加记录与挑战。",
            "dimensions": [
                {"name": "输入丰富度", "score": 50, "trend": "stable"},
                {"name": "反思深度", "score": 50, "trend": "stable"},
                {"name": "决策质量", "score": 50, "trend": "stable"},
                {"name": "偏差觉察", "score": 50, "trend": "stable"},
                {"name": "未来视野", "score": 50, "trend": "stable"},
            ],
            "highlights": ["开始关注认知健康"],
            "risks": ["数据不足，难以精确评估"],
            "suggestions": ["多记录笔记", "完成每日认知挑战", "定期进行决策审计"],
        }

    dimensions_raw = data.get("dimensions", [])
    dimensions = []
    for d in dimensions_raw:
        dimensions.append({
            "name": d.get("name", "未知"),
            "score": max(0, min(100, float(d.get("score", 50)))),
            "trend": d.get("trend", "stable"),
        })

    report = CognitiveWeeklyReport(
        id=str(uuid.uuid4()),
        user_id=user.id,
        week_start=week_start,
        week_end=week_end,
        health_score=max(0, min(100, int(data.get("health_score", 60)))),
        summary=(data.get("summary", "") or "")[:500],
        dimensions=json.dumps(dimensions, ensure_ascii=False),
        highlights=json.dumps(data.get("highlights", [])[:10], ensure_ascii=False),
        risks=json.dumps(data.get("risks", [])[:10], ensure_ascii=False),
        suggestions=json.dumps(data.get("suggestions", [])[:10], ensure_ascii=False),
        stats=json.dumps(stats, ensure_ascii=False),
        status="generated",
    )
    # 新报告生成成功，替换掉同周的旧报告
    if existing:
        db.delete(existing)
        db.commit()
    db.add(report)
    db.commit()
    db.refresh(report)
    return _serialize_weekly_report(report)


@router.get("/weekly-reports", response_model=WeeklyReportListResponse, summary="认知健康周报列表")
async def list_weekly_reports(
    limit: int = Query(12, ge=1, le=52),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = db.query(CognitiveWeeklyReport).filter(CognitiveWeeklyReport.user_id == user.id)
    total = query.count()
    reports = query.order_by(CognitiveWeeklyReport.week_start.desc()).offset(offset).limit(limit).all()
    return WeeklyReportListResponse(items=[_serialize_weekly_report(r) for r in reports], total=total)


@router.get("/weekly-reports/latest", response_model=WeeklyReportResponse, summary="最新认知健康周报")
async def get_latest_weekly_report(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    report = (
        db.query(CognitiveWeeklyReport)
        .filter(CognitiveWeeklyReport.user_id == user.id)
        .order_by(CognitiveWeeklyReport.week_start.desc())
        .first()
    )
    if not report:
        raise HTTPException(status_code=404, detail="No weekly report found")
    return _serialize_weekly_report(report)
