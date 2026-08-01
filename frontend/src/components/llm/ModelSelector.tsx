import { useEffect, useMemo, useRef } from 'react';
import { ChevronDown, Server, Cpu } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getOllamaModels } from '@/api/llm';
import { useSettings } from '@/store/settings';
import { useAuth } from '@/hooks/useAuth';

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

export function ModelSelector({
  value,
  onChange,
  className = '',
  placeholder = '选择模型',
  disabled = false,
}: ModelSelectorProps) {
  const ollamaModel = useSettings((s) => s.ollamaModel);
  const activeProvider = useSettings((s) => s.activeProvider);
  const activeModel = useSettings((s) => s.activeModel);
  const { isLoggedIn } = useAuth();

  const { data: ollamaModelsData } = useQuery({
    queryKey: ['ollamaModels'],
    queryFn: getOllamaModels,
    staleTime: 5 * 60 * 1000,
  });

  const localOptions = useMemo(() => {
    const base = [...LOCAL_MODELS];
    const push = (model: string, description: string) => {
      const id = `ollama-${model}`;
      if (model && !base.some((m) => m.id === id)) {
        base.push({ id, name: `${model}（本地）`, provider: 'ollama', description });
      }
    };
    // 设置里配置的自定义 Ollama 模型
    push(ollamaModel, '自定义 Ollama 模型');
    // Ollama 服务实际可用的模型
    ollamaModelsData?.models?.forEach((m) => push(m, 'Ollama 可用模型'));
    return base;
  }, [ollamaModel, ollamaModelsData]);

  // 全局 LLM 控制台（settings store）里选择的模型，映射回此选择器的选项 id，
  // 让各页面默认跟随它
  const consoleDefaultId = useMemo(() => {
    if (!activeModel) return '';
    if ((activeProvider || '').toLowerCase() === 'ollama') return `ollama-${activeModel}`;
    return '';
  }, [activeProvider, activeModel]);

  const hasSetDefault = useRef(false);
  useEffect(() => {
    if (!hasSetDefault.current && !value && isLoggedIn) {
      const fill = consoleDefaultId || localOptions[0]?.id || '';
      if (fill) {
        hasSetDefault.current = true;
        onChange(fill);
      }
    }
  }, [value, consoleDefaultId, localOptions, onChange, isLoggedIn]);

  const selectedModel = useMemo(() => {
    if (!value) return null;
    return localOptions.find((m) => m.id === value) || null;
  }, [value, localOptions]);

  return (
    <div className={`relative ${className}`}>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <select
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            className="w-full appearance-none pl-9 pr-8 py-2 rounded-[2px] bg-white/[0.03] border border-white/[0.08] text-sm text-text-primary focus:outline-none focus:border-info disabled:opacity-50"
          >
            {!value && <option value="">{placeholder}</option>}

            {localOptions.length > 0 && (
              <optgroup label="🏠 本地模型（免费）">
                {localOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} · 免费
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <Cpu className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
        </div>
      </div>

      {selectedModel && (
        <div className="mt-1.5 flex items-center gap-2 text-xs text-text-muted">
          <Server className="w-3 h-3 text-success" />
          <span className="text-success">本地调用，不计费</span>
        </div>
      )}
    </div>
  );
}

export default ModelSelector;
