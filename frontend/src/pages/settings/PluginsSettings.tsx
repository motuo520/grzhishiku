import { FC, useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Puzzle, Check, Loader2, AlertTriangle,
  Code, Save, RefreshCw, Play, Clock, CalendarClock,
} from 'lucide-react';
import { pluginsApi, type PluginInfo, type AutoSyncStatus } from '@/api/plugins';

const SYNCABLE_PLUGIN_IDS = ['notion-import', 'pocket-sync', 'readwise-sync'];

const SYNC_LABELS: Record<string, string> = {
  'notion-import': '导入 Notion',
  'pocket-sync': '同步 Pocket',
  'readwise-sync': '同步 Readwise',
};

const INTERVAL_OPTIONS = [
  { value: 30, label: '30 分钟' },
  { value: 60, label: '1 小时' },
  { value: 360, label: '6 小时' },
  { value: 1440, label: '24 小时' },
];

function formatSyncTime(iso?: string | null): string {
  if (!iso) return '无';
  try {
    return new Date(iso).toLocaleString('zh-CN');
  } catch {
    return iso;
  }
}

const PluginsSettings: FC = () => {
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [configDrafts, setConfigDrafts] = useState<Record<string, string>>({});

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const { data: plugins, isLoading, error: listError } = useQuery({
    queryKey: ['plugins'],
    queryFn: () => pluginsApi.list().then(r => r.data),
  });

  useEffect(() => {
    if (plugins) {
      const drafts: Record<string, string> = {};
      plugins.forEach(p => {
        drafts[p.id] = JSON.stringify(p.config || {}, null, 2);
      });
      setConfigDrafts(drafts);
    }
  }, [plugins]);

  const enableMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      pluginsApi.enable(id, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plugins'] });
      showToast('插件状态已更新', 'success');
    },
    onError: (err: any) => showToast(err?.message || '更新失败', 'error'),
  });

  const configMutation = useMutation({
    mutationFn: ({ id, config }: { id: string; config: Record<string, any> }) =>
      pluginsApi.configure(id, config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plugins'] });
      showToast('配置已保存', 'success');
    },
    onError: (err: any) => showToast(err?.message || '保存失败', 'error'),
  });

  const togglePlugin = (plugin: PluginInfo) => {
    enableMutation.mutate({ id: plugin.id, enabled: !plugin.enabled });
  };

  const handleConfigChange = (id: string, value: string) => {
    setConfigDrafts(prev => ({ ...prev, [id]: value }));
  };

  const saveConfig = (plugin: PluginInfo) => {
    const raw = configDrafts[plugin.id];
    try {
      const parsed = raw ? JSON.parse(raw) : {};
      configMutation.mutate({ id: plugin.id, config: parsed });
    } catch {
      showToast('配置 JSON 格式错误', 'error');
    }
  };

  if (isLoading) {
    return (
      <div className="glass-card p-8 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-info" />
      </div>
    );
  }

  if (listError) {
    return (
      <div className="glass-card p-6 flex items-center gap-2 text-danger text-sm">
        <AlertTriangle size={18} />
        加载插件列表失败，请检查后端服务。
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl border backdrop-blur-xl shadow-lg ${
          toast.type === 'success'
            ? 'bg-success/20 border-success/30 text-green-400'
            : 'bg-danger/20 border-danger/30 text-red-400'
        }`}>
          <div className="flex items-center gap-2">
            {toast.type === 'success' ? <Check size={16} /> : <AlertTriangle size={16} />}
            <span className="text-sm">{toast.message}</span>
          </div>
        </div>
      )}

      <section className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <Puzzle size={18} className="text-info" />
            已安装插件
          </h2>
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ['plugins'] })}
            className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-info transition-colors"
          >
            <RefreshCw size={14} />
            刷新
          </button>
        </div>
        <p className="text-sm text-text-muted mb-4">
          后端会从 <code className="text-info">backend/app/plugins/builtin</code> 和 <code className="text-info">backend/plugins</code> 自动扫描插件。启用后，插件的 MCP 工具/REST 接口会生效。
        </p>

        <div className="space-y-4">
          {plugins?.length === 0 && (
            <div className="text-sm text-text-muted py-4 text-center">
              暂无插件，请在 <code>backend/plugins</code> 目录添加插件包。
            </div>
          )}
          {plugins?.map(plugin => (
            <div
              key={plugin.id}
              className={`p-4 rounded-xl border transition-all ${
                plugin.enabled ? 'border-info/30 bg-info/[0.03]' : 'border-white/[0.08] bg-white/[0.02]'
              }`}
            >
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-info/10 flex items-center justify-center text-info shrink-0">
                  <Puzzle size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-text-primary">{plugin.name}</span>
                    <span className="text-xs text-text-muted">v{plugin.version}</span>
                    <span className={`px-1.5 py-0.5 rounded-md text-[10px] border ${
                      plugin.type === 'builtin'
                        ? 'bg-fusion-primary/10 text-fusion-primary border-fusion-primary/30'
                        : 'bg-success/10 text-success border-success/30'
                    }`}>
                      {plugin.type === 'builtin' ? '内置' : '本地'}
                    </span>
                  </div>
                  <div className="text-xs text-text-muted mt-0.5">{plugin.description}</div>

                  {SYNCABLE_PLUGIN_IDS.includes(plugin.id) && (
                    <PluginSyncPanel plugin={plugin} showToast={showToast} />
                  )}

                  {/* Config editor */}
                  {plugin.config_schema && (
                    <div className="mt-3 space-y-2">
                      <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                        <Code size={14} />
                        配置 (JSON)
                      </div>
                      <textarea
                        value={configDrafts[plugin.id] || '{}'}
                        onChange={(e) => handleConfigChange(plugin.id, e.target.value)}
                        rows={4}
                        className="w-full bg-bg-primary border border-white/[0.08] rounded-xl p-3 text-xs font-mono text-text-primary focus:outline-none focus:border-info/40 transition-colors"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => saveConfig(plugin)}
                          disabled={configMutation.isPending}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.06] border border-white/[0.08] rounded-lg text-xs text-text-primary hover:bg-info/10 hover:border-info/30 transition-all disabled:opacity-50"
                        >
                          {configMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                          保存配置
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => togglePlugin(plugin)}
                  disabled={enableMutation.isPending}
                  className={`relative w-12 h-6 rounded-full transition-colors shrink-0 ${
                    plugin.enabled ? 'bg-info' : 'bg-bg-tertiary'
                  }`}
                  title={plugin.enabled ? '启用中' : '已禁用'}
                >
                  <span
                    className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${
                      plugin.enabled ? 'translate-x-6' : ''
                    }`}
                  />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="glass-card p-6">
        <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <Code size={18} className="text-personal-primary" />
          外部 Agent 接入说明
        </h2>
        <div className="text-sm text-text-secondary space-y-2">
          <p>
            本系统已暴露 <strong>MCP Server</strong>，外部 AI 客户端（如 Cursor、Claude Desktop）可通过 SSE 连接：
          </p>
          <code className="block bg-bg-primary border border-white/[0.08] rounded-xl p-3 text-xs text-info font-mono">
            {`${window.location.origin}/api/v1/mcp/sse`}
          </code>
          <p>
            当前内置工具包括：搜索知识库、创建笔记、创建知识单元、查看管线统计。启用更多插件后，它们贡献的工具会自动加入。
          </p>
        </div>
      </section>
    </div>
  );
};

interface PluginSyncPanelProps {
  plugin: PluginInfo;
  showToast: (message: string, type: 'success' | 'error') => void;
}

const PluginSyncPanel: FC<PluginSyncPanelProps> = ({ plugin, showToast }) => {
  const queryClient = useQueryClient();
  const { data: status, isLoading } = useQuery<AutoSyncStatus>({
    queryKey: ['plugin-sync-config', plugin.id],
    queryFn: () => pluginsApi.getAutoSync(plugin.id).then(r => r.data),
    enabled: plugin.enabled,
  });

  const [enabled, setEnabled] = useState(false);
  const [intervalMinutes, setIntervalMinutes] = useState(60);

  useEffect(() => {
    if (status) {
      setEnabled(status.auto_sync.enabled);
      setIntervalMinutes(status.auto_sync.interval_minutes || 60);
    }
  }, [status]);

  const setAutoSyncMutation = useMutation({
    mutationFn: ({ id, enabled, intervalMinutes }: { id: string; enabled: boolean; intervalMinutes: number }) =>
      pluginsApi.setAutoSync(id, { enabled, interval_minutes: intervalMinutes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plugin-sync-config', plugin.id] });
      showToast('自动同步设置已保存', 'success');
    },
    onError: (err: any) => showToast(err?.message || '保存失败', 'error'),
  });

  const triggerMutation = useMutation({
    mutationFn: (id: string) => pluginsApi.triggerSync(id),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['plugins'] });
      queryClient.invalidateQueries({ queryKey: ['plugin-sync-config', plugin.id] });
      const data = res.data;
      const msg = data?.created !== undefined
        ? `同步完成：新建 ${data.created} 条，跳过 ${data.skipped} 条`
        : '同步完成';
      showToast(msg, 'success');
    },
    onError: (err: any) => showToast(err?.message || '同步失败', 'error'),
  });

  const saveAutoSync = () => {
    setAutoSyncMutation.mutate({ id: plugin.id, enabled, intervalMinutes });
  };

  return (
    <div className="mt-3 p-3 rounded-xl border border-white/[0.08] bg-bg-primary/50 space-y-3">
      <div className="flex items-center gap-2 text-xs text-text-secondary">
        <Clock size={14} />
        <span>自动同步</span>
        {!plugin.enabled && <span className="text-text-muted">（启用插件后生效）</span>}
      </div>

      {isLoading ? (
        <Loader2 size={16} className="animate-spin text-info" />
      ) : (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                disabled={!plugin.enabled || setAutoSyncMutation.isPending}
                className="rounded border-white/[0.08] bg-bg-primary text-info focus:ring-info"
              />
              启用自动同步
            </label>

            <select
              value={intervalMinutes}
              onChange={(e) => setIntervalMinutes(Number(e.target.value))}
              disabled={!plugin.enabled || setAutoSyncMutation.isPending}
              className="bg-bg-primary border border-white/[0.08] rounded-lg px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-info/40"
            >
              {INTERVAL_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>

            <button
              onClick={saveAutoSync}
              disabled={!plugin.enabled || setAutoSyncMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-info/10 border border-info/30 rounded-lg text-xs text-info hover:bg-info/20 transition-all disabled:opacity-50"
            >
              {setAutoSyncMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              保存
            </button>
          </div>

          {status?.auto_sync?.last_sync_error && (
            <div className="text-xs text-danger flex items-start gap-1.5">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>上次错误：{status.auto_sync.last_sync_error}</span>
            </div>
          )}

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
            <span className="flex items-center gap-1">
              <CalendarClock size={12} />
              上次同步：{formatSyncTime(status?.last_sync_at)}
            </span>
            <span className="flex items-center gap-1">
              <CalendarClock size={12} />
              下次同步：{formatSyncTime(status?.next_run_at)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => triggerMutation.mutate(plugin.id)}
              disabled={!plugin.enabled || triggerMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-success/10 border border-success/30 rounded-lg text-xs text-success hover:bg-success/20 transition-all disabled:opacity-50"
            >
              {triggerMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              {SYNC_LABELS[plugin.id] || '立即同步'}
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default PluginsSettings;
