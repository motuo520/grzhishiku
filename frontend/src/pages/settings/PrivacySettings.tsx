import { FC, useState, useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { settingsApi, UserSettings } from '@/api/settings';
import { Shield, Download, Trash2, AlertTriangle, Loader2, Check, Lock } from 'lucide-react';
import { downloadBlob, filenameFromDisposition } from '@/utils/download';

const PrivacySettings: FC = () => {
  const [localEncryption, setLocalEncryption] = useState(false);
  const [defaultPrivacyLevel, setDefaultPrivacyLevel] = useState<'public' | 'shared' | 'private'>('private');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearConfirmText, setClearConfirmText] = useState('');
  const [exportLoading, setExportLoading] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings', 'privacy'],
    queryFn: () => settingsApi.getSettings().then(r => r.data),
  });

  useEffect(() => {
    if (settings?.privacy) {
      setLocalEncryption(settings.privacy.localEncryption ?? false);
      setDefaultPrivacyLevel(settings.privacy.defaultPrivacyLevel ?? 'private');
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: (data: Partial<UserSettings>) => settingsApi.updateSettings(data),
    onSuccess: () => showToast('隐私设置已保存', 'success'),
    onError: (error: any) => showToast(error?.message || '保存失败', 'error'),
  });

  const handleSave = () => {
    saveMutation.mutate({
      privacy: {
        localEncryption,
        defaultPrivacyLevel,
      },
    });
  };

  const handleExport = async () => {
    setExportLoading(true);
    try {
      const response = await settingsApi.exportData();
      const disposition = (response.headers?.['content-disposition'] as string) || '';
      const filename = filenameFromDisposition(disposition) || `second-brain-export-${Date.now()}.json`;
      downloadBlob(new Blob([response.data], { type: 'application/json' }), filename);
      setExportMessage('数据已导出，文件已开始下载');
      showToast('导出成功', 'success');
    } catch (error: any) {
      showToast(error?.message || '导出失败', 'error');
    } finally {
      setExportLoading(false);
    }
  };

  const clearDataMutation = useMutation({
    mutationFn: () => settingsApi.clearData(),
    onSuccess: () => {
      showToast('所有数据已清除', 'success');
      setShowClearConfirm(false);
      setClearConfirmText('');
    },
    onError: (error: any) => showToast(error?.message || '数据清除失败', 'error'),
  });

  const handleClearData = () => {
    if (clearConfirmText !== '确认删除') {
      showToast('确认文字不匹配', 'error');
      return;
    }
    clearDataMutation.mutate();
  };

  if (isLoading) {
    return (
      <div className="glass-card p-8 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-info" />
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

      {/* Data Export */}
      <section className="glass-card p-6">
        <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <Download size={18} className="text-info" />
          数据导出
        </h2>
        <p className="text-sm text-text-muted mb-4">
          导出您的笔记、胶囊、剪藏、知识单元、便签、标签、稍后读、RSS 和文档为 JSON 文件，点击后立即下载。
        </p>
        <button
          onClick={handleExport}
          disabled={exportLoading}
          className="btn-secondary flex items-center gap-2"
        >
          {exportLoading && <Loader2 size={16} className="animate-spin" />}
          <Download size={16} />
          导出我的数据
        </button>
        {exportMessage && (
          <div className="mt-3 p-3 bg-info/10 border border-info/20 rounded-xl text-sm text-info">
            {exportMessage}
          </div>
        )}
      </section>

      {/* Local Encryption */}
      <section className="glass-card p-6">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-text-primary mb-1 flex items-center gap-2">
              <Lock size={18} className="text-personal-primary" />
              本地加密
            </h2>
            <p className="text-sm text-text-muted">
              启用后，敏感数据将在本地加密存储。当前为 UI 占位功能，加密逻辑将在后续版本实现。
            </p>
          </div>
          <button
            onClick={() => setLocalEncryption(!localEncryption)}
            className={`relative w-12 h-6 rounded-full transition-colors shrink-0 ml-4 ${localEncryption ? 'bg-personal-primary' : 'bg-bg-tertiary'}`}
          >
            <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${localEncryption ? 'translate-x-6' : ''}`} />
          </button>
        </div>
      </section>

      {/* Default Privacy Level */}
      <section className="glass-card p-6">
        <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <Shield size={18} className="text-network-primary" />
          默认隐私级别
        </h2>
        <p className="text-sm text-text-muted mb-4">
          设置新创建内容的默认隐私级别。
        </p>
        <div className="space-y-2">
          {([
            { value: 'public', label: '公开', desc: '所有人可见' },
            { value: 'shared', label: '共享', desc: '仅协作者可见' },
            { value: 'private', label: '私密', desc: '仅自己可见' },
          ] as const).map(opt => (
            <label
              key={opt.value}
              className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                defaultPrivacyLevel === opt.value
                  ? 'border-network-primary/40 bg-network-primary/5'
                  : 'border-white/[0.08] hover:border-white/[0.15]'
              }`}
            >
              <input
                type="radio"
                name="privacyLevel"
                value={opt.value}
                checked={defaultPrivacyLevel === opt.value}
                onChange={() => setDefaultPrivacyLevel(opt.value)}
                className="accent-network-primary"
              />
              <div>
                <div className="text-sm font-medium text-text-primary">{opt.label}</div>
                <div className="text-xs text-text-muted">{opt.desc}</div>
              </div>
            </label>
          ))}
        </div>
      </section>

      {/* Data Deletion */}
      <section className="glass-card p-6 border-danger/20">
        <h2 className="text-lg font-semibold text-danger mb-4 flex items-center gap-2">
          <AlertTriangle size={18} />
          数据清除
        </h2>
        <p className="text-sm text-text-muted mb-4">
          清除所有笔记、胶囊、剪藏、知识单元、便签、提醒、标签、稍后读、RSS 订阅和文档。账户与订阅保留，此操作不可恢复，请谨慎操作。
        </p>

        {!showClearConfirm ? (
          <button
            onClick={() => setShowClearConfirm(true)}
            className="px-5 py-2.5 bg-danger/10 text-danger border border-danger/30 rounded-xl font-medium transition-all hover:bg-danger/20 flex items-center gap-2"
          >
            <Trash2 size={16} />
            清除所有数据
          </button>
        ) : (
          <div className="space-y-4 max-w-md">
            <div className="p-3 bg-danger/10 border border-danger/20 rounded-xl text-sm text-danger">
              请输入「确认删除」以确认清除所有数据
            </div>
            <input
              className="input"
              placeholder="输入：确认删除"
              value={clearConfirmText}
              onChange={e => setClearConfirmText(e.target.value)}
            />
            <div className="flex gap-3">
              <button
                onClick={handleClearData}
                disabled={clearDataMutation.isPending}
                className="px-5 py-2.5 bg-danger text-white rounded-xl font-medium transition-all flex items-center gap-2 disabled:opacity-60"
              >
                {clearDataMutation.isPending && <Loader2 size={16} className="animate-spin" />}
                <Trash2 size={16} />
                确认清除
              </button>
              <button
                onClick={() => {
                  setShowClearConfirm(false);
                  setClearConfirmText('');
                }}
                className="btn-secondary"
              >
                取消
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Save */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saveMutation.isPending}
          className="btn-primary flex items-center gap-2"
        >
          {saveMutation.isPending && <Loader2 size={16} className="animate-spin" />}
          <Check size={16} />
          保存隐私设置
        </button>
      </div>
    </div>
  );
};

export default PrivacySettings;
