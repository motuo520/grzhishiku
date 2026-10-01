import { Server } from 'lucide-react';

export interface LLMModelConfig {
  id: string;
  name: string;
  provider: string;
  model: string;
  icon: React.ElementType;
  color: string;
  desc: string;
  tags: string[];
  context: string;
  requiresKey: boolean;
  keyField?: string;
  keyLabel?: string;
}

export const LLM_MODELS: LLMModelConfig[] = [
  {
    id: 'ollama',
    name: 'Ollama 本地',
    provider: 'ollama',
    model: 'qwen3.5:0.8b',
    icon: Server,
    color: 'text-success',
    desc: '本地轻量小模型，约 1GB',
    tags: ['本地', '低延迟', '中文'],
    context: '32K',
    requiresKey: false,
  },
  {
    id: 'ollama-smollm2',
    name: 'SmolLM2 135M 本地',
    provider: 'ollama',
    model: 'smollm2:135m',
    icon: Server,
    color: 'text-success',
    desc: '本地玩具级模型，约 90MB，英文为主',
    tags: ['本地', '低延迟', '玩具'],
    context: '8K',
    requiresKey: false,
  },
];

export const LLM_MODEL_MAP: Record<string, LLMModelConfig> = Object.fromEntries(
  LLM_MODELS.map((m) => [m.id, m])
);

export function getModelByProviderModel(provider: string, model: string): LLMModelConfig | undefined {
  return LLM_MODELS.find(
    (m) => m.provider === provider.toLowerCase() && m.model === model
  );
}

export function getModelIdByProviderModel(provider: string, model: string): string {
  const exact = getModelByProviderModel(provider, model);
  if (exact) return exact.id;

  // Fallback: match by provider only
  const byProvider = LLM_MODELS.find((m) => m.provider === provider.toLowerCase());
  if (byProvider) return byProvider.id;

  return 'ollama';
}

/** Map a frontend selector id to the backend `preferred_model` identifier. */
export function getBackendModelId(selectorId: string, ollamaModel: string): string {
  if (selectorId === 'ollama') {
    const m = ollamaModel || 'qwen3.5:0.8b';
    if (m === 'qwen3.5:0.8b') return 'ollama-qwen3.5-0.8b';
    if (m === 'smollm2:135m') return 'ollama-smollm2';
    return `ollama-${m}`;
  }
  if (selectorId === 'ollama-smollm2') {
    return 'ollama-smollm2';
  }
  // For cloud models, the selector id matches the backend ModelConfig key.
  return selectorId;
}

/** `ollama-qwen3.5-0.8b` ↔ `qwen3.5:0.8b` 形态归一（移植主仓同口径）。 */
export function normalizeOllamaModelName(model: string): string {
  let m = model;
  if (m.startsWith('ollama-')) m = m.slice('ollama-'.length);
  if (m.includes(':')) return m;
  // 短横形只把「名-标签」之间的那个短横转回冒号：标签段以数字开头（0.8b / 135m / 7b），
  // 名字段里的短横（bge-m3、phi4-mini 这类无标签名）不动
  const idx = m.search(/-(?=[0-9][A-Za-z0-9.]*$)/);
  if (idx > 0) return `${m.slice(0, idx)}:${m.slice(idx + 1)}`;
  return m;
}
