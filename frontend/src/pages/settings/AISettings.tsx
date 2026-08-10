import { FC, useState, useEffect, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { settingsApi, UserSettings } from '@/api/settings';
import { getLLMStatus, getOllamaModels, getModelCatalog } from '@/api/llm';
import {
  Brain, Loader2, Check, AlertTriangle,
  Server,
  Bot, TestTube, ArrowRightCircle
} from 'lucide-react';
import { apiClient } from '@/api/client';
import { useSettings } from '@/store/settings';

const PROVIDER_ICONS: Record<string, React.ElementType> = {
  ollama: Server,
};

const FALLBACK_OLLAMA_MODELS = ['qwen2.5:0.5b'];

const AISettings: FC = () => {
  const [selectedModel, setSelectedModel] = useState('ollama');
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(2048);
  const [localEnabled, setLocalEnabled] = useState(true);
  const [modelRoutingEnabled, setModelRoutingEnabled] = useState(true);
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434');
  const [ollamaModel, setOllamaModel] = useState('qwen2.5:0.5b');

  const setActiveProvider = useSettings((state) => state.setActiveProvider);
  const queryClient = useQueryClient();

  // UI state
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Routing preview
  const [previewText, setPreviewText] = useState('');
  const [previewResult, setPreviewResult] = useState<any>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings', 'ai'],
    queryFn: () => settingsApi.getSettings().then(r => r.data),
  });

  const { data: status } = useQuery({
    queryKey: ['llmStatus'],
    queryFn: getLLMStatus,
    staleTime: 30000,
  });

  const { data: catalog, isLoading: catalogLoading } = useQuery({
    queryKey: ['llmModelCatalog'],
    queryFn: getModelCatalog,
    staleTime: 60000,
  });

  const ollamaAvailable = status?.providers?.some(
    (p) => p.provider.toLowerCase() === 'ollama' && (p.connected || p.available)
  ) ?? false;

  const { data: ollamaModelsData } = useQuery({
    queryKey: ['ollamaModels'],
    queryFn: getOllamaModels,
    enabled: ollamaAvailable,
    staleTime: 60000,
  });

  const ollamaModels = ollamaModelsData?.models?.length ? ollamaModelsData.models : FALLBACK_OLLAMA_MODELS;

  useEffect(() => {
    if (settings?.ai) {
      const ai = settings.ai;
      // 以 ai.active_provider/active_model 为准（模型控制台/聊天栏选择的落点），
      // 在 catalog 里按 provider + provider_model_id 匹配，保证各处显示一致
      const activeCat = ai.active_provider && ai.active_model
        ? catalog?.models.find(
            (m) =>
              m.provider === ai.active_provider &&
              m.provider_model_id === ai.active_model
          )
        : undefined;
      const derivedModel = activeCat?.id || ai.model || 'ollama-qwen2.5-0.5b';
      setSelectedModel(derivedModel);
      setTemperature(settings.ai.temperature ?? 0.7);
      setMaxTokens(settings.ai.max_tokens ?? 2048);
      setLocalEnabled(settings.ai.local_enabled ?? true);
      setModelRoutingEnabled(settings.ai.model_routing_enabled ?? true);
      setOllamaUrl(settings.ai.ollama_url || 'http://localhost:11434');
      setOllamaModel(settings.ai.ollama_model || 'qwen2.5:0.5b');
    }
  }, [settings, catalog]);

  const selectedConfig = catalog?.models.find((m) => m.id === selectedModel);

  const saveMutation = useMutation({
    mutationFn: (data: Partial<UserSettings>) => settingsApi.updateSettings(data),
    onSuccess: () => {
      showToast('AI 设置已保存', 'success');
      queryClient.invalidateQueries({ queryKey: ['settings', 'ai'] });
      queryClient.invalidateQueries({ queryKey: ['llmStatus'] });
      if (selectedConfig) {
        const provider = selectedConfig.provider;
        const activeModel = provider === 'ollama' ? ollamaModel : selectedConfig.provider_model_id;
        setActiveProvider(provider, activeModel);
      }
    },
    onError: (error: any) => showToast(error?.message || '保存失败', 'error'),
  });

  const handleSave = () => {
    if (!selectedConfig) {
      showToast('请选择有效的模型', 'error');
      return;
    }

    if (temperature < 0 || temperature > 1) {
      showToast('Temperature 必须在 0 到 1 之间', 'error');
      return;
    }

    if (maxTokens < 256 || maxTokens > 8192) {
      showToast('最大令牌数必须在 256 到 8192 之间', 'error');
      return;
    }

    // Ollama 地址前端纵深校验（后端仍须白名单/禁重定向防 SSRF）
    if (ollamaUrl.trim()) {
      try {
        const parsedUrl = new URL(ollamaUrl);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
          showToast('Ollama 地址仅支持 http 或 https 协议', 'error');
          return;
        }
      } catch {
        showToast('请输入有效的 Ollama 地址', 'error');
        return;
      }
    }

    const provider = selectedConfig.provider;
    const activeModel = provider === 'ollama' ? ollamaModel : selectedConfig.provider_model_id;

    saveMutation.mutate({
      ai: {
        model: selectedModel,
        active_provider: provider,
        active_model: activeModel,
        temperature,
        max_tokens: maxTokens,
        local_enabled: localEnabled,
        model_routing_enabled: modelRoutingEnabled,
        ollama_url: ollamaUrl,
        ollama_model: ollamaModel,
      },
    });
  };

  const runRoutePreview = useCallback(async () => {
    if (!previewText.trim()) return;
    setPreviewLoading(true);
    try {
      const token = apiClient.getToken();
      const res = await fetch('/api/v1/llm/route', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : '',
        },
        body: JSON.stringify({ message: previewText, brain_side: 'both', sensitivity: 'low', task_type: 'chat' }),
      });
      if (!res.ok) {
        throw new Error(`路由预览失败（${res.status}）`);
      }
      const data = await res.json();
      setPreviewResult(data);
    } catch (e: any) {
      setPreviewResult(null);
      showToast(e?.message || '路由预览失败，请检查后端 LLM 服务', 'error');
    } finally {
      setPreviewLoading(false);
    }
  }, [previewText]);

  if (isLoading || catalogLoading) {
    return (
      <div className="glass-card p-8 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-info" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-[2px] border ${
          toast.type === 'success'
            ? 'bg-success/20 border-success/30 text-success'
            : 'bg-danger/20 border-danger/30 text-danger'
        }`}>
          <div className="flex items-center gap-2">
            {toast.type === 'success' ? <Check size={16} /> : <AlertTriangle size={16} />}
            <span className="text-sm">{toast.message}</span>
          </div>
        </div>
      )}

      {/* Model Selection */}
      <section className="glass-card p-6">
        <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <Brain size={18} className="text-fusion-primary" />
          模型选择
        </h2>
        <div className="space-y-3">
          {catalog?.models.map((m) => {
            const Icon = PROVIDER_ICONS[m.provider] || Bot;
            const isSelected = selectedModel === m.id;
            return (
              <label
                key={m.id}
                className={`flex items-start gap-3 p-4 rounded-[2px] border cursor-pointer transition-all ${
                  isSelected
                    ? 'border-fusion-primary/40 bg-fusion-primary/5'
                    : 'border-white/[0.08] hover:border-white/[0.15]'
                }`}
              >
                <input
                  type="radio"
                  name="model"
                  value={m.id}
                  checked={isSelected}
                  onChange={() => setSelectedModel(m.id)}
                  className="mt-1 accent-fusion-primary"
                />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon size={16} className={isSelected ? 'text-fusion-primary' : 'text-text-secondary'} />
                      <div className="text-sm font-medium text-text-primary">{m.name}</div>
                    </div>
                  </div>
                  <div className="text-xs text-text-secondary mt-0.5">{m.description}</div>
                </div>
              </label>
            );
          })}
          {!catalog?.models.length && (
            <div className="text-sm text-text-secondary">暂无可用的模型配置</div>
          )}
        </div>
      </section>

      {/* Routing Preview */}
      <section className="glass-card p-6">
        <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <ArrowRightCircle size={18} className="text-fusion-primary" />
          模型路由预览
        </h2>
        <p className="text-xs text-text-secondary mb-3">
          输入一段文本，系统会根据内容特征自动推荐最合适的模型。
        </p>
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={previewText}
            onChange={(e) => setPreviewText(e.target.value)}
            placeholder="输入示例文本..."
            className="flex-1 bg-bg-tertiary border border-border-color rounded-[2px] px-3 py-2 text-sm text-text-primary placeholder-text-secondary focus:outline-none focus:border-info"
          />
          <button
            onClick={runRoutePreview}
            disabled={previewLoading || !previewText.trim()}
            className="px-3 py-2 rounded-[2px] bg-info/10 border border-info/30 text-info hover:bg-info/20 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {previewLoading ? <Loader2 size={14} className="animate-spin" /> : <TestTube size={14} />}
            <span className="text-sm">测试</span>
          </button>
        </div>

        {previewResult && (() => {
          const route = previewResult.intelligent_route;
          const routeModel = route && typeof route === 'object'
            ? (route.model_name || route.model || '未知')
            : (route || '未知');
          const routeProvider = route && typeof route === 'object' ? route.provider : null;
          return (
            <div className="bg-bg-primary border border-border-color rounded-[2px] p-4 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-secondary">推荐模型:</span>
                <span className="text-sm font-medium text-fusion-primary">
                  {catalog?.models.find((m) => m.provider_model_id === routeModel)?.name || routeModel}
                </span>
              </div>
              {routeProvider && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-secondary">提供商:</span>
                  <span className="text-sm text-text-primary">{routeProvider}</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-secondary">预估 Token:</span>
                <span className="text-sm text-text-primary">{previewResult.token_estimate}</span>
              </div>
              <div className="text-[10px] text-text-secondary mt-1">{previewResult.reasoning}</div>
            </div>
          );
        })()}
      </section>

      {/* Local Model Configuration */}
      <section className="glass-card p-6">
        <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <Server size={18} className="text-success" />
          本地模型配置
        </h2>
        <div className="space-y-4">
          <div>
            <label className="text-sm text-text-primary block mb-1.5">Ollama 地址</label>
            <input
              type="text"
              value={ollamaUrl}
              onChange={(e) => setOllamaUrl(e.target.value)}
              placeholder="http://localhost:11434"
              className="w-full bg-bg-tertiary border border-border-color rounded-[2px] px-3 py-2 text-sm text-text-primary placeholder-text-secondary focus:outline-none focus:border-info"
            />
            <p className="text-xs text-text-secondary mt-1">本地 Ollama 服务地址，默认 http://localhost:11434</p>
          </div>
          <div>
            <label className="text-sm text-text-primary block mb-1.5">默认模型名称</label>
            <select
              value={ollamaModel}
              onChange={(e) => setOllamaModel(e.target.value)}
              className="w-full bg-bg-tertiary border border-border-color rounded-[2px] px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-info"
            >
              {ollamaModels.map((m) => (
                <option key={m} value={m} className="bg-bg-tertiary text-text-primary">
                  {m}
                </option>
              ))}
            </select>
            <p className="text-xs text-text-secondary mt-1">
              {ollamaAvailable ? '已从 Ollama 服务加载可用模型' : '使用默认推荐模型列表（Ollama 未连接时）'}
            </p>
          </div>
        </div>
      </section>


      {/* Temperature & Max Tokens */}
      <section className="glass-card p-6">
        <h2 className="text-lg font-semibold text-text-primary mb-4">生成参数</h2>

        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm text-text-primary">Temperature（温度）</label>
            <span className="text-sm font-mono text-fusion-primary">{temperature.toFixed(1)}</span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.1}
            value={temperature}
            onChange={e => setTemperature(parseFloat(e.target.value))}
            className="w-full h-2 bg-bg-tertiary rounded-[2px] appearance-none cursor-pointer accent-fusion-primary"
          />
          <div className="flex justify-between text-xs text-text-secondary mt-1">
            <span>保守（0.0）</span>
            <span>平衡（0.5）</span>
            <span>创意（1.0）</span>
          </div>
          <p className="text-xs text-text-secondary mt-2">
            温度越低，输出越保守、确定性强；温度越高，输出越多样、富有创意。
          </p>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm text-text-primary">最大令牌数</label>
            <span className="text-sm font-mono text-fusion-primary">{maxTokens}</span>
          </div>
          <input
            type="range"
            min={256}
            max={8192}
            step={256}
            value={maxTokens}
            onChange={e => setMaxTokens(parseInt(e.target.value))}
            className="w-full h-2 bg-bg-tertiary rounded-[2px] appearance-none cursor-pointer accent-fusion-primary"
          />
          <div className="flex justify-between text-xs text-text-secondary mt-1">
            <span>256</span>
            <span>4096</span>
            <span>8192</span>
          </div>
        </div>
      </section>

      {/* Local LLM Toggle */}
      <section className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">启用本地模型</h2>
            <p className="text-xs text-text-secondary mt-1">优先使用 Ollama 等本地模型，保护隐私</p>
          </div>
          <button
            onClick={() => setLocalEnabled(!localEnabled)}
            className={`relative w-12 h-6 rounded-full transition-colors ${localEnabled ? 'bg-fusion-primary' : 'bg-bg-tertiary'}`}
          >
            <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${localEnabled ? 'translate-x-6' : ''}`} />
          </button>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">启用智能路由</h2>
            <p className="text-xs text-text-secondary mt-1">根据内容特征自动选择最合适的模型（如敏感内容优先用本地模型）</p>
          </div>
          <button
            onClick={() => setModelRoutingEnabled(!modelRoutingEnabled)}
            className={`relative w-12 h-6 rounded-full transition-colors ${modelRoutingEnabled ? 'bg-fusion-primary' : 'bg-bg-tertiary'}`}
          >
            <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${modelRoutingEnabled ? 'translate-x-6' : ''}`} />
          </button>
        </div>
      </section>

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saveMutation.isPending}
          className="btn-primary flex items-center gap-2"
        >
          {saveMutation.isPending && <Loader2 size={16} className="animate-spin" />}
          <Check size={16} />
          保存 AI 设置
        </button>
      </div>
    </div>
  );
};

export default AISettings;
