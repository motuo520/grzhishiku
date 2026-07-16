import { FC, useState, useRef, useCallback, useEffect } from 'react';
import { User, Camera, Lock, Trash2, AlertTriangle, Eye, EyeOff, Loader2, CheckCircle, XCircle, CreditCard, RefreshCcw } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { settingsApi } from '@/api/settings';
import { clearToken } from '@/api/auth';
import apiClient from '@/api/client';

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

interface PaymentRecord {
  id: string;
  amount: number;
  currency: string;
  status: string;
  description?: string;
  paid_at?: string;
  created_at?: string;
}

const BillingHistory: FC = () => {
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
  }, []);

  const fetchPayments = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.get('/api/v1/billing/payments');
      setPayments(data || []);
    } catch (err: any) {
      showToast(err?.response?.data?.detail || '加载账单失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchPayments();
  }, [fetchPayments]);

  const handleRefund = async (paymentId: string) => {
    if (!window.confirm('确认申请退款？订阅类订单退款后会取消当前订阅。')) return;
    setRefundingId(paymentId);
    try {
      await apiClient.post(`/api/v1/billing/payments/${paymentId}/refund`, { reason: '用户申请退款' });
      showToast('退款申请已提交', 'success');
      await fetchPayments();
    } catch (err: any) {
      showToast(err?.response?.data?.detail || '退款失败', 'error');
    } finally {
      setRefundingId(null);
    }
  };

  const formatMoney = (cents?: number) =>
    typeof cents === 'number' ? `¥${(cents / 100).toFixed(2)}` : '-';

  const formatDate = (s?: string) =>
    s ? new Date(s).toLocaleString('zh-CN') : '-';

  const statusClass = (status: string) => {
    switch (status) {
      case 'success':
        return 'bg-emerald-500/10 text-emerald-400';
      case 'refunded':
        return 'bg-amber-500/10 text-amber-400';
      case 'pending':
        return 'bg-blue-500/10 text-blue-400';
      case 'failed':
        return 'bg-red-500/10 text-red-400';
      default:
        return 'bg-white/5 text-text-muted';
    }
  };

  return (
    <div className="glass-card p-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium text-text-primary flex items-center gap-2">
          <CreditCard size={18} className="text-info" />
          账单与退款
        </h3>
        <button
          onClick={() => window.location.href = '/billing'}
          className="text-xs text-info hover:underline"
        >
          查看用量与余额 →
        </button>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-text-muted text-sm">
          <Loader2 size={16} className="animate-spin" />
          加载中…
        </div>
      ) : payments.length === 0 ? (
        <p className="text-sm text-text-secondary">暂无支付记录</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] text-text-muted">
                <th className="text-left py-2 font-medium">订单号</th>
                <th className="text-left py-2 font-medium">描述</th>
                <th className="text-left py-2 font-medium">金额</th>
                <th className="text-left py-2 font-medium">状态</th>
                <th className="text-left py-2 font-medium">时间</th>
                <th className="text-right py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                  <td className="py-3 font-mono text-xs text-text-secondary">{p.id}</td>
                  <td className="py-3 text-text-secondary">{p.description || '-'}</td>
                  <td className="py-3 text-text-primary">{formatMoney(p.amount)}</td>
                  <td className="py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs ${statusClass(p.status)}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="py-3 text-text-muted text-xs">{formatDate(p.paid_at || p.created_at)}</td>
                  <td className="py-3 text-right">
                    {p.status === 'success' && (
                      <button
                        onClick={() => handleRefund(p.id)}
                        disabled={refundingId === p.id}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/[0.06] border border-white/[0.1] text-text-secondary hover:text-white hover:bg-white/[0.1] transition-colors disabled:opacity-50 text-xs"
                      >
                        {refundingId === p.id && <Loader2 size={12} className="animate-spin" />}
                        <RefreshCcw size={12} />
                        退款
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const AccountSettings: FC = () => {
  const { user, refreshUser } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState(user?.display_name || user?.name || '');
  const [username, setUsername] = useState(user?.username || '');
  const [avatarPreview, setAvatarPreview] = useState<string | null>(user?.avatar || null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [showDeletePassword, setShowDeletePassword] = useState(false);
  const [showDeleteInput, setShowDeleteInput] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
  }, []);

  const handleSaveProfile = async () => {
    setSavingProfile(true);
    try {
      await settingsApi.updateProfile({ name: displayName, display_name: displayName, username })
      await refreshUser?.();
      showToast('个人信息已保存', 'success');
    } catch (err: any) {
      showToast(err?.message || '保存失败', 'error');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(file.type)) {
      showToast('仅支持 png/jpg/jpeg/webp 格式', 'error');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      showToast('文件大小超过 2MB', 'error');
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    setAvatarPreview(previewUrl);
    setUploadingAvatar(true);
    try {
      const res = await settingsApi.uploadAvatar(file);
      setAvatarPreview(res.data.avatar_url);
      await refreshUser?.();
      showToast('头像上传成功', 'success');
    } catch (err: any) {
      showToast(err?.message || '头像上传失败', 'error');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      showToast('请填写所有密码字段', 'error');
      return;
    }
    if (newPassword.length < 8) {
      showToast('新密码至少 8 位', 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast('两次新密码不一致', 'error');
      return;
    }
    setChangingPassword(true);
    try {
      await settingsApi.changePassword({ current_password: currentPassword, new_password: newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      showToast('密码修改成功', 'success');
    } catch (err: any) {
      showToast(err?.message || '密码修改失败', 'error');
    } finally {
      setChangingPassword(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!deletePassword) {
      showToast('请输入当前密码', 'error');
      return;
    }
    if (deleteConfirmText !== '删除我的账户') {
      showToast('确认文字不匹配', 'error');
      return;
    }
    setDeleting(true);
    try {
      await settingsApi.deleteAccount({ password: deletePassword, confirmation: deleteConfirmText });
      showToast('账户已标记删除', 'success');
      setTimeout(() => {
        clearToken();
        window.location.href = '/welcome';
      }, 1500);
    } catch (err: any) {
      showToast(err?.message || '账户删除失败', 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Avatar & Profile */}
      <div className="glass-card p-6">
        <h3 className="text-lg font-medium text-text-primary mb-4 flex items-center gap-2">
          <User size={18} className="text-info" />
          个人信息
        </h3>
        <div className="flex items-start gap-6">
          <div className="relative group cursor-pointer" onClick={handleAvatarClick}>
            <div className="w-20 h-20 rounded-2xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center overflow-hidden">
              {avatarPreview ? (
                <img
                  src={avatarPreview}
                  alt="avatar"
                  className="w-full h-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <User size={32} className="text-text-muted" />
              )}
            </div>
            <div className="absolute inset-0 rounded-2xl bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <Camera size={20} className="text-white" />
            </div>
            {uploadingAvatar && (
              <div className="absolute inset-0 rounded-2xl bg-black/60 flex items-center justify-center">
                <Loader2 size={20} className="text-white animate-spin" />
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/webp"
              className="hidden"
              onChange={handleAvatarChange}
            />
          </div>
          <div className="flex-1 space-y-4">
            <div>
              <label className="text-xs text-text-secondary mb-1 block">显示名</label>
              <input
                className="input"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="你的显示名称"
              />
            </div>
            <div>
              <label className="text-xs text-text-secondary mb-1 block">用户名</label>
              <input
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="username"
              />
            </div>
            <div>
              <label className="text-xs text-text-secondary mb-1 block">邮箱</label>
              <input
                className="input opacity-60 cursor-not-allowed"
                value={user?.email || ''}
                readOnly
              />
            </div>
            <button
              className="btn-primary flex items-center gap-2"
              onClick={handleSaveProfile}
              disabled={savingProfile}
            >
              {savingProfile && <Loader2 size={16} className="animate-spin" />}
              {savingProfile ? '保存中...' : '保存个人信息'}
            </button>
          </div>
        </div>
      </div>

      {/* Password */}
      <div className="glass-card p-6">
        <h3 className="text-lg font-medium text-text-primary mb-4 flex items-center gap-2">
          <Lock size={18} className="text-info" />
          修改密码
        </h3>
        <div className="space-y-4 max-w-md">
          <div className="relative">
            <input
              className="input pr-10"
              type={showCurrent ? 'text' : 'password'}
              placeholder="当前密码"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
            <button className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary" onClick={() => setShowCurrent(!showCurrent)}>
              {showCurrent ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <div className="relative">
            <input
              className="input pr-10"
              type={showNew ? 'text' : 'password'}
              placeholder="新密码（至少 8 位）"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <button className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary" onClick={() => setShowNew(!showNew)}>
              {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <div className="relative">
            <input
              className="input pr-10"
              type={showConfirm ? 'text' : 'password'}
              placeholder="确认新密码"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
            <button className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary" onClick={() => setShowConfirm(!showConfirm)}>
              {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <button
            className="btn-primary flex items-center gap-2"
            onClick={handleChangePassword}
            disabled={changingPassword}
          >
            {changingPassword && <Loader2 size={16} className="animate-spin" />}
            {changingPassword ? '修改中...' : '修改密码'}
          </button>
        </div>
      </div>

      {/* Billing History */}
      <BillingHistory />

      {/* Danger Zone */}
      <div className="glass-card p-6 border-danger/30">
        <h3 className="text-lg font-medium text-danger mb-4 flex items-center gap-2">
          <AlertTriangle size={18} />
          危险区域
        </h3>
        <p className="text-sm text-text-secondary mb-4">
          删除账户后，您的所有数据将被标记删除，且无法恢复。此操作需要验证密码。
        </p>
        {!showDeleteInput ? (
          <button
            className="btn-danger flex items-center gap-2"
            onClick={() => setShowDeleteInput(true)}
          >
            <Trash2 size={16} />
            删除账户
          </button>
        ) : (
          <div className="space-y-3 max-w-md">
            <div className="relative">
              <input
                className="input pr-10"
                type={showDeletePassword ? 'text' : 'password'}
                placeholder="输入当前密码"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
              />
              <button className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary" onClick={() => setShowDeletePassword(!showDeletePassword)}>
                {showDeletePassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <input
              className="input border-danger/30 focus:border-danger/60"
              placeholder='请输入「删除我的账户」以确认'
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
            />
            <div className="flex gap-3">
              <button
                className="btn-danger flex items-center gap-2"
                onClick={handleDeleteAccount}
                disabled={deleting}
              >
                {deleting && <Loader2 size={16} className="animate-spin" />}
                {deleting ? '删除中...' : '确认删除'}
              </button>
              <button
                className="btn-secondary"
                onClick={() => { setShowDeleteInput(false); setDeleteConfirmText(''); setDeletePassword(''); }}
              >
                取消
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AccountSettings;
