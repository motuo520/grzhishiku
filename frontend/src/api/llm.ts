import api from './client';

export interface LLMProvider {
  provider: string;
  /** 身份 slug（deepseek/dashscope/...）；provider 字段是显示名，写库/匹配必须用 slug */
  slug?: string;
  model: string;
  connected: boolean;
  latency: number;
  icon_color: string;
  available: boolean;
}

export interface LLMStatusResponse {
  active_provider: string;
  /** 显示名（如「通义（阿里）」），仅用于展示 */
  active_provider_name?: string;
  active_model: string;
  connected: boolean;
  latency: number;
  providers: LLMProvider[];
}

export interface ActiveProvider {
  provider: string;
  model: string;
}

export interface LLMTestResult {
  provider: string;
  model: string;
  connected: boolean;
  latency: number;
  reason?: string;
}

export interface OllamaModelsResponse {
  models: string[];
}

export interface LLMModelCatalogItem {
  id: string;
  name: string;
  provider: string;
  provider_model_id: string;
  description?: string;
  is_system: boolean;
  supports_streaming: boolean;
  context_length: number;
  price_input_per_1k: number;
  price_output_per_1k: number;
  currency: string;
}

export interface LLMModelCatalogResponse {
  models: LLMModelCatalogItem[];
}

/**
 * 用户态价格展示：按典型一次对话估算每次费用，
 * 不直接暴露按 1K token 计费的单价，避免与厂商官网价格直接对比。
 * 典型用量按 RAG 场景约 5 万输入 + 1 千输出 token 估（用户实测口径 5–10 万，取下限再让三分之一）。
 */
export function formatPerCallPrice(m: {
  price_input_per_1k?: number;
  price_output_per_1k?: number;
  currency?: string;
}): string {
  const pin = m.price_input_per_1k || 0;
  const pout = m.price_output_per_1k || 0;
  if (pin <= 0 && pout <= 0) return '免费';
  // 展示口径（08-08 定稿 v3）：典型对话估算（约 8k 输入 + 500 输出/次，
  // 非全量 RAG 大上下文的极端值），两位小数按次展示，观感轻；
  // 实际扣费仍按 token 实算，用量分析/账单页可对账
  const perCall = pin * 8 + pout * 0.5;
  const symbol = m.currency === 'USD' ? '$' : '¥';
  const shown = perCall < 0.01 ? perCall.toFixed(3) : perCall.toFixed(2);
  return `约 ${symbol}${shown}/次`;
}

/**
 * 清洗模型描述里的供应商内幕字样（聚合商 opencode、「上游免费模型」「每日免费额度池」）。
 * 仅用于前端显示层，不改动后端数据。
 * 例：'opencode 上游免费模型，每日免费额度池（对话前 N 次/天免扣费）' → ''
 *     'OpenCode 聚合的 DeepSeek 旗舰' → 'DeepSeek 旗舰'
 */
export function sanitizeModelDescription(desc?: string): string {
  if (!desc) return '';
  return desc
    .replace(/opencode/gi, '')
    .replace(/聚合的/g, '')
    .replace(/上游免费模型/g, '')
    .replace(/每日免费额度池/g, '')
    .replace(/[（(]对话前[^）)]*[）)]/g, '')
    .replace(/^[\s，,、]+/, '')
    .replace(/[\s，,、。；;]+$/, '')
    .trim();
}

/** 目录模型可见性（0.2.67 起两端同口径）：BYOK 总开关关闭时隐藏 BYOK 自付行——
 * 但系统行（is_system，平台按量/免费池）不吃这个开关：两套分离，平台通道与
 * BYOK 自付互不隶属，免费池/按量模型不开 BYOK 也该可见（08-22 拍板；此前连坐
 * 导致网页端新用户全站只剩本地 0.5b 可选）。
 * disabledIds：用户在设置里单独关闭的 BYOK 模型（单模型开关），一并过滤。
 * excludePriced：桌面端为 true——有价模型是平台按量层，走 ☁️平台模型分组
 * （platform: 通道转发云端），不混进 BYOK 自付分组。 */
export function filterVisibleCatalogModels<T extends { provider?: string; id?: string; is_system?: boolean; price_input_per_1k?: number; price_output_per_1k?: number }>(
  models: T[],
  byokEnabled: boolean,
  disabledIds?: Set<string>,
  excludePriced?: boolean,
  byokPickedIds?: Set<string>,
): T[] {
  let visible = byokEnabled
    ? models
    : models.filter((m) => (m.provider || '').toLowerCase() === 'ollama' || m.is_system);
  if (excludePriced) {
    visible = visible.filter(
      (m) => (m.price_input_per_1k || 0) <= 0 && (m.price_output_per_1k || 0) <= 0
    );
  }
  // BYOK 可见性收紧（09-05 本人拍板）：给了已选清单时，非系统/非本地行只显示
  // 用户在 BYOK 控制台选中的——未填 key 未选型的厂商行一律不出现
  if (byokPickedIds) {
    visible = visible.filter(
      (m) => (m.provider || '').toLowerCase() === 'ollama' || m.is_system || (m.id && byokPickedIds.has(m.id))
    );
  }
  if (!disabledIds || disabledIds.size === 0) return visible;
  return visible.filter((m) => !m.id || !disabledIds.has(m.id));
}

/** 计费标签统一口径（08-15 晚拍板，两套分离）：
 * 本地 ollama 模型=「免费」；平台免费模型（is_system 且价格为 0）=「免费」；
 * 平台按量模型（is_system 且有价）=按次估算价；其余（用户自填 key）=「BYOK 自付」。 */
export function modelBillingLabel(m: {
  provider?: string;
  is_system?: boolean;
  price_input_per_1k?: number;
  price_output_per_1k?: number;
  currency?: string;
}): string {
  if ((m.provider || '').toLowerCase() === 'ollama') return '免费';
  const pin = m.price_input_per_1k || 0;
  const pout = m.price_output_per_1k || 0;
  if (pin <= 0 && pout <= 0) return m.is_system ? '免费' : 'BYOK 自付';
  return formatPerCallPrice(m);
}

export const getLLMStatus = () => api.get<LLMStatusResponse>('/api/v1/llm/status').then((res) => res.data);

export const getModelCatalog = () =>
  api.get<LLMModelCatalogResponse>('/api/v1/llm/models/catalog').then((res) => res.data);

// 用量分析（Pro）：按模型聚合近 N 天调用，含桌面 BYOK 本地记账
export interface UsageSummaryItem {
  model_id: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  price: number;
  byok: boolean;
}

export interface UsageSummaryResponse {
  days: number;
  models: UsageSummaryItem[];
}

export const getUsageSummary = (days = 30) =>
  api.get<UsageSummaryResponse>('/api/v1/billing/usage/summary', { params: { days } }).then((res) => res.data);

export const getOllamaModels = () =>
  api.get<OllamaModelsResponse>('/api/v1/llm/providers/ollama/models').then((res) => res.data);

export const getActiveProvider = () => api.get<ActiveProvider>('/api/v1/llm/active').then((res) => res.data);

export const setActiveProvider = (provider: string, model: string) =>
  api.post<ActiveProvider>('/api/v1/llm/active', { provider, model }).then((res) => res.data);

// 测试输入框里尚未保存的 key（先测后存）
export const testProviderWithKey = (provider: string, apiKey: string) =>
  api.post<LLMTestResult>(`/api/v1/llm/providers/${provider}/test`, { api_key: apiKey }).then((res) => res.data);

export interface SummarizeRequest {
  text: string;
  length?: 'short' | 'medium' | 'long';
  model?: string;
}

export interface SummarizeResponse {
  summary: string;
  original_length: number;
  summary_length: number;
  compression_ratio: number;
  model_used: string;
  cached: boolean;
}

export const summarizeText = (data: SummarizeRequest) =>
  api.post<SummarizeResponse>('/api/v1/llm/summarize', data).then((res) => res.data);

export interface ExtractTagsRequest {
  text: string;
  max_tags?: number;
  suggest_categories?: boolean;
  model?: string;
}

export interface ExtractTagsResponse {
  tags: string[];
  categories?: string[];
  model_used: string;
}

export const extractTags = (data: ExtractTagsRequest) =>
  api.post<ExtractTagsResponse>('/api/v1/llm/extract-tags', data).then((res) => res.data);

export interface CompleteRequest {
  prompt: string;
  system_prompt?: string;
  model?: string;
  task_type?: string;
}

export interface CompleteResponse {
  text: string;
  model_used: string;
}

export const completeText = (data: CompleteRequest) =>
  api.post<CompleteResponse>('/api/v1/llm/complete', data).then((res) => res.data);
