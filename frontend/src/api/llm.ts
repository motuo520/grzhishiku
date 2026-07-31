import api from './client';
import { llmBase } from './unifiedSync';

export interface LLMProvider {
  provider: string;
  model: string;
  connected: boolean;
  latency: number;
  icon_color: string;
  available: boolean;
}

export interface LLMStatusResponse {
  active_provider: string;
  active_model: string;
  connected: boolean;
  latency: number;
  providers: LLMProvider[];
}

export interface ActiveProvider {
  provider: string;
  model: string;
}

export interface SetActiveProviderRequest {
  provider: string;
  model: string;
}

export interface LLMTestResult {
  provider: string;
  model: string;
  connected: boolean;
  latency: number;
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

export const getLLMStatus = () => api.get<LLMStatusResponse>(`${llmBase()}/llm/status`).then((res) => res.data);

export const getModelCatalog = () =>
  api.get<LLMModelCatalogResponse>(`${llmBase()}/llm/models/catalog`).then((res) => res.data);

// Ollama 模型列表始终查本机（桌面端用自己的 Ollama，与云端无关）
export const getOllamaModels = () =>
  api.get<OllamaModelsResponse>('/api/v1/llm/providers/ollama/models').then((res) => res.data);

export const getActiveProvider = () => api.get<ActiveProvider>('/api/v1/llm/active').then((res) => res.data);

export const setActiveProvider = (provider: string, model: string) =>
  api.post<ActiveProvider>('/api/v1/llm/active', { provider, model }).then((res) => res.data);

export const testProvider = (provider: string) =>
  api.post<LLMTestResult>(`/api/v1/llm/providers/${provider}/test`).then((res) => res.data);

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
