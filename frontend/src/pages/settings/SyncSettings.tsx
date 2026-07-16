import { FC, useState, useEffect, useCallback } from 'react';
import { RefreshCw, Wifi, WifiOff, Loader2, CheckCircle, XCircle, HardDrive, Info } from 'lucide-react';
import { settingsApi } from '@/api/settings';
import { useAuth } from '@/hooks/useAuth';

interface SyncConfig {
  frequency: 'realtime' | 'hourly' | 'daily' | 'manual';
  conflictStrategy: 'local' | 'cloud' | 'latest' | 'manual';
  offlineMode: boolean;
}

const Toast: FC<{ message: string; type: 'success' | 'error'; onClose: () => void }> = ({ message, type, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);
  return (
    <div className={`fixed top-5 right-5 z-50 flex items-center gap-2 px-4 py-3 rounded-xl border backdrop-blur ${
      type === 'success'
        ? 'bg-green-500/10 border-green-500/30 text-green-400'
        : 'bg-red-500/10 border-red-500/30 text-red-400'
    }`}>
      {type === 'success' ? <CheckCircle size={18} /> : <XCircle size={18} />}
      <span className="text-sm">{message}</span>
    </div>
  );
};

const FREQUENCIES: { id: SyncConfig['frequency']; label: string; desc: string }[] = [
  { id: 'realtime', label: '实时同步', desc: '任何更改立即同步到云端，适合多设备频繁切换' },
  { id: 'hourly', label: '每小时', desc: '每小时自动同步一次，平衡实时性与电量消耗' },
  { id: 'daily', label: '每天', desc: '每天同步一次，适合主要在单一设备使用的场景' },
  { id: 'manual', label: '手动', desc: '仅当您点击同步按钮时才同步，最大程度节省流量' },
];

const CONFLICTS: { id: SyncConfig['conflictStrategy']; label: string; desc: string }[] = [
  { id: 'local', label: '本地优先', desc: '冲突时保留本地版本，云端版本将被覆盖' },
  { id: 'cloud', label: '云端优先', desc: '冲突时保留云端版本，本地版本将被覆盖' },
  { id: 'latest', label: '最新优先', desc: '保留时间戳较新的版本，自动合并简单差异' },
  { id: 'manual', label: '手动合并', desc: '每次冲突都提示您手动选择保留哪个版本' },
];

const defaultSync: SyncConfig = {
  frequency: 'hourly',
  conflictStrategy: 'latest',
  offlineMode: false,
};

const formatBytes = (bytes?: number) => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(1)} ${units[i]}`;
};

const SyncSettings: FC = () => {
  const { user } = useAuth();
  const [settings, setSettings] = useState<SyncConfig>(defaultSync);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
  }, []);

  useEffect(() => {
    setLoading(true);
    settingsApi.getSettings()
      .then(res => {
        const sync = res.data.sync;
        if (sync) {
          setSettings({
            frequency: (sync.frequency as SyncConfig['frequency']) || 'hourly',
            conflictStrategy: (sync.conflictStrategy as SyncConfig['conflictStrategy']) || 'latest',
            offlineMode: sync.offlineMode ?? false,
          });
        }
      })
      .catch(() => showToast('加载设置失败', 'error'))
      .finally(() => setLoading(false));
  }, [showToast]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await settingsApi.updateSettings({ sync: settings });
      showToast('同步设置已保存', 'success');
    } catch (err: any) {
      showToast(err?.message || '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="glass-card p-10 flex items-center justify-center">
        <Loader2 size={24} className="text-info animate-spin" />
        <span className="ml-2 text-text-secondary">加载中...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Local deployment notice */}
      <div className="glass-card p-4 border-info/20 flex items-start gap-3">
        <Info size={16} className="text-info shrink-0 mt-0.5" />
        <p className="text-xs text-text-secondary">
          当前为本地部署版本，数据均保存在本机。以下同步设置会被保存，将在云端同步版本上线后生效。
        </p>
      </div>

      {/* Sync Frequency */}
      <div className="glass-card p-6">
        <h3 className="text-lg font-medium text-text-primary mb-4 flex items-center gap-2">
          <RefreshCw size={18} className="text-info" />
          同步频率
        </h3>
        <div className="space-y-3">
          {FREQUENCIES.map(f => (
            <label
              key={f.id}
              className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-all ${
                settings.frequency === f.id
                  ? 'border-info/40 bg-info/[0.05]'
                  : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12]'
              }`}
              onClick={() => setSettings(prev => ({ ...prev, frequency: f.id as any }))}
            >
              <input
                type="radio"
                name="frequency"
                className="mt-1 accent-info"
                checked={settings.frequency === f.id}
                onChange={() => setSettings(prev => ({ ...prev, frequency: f.id as any }))}
              />
              <div>
                <div className="text-sm font-medium text-text-primary">{f.label}</div>
                <div className="text-xs text-text-secondary mt-0.5">{f.desc}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Conflict Strategy */}
      <div className="glass-card p-6">
        <h3 className="text-lg font-medium text-text-primary mb-4 flex items-center gap-2">
          <RefreshCw size={18} className="text-info" />
          冲突解决策略
        </h3>
        <div className="space-y-3">
          {CONFLICTS.map(c => (
            <label
              key={c.id}
              className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-all ${
                settings.conflictStrategy === c.id
                  ? 'border-info/40 bg-info/[0.05]'
                  : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12]'
              }`}
              onClick={() => setSettings(prev => ({ ...prev, conflictStrategy: c.id as any }))}
            >
              <input
                type="radio"
                name="conflict"
                className="mt-1 accent-info"
                checked={settings.conflictStrategy === c.id}
                onChange={() => setSettings(prev => ({ ...prev, conflictStrategy: c.id as any }))}
              />
              <div>
                <div className="text-sm font-medium text-text-primary">{c.label}</div>
                <div className="text-xs text-text-secondary mt-0.5">{c.desc}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Offline Mode */}
      <div className="glass-card p-6">
        <h3 className="text-lg font-medium text-text-primary mb-4 flex items-center gap-2">
          {settings.offlineMode ? <WifiOff size={18} className="text-warning" /> : <Wifi size={18} className="text-info" />}
          离线模式
        </h3>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-text-primary">启用离线模式</div>
            <div className="text-xs text-text-secondary mt-0.5">
              离线模式下，更改将在恢复连接后自动同步。
            </div>
          </div>
          <button
            className={`relative w-12 h-6 rounded-full transition-colors ${settings.offlineMode ? 'bg-warning' : 'bg-white/10'}`}
            onClick={() => setSettings(prev => ({ ...prev, offlineMode: !prev.offlineMode }))}
          >
            <span
              className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${settings.offlineMode ? 'translate-x-6' : 'translate-x-0'}`}
            />
          </button>
        </div>
      </div>

      {/* Storage Usage */}
      <div className="glass-card p-6">
        <h3 className="text-lg font-medium text-text-primary mb-4 flex items-center gap-2">
          <HardDrive size={18} className="text-info" />
          存储使用
        </h3>
        {(() => {
          const used = user?.storage_used ?? 0;
          const limit = user?.storage_limit ?? 0;
          const percent = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
          return (
            <div className="space-y-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-text-secondary">已用空间</span>
                <span className="text-sm font-mono text-text-primary">
                  {formatBytes(used)} / {limit > 0 ? formatBytes(limit) : '不限'}
                </span>
              </div>
              <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${percent > 90 ? 'bg-danger' : percent > 70 ? 'bg-warning' : 'bg-info'}`}
                  style={{ width: `${Math.max(percent, used > 0 ? 1 : 0)}%` }}
                />
              </div>
              <p className="text-xs text-text-muted">
                上传的头像、文档与打包备份会占用存储空间。
              </p>
            </div>
          );
        })()}
      </div>

      <div className="flex justify-end">
        <button
          className="btn-primary flex items-center gap-2"
          onClick={handleSave}
          disabled={saving}
        >
          {saving && <Loader2 size={16} className="animate-spin" />}
          {saving ? '保存中...' : '保存同步设置'}
        </button>
      </div>
    </div>
  );
};

export default SyncSettings;
