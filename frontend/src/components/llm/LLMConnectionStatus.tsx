import { FC, useEffect, useRef, useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Zap, RefreshCw, X, Settings, Sparkles, Activity, Loader2, ChevronRight,
} from 'lucide-react';
import { getLLMStatus, getModelCatalog, LLMModelCatalogItem } from '@/api/llm';
import { useSettings } from '@/store/settings';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

const PROVIDER_COLORS: Record<string, string> = {
  ollama: 'bg-success',
};

interface LLMConnectionStatusProps {
  placement?: 'top' | 'bottom';
  onLoginClick?: () => void;
}

const LLMConnectionStatus: FC<LLMConnectionStatusProps> = ({ placement = 'bottom', onLoginClick }) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isLoggedIn } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [smartRouting, setSmartRouting] = useState(true);

  const setActiveProvider = useSettings((state) => state.setActiveProvider);
  const syncActiveProvider = useSettings((state) => state.syncActiveProvider);
  const activeProvider = useSettings((state) => state.activeProvider);
  const activeModel = useSettings((state) => state.activeModel);

  const { data: catalog } = useQuery({
    queryKey: ['llmModelCatalog'],
    queryFn: getModelCatalog,
    staleTime: 5 * 60 * 1000,
  });

  const { data: status, isLoading, refetch } = useQuery({
    queryKey: ['llmStatus'],
    queryFn: getLLMStatus,
    refetchInterval: 30000,
    staleTime: 30000,
  });

  // Use backend status as primary source, local store as fallback
  const activeProviderName = status?.active_provider || activeProvider || 'Ollama';
  const displayModel = status?.active_model || activeModel || 'qwen2.5:0.5b';
  const isConnected = status?.connected ?? false;
  const activeLatency = status?.latency ?? -1;

  const activeProviderInfo = status?.providers?.find(
    (p) => p.provider.toLowerCase() === activeProviderName.toLowerCase()
  ) || {
    provider: activeProviderName,
    model: displayModel,
    connected: isConnected,
    latency: activeLatency,
    icon_color: PROVIDER_COLORS[activeProviderName.toLowerCase()] || 'bg-success',
    available: true,
  };

  const setMutation = useMutation({
    mutationFn: async ({ provider, model }: { provider: string; model: string }) => {
      await setActiveProvider(provider, model);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['llmStatus'] });
      setIsOpen(false);
    },
  });

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Sync backend active provider to local selector when status changes
  useEffect(() => {
    if (status?.active_provider && status?.active_model) {
      const backendProvider = status.active_provider.toLowerCase();
      const backendModel = status.active_model;
      const settingsProvider = (activeProvider || '').toLowerCase();
      if (backendProvider !== settingsProvider || backendModel !== activeModel) {
        syncActiveProvider(status.active_provider, status.active_model);
      }
    }
  }, [status, activeProvider, activeModel, syncActiveProvider]);

  const handleModelClick = (model: LLMModelCatalogItem) => {
    if (!isLoggedIn) {
      onLoginClick?.();
      setIsOpen(false);
      return;
    }
    const activeModelName = model.provider_model_id;
    setMutation.mutate({ provider: model.provider, model: activeModelName });
  };

  const handleRefresh = () => {
    refetch();
  };

  const formatLatency = (latency: number) => (latency >= 0 ? `${latency}ms` : '未连接');

  // Group catalog models by provider
  const modelsByProvider = useMemo(() => {
    const groups: Record<string, LLMModelCatalogItem[]> = {};
    catalog?.models?.forEach((m) => {
      if (!groups[m.provider]) groups[m.provider] = [];
      groups[m.provider].push(m);
    });
    return groups;
  }, [catalog]);

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-3 py-2 rounded-[2px] text-xs font-medium transition-all duration-300 glass ${
          isConnected
            ? 'text-success border-success/20'
            : 'text-danger border-danger/20'
        }`}
        title={`LLM: ${activeProviderName} ${displayModel} | ${isConnected ? '已连接' : '断开'}`}
      >
        <div className="relative">
          <div className={`w-2 h-2 rounded-full bg-gradient-to-r ${activeProviderInfo.icon_color}`} />
          {isConnected && (
            <div className="absolute inset-0 w-2 h-2 rounded-full bg-success animate-ping opacity-40" />
          )}
        </div>

        <span className="hidden lg:inline">
          <span className="text-text-primary font-semibold">
            {activeProviderName}
          </span>
          <span className="text-text-muted ml-1">{displayModel}</span>
        </span>

        {isConnected && activeLatency >= 0 && (
          <span className="text-text-muted">{activeLatency}ms</span>
        )}

        {isLoading && (
          <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className={`absolute right-0 ${placement === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'} w-[460px] glass-popup rounded-[2px] p-4 z-50`}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-info" />
                <span className="text-sm font-semibold text-text-primary">LLM 模型控制台</span>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-[2px] hover:bg-white/[0.06] text-text-muted hover:text-text-primary transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Active Model Card */}
            <div className="glass-card p-4 mb-3">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={`w-10 h-10 rounded-[2px] bg-gradient-to-br ${activeProviderInfo.icon_color} flex items-center justify-center`}>
                    <Zap className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-text-primary">{activeProviderName}</div>
                    <div className="text-xs text-text-muted">{displayModel}</div>
                  </div>
                </div>
                <button
                  onClick={handleRefresh}
                  disabled={isLoading}
                  className="p-1.5 rounded-[2px] hover:bg-white/[0.06] text-text-muted hover:text-info transition-colors disabled:opacity-50"
                  title="刷新状态"
                >
                  <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {isConnected ? (
                    <>
                      <div className="relative">
                        <div className="w-2 h-2 rounded-full bg-success" />
                        <div className="absolute inset-0 w-2 h-2 rounded-full bg-success animate-ping opacity-40" />
                      </div>
                      <span className="text-xs font-medium text-success">已连接</span>
                    </>
                  ) : (
                    <>
                      <div className="w-2 h-2 rounded-full bg-danger" />
                      <span className="text-xs font-medium text-danger">未连接</span>
                    </>
                  )}
                </div>
                <span className="text-xs text-text-muted">{formatLatency(activeProviderInfo.latency)}</span>
              </div>
            </div>

            {/* Model List by Provider */}
            <div className="space-y-3 max-h-72 overflow-y-auto pr-0.5">
              {Object.entries(modelsByProvider).map(([provider, models]) => {
                return (
                  <div key={provider} className="space-y-0.5">
                    {/* Models under this provider - no provider header shown */}
                    <div className="divide-y divide-white/[0.04] border border-white/[0.06] rounded-[2px] overflow-hidden">
                      {models.map((model) => {
                        const isActive = model.provider.toLowerCase() === activeProviderName.toLowerCase() && model.provider_model_id === displayModel;
                        const isSetting = setMutation.isPending && setMutation.variables?.provider === model.provider && setMutation.variables?.model === model.provider_model_id;

                        return (
                          <button
                            key={model.id}
                            onClick={() => handleModelClick(model)}
                            disabled={setMutation.isPending}
                            className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-all ${
                              isActive
                                ? 'bg-info/10 text-info'
                                : 'hover:bg-white/[0.03] text-text-secondary'
                            }`}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-text-primary truncate">{model.name}</span>
                                {isActive && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-info/20 text-info border border-info/20">当前</span>
                                )}
                              </div>
                              <div className="text-xs text-text-muted truncate">{model.description}</div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {isSetting ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-info" />
                              ) : (
                                <ChevronRight className="w-3 h-3 text-text-muted" />
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {!catalog?.models?.length && (
                <div className="text-center py-4 text-xs text-text-muted">
                  暂无可用的模型配置
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="mt-3 pt-3 border-t border-white/[0.08] flex items-center justify-between">
              <button
                onClick={() => setSmartRouting(!smartRouting)}
                className="flex items-center gap-2 text-xs text-text-secondary hover:text-text-primary transition-colors"
              >
                <Sparkles className={`w-3.5 h-3.5 ${smartRouting ? 'text-fusion-primary' : 'text-text-muted'}`} />
                <span>智能路由</span>
                <div className={`relative w-8 h-4 rounded-full transition-colors ${smartRouting ? 'bg-fusion-primary' : 'bg-bg-tertiary'}`}>
                  <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${smartRouting ? 'translate-x-4' : ''}`} />
                </div>
              </button>

              <button
                onClick={() => {
                  setIsOpen(false);
                  if (!isLoggedIn) {
                    onLoginClick?.();
                  } else {
                    navigate('/settings');
                  }
                }}
                className="flex items-center gap-1.5 text-xs text-info hover:text-network-secondary transition-colors"
              >
                <Settings className="w-3.5 h-3.5" />
                AI 设置
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default LLMConnectionStatus;
