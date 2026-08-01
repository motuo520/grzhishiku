import { FC, useState, useEffect, useCallback } from 'react';
import { RefreshCw, Loader2, CheckCircle, XCircle, HardDrive, Info, Trash2, Download, Upload, KeyRound, Smartphone } from 'lucide-react';
import { settingsApi } from '@/api/settings';
import { useAuth } from '@/hooks/useAuth';
import { unifiedSyncApi, getFingerprint } from '@/api/unifiedSync';
import type { SyncDevice } from '@/api/sync';
import { encryptSnapshot, decryptSnapshot } from '@/services/syncCrypto';

const SYNC_FORMAT = 'psb-sync-v1';

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
    <div className={`fixed top-5 right-5 z-50 flex items-center gap-2 px-4 py-3 rounded-[2px] border ${
      type === 'success'
        ? 'bg-success/10 border-success/30 text-success'
        : 'bg-danger/10 border-danger/30 text-danger'
    }`}>
      {type === 'success' ? <CheckCircle size={18} /> : <XCircle size={18} />}
      <span className="text-sm">{message}</span>
    </div>
  );
};

const defaultSync: SyncConfig = {
  frequency: 'manual',
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

const getDeviceName = () => {
  const ua = navigator.userAgent;
  if (ua.includes('Win')) return 'Windows 设备';
  if (ua.includes('Mac')) return 'Mac 设备';
  if (ua.includes('Linux')) return 'Linux 设备';
  if (ua.includes('Android')) return 'Android 设备';
  if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS 设备';
  return '浏览器设备';
};

const SYNC_PASSWORD_KEY = 'psb-sync-password';

const SyncSettings: FC = () => {
  const { user } = useAuth();

  const [settings, setSettings] = useState<SyncConfig>(defaultSync);
  const [password, setPassword] = useState(() => sessionStorage.getItem(SYNC_PASSWORD_KEY) || '');
  const [devices, setDevices] = useState<SyncDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      settingsApi.getSettings().then(res => {
        const sync = res.data.sync;
        if (sync) {
          setSettings({
            frequency: (sync.frequency as SyncConfig['frequency']) || 'manual',
            conflictStrategy: (sync.conflictStrategy as SyncConfig['conflictStrategy']) || 'latest',
            offlineMode: sync.offlineMode ?? false,
          });
        }
      }),
      loadDevices(),
    ])
      .catch(() => showToast('加载设置失败', 'error'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showToast]);

  async function loadDevices() {
    const { data } = await unifiedSyncApi.listDevices();
    setDevices(data || []);
  }

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

  const handleSetPassword = () => {
    if (!password.trim()) {
      showToast('请输入同步密码', 'error');
      return;
    }
    sessionStorage.setItem(SYNC_PASSWORD_KEY, password);
    showToast('同步密码已设置（仅保存在本页面会话）', 'success');
  };

  const handlePush = async () => {
    if (!password) {
      showToast('请先设置同步密码', 'error');
      return;
    }
    setSyncing(true);
    try {
      const fp = getFingerprint();
      await unifiedSyncApi.registerDevice(getDeviceName());
      // 真快照：全量导出内容数据（笔记/剪藏/知识单元/胶囊/标签等）
      const exportRes = await unifiedSyncApi.exportJson();
      const payload = { format: SYNC_FORMAT, ...exportRes.data };
      const encrypted = await encryptSnapshot(payload, password);
      const blob = new Blob([JSON.stringify(encrypted)], { type: 'application/octet-stream' });
      const formData = new FormData();
      formData.append('file', blob, 'snapshot.enc');
      formData.append('fingerprint', fp);
      formData.append('salt', encrypted.salt);
      formData.append('iv', encrypted.iv);
      formData.append('entity_count', String(exportRes.data.total_records ?? 0));
      await unifiedSyncApi.uploadSnapshot(formData);
      await loadDevices();
      showToast(`已上传加密快照（${exportRes.data.total_records ?? 0} 条记录）`, 'success');
    } catch (err: any) {
      showToast(err?.message || '同步失败', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const handlePull = async () => {
    if (!password) {
      showToast('请先设置同步密码', 'error');
      return;
    }
    setPulling(true);
    try {
      const { data: snapshot } = await unifiedSyncApi.getLatestSnapshot();
      if (!snapshot) {
        showToast('云端暂无快照', 'error');
        return;
      }
      // 经后端下载密文，不依赖 S3 公网可达
      const dl = await unifiedSyncApi.downloadLatestSnapshot();
      const encrypted = typeof dl.data === 'string' ? JSON.parse(dl.data) : dl.data;
      const payload = await decryptSnapshot<any>(encrypted, password);
      if (payload?.format !== SYNC_FORMAT || !payload?.data) {
        showToast('旧格式快照不支持恢复，请先在另一端重新上传', 'error');
        return;
      }
      const { data: stats } = await unifiedSyncApi.importJson(payload);
      showToast(
        `恢复完成：新增 ${stats.inserted} 条、更新 ${stats.updated} 条、跳过 ${stats.skipped} 条`,
        'success'
      );
    } catch (err: any) {
      showToast(err?.message || '拉取失败，可能是密码错误', 'error');
    } finally {
      setPulling(false);
    }
  };

  const handleRemoveDevice = async (id: string) => {
    try {
      await unifiedSyncApi.removeDevice(id);
      await loadDevices();
      showToast('设备已移除', 'success');
    } catch (err: any) {
      showToast(err?.message || '移除失败', 'error');
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

      <div className="glass-card p-4 border-info/20 flex items-start gap-3">
        <Info size={16} className="text-info shrink-0 mt-0.5" />
        <p className="text-xs text-text-secondary">
          云同步采用端到端加密：同步密码不会上传到服务器，丢失后无法恢复数据，请务必牢记。
          当前版本同步新增与修改的内容，删除操作不会同步。
        </p>
      </div>


      {/* Sync password */}
      <div className="glass-card p-6">
        <h3 className="text-lg font-medium text-text-primary mb-4 flex items-center gap-2">
          <KeyRound size={18} className="text-info" />
          同步密码
        </h3>
        <div className="flex gap-3">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="设置一个用于加密同步数据的密码"
            className="flex-1 bg-bg-secondary border border-white/[0.06] rounded-[2px] px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-info/40"
          />
          <button
            className="btn-primary px-4 py-2 text-sm"
            onClick={handleSetPassword}
            disabled={!password.trim()}
          >
            确认
          </button>
        </div>
        <p className="text-xs text-text-muted mt-2">
          密码仅保存在当前浏览器标签页，刷新后需重新输入。
        </p>
      </div>

      {/* Manual sync */}
      <div className="glass-card p-6">
        <h3 className="text-lg font-medium text-text-primary mb-4 flex items-center gap-2">
          <RefreshCw size={18} className="text-info" />
          手动同步
        </h3>
        <div className="flex flex-wrap gap-3">
          <button
            className="btn-primary flex items-center gap-2 px-4 py-2"
            onClick={handlePush}
            disabled={syncing}
          >
            {syncing && <Loader2 size={16} className="animate-spin" />}
            <Upload size={16} />
            {syncing ? '上传中...' : '立即上传快照'}
          </button>
          <button
            className="btn-secondary flex items-center gap-2 px-4 py-2"
            onClick={handlePull}
            disabled={pulling}
          >
            {pulling && <Loader2 size={16} className="animate-spin" />}
            <Download size={16} />
            {pulling ? '拉取中...' : '从云端恢复'}
          </button>
        </div>
      </div>

      {/* Devices */}
      <div className="glass-card p-6">
        <h3 className="text-lg font-medium text-text-primary mb-4 flex items-center gap-2">
          <Smartphone size={18} className="text-info" />
          已同步设备
        </h3>
        {devices.length === 0 ? (
          <p className="text-sm text-text-secondary">暂无设备，点击「立即上传快照」即可注册当前设备。</p>
        ) : (
          <ul className="space-y-2">
            {devices.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between p-3 rounded-[2px] border border-white/[0.06] bg-white/[0.02]"
              >
                <div>
                  <div className="text-sm font-medium text-text-primary">
                    {d.name}
                    {d.fingerprint === getFingerprint() && (
                      <span className="ml-2 text-xs text-info">本机</span>
                    )}
                  </div>
                  <div className="text-xs text-text-muted">
                    最后在线：{d.last_seen_at ? new Date(d.last_seen_at).toLocaleString() : '未知'}
                    {d.last_sync_at && ` · 最后同步：${new Date(d.last_sync_at).toLocaleString()}`}
                  </div>
                </div>
                <button
                  onClick={() => handleRemoveDevice(d.id)}
                  className="p-2 rounded-[2px] hover:bg-danger/10 text-text-muted hover:text-danger transition-colors"
                  title="移除设备"
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
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
              <div className="w-full h-2 bg-white/5 rounded-[2px] overflow-hidden">
                <div
                  className={`h-full rounded-[2px] transition-all ${percent > 90 ? 'bg-danger' : percent > 70 ? 'bg-warning' : 'bg-info'}`}
                  style={{ width: `${Math.max(percent, used > 0 ? 1 : 0)}%` }}
                />
              </div>
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
