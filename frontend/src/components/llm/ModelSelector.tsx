import { useEffect, useMemo, useRef } from 'react';
import { ChevronDown, Server, Cloud, Cpu, Wallet, AlertCircle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getModelCatalog, LLMModelCatalogItem } from '@/api/llm';
import { useSettings } from '@/store/settings';
import { useAuth } from '@/hooks/useAuth';
import { useLLMBalance } from '@/hooks/useLLMBalance';

export type TaskType = 'chat' | 'summary' | 'analysis' | 'creative' | 'coding' | 'reasoning' | 'default';

export interface ModelSelectorProps {
  value?: string;
  onChange: (modelId: string) => void;
  taskType?: TaskType;
  showPrice?: boolean;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  onLoginClick?: () => void;
}

interface LocalModelOption {
  id: string;
  name: string;
  provider: 'ollama';
  description: string;
}

const LOCAL_MODELS: LocalModelOption[] = [
  { id: 'ollama-qwen2.5-0.5b', name: 'Qwen 2.5 0.5B（本地）', provider: 'ollama', description: '本地轻量小模型' },
];

function isLocalModel(id?: string): boolean {
  return !!id && id.startsWith('ollama-');
}

function modelPriceScore(m: LLMModelCatalogItem): number {
  return (m.price_input_per_1k || 0) + (m.price_output_per_1k || 0);
}

function recommendSystemModel(models: LLMModelCatalogItem[], taskType: TaskType): string | null {
  // Exclude local (Ollama) models from auto-recommendation: they are listed
  // separately under "本地模型" and are unavailable when the local service is down.
  const cloudModels = models.filter((m) => m.provider !== 'ollama' && !m.id.startsWith('ollama-'));
  if (cloudModels.length === 0) return null;
  const sorted = [...cloudModels].sort((a, b) => modelPriceScore(a) - modelPriceScore(b));
  switch (taskType) {
    case 'summary':
    case 'analysis':
    case 'chat':
    case 'default':
      // Recommend cheapest capable model
      return sorted[0]?.id || null;
    case 'coding':
    case 'reasoning':
    case 'creative':
      // Recommend most capable (most expensive) among top half
      return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length / 2))]?.id || null;
    default:
      return sorted[0]?.id || null;
  }
}

export function ModelSelector({
  value,
  onChange,
  taskType = 'default',
  showPrice = true,
  className = '',
  placeholder = '选择模型',
  disabled = false,
  onLoginClick,
}: ModelSelectorProps) {
  const { data: catalog, isLoading } = useQuery({
    queryKey: ['llmModelCatalog'],
    queryFn: getModelCatalog,
    staleTime: 5 * 60 * 1000,
  });
  const { balance: balanceSummary } = useLLMBalance();
  const ollamaModel = useSettings((s) => s.ollamaModel);
  const activeProvider = useSettings((s) => s.activeProvider);
  const activeModel = useSettings((s) => s.activeModel);
  const { isLoggedIn } = useAuth();

  const systemModels = catalog?.models || [];

  const localOptions = useMemo(() => {
    const base = [...LOCAL_MODELS];
    // If user has a different Ollama model in settings, offer it as well
    const customId = `ollama-${ollamaModel}`;
    if (ollamaModel && !base.some((m) => m.id === customId)) {
      base.push({
        id: customId,
        name: `${ollamaModel}（本地）`,
        provider: 'ollama',
        description: '自定义 Ollama 模型',
      });
    }
    return base;
  }, [ollamaModel]);

  // The model the user picked in the global LLM console (settings store),
  // mapped back to this selector's option id by (provider, provider_model_id),
  // so every page defaults to it instead of an unrelated cheapest pick.
  const consoleDefaultId = useMemo(() => {
    if (!activeModel) return '';
    const match = systemModels.find(
      (m) =>
        m.provider?.toLowerCase() === (activeProvider || '').toLowerCase() &&
        m.provider_model_id === activeModel
    );
    if (match) return match.id;
    if ((activeProvider || '').toLowerCase() === 'ollama') return `ollama-${activeModel}`;
    return '';
  }, [activeProvider, activeModel, systemModels]);

  const recommendedId = useMemo(() => {
    const sysRec = recommendSystemModel(systemModels, taskType);
    return sysRec || localOptions[0]?.id || '';
  }, [systemModels, localOptions, taskType]);

  const hasSetDefault = useRef(false);
  useEffect(() => {
    if (!hasSetDefault.current && !value && isLoggedIn && !isLoading) {
      // Prefer the console-selected model; only fall back to the cheapest
      // recommendation when there is no console selection.
      const fill = consoleDefaultId || recommendedId;
      if (fill) {
        hasSetDefault.current = true;
        onChange(fill);
      }
    }
  }, [value, consoleDefaultId, recommendedId, onChange, isLoggedIn, isLoading]);

  const selectedModel = useMemo(() => {
    if (!value) return null;
    if (isLocalModel(value)) {
      return localOptions.find((m) => m.id === value) || null;
    }
    return systemModels.find((m) => m.id === value) || null;
  }, [value, localOptions, systemModels]);

  const renderOption = (id: string, name: string, desc: string, priceNode?: React.ReactNode) => (
    <option key={id} value={id}>
      {name} {priceNode ? `· ${priceNode}` : ''}
    </option>
  );

  return (
    <div className={`relative ${className}`}>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <select
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled || isLoading}
            className="w-full appearance-none pl-9 pr-8 py-2 rounded-xl bg-white/[0.03] border border-white/[0.08] text-sm text-text-primary focus:outline-none focus:border-info disabled:opacity-50"
          >
            {!value && <option value="">{placeholder}</option>}

            {localOptions.length > 0 && (
              <optgroup label="🏠 本地模型（免费）">
                {localOptions.map((m) =>
                  renderOption(m.id, m.name, m.description, '免费')
                )}
              </optgroup>
            )}

            {systemModels.length > 0 && (
              <optgroup label="🌐 系统模型（按量计费）">
                {systemModels.map((m) => {
                  const isRec = m.id === recommendedId;
                  const symbol = m.currency === 'USD' ? '$' : '¥';
                  const priceLabel = showPrice
                    ? `${symbol}${m.price_input_per_1k?.toFixed(3) || '0'}/${symbol}${m.price_output_per_1k?.toFixed(3) || '0'} per 1K`
                    : '';
                  return (
                    <option key={m.id} value={m.id}>
                      {m.name} {priceLabel} {isRec ? '· 推荐' : ''}
                    </option>
                  );
                })}
              </optgroup>
            )}
          </select>
          <Cpu className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
        </div>
      </div>

      {selectedModel && (
        <div className="mt-1.5 flex items-center gap-2 text-xs text-text-muted">
          {isLocalModel(selectedModel.id) ? (
            <>
              <Server className="w-3 h-3 text-emerald-400" />
              <span className="text-emerald-400">本地调用，不计费</span>
            </>
          ) : (
            <>
              <Cloud className="w-3 h-3 text-info" />
              <span>{(selectedModel as LLMModelCatalogItem).description || '按实际调用量扣费'}</span>
            </>
          )}
        </div>
      )}

      {/* Balance info */}
      {!isLocalModel(value) && balanceSummary && (
        balanceSummary.balance < 0.1 ? (
          <div className="mt-1.5 flex items-center gap-1.5 text-xs text-amber-400">
            <AlertCircle className="w-3 h-3" />
            <span>余额不足，<a href="/topup" className="underline hover:text-amber-300">去充值</a></span>
          </div>
        ) : (
          <div className="mt-1.5 flex items-center gap-1.5 text-xs text-text-muted">
            <Wallet className="w-3 h-3 text-emerald-400" />
            <span>可用余额 ¥{balanceSummary.balance.toFixed(2)}，<a href="/topup" className="underline hover:text-text-primary">充值</a></span>
          </div>
        )
      )}
    </div>
  );
}

export default ModelSelector;
