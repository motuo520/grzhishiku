/**
 * AI 回答展示层净化（08-25）：小模型会编造引用链接格式
 * `[1](file:proof/<uuid>)`、`[2](http://...)` ——这些链接一律是幻觉，
 * 引用只许 [n] 纯编号（后端 system prompt 已硬规则，此处做展示层兜底，
 * 顺带清洗历史消息）。
 */
export const sanitizeAiText = (text: string): string => {
  if (!text) return text;
  return (
    text
      // [n](file:...) / [n](proof/...) / [n](http...) → [n]
      .replace(/(\[\d+\])\s*\((?:file|proof|https?)[^)]*\)/gi, '$1')
      // 残留的独立 (file:...) / (proof/...) 伪链接
      .replace(/\((?:file|proof):[^)]*\)/gi, '')
  );
};
