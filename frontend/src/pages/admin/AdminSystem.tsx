import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Settings, ToggleLeft, ToggleRight, AlertTriangle, Save, RefreshCw,
  Globe, Lock, Unlock, Megaphone, UserPlus
} from 'lucide-react';
import adminApi from '../../services/adminApi';

interface FeatureFlag {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  scope: string;
}

interface Announcement {
  title: string;
  content: string;
  effective_at: string;
}

interface SystemConfig {
  feature_flags: FeatureFlag[];
  announcement: Announcement;
  maintenance_mode: { enabled: boolean; resume_at: string };
  registration_open: boolean;
}

function ShimmerCard() {
  return (
    <div className="bg-admin-sidebar rounded-xl border border-admin-border p-6 animate-pulse">
      <div className="h-4 bg-admin-hover rounded w-32 mb-4" />
      <div className="h-8 bg-admin-hover rounded w-20" />
    </div>
  );
}

export default function AdminSystem() {
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [previewMode, setPreviewMode] = useState(false);

  const fetchConfig = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await adminApi.getSystemConfig();
      setConfig(res.data);
    } catch (err: any) {
      setError(err.response?.data?.detail || '加载配置失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    setSaveError('');
    try {
      await adminApi.updateSystemConfig(config);
    } catch (err: any) {
      setSaveError(err.response?.data?.detail || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const toggleFeature = (key: string) => {
    setConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        feature_flags: prev.feature_flags.map((f) =>
          f.key === key ? { ...f, enabled: !f.enabled } : f
        ),
      };
    });
  };

  const updateAnnouncement = (field: keyof Announcement, value: string) => {
    setConfig((prev) => {
      if (!prev) return prev;
      return { ...prev, announcement: { ...prev.announcement, [field]: value } };
    });
  };

  const updateMaintenance = (field: keyof SystemConfig['maintenance_mode'], value: boolean | string) => {
    setConfig((prev) => {
      if (!prev) return prev;
      return { ...prev, maintenance_mode: { ...prev.maintenance_mode, [field]: value } };
    });
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white mb-2">系统配置</h1>
          <p className="text-admin-muted">系统配置与功能开关</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ShimmerCard />
          <ShimmerCard />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white mb-2">系统配置</h1>
          <p className="text-admin-muted">系统配置与功能开关</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchConfig}
            className="flex items-center gap-2 px-3 py-2 bg-admin-sidebar border border-admin-border rounded-lg text-sm text-admin-muted hover:text-white hover:bg-admin-hover transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            刷新
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-admin-primary text-white rounded-lg text-sm font-medium hover:bg-admin-primary/90 transition-colors disabled:opacity-50"
          >
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? '保存中...' : '保存配置'}
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 bg-danger/10 border border-danger/20 rounded-lg text-danger text-sm">
          {error}
        </div>
      )}
      {saveError && (
        <div className="px-4 py-3 bg-danger/10 border border-danger/20 rounded-lg text-danger text-sm">
          {saveError}
        </div>
      )}

      {/* Feature Flags */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-admin-sidebar rounded-xl border border-admin-border p-6"
      >
        <div className="flex items-center gap-3 mb-6">
          <Settings className="w-5 h-5 text-admin-primary" />
          <h2 className="text-lg font-semibold text-white">Feature Flags</h2>
        </div>
        <div className="space-y-3">
          {(config?.feature_flags || []).map((flag) => (
            <div
              key={flag.key}
              className="flex items-center justify-between py-3 px-4 bg-admin-bg rounded-lg border border-admin-border hover:border-admin-primary/30 transition-colors"
            >
              <div>
                <div className="text-sm font-medium text-white">{flag.name}</div>
                <div className="text-xs text-admin-muted mt-0.5">{flag.description}</div>
                <div className="text-xs text-admin-primary mt-0.5">影响范围: {flag.scope}</div>
              </div>
              <button
                onClick={() => toggleFeature(flag.key)}
                className="p-1 transition-transform active:scale-95"
              >
                {flag.enabled ? (
                  <ToggleRight className="w-6 h-6 text-success" />
                ) : (
                  <ToggleLeft className="w-6 h-6 text-admin-muted" />
                )}
              </button>
            </div>
          ))}
          {(!config?.feature_flags || config.feature_flags.length === 0) && (
            <p className="text-sm text-admin-muted text-center py-4">暂无功能开关</p>
          )}
        </div>
      </motion.div>

      {/* System Announcement */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-admin-sidebar rounded-xl border border-admin-border p-6"
      >
        <div className="flex items-center gap-3 mb-6">
          <Megaphone className="w-5 h-5 text-personal-primary" />
          <h2 className="text-lg font-semibold text-white">系统公告</h2>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-admin-muted mb-1.5">公告标题</label>
            <input
              type="text"
              value={config?.announcement?.title || ''}
              onChange={(e) => updateAnnouncement('title', e.target.value)}
              placeholder="输入公告标题..."
              className="w-full px-4 py-2.5 bg-admin-bg border border-admin-border rounded-lg text-white placeholder-admin-muted focus:outline-none focus:border-admin-primary"
            />
          </div>
          <div>
            <label className="block text-sm text-admin-muted mb-1.5">公告内容</label>
            <div className="flex items-center gap-2 mb-2">
              <button
                onClick={() => setPreviewMode(false)}
                className={`px-2 py-1 rounded text-xs ${!previewMode ? 'bg-admin-primary text-white' : 'text-admin-muted hover:text-white'}`}
              >
                编辑
              </button>
              <button
                onClick={() => setPreviewMode(true)}
                className={`px-2 py-1 rounded text-xs ${previewMode ? 'bg-admin-primary text-white' : 'text-admin-muted hover:text-white'}`}
              >
                预览
              </button>
            </div>
            {!previewMode ? (
              <textarea
                value={config?.announcement?.content || ''}
                onChange={(e) => updateAnnouncement('content', e.target.value)}
                placeholder="支持 Markdown 格式..."
                rows={5}
                className="w-full px-4 py-2.5 bg-admin-bg border border-admin-border rounded-lg text-white placeholder-admin-muted focus:outline-none focus:border-admin-primary resize-none font-mono text-sm"
              />
            ) : (
              <div className="w-full px-4 py-2.5 bg-admin-bg border border-admin-border rounded-lg text-white min-h-[120px] prose prose-invert prose-sm max-w-none">
                <div className="text-xs text-admin-muted mb-2">Markdown 预览</div>
                <div className="whitespace-pre-wrap">{config?.announcement?.content || '（无内容）'}</div>
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm text-admin-muted mb-1.5">生效时间</label>
            <input
              type="datetime-local"
              value={config?.announcement?.effective_at?.slice(0, 16) || ''}
              onChange={(e) => updateAnnouncement('effective_at', new Date(e.target.value).toISOString())}
              className="px-4 py-2.5 bg-admin-bg border border-admin-border rounded-lg text-white focus:outline-none focus:border-admin-primary"
            />
          </div>
        </div>
      </motion.div>

      {/* Maintenance Mode & Registration */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="bg-admin-sidebar rounded-xl border border-admin-border p-6"
      >
        <div className="flex items-center gap-3 mb-6">
          <Globe className="w-5 h-5 text-network-primary" />
          <h2 className="text-lg font-semibold text-white">运行控制</h2>
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-between py-3 px-4 bg-admin-bg rounded-lg border border-admin-border">
            <div className="flex items-center gap-3">
              {config?.maintenance_mode?.enabled ? <Lock className="w-4 h-4 text-warning" /> : <Unlock className="w-4 h-4 text-success" />}
              <div>
                <div className="text-sm font-medium text-white">维护模式</div>
                <div className="text-xs text-admin-muted">开启后仅管理员可访问系统</div>
              </div>
            </div>
            <button
              onClick={() => updateMaintenance('enabled', !config?.maintenance_mode?.enabled)}
              className="p-1 transition-transform active:scale-95"
            >
              {config?.maintenance_mode?.enabled ? (
                <ToggleRight className="w-6 h-6 text-warning" />
              ) : (
                <ToggleLeft className="w-6 h-6 text-admin-muted" />
              )}
            </button>
          </div>
          <AnimatePresence>
            {config?.maintenance_mode?.enabled && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="px-4 pb-2">
                  <label className="block text-sm text-admin-muted mb-1.5">预计恢复时间</label>
                  <input
                    type="datetime-local"
                    value={config?.maintenance_mode?.resume_at?.slice(0, 16) || ''}
                    onChange={(e) => updateMaintenance('resume_at', new Date(e.target.value).toISOString())}
                    className="px-4 py-2.5 bg-admin-bg border border-admin-border rounded-lg text-white focus:outline-none focus:border-admin-primary"
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex items-center justify-between py-3 px-4 bg-admin-bg rounded-lg border border-admin-border">
            <div className="flex items-center gap-3">
              <UserPlus className="w-4 h-4 text-success" />
              <div>
                <div className="text-sm font-medium text-white">开放注册</div>
                <div className="text-xs text-admin-muted">允许新用户注册账号</div>
              </div>
            </div>
            <button
              onClick={() => setConfig((prev) => prev ? { ...prev, registration_open: !prev.registration_open } : prev)}
              className="p-1 transition-transform active:scale-95"
            >
              {config?.registration_open ? (
                <ToggleRight className="w-6 h-6 text-success" />
              ) : (
                <ToggleLeft className="w-6 h-6 text-admin-muted" />
              )}
            </button>
          </div>
        </div>
      </motion.div>

      {/* Danger Zone */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-admin-sidebar rounded-xl border border-danger/30 p-6"
      >
        <div className="flex items-center gap-3 mb-4">
          <AlertTriangle className="w-5 h-5 text-danger" />
          <h2 className="text-lg font-semibold text-danger">危险区域</h2>
        </div>
        <p className="text-sm text-admin-muted mb-4">
          以下配置修改后会立即生效，无需重启服务。请谨慎操作。
        </p>
        <div className="flex items-center gap-3 px-4 py-3 bg-danger/5 rounded-lg border border-danger/10">
          <AlertTriangle className="w-4 h-4 text-danger flex-shrink-0" />
          <span className="text-sm text-danger">
            修改维护模式或注册开关将立即影响所有用户访问。建议在低峰时段进行变更。
          </span>
        </div>
      </motion.div>
    </div>
  );
}
