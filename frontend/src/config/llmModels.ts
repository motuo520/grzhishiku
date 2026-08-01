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
    model: 'qwen2.5:0.5b',
    icon: Server,
    color: 'text-success',
    desc: '本地轻量小模型，约 400MB',
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
    const m = ollamaModel || 'qwen2.5:0.5b';
    if (m === 'qwen2.5:0.5b') return 'ollama-qwen2.5-0.5b';
    if (m === 'smollm2:135m') return 'ollama-smollm2';
    return `ollama-${m}`;
  }
  if (selectorId === 'ollama-smollm2') {
    return 'ollama-smollm2';
  }
  // For cloud models, the selector id matches the backend ModelConfig key.
  return selectorId;
}
