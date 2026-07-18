import { FC, useState, useEffect, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { settingsApi, UserSettings } from '@/api/settings';
import { testProvider, getLLMStatus, getOllamaModels, getModelCatalog, LLMModelCatalogItem } from '@/api/llm';
import {
  Brain, Eye, EyeOff, Loader2, Check, AlertTriangle, Wifi, WifiOff,
  Server, KeyRound, Sparkles, Globe, Zap,
  Bot, TestTube, ArrowRightCircle
} from 'lucide-react';
import { apiClient } from '@/api/client';
import { useSettings } from '@/store/settings';

const PROVIDER_ICONS: Record<string, React.ElementType> = {
  ollama: Server,
  kimi: Globe,
  deepseek: Sparkles,
  opencode: Brain,
};

const EXTERNAL_PROVIDERS = [
  { slug: 'kimi', name: 'Kimi (Moonshot)', keyLabel: 'Kimi API Key', field: 'kimi_api_key', icon: Globe },
  { slug: 'deepseek', name: 'DeepSeek', keyLabel: 'DeepSeek API Key', field: 'deepseek_api_key', icon: Sparkles },
  { slug: 'opencode', name: 'OpenCode', keyLabel: 'OpenCode API Key', field: 'opencode_api_key', icon: Brain },
];

const FALLBACK_OLLAMA_MODELS = ['qwen2.5:0.5b'];

const AISettings: FC = () => {
  const [selectedModel, setSelectedModel] = useState('ollama');
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(2048);
  const [localEnabled, setLocalEnabled] = useState(true);
  const [modelRoutingEnabled, setModelRoutingEnabled] = useState(true);
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434');
  const [ollamaModel, setOllamaModel] = useState('qwen2.5:0.5b');
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({
    kimi: '',
    deepseek: '',
    opencode: '',
  });

  const setActiveProvider = useSettings((state) => state.setActiveProvider);
  const queryClient = useQueryClient();

  // UI state
  const [showKeyMap, setShowKeyMap] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { status: 'loading' | 'success' | 'error'; message?: string }>>({});

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
      setApiKeys({
        kimi: settings.ai.kimi_api_key || '',
        deepseek: settings.ai.deepseek_api_key || '',
        opencode: settings.ai.opencode_api_key || '',
      });
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

    const requiresKey = selectedConfig.provider !== 'ollama';
    if (requiresKey && !apiKeys[selectedConfig.provider]?.trim()) {
      const providerName = EXTERNAL_PROVIDERS.find((p) => p.slug === selectedConfig.provider)?.name || selectedConfig.provider;
      showToast(`请填写 ${providerName} 的 API Key`, 'error');
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

    const provider = selectedConfig.provider;
    const activeModel = provider === 'ollama' ? ollamaModel : selectedConfig.provider_model_id;

    // 密钥处理：掩码值（****...）或留空表示不改动，由后端保留原值；仅输入新值才提交
    const keyPayload = (slug: string) => {
      const v = apiKeys[slug]?.trim();
      if (!v || v.startsWith('****')) return undefined;
      return v;
    };

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
        kimi_api_key: keyPayload('kimi'),
        deepseek_api_key: keyPayload('deepseek'),
        opencode_api_key: keyPayload('opencode'),
      },
    });
  };

  const handleClearKey = async (slug: string, field: string, name: string) => {
    try {
      await settingsApi.updateSettings({ ai: { [field]: '' } as Partial<UserSettings['ai']> });
      updateApiKey(slug, '');
      queryClient.invalidateQueries({ queryKey: ['settings', 'ai'] });
      showToast(`${name} 的 API Key 已清除`, 'success');
    } catch (err: any) {
      showToast(err?.message || '清除失败', 'error');
    }
  };

  const toggleKeyVisibility = (slug: string) => {
    setShowKeyMap((prev) => ({ ...prev, [slug]: !prev[slug] }));
  };

  const updateApiKey = (slug: string, value: string) => {
    setApiKeys((prev) => ({ ...prev, [slug]: value }));
  };

  const handleTest = async (providerSlug: string) => {
    setTestResults((prev) => ({ ...prev, [providerSlug]: { status: 'loading' } }));
    try {
      const result = await testProvider(providerSlug);
      if (result.connected) {
        setTestResults((prev) => ({
          ...prev,
          [providerSlug]: { status: 'success', message: `已连接 · 延迟 ${result.latency}ms` },
        }));
      } else {
        setTestResults((prev) => ({
          ...prev,
          [providerSlug]: { status: 'error', message: '未连接（请检查 API Key）' },
        }));
      }
    } catch (e: any) {
      setTestResults((prev) => ({
        ...prev,
        [providerSlug]: { status: 'error', message: e?.message || '测试失败' },
      }));
    }
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
                    {m.price_input_per_1k > 0 && (
                      <div className="text-xs text-text-secondary">
                        {(m.currency === 'USD' ? '$' : '¥') + m.price_input_per_1k.toFixed(4)} / {(m.currency === 'USD' ? '$' : '¥') + m.price_output_per_1k.toFixed(4)} per 1K tokens
                      </div>
                    )}
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

      {/* API Key Configuration */}
      <section className="glass-card p-6">
        <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <KeyRound size={18} className="text-warning" />
          API Key 配置
        </h2>
        <p className="text-xs text-text-secondary mb-4">
          API Key 保存在服务端用户设置中，仅用于后端调用外部 AI 服务，不会在前端页面暴露。
        </p>

        <div className="space-y-4">
          {EXTERNAL_PROVIDERS.map((p) => {
            const Icon = p.icon;
            const keyValue = apiKeys[p.slug] || '';
            const testResult = testResults[p.slug];
            const isVisible = showKeyMap[p.slug] || false;

            return (
              <div key={p.slug} className="border border-border-color rounded-[2px] p-4 bg-bg-primary/50">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Icon size={16} className="text-text-secondary" />
                    <span className="text-sm font-medium text-text-primary">{p.name}</span>
                  </div>
                  <button
                    onClick={() => handleTest(p.slug)}
                    disabled={testResult?.status === 'loading'}
                    className="text-xs px-2.5 py-1 rounded bg-bg-tertiary border border-border-color text-text-primary hover:bg-bg-tertiary transition-colors flex items-center gap-1 disabled:opacity-50"
                  >
                    {testResult?.status === 'loading' ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : testResult?.status === 'success' ? (
                      <Wifi size={12} className="text-success" />
                    ) : testResult?.status === 'error' ? (
                      <WifiOff size={12} className="text-danger" />
                    ) : (
                      <TestTube size={12} />
                    )}
                    测试连接
                  </button>
                </div>

                {testResult?.message && (
                  <div className={`text-xs mb-2 px-2 py-1 rounded ${
                    testResult.status === 'success'
                      ? 'bg-success/10 text-success'
                      : 'bg-danger/10 text-danger'
                  }`}>
                    {testResult.message}
                  </div>
                )}

                <div className="relative max-w-md">
                  <input
                    type={isVisible ? 'text' : 'password'}
                    className="w-full bg-bg-tertiary border border-border-color rounded-[2px] px-3 py-2 pr-10 text-sm text-text-primary placeholder-text-secondary focus:outline-none focus:border-info"
                    value={keyValue}
                    onChange={(e) => updateApiKey(p.slug, e.target.value)}
                    placeholder={p.keyLabel}
                  />
                  <button
                    onClick={() => toggleKeyVisibility(p.slug)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
                  >
                    {isVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {keyValue.startsWith('****') && (
                  <div className="flex items-center justify-between max-w-md mt-1.5">
                    <p className="text-xs text-text-muted">已保存（掩码显示），输入新 Key 以更换</p>
                    <button
                      onClick={() => handleClearKey(p.slug, p.field, p.name)}
                      className="text-xs text-danger hover:underline shrink-0 ml-3"
                    >
                      清除 Key
                    </button>
                  </div>
                )}
              </div>
            );
          })}
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
            <p className="text-xs text-text-secondary mt-1">根据内容特征自动选择最合适的模型（如敏感内容用本地模型、代码用 Kimi、推理用 DeepSeek）</p>
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
