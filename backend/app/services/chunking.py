# -*- coding: utf-8 -*-
"""中文感知的语义切块 + 文档级向量化存储约定（父子块结构）。

- chunk_text：纯函数，Markdown 标题边界优先的父子分块。先按标题行（^#{1,6} ）
  切段（标题行并入其后内容段，标题不单独成原子），小 section 贪心合并成
  不超过父块上限的父块，超长 section 按段落 -> 句子 -> 硬切再切；父块内按
  同一逻辑切不超过子块上限的子块，兄弟子块间带 overlap。可无损拼回。
- embed_document_chunks：统一的文档向量写入入口。短文档（<= CHUNK_SIZE_THRESHOLD）
  保持一文档一向量（单父单子，行为与旧版一致）；长文档落库的是子块向量，
  子块 content_id = f"{doc_id}::chunk::{p}.{c}"（p=父序号、c=父内子序号，
  均从 0 起），content_type 与文档一致，检索端据此把块归属回原文档；
  父块全文冗余在子块行的 parent_text 列，检索端零回表直接取上下文窗口。
- 表格行结构化索引（09-11 云端评分实捕：「低频编号+高区分度字段」的表格行
  ——生物-B01/B15 这类——整表切块后行信号被稀释，稳定进不了 prompt）：
  长文档的 Markdown 表格每个数据行额外产出一条行级条目向量
  （文本 = 最近章节标题 + 「列名: 值」拼接），content_id 用
  f"{doc_id}::chunk::row::{n}" 独立命名空间接在子块后排，检索端当普通
  块行处理、零改动；既有父/子块与 FTS 一字不动。
- 子块面包屑（⑦ 父子块检索富化 A，借鉴 WeKnora strategy.go ContextHeader，
  代码全新写）：长文档子块落库时把所属章节标题链（markdown 标题层级，如
  「3.2 部署 > 3.2.1 配置」）作 ContextHeader 前缀合入落库的 chunk_text，
  孤立子块自带章节语境；链尾标题已在子块首行标题行里的剥掉不重复打头，
  无标题文档逐字节零改动。只影响新嵌入内容，存量靠自然重嵌渐进生效，
  不做存量回填；chunk_text 纯函数切块结果不变（标题链在嵌入装配层合入）。
  嵌入文本（text 列）刻意保持纯子块不带面包屑：mega14 门禁实捕面包屑入
  向量会同质化同章块、漂移向量排名（深章节双锚点题退化）——向量口径与
  改造前逐字节一致，面包屑的语境价值落在检索 preview/装配展示侧。
"""

import logging
import re
from typing import List, Tuple

logger = logging.getLogger(__name__)

# 文档长度超过此值才切块；不超过则维持一文档一向量，小文档行为完全不变
CHUNK_SIZE_THRESHOLD = 1500
# 块向量 content_id 的分隔符：{doc_id}::chunk::{p}.{c}
CHUNK_ID_SEP = "::chunk::"

# 父子块默认口径：子块 ~600 字（去向量化/检索命中），父块 ~1800 字（命中后作上下文窗口）
CHILD_TARGET = 600
CHILD_OVERLAP = 80
PARENT_TARGET = 1800

_PARA_SPLIT = re.compile(r"(\n\s*\n)")
_SENTENCE_END = re.compile(r"(?<=[。！？；.!?])")
_HEADING = re.compile(r"^#{1,6}\s", re.M)

# 表格行条目的 content_id 命名空间：{doc_id}::chunk::row::{n}。
# 独立 row:: 前缀而不是接着 {p}.{c} 编扁平序号——knowledge_dedup 只认
# 第 0 块（"0"/"0.x" 前缀）做候选匹配，扁平 "0" 会被误认成首块。
TABLE_ROW_ID_PREFIX = "row::"
# 单文档表格行条目上限：病态文档（数千行大表）超限则一行不产、整体回落
# 整表切块（行为与改造前一致），防向量行数爆炸拖垮嵌入与检索
TABLE_ROW_ENTRY_CAP = 500

_TABLE_ROW = re.compile(r"^\s*\|.*\|\s*$")      # 表头/数据行：|...| 形态
_TABLE_SEP_CELL = re.compile(r"^:?-+:?$")        # 分隔行单元格：--- / :--- / ---:
_HEADING_LINE = re.compile(r"^#{1,6}\s+(.*\S)\s*$")

# ── 子块面包屑（⑦ 父子块检索富化 A，ContextHeader 标题链前缀）──
_HEADING_FULL = re.compile(r"^(#{1,6})\s+(.*\S)\s*$", re.M)  # 带捕获组的全文标题扫描
# 面包屑前缀形态：「【章节：链1 > 链2】\n」。检索端富化（retrieval.enrich）据此
# 剥前缀做窗口覆盖判重；改格式必须同步那边。
_BREADCRUMB_RE = re.compile(r"^【章节：[^\n]*】\n")


def _heading_chain_at(headings: List[Tuple[int, int, str]], pos: int) -> List[str]:
    """pos 处生效的章节标题链（浅->深的标题文本列表）。

    headings = [(偏移, 级别, 标题文本), ...]（_HEADING_FULL 全文扫描结果，按序）；
    只收偏移 < pos 的标题，同级/更浅标题出现即替换栈尾（标题层级语义）。
    """
    chain: List[Tuple[int, str]] = []
    for off, level, title in headings:
        if off >= pos:
            break
        while chain and chain[-1][0] >= level:
            chain.pop()
        chain.append((level, title))
    return [t for _, t in chain]


def _breadcrumb_prefix(titles: List[str], child: str) -> str:
    """ContextHeader 前缀：「【章节：链1 > 链2】\n」；空链零前缀（无标题零改动）。

    去重（strategy.go:250-267 思路）：链尾标题已作为子块开头的连续标题行
    出现时整段剥掉——子块自带「## 3.2 部署」首行时前缀不再重复打头。
    """
    if not titles:
        return ""
    head_titles: List[str] = []
    for ln in (child or "").splitlines():
        m = _HEADING_LINE.match(ln)
        if not m:
            break
        head_titles.append(m.group(1).strip())
    # 链尾（深）与子块开头标题行（浅->深）对齐：最长后缀==前缀的整段剥掉
    k = min(len(titles), len(head_titles))
    while k > 0 and titles[len(titles) - k:] != head_titles[:k]:
        k -= 1
    titles = titles[: len(titles) - k]
    if not titles:
        return ""
    return "【章节：" + " > ".join(titles) + "】\n"


def _split_long_piece(piece: str, target: int) -> List[str]:
    """段落超过 target：先按句末标点切，单句仍超长则硬切。"""
    sentences = [s for s in _SENTENCE_END.split(piece) if s]
    out = []
    for s in sentences:
        while len(s) > target:
            out.append(s[:target])
            s = s[target:]
        if s:
            out.append(s)
    return out


def _split_heading_sections(text: str) -> List[str]:
    """按 Markdown 标题行切段：标题行并入其后的内容段（标题不单独成原子）。

    段按序拼接 == 原文（标题行前的换行留在前一段尾部）；无标题时返回 [text]。
    """
    heads = list(_HEADING.finditer(text))
    if not heads:
        return [text]
    sections: List[str] = []
    if heads[0].start() > 0:
        sections.append(text[: heads[0].start()])
    for i, m in enumerate(heads):
        end = heads[i + 1].start() if i + 1 < len(heads) else len(text)
        sections.append(text[m.start():end])
    return [s for s in sections if s.strip()]


def _flat_chunks(text: str, target: int, overlap: int) -> List[str]:
    """段落 -> 句子 -> 硬切的贪心平铺切块（标题无感），带 overlap。

    保证每块 <= target + overlap；去掉每块前缀的 overlap 部分后按序拼接 == 原文。
    """
    # 先拆成原子：段落分隔符并入前一段，保证原子按序拼接即原文
    atoms: List[str] = []
    parts = _PARA_SPLIT.split(text)  # [段, 分隔, 段, 分隔, ...]
    merged: List[str] = []
    for i, part in enumerate(parts):
        if not part:
            continue
        if i % 2 == 1:  # 分隔符
            if merged:
                merged[-1] += part
        else:
            merged.append(part)
    for piece in merged:
        if len(piece) > target:
            atoms.extend(_split_long_piece(piece, target))
        else:
            atoms.append(piece)

    # 贪心合并相邻原子到接近 target
    chunks: List[str] = []
    current = ""
    for atom in atoms:
        if current and len(current) + len(atom) > target:
            chunks.append(current)
            current = atom
        else:
            current += atom
    if current:
        chunks.append(current)

    # 加 overlap：每块（除首块）前缀重复前一块尾部
    if overlap > 0:
        with_overlap = [chunks[0]]
        for i in range(1, len(chunks)):
            prev = chunks[i - 1]
            prefix = prev[-overlap:] if len(prev) > overlap else ""
            with_overlap.append(prefix + chunks[i])
        chunks = with_overlap

    return chunks


def _split_table_cells(line: str) -> List[str]:
    """`| a | b |` -> ['a', 'b']：去首尾 | 再按 | 切，单元格去空白。"""
    return [c.strip() for c in line.strip().strip("|").split("|")]


def _is_table_separator(line: str) -> bool:
    """分隔行（|---|---|）判定：必须含 | 和 -，且每个单元格都是 :?-+:? 形态。"""
    s = line.strip()
    if "|" not in s or "-" not in s:
        return False
    cells = _split_table_cells(s)
    return bool(cells) and all(_TABLE_SEP_CELL.match(c) for c in cells)


def extract_table_row_entries(text: str) -> List[str]:
    """把 Markdown 表格的每个数据行解析成独立行级条目（纯函数、不限帽）。

    表格 = 表头行（|...|）+ 分隔行（|---|---|）+ 连续数据行；表头取自分隔行
    上一行。条目文本 = 最近章节标题（向上找 markdown 标题行，无则不带前缀）
    + 「列名: 值」按 " | " 拼接；空值列、空列名、整行皆空的数据行跳过。
    无 # 标题时退用表格上方紧邻的平文题名行（≤50 字）作前缀——PDF 抽取文档的
    表格题名是平文行不是标题（「附表2 近岸水质季度均值」，09-21 桌面 20 题复测
    Q7 实捕：行条目丢了表名 token，题面点名「附表2」时 BM25/向量双路都挂不上）。
    有 # 标题时章节优先、平文行不理会（既有行为逐字节不变）。
    非表格内容不产生任何条目；chunk_text 主流程完全不经此函数，行为逐字节不变。
    """
    lines = (text or "").splitlines()
    entries: List[str] = []
    heading = ""
    prev_plain = ""  # 最近一条非空、非标题、非表格行的平文行（表格题名候选）
    i = 0
    while i < len(lines):
        line = lines[i]
        hm = _HEADING_LINE.match(line)
        if hm:
            heading = hm.group(1).strip()
            prev_plain = ""  # 题名不跨章节
            i += 1
            continue
        # 表头候选：当前行是 |...| 且下一行是分隔行
        if (
            _TABLE_ROW.match(line)
            and i + 1 < len(lines)
            and _is_table_separator(lines[i + 1])
        ):
            header = _split_table_cells(line)
            prefix = heading
            if not prefix and prev_plain and len(prev_plain) <= 50 and " | " not in prev_plain:
                prefix = prev_plain  # 平文题名（无 # 标题的 PDF 抽取文档）
            j = i + 2
            while (
                j < len(lines)
                and _TABLE_ROW.match(lines[j])
                and not _is_table_separator(lines[j])  # 防御：分隔行混进数据区不当数据行
            ):
                pairs = [
                    f"{col}: {val}"
                    for col, val in zip(header, _split_table_cells(lines[j]))
                    if col and val  # 空列名/空值列跳过
                ]
                if pairs:
                    entry = " | ".join(pairs)
                    entries.append(f"{prefix} | {entry}" if prefix else entry)
                j += 1
            i = j
            prev_plain = ""  # 题名只用一次：相邻无题名的表不继承上一张表的题名
            continue
        s = line.strip()
        if s and not _TABLE_ROW.match(line):
            prev_plain = s  # 空行/游离表格行不覆盖题名候选
        i += 1
    return entries


def _capped_table_row_entries(text: str) -> List[str]:
    """限帽后的行条目：超 TABLE_ROW_ENTRY_CAP 一行不产，整体回落整表切块。

    限帽口径必须与 expected_chunk_count 用的就是本函数，二者天然一致——
    各算各的会在病态文档上判存失配、每轮启动都重嵌。

    开源版无 table_reconstruct（剥离面）：直接用原文提行条目。
    """
    entries = extract_table_row_entries(text or "")
    if len(entries) > TABLE_ROW_ENTRY_CAP:
        logger.warning(
            "table row entries capped: %d rows > cap %d, falling back to whole-table chunking",
            len(entries), TABLE_ROW_ENTRY_CAP,
        )
        return []
    return entries


def chunk_text(
    text: str,
    target: int = CHILD_TARGET,
    overlap: int = CHILD_OVERLAP,
    parent_target: int = PARENT_TARGET,
) -> List[Tuple[str, List[str]]]:
    """把文本切成父子块结构，返回 [(父块全文, [子块, ...]), ...]。

    保证：
    - 父块 <= parent_target（标题 section 优先，小 section 贪心合并，
      超长 section 按段落/句子/硬切再切）；子块 <= target + overlap；
    - 父块按序拼接 == 原始 strip 后文本；父内子块去掉 overlap 前缀后
      按序拼接 == 父块；
    - 纯函数、确定性：同输入两次调用输出完全一致。
    """
    text = (text or "").strip()
    if not text:
        return []

    sections = _split_heading_sections(text)

    # 父块装配：小 section 贪心合并到接近 parent_target；单 section 超限按现逻辑再切
    parents: List[str] = []
    current = ""
    for sec in sections:
        if len(sec) > parent_target:
            if current:
                parents.append(current)
                current = ""
            parents.extend(_flat_chunks(sec, parent_target, 0))
        elif current and len(current) + len(sec) > parent_target:
            parents.append(current)
            current = sec
        else:
            current += sec
    if current:
        parents.append(current)

    # 父块内切子块（同段落/句子语义逻辑，兄弟子块间带 overlap）
    return [
        (p, _flat_chunks(p, target, overlap) if len(p) > target else [p])
        for p in parents
    ]


def expected_chunk_count(
    text: str,
    target: int = CHILD_TARGET,
    overlap: int = CHILD_OVERLAP,
    parent_target: int = PARENT_TARGET,
) -> int:
    """该内容经 embed_document_chunks 切块后应写入的向量条数（回填判存口径）。

    父子块结构下落库的是子块 + 一行文档级入口行：预期条数 = 子块总数 + 1。
    逐块嵌入中途失败会留下「部分覆盖」：判存必须比对实际条数与预期分块数，
    只看基 id（第 0 块在就算覆盖）会把半截文档判成已覆盖、永远不再回填。

    表格行条目（09-11 表格行结构化索引）计入预期条数：老库启动回填会把
    含表格的长文档判为「缺行条目」整体重嵌一遍——预期后果，本地嵌入模型
    零成本、一次性，重嵌后口径稳定幂等。无表格文档条数与改造前完全一致；
    短文档（<= 阈值）不出行条目（整篇单向量，行信号本来就没被稀释）。
    """
    text = (text or "").strip()
    if not text:
        return 0
    if len(text) <= CHUNK_SIZE_THRESHOLD:
        return 1
    return 1 + len(_capped_table_row_entries(text)) + sum(
        len(children)
        for _, children in chunk_text(text, target=target, overlap=overlap, parent_target=parent_target)
    )


async def compute_document_chunk_embeddings(
    text: str,
    doc_id: str,
    target: int = CHILD_TARGET,
    overlap: int = CHILD_OVERLAP,
    parent_target: int = PARENT_TARGET,
) -> List[dict]:
    """只算不落库：返回 [{'content_id', 'text', 'vec', 'model',
    'parent_content_id', 'chunk_index', 'chunk_text', 'parent_text'}]。

    供「先算后写」的事务化替换（note_embedding_service.embed_note）使用：
    向量服务处于 mock fallback（Ollama 不可用）或任一块算不出向量时返回 []——
    调用方据此不动库（保留旧向量），绝不落半截覆盖。
    """
    from app.services.embedding_service import embedding_service

    text = (text or "").strip()
    if not text:
        return []

    if len(text) <= CHUNK_SIZE_THRESHOLD:
        # 短文档一文档一向量：单父单子，content_id 无 ::chunk:: 后缀，行为与旧版一致
        pieces = [{
            "content_id": doc_id,
            "text": text[:2000],
            "parent_content_id": None,
            "chunk_index": 0,
            "chunk_text": text,
            "parent_text": None,
        }]
    else:
        # 长文档：子块向量之外补一行「文档级入口行」（content_id 无后缀，
        # 与短文档行同形态）——全局提问（总结全文/跨块综合）的语义召回锚点。
        # 嵌入文本=全文前 1000 字（零 LLM 成本；真摘要另立项）。
        pieces = [{
            "content_id": doc_id,
            "text": text[:1000][:2000],
            "parent_content_id": None,
            "chunk_index": None,
            "chunk_text": None,
            "parent_text": None,
        }]
        # ⑦ 面包屑素材：全文标题扫描一次，各子块按新内容偏移取生效标题链
        headings = [(m.start(), len(m.group(1)), m.group(2).strip())
                    for m in _HEADING_FULL.finditer(text)]
        p_off = 0  # 父块在原文的偏移（父块按序拼接 == strip 后文本）
        for p, (parent_text, children) in enumerate(
            chunk_text(text, target=target, overlap=overlap, parent_target=parent_target)
        ):
            c_off = 0  # 子块新内容在父块内的偏移（去 overlap 前缀，与无损拼回同口径）
            for c, child in enumerate(children):
                prev = children[c - 1] if c else ""
                prefix_len = len(prev[-overlap:]) if prev and len(prev) > overlap else 0
                crumb = ""
                if headings:
                    crumb = _breadcrumb_prefix(
                        _heading_chain_at(headings, p_off + c_off + prefix_len), child)
                body = crumb + child
                pieces.append({
                    "content_id": f"{doc_id}{CHUNK_ID_SEP}{p}.{c}",
                    # 嵌入文本保持纯子块（面包屑不入向量）：mega 门禁实捕——面包屑
                    # 进嵌入会同质化同章块、漂移向量排名（mega-q03 深章节双锚点窗
                    # 丢失退化 14→13）。面包屑只进 chunk_text（检索 preview/装配
                    # 展示的 ContextHeader），向量口径与改造前逐字节一致、门禁退化 0
                    "text": child[:2000],
                    "parent_content_id": f"{doc_id}{CHUNK_ID_SEP}{p}",
                    "chunk_index": c,
                    "chunk_text": body,
                    "parent_text": parent_text,
                })
                c_off += len(child) - prefix_len
            p_off += len(parent_text)
        # 表格行级条目：每个数据行一条独立向量，接在子块后排（row:: 独立
        # 命名空间，不与 {p}.{c} 冲突）。既有父/子块不动——整表仍在父块里
        # 保上下文，行条目补的是「低频编号行」的独立召回精度。parent_text
        # 直接带行文本（已含章节标题+列名上下文）：检索端命中后窗口装配
        # 拿的是行文本而不是整表，检索侧零改动。
        for n, entry in enumerate(_capped_table_row_entries(text)):
            pieces.append({
                "content_id": f"{doc_id}{CHUNK_ID_SEP}{TABLE_ROW_ID_PREFIX}{n}",
                "text": entry[:2000],
                "parent_content_id": doc_id,
                "chunk_index": n,
                "chunk_text": entry,
                "parent_text": entry,
            })

    computed: List[dict] = []
    for piece in pieces:
        result = await embedding_service.embed(piece["text"], store=False)
        vec = result.get("embedding") or []
        if result.get("model_used") == "mock/fallback" or not vec:
            return []
        computed.append({**piece, "vec": vec, "model": result["model_used"]})
    return computed


async def embed_document_chunks(
    text: str,
    content_type: str,
    doc_id: str,
    user_id: str,
    target: int = CHILD_TARGET,
    overlap: int = CHILD_OVERLAP,
    parent_target: int = PARENT_TARGET,
) -> int:
    """统一的文档向量写入入口（pipeline 与 backfill 共用）。

    短文档存一条整文档向量；长文档按父子块切，落库的是子块向量
    （content_id 带 CHUNK_ID_SEP 后缀，父块全文冗余在 parent_text 列），
    含表格时再补表格行级条目（row:: 命名空间，见模块 docstring）。
    向量服务处于 mock fallback（Ollama 不可用）时不写库
    （假向量没有检索价值），返回 0。正常返回写入的向量条数。
    """
    from app.services.embedding_service import embedding_service

    computed = await compute_document_chunk_embeddings(
        text, doc_id, target=target, overlap=overlap, parent_target=parent_target
    )
    for item in computed:
        embedding_service._store_embedding(
            item["text"], item["vec"], content_type, item["content_id"], user_id, item["model"],
            parent_content_id=item["parent_content_id"],
            chunk_index=item["chunk_index"],
            chunk_text=item["chunk_text"],
            parent_text=item["parent_text"],
        )
    return len(computed)
