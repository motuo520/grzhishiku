# -*- coding: utf-8 -*-
"""中文感知的语义切块 + 文档级向量化存储约定。

- chunk_text：纯函数，段落 -> 句子 -> 硬切，带 overlap，可无损拼回。
- embed_document_chunks：统一的文档向量写入入口。短文档（<= CHUNK_SIZE_THRESHOLD）
  保持一文档一向量（现状）；长文档切块，块 content_id = f"{doc_id}::chunk::{n}"，
  content_type 与文档一致，检索端据此把块归属回原文档。
"""

import re
from typing import List

# 文档长度超过此值才切块；不超过则维持一文档一向量，小文档行为完全不变
CHUNK_SIZE_THRESHOLD = 1500
# 块向量 content_id 的分隔符：{doc_id}::chunk::{n}
CHUNK_ID_SEP = "::chunk::"

_PARA_SPLIT = re.compile(r"(\n\s*\n)")
_SENTENCE_END = re.compile(r"(?<=[。！？；.!?])")


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


def chunk_text(text: str, target: int = 600, overlap: int = 80) -> List[str]:
    """把文本切成带 overlap 的块。

    保证：
    - 每块长度 <= target + overlap（overlap 部分是与前一块重复的前缀）；
    - 去掉每块前缀的 overlap 部分后按序拼接 == 原始 strip 后文本；
    - 相邻块共享至多 overlap 个字符（前一块尾部）。
    """
    text = (text or "").strip()
    if not text:
        return []

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


async def embed_document_chunks(
    text: str,
    content_type: str,
    doc_id: str,
    user_id: str,
    target: int = 600,
    overlap: int = 80,
) -> int:
    """统一的文档向量写入入口（pipeline 与 backfill 共用）。

    短文档存一条整文档向量；长文档切块后每块存一条，块 content_id 带
    CHUNK_ID_SEP 后缀。向量服务处于 mock fallback（Ollama 不可用）时不写库
    （假向量没有检索价值），返回 0。正常返回写入的向量条数。
    """
    from app.services.embedding_service import embedding_service

    text = (text or "").strip()
    if not text:
        return 0

    if len(text) <= CHUNK_SIZE_THRESHOLD:
        pieces = [(doc_id, text[:2000])]
    else:
        pieces = [
            (f"{doc_id}{CHUNK_ID_SEP}{i}", chunk[:2000])
            for i, chunk in enumerate(chunk_text(text, target=target, overlap=overlap))
        ]

    stored = 0
    for content_id, piece in pieces:
        result = await embedding_service.embed(piece, store=False)
        vec = result.get("embedding") or []
        if result.get("model_used") == "mock/fallback" or not vec:
            break
        embedding_service._store_embedding(
            piece, vec, content_type, content_id, user_id, result["model_used"]
        )
        stored += 1
    return stored
