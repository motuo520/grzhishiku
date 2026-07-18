import { FC, useEffect, useState, useCallback, useRef } from 'react';
import {
  HardDrive, Cloud, Package, Download, Trash2, CheckCircle, AlertTriangle,
  Loader2, Crown, ExternalLink, RefreshCw, Database, X
} from 'lucide-react';
import { storageApi, DataPackage, CloudDrive } from '@/api/storage';
import { useSubscription } from '@/hooks/useSubscription';
import { useNavigate } from 'react-router-dom';

const PROVIDERS = [
  {
    key: 'baidu',
    name: '百度网盘',
    desc: '百度网盘开放平台，需配置 client_id / client_secret',
    color: 'text-network-primary',
    bg: 'bg-network-primary/10',
    border: 'border-network-primary/20',
  },
  {
    key: 'aliyun',
    name: '阿里云盘',
    desc: '阿里云盘开放平台，需配置 client_id / client_secret',
    color: 'text-network-primary',
    bg: 'bg-network-primary/10',
    border: 'border-network-primary/20',
  },
] as const;

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

const formatDate = (s?: string) => {
  if (!s) return '-';
  return new Date(s).toLocaleString('zh-CN');
};

const StorageSettings: FC = () => {
  const navigate = useNavigate();
  const { tier, currentSubscription } = useSubscription();
  const isStorageMember = tier === 'storage';

  const [packages, setPackages] = useState<DataPackage[]>([]);
  const [drives, setDrives] = useState<CloudDrive[]>([]);
  const [loading, setLoading] = useState(true);
  const [packaging, setPackaging] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const authPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (authPollRef.current) {
        clearInterval(authPollRef.current);
      }
    };
  }, []);

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [pkgRes, driveRes] = await Promise.all([
        storageApi.listPackages(),
        storageApi.listDrives(),
      ]);
      setPackages(pkgRes.data || []);
      setDrives(driveRes.data || []);
    } catch (err: any) {
      showToast(err?.response?.data?.detail || '加载存储数据失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handlePackage = async () => {
    if (!isStorageMember) {
      showToast('一键打包为存储会员功能，请先订阅', 'error');
      return;
    }
    setPackaging(true);
    try {
      const res = await storageApi.createPackage();
      if (res.data.status === 'ready') {
        showToast('数据打包完成', 'success');
      } else if (res.data.status === 'failed') {
        showToast(res.data.error_message || '打包失败', 'error');
      } else {
        showToast('打包中，请稍后刷新', 'success');
      }
      await fetchData();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      if (detail?.includes('storage') || err?.response?.status === 403) {
        showToast('该功能需要 9.9 元存储会员', 'error');
      } else {
        showToast(detail || '打包失败', 'error');
      }
    } finally {
      setPackaging(false);
    }
  };

  const handleDownload = async (pkg: DataPackage) => {
    try {
      const res = await storageApi.downloadPackage(pkg.id);
      const blob = new Blob([res.data], { type: 'application/zip' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = pkg.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      showToast(err?.response?.data?.detail || '下载失败', 'error');
    }
  };

  const handleDelete = async (pkg: DataPackage) => {
    if (!window.confirm(`确定删除打包记录 ${pkg.filename}？本地文件会一并清理。`)) return;
    setDeletingId(pkg.id);
    try {
      await storageApi.deletePackage(pkg.id);
      showToast('已删除', 'success');
      await fetchData();
    } catch (err: any) {
      showToast(err?.response?.data?.detail || '删除失败', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const handleConnect = async (providerKey: string) => {
    if (!isStorageMember) {
      showToast('绑定网盘为存储会员功能，请先订阅', 'error');
      return;
    }
    if (authPollRef.current) {
      clearInterval(authPollRef.current);
      authPollRef.current = null;
    }
    setConnecting(providerKey);
    try {
      const res = await storageApi.getAuthUrl(providerKey);
      const authWindow = window.open(res.data.url, '_blank');
      if (!authWindow) {
        showToast('请允许弹窗，或复制链接到浏览器授权', 'error');
      }
      // 轮询授权结果
      let attempts = 0;
      authPollRef.current = setInterval(async () => {
        attempts++;
        if (attempts > 30) {
          if (authPollRef.current) {
            clearInterval(authPollRef.current);
            authPollRef.current = null;
          }
          setConnecting(null);
          showToast('授权等待超时，如已完成授权请点击刷新', 'error');
          return;
        }
        try {
          const driveRes = await storageApi.listDrives();
          const connected = driveRes.data.find((d) => d.provider === providerKey && d.is_active);
          if (connected) {
            if (authPollRef.current) {
              clearInterval(authPollRef.current);
              authPollRef.current = null;
            }
            setDrives(driveRes.data);
            setConnecting(null);
            showToast(`${PROVIDERS.find((p) => p.key === providerKey)?.name} 绑定成功`, 'success');
          }
        } catch {
          // ignore polling errors
        }
      }, 2000);
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      showToast(detail || '获取授权链接失败', 'error');
      setConnecting(null);
    }
  };

  const handleDisconnect = async (providerKey: string) => {
    try {
      await storageApi.disconnectDrive(providerKey);
      showToast('已解绑', 'success');
      await fetchData();
    } catch (err: any) {
      showToast(err?.response?.data?.detail || '解绑失败', 'error');
    }
  };

  const handleUpload = async (pkg: DataPackage, providerKey: string) => {
    if (!isStorageMember) {
      showToast('上传网盘为存储会员功能', 'error');
      return;
    }
    setUploadingId(`${pkg.id}-${providerKey}`);
    try {
      const res = await storageApi.uploadToDrive(providerKey, pkg.id);
      if (res.data.success) {
        showToast('已上传到网盘', 'success');
      } else {
        showToast(res.data.package.error_message || '上传失败', 'error');
      }
      await fetchData();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      showToast(detail || '上传失败', 'error');
    } finally {
      setUploadingId(null);
    }
  };

  const getDrive = (key: string) => drives.find((d) => d.provider === key && d.is_active);

  if (loading) {
    return (
      <div className="glass-card p-10 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-info animate-spin" />
        <span className="ml-2 text-text-secondary">加载中...</span>
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
            {toast.type === 'success' ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
            <span className="text-sm">{toast.message}</span>
            <button onClick={() => setToast(null)} className="ml-2">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Membership status */}
      <div className={`glass-card p-6 ${isStorageMember ? 'border-warning/20' : ''}`}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-[2px] flex items-center justify-center ${isStorageMember ? 'bg-warning/10' : 'bg-white/5'}`}>
              {isStorageMember ? <Crown className="w-5 h-5 text-warning" /> : <HardDrive className="w-5 h-5 text-text-secondary" />}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">
                {isStorageMember ? '存储会员已生效' : 'Free 用户'}
              </h2>
              <p className="text-sm text-text-secondary">
                {isStorageMember
                  ? '已解锁一键打包 + 百度/阿里云盘直传'
                  : '一键打包备份、网盘直传为 9.9 元/月存储会员专享'}
              </p>
            </div>
          </div>
          {!isStorageMember && (
            <button
              onClick={() => navigate('/payment')}
              className="px-5 py-2.5 rounded-[2px] bg-accent text-white text-sm font-bold hover:bg-[var(--accent-hover)] transition-all flex items-center gap-2"
            >
              <Crown className="w-4 h-4" />
              开通 9.9 元存储会员
            </button>
          )}
        </div>
      </div>

      {/* One-click package */}
      <div className="glass-card p-6">
        <h3 className="text-lg font-semibold text-text-primary mb-2 flex items-center gap-2">
          <Package className="w-5 h-5 text-info" />
          一键打包个人数据
        </h3>
        <p className="text-sm text-text-secondary mb-4">
          将笔记、胶囊、剪藏、知识单元导出为 JSON 并打包成 ZIP，可直接下载或上传到自己的网盘。
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handlePackage}
            disabled={packaging}
            className="btn-primary flex items-center gap-2 disabled:opacity-50"
          >
            {packaging && <Loader2 className="w-4 h-4 animate-spin" />}
            <Package className="w-4 h-4" />
            {packaging ? '打包中...' : '立即打包'}
          </button>
          <button
            onClick={fetchData}
            className="btn-secondary flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            刷新
          </button>
        </div>
      </div>

      {/* Package list */}
      <div className="glass-card p-6">
        <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <Database className="w-5 h-5 text-personal-primary" />
          打包记录
        </h3>
        {packages.length === 0 ? (
          <div className="text-sm text-text-secondary py-6 text-center border border-white/[0.06] rounded-[2px] bg-white/[0.02]">
            暂无打包记录
          </div>
        ) : (
          <div className="space-y-3">
            {packages.map((pkg) => (
              <div
                key={pkg.id}
                className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-4 rounded-[2px] border border-white/[0.06] bg-white/[0.02]"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-text-primary truncate">{pkg.filename}</div>
                  <div className="text-xs text-text-secondary mt-1 flex flex-wrap items-center gap-3">
                    <span>{formatBytes(pkg.file_size)}</span>
                    <span>{formatDate(pkg.created_at)}</span>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${
                      pkg.status === 'ready' ? 'bg-success/10 text-success' :
                      pkg.status === 'uploaded' ? 'bg-network-primary/10 text-network-primary' :
                      pkg.status === 'failed' ? 'bg-danger/10 text-danger' :
                      'bg-warning/10 text-warning'
                    }`}>
                      {pkg.status === 'ready' && <CheckCircle className="w-3 h-3" />}
                      {pkg.status === 'uploaded' && <Cloud className="w-3 h-3" />}
                      {pkg.status === 'failed' && <AlertTriangle className="w-3 h-3" />}
                      {pkg.status === 'pending' && <Loader2 className="w-3 h-3 animate-spin" />}
                      {pkg.status === 'ready' ? '可下载' :
                       pkg.status === 'uploaded' ? `已传${pkg.provider === 'baidu' ? '百度' : pkg.provider === 'aliyun' ? '阿里云盘' : ''}` :
                       pkg.status === 'failed' ? '失败' : '打包中'}
                    </span>
                    {pkg.error_message && (
                      <span className="text-danger">{pkg.error_message}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {(pkg.status === 'ready' || pkg.status === 'uploaded') && (
                    <button
                      onClick={() => handleDownload(pkg)}
                      className="btn-secondary flex items-center gap-1.5 text-xs"
                    >
                      <Download className="w-3.5 h-3.5" />
                      下载
                    </button>
                  )}
                  {pkg.status === 'ready' && getDrive('baidu') && (
                    <button
                      onClick={() => handleUpload(pkg, 'baidu')}
                      disabled={uploadingId === `${pkg.id}-baidu`}
                      className="px-3 py-1.5 rounded-[2px] bg-network-primary/10 border border-network-primary/20 text-network-primary text-xs hover:bg-network-primary/20 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {uploadingId === `${pkg.id}-baidu` && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      传百度
                    </button>
                  )}
                  {pkg.status === 'ready' && getDrive('aliyun') && (
                    <button
                      onClick={() => handleUpload(pkg, 'aliyun')}
                      disabled={uploadingId === `${pkg.id}-aliyun`}
                      className="px-3 py-1.5 rounded-[2px] bg-network-primary/10 border border-network-primary/20 text-network-primary text-xs hover:bg-network-primary/20 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {uploadingId === `${pkg.id}-aliyun` && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      传阿里云盘
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(pkg)}
                    disabled={deletingId === pkg.id}
                    className="p-2 rounded-[2px] hover:bg-danger/10 text-text-secondary hover:text-danger transition-colors disabled:opacity-50"
                    title="删除"
                  >
                    {deletingId === pkg.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Cloud drives */}
      <div className="glass-card p-6">
        <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <Cloud className="w-5 h-5 text-network-primary" />
          我的网盘
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {PROVIDERS.map((p) => {
            const drive = getDrive(p.key);
            return (
              <div
                key={p.key}
                className={`p-5 rounded-[2px] border ${p.border} ${p.bg} flex flex-col gap-3`}
              >
                <div className="flex items-center justify-between">
                  <div className={`font-semibold ${p.color}`}>{p.name}</div>
                  {drive ? (
                    <span className="text-xs px-2 py-1 rounded-full bg-success/10 text-success flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" />
                      已绑定
                    </span>
                  ) : (
                    <span className="text-xs text-text-secondary">未绑定</span>
                  )}
                </div>
                <p className="text-xs text-text-secondary">{p.desc}</p>
                {drive ? (
                  <div className="space-y-2">
                    <div className="text-sm text-text-primary">
                      账号：{drive.account_name || '未知'}
                    </div>
                    <button
                      onClick={() => handleDisconnect(p.key)}
                      className="w-full px-3 py-2 rounded-[2px] bg-white/[0.06] border border-white/[0.08] text-text-secondary text-xs hover:text-danger hover:border-danger/30 transition-colors"
                    >
                      解绑
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => handleConnect(p.key)}
                    disabled={connecting === p.key}
                    className="w-full px-3 py-2 rounded-[2px] bg-white/[0.08] border border-white/[0.12] text-text-primary text-xs hover:bg-white/[0.12] transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    {connecting === p.key && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <ExternalLink className="w-3.5 h-3.5" />
                    {connecting === p.key ? '等待授权...' : '去授权'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default StorageSettings;
