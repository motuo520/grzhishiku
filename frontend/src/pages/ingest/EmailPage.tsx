import { FC, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mail, Plus, Search, Trash2, RefreshCw, AlertCircle, X, Loader2,
  Check, BookOpen, Clock, Eye, Tag, Filter
} from 'lucide-react';
import { useEmailAccounts, useEmailMessages } from '@/hooks/useEmail';
import { useTags } from '@/hooks/useTags';
import TagSelector from '@/components/TagSelector';
import type { EmailAccount, EmailMessage } from '@/api/email';

const PROVIDER_OPTIONS = [
  { key: 'gmail', label: 'Gmail', host: 'imap.gmail.com', port: 993 },
  { key: 'outlook', label: 'Outlook / 365', host: 'outlook.office365.com', port: 993 },
  { key: 'qq', label: 'QQ 邮箱', host: 'imap.qq.com', port: 993 },
  { key: '163', label: '163 邮箱', host: 'imap.163.com', port: 993 },
  { key: '126', label: '126 邮箱', host: 'imap.126.com', port: 993 },
  { key: 'sina', label: '新浪邮箱', host: 'imap.sina.com', port: 993 },
  { key: 'imap_other', label: '其他 IMAP', host: '', port: 993 },
];

const EmailPage: FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [isAddAccountOpen, setIsAddAccountOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [detailMessage, setDetailMessage] = useState<EmailMessage | null>(null);
  const [saveTagIds, setSaveTagIds] = useState<string[]>([]);

  const [provider, setProvider] = useState('gmail');
  const [emailAddress, setEmailAddress] = useState('');
  const [imapHost, setImapHost] = useState('imap.gmail.com');
  const [imapPort, setImapPort] = useState(993);
  const [authCode, setAuthCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const { accounts, isLoading: isAccountsLoading, createAccount, deleteAccount, syncAccount, isCreating, isDeleting, isSyncing } = useEmailAccounts();
  const { tags: allTags, isLoading: isTagsLoading } = useTags();
  const {
    messages,
    isLoading: isMessagesLoading,
    saveToKnowledge,
    deleteMessage,
    isSavingToKnowledge,
    isDeleting: isDeletingMessage,
  } = useEmailMessages({
    account_id: selectedAccountId || undefined,
    q: searchQuery || undefined,
  });

  const showError = (message: string) => {
    setError(message);
    setSuccess(null);
    setTimeout(() => setError(null), 4000);
  };

  const showSuccess = (message: string) => {
    setSuccess(message);
    setError(null);
    setTimeout(() => setSuccess(null), 3000);
  };

  const handleProviderChange = (key: string) => {
    setProvider(key);
    const preset = PROVIDER_OPTIONS.find((p) => p.key === key);
    if (preset && preset.host) {
      setImapHost(preset.host);
      setImapPort(preset.port);
    }
  };

  const resetAddForm = () => {
    setProvider('gmail');
    setEmailAddress('');
    setImapHost('imap.gmail.com');
    setImapPort(993);
    setAuthCode('');
    setError(null);
  };

  const handleAddAccount = async () => {
    if (!emailAddress.trim() || !authCode.trim() || !imapHost.trim()) {
      showError('邮箱地址、授权码和 IMAP 服务器不能为空');
      return;
    }
    try {
      await createAccount({
        provider,
        email_address: emailAddress.trim(),
        imap_host: imapHost.trim(),
        imap_port: imapPort,
        access_token: authCode.trim(),
      });
      setIsAddAccountOpen(false);
      resetAddForm();
      showSuccess('邮箱账号添加成功');
    } catch (err: any) {
      showError(err.message || '添加失败，请检查授权码和 IMAP 设置');
    }
  };

  const handleDeleteAccount = async (id: string) => {
    if (!confirm('确定要删除这个邮箱账号吗？同步的邮件也会被移除。')) return;
    try {
      await deleteAccount(id);
      showSuccess('账号已删除');
    } catch (err: any) {
      showError(err.message || '删除失败');
    }
  };

  const handleSync = async (account: EmailAccount) => {
    try {
      const res = await syncAccount({ id: account.id, maxMessages: 50 });
      showSuccess(`同步完成，新增 ${res.data.synced_count} 封邮件`);
    } catch (err: any) {
      showError(err.message || '同步失败');
    }
  };

  const handleSaveToKnowledge = async (msg: EmailMessage) => {
    try {
      await saveToKnowledge({ id: msg.id, tag_ids: saveTagIds });
      showSuccess('已保存到 知识库 · 网络脑知识');
      setIsDetailOpen(false);
      setSaveTagIds([]);
    } catch (err: any) {
      showError(err.message || '保存失败');
    }
  };

  const openDetail = (msg: EmailMessage) => {
    setDetailMessage(msg);
    setSaveTagIds([]);
    setIsDetailOpen(true);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getPreviewText = (msg: EmailMessage, maxLen = 120) => {
    const text = msg.body_text || '';
    const clean = text.replace(/\s+/g, ' ').trim();
    return clean.length > maxLen ? clean.slice(0, maxLen) + '...' : clean;
  };

  const getAccountLabel = (accountId: string) => {
    const account = accounts?.find((a) => a.id === accountId);
    return account ? `${account.email_address} (${PROVIDER_OPTIONS.find(p => p.key === account.provider)?.label || account.provider})` : '';
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">邮件集成</h1>
          <p className="text-sm text-text-secondary mt-1">把收件箱沉淀的信息纳入知识库</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="badge-network">Network Brain</span>
          <button onClick={() => { resetAddForm(); setIsAddAccountOpen(true); }} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" />
            添加邮箱
          </button>
        </div>
      </div>

      {/* Banners */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex items-center gap-2 px-4 py-3 rounded-[2px] bg-danger/10 border border-danger/30 text-danger text-sm"
          >
            <AlertCircle className="w-4 h-4" />
            {error}
            <button onClick={() => setError(null)} className="ml-auto">
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
        {success && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex items-center gap-2 px-4 py-3 rounded-[2px] bg-success/10 border border-success/30 text-success text-sm"
          >
            <Check className="w-4 h-4" />
            {success}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Accounts */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
            <Mail className="w-4 h-4" />
            已连接邮箱
          </h3>
          <span className="text-xs text-text-muted">{accounts?.length || 0} 个账号</span>
        </div>
        {isAccountsLoading ? (
          <Loader2 className="w-5 h-5 animate-spin text-info" />
        ) : !accounts || accounts.length === 0 ? (
          <div className="text-sm text-text-secondary">暂无邮箱账号，点击右上角添加</div>
        ) : (
          <div className="space-y-2">
            {accounts.map((account) => (
              <div
                key={account.id}
                className={`flex items-center justify-between p-3 rounded-[2px] border transition-colors ${
                  selectedAccountId === account.id ? 'border-info/50 bg-info/5' : 'border-border-color bg-bg-primary'
                }`}
              >
                <div className="flex items-center gap-3 cursor-pointer flex-1" onClick={() => setSelectedAccountId(account.id === selectedAccountId ? '' : account.id)}>
                  <div className="w-8 h-8 rounded-[2px] bg-bg-tertiary flex items-center justify-center text-text-secondary">
                    <Mail className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-text-primary">{account.email_address}</div>
                    <div className="text-xs text-text-muted">
                      {PROVIDER_OPTIONS.find((p) => p.key === account.provider)?.label || account.provider} ·
                      同步 {account.sync_count} 封 ·
                      {account.sync_status === 'syncing' ? (
                        <span className="text-info ml-1">同步中</span>
                      ) : account.sync_status === 'error' ? (
                        <span className="text-danger ml-1">失败</span>
                      ) : account.last_sync_at ? (
                        <span className="text-success ml-1">已同步</span>
                      ) : (
                        <span className="text-text-muted ml-1">未同步</span>
                      )}
                    </div>
                    {account.last_error && (
                      <div className="text-[10px] text-danger mt-0.5">{account.last_error}</div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleSync(account)}
                    disabled={isSyncing}
                    className="p-1.5 rounded-[2px] hover:bg-white/[0.05] text-text-muted hover:text-info transition-colors disabled:opacity-50"
                    title="同步邮件"
                  >
                    {isSyncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => handleDeleteAccount(account.id)}
                    disabled={isDeleting}
                    className="p-1.5 rounded-[2px] hover:bg-white/[0.05] text-text-muted hover:text-danger transition-colors disabled:opacity-50"
                    title="删除账号"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索邮件主题、正文..."
              className="w-full bg-bg-secondary border border-border-color rounded-[2px] pl-10 pr-4 py-2.5 text-sm text-text-primary placeholder-text-secondary focus:outline-none focus:border-info/50 transition-colors"
            />
          </div>
          {selectedAccountId && (
            <button
              onClick={() => setSelectedAccountId('')}
              className="btn-secondary text-xs flex items-center gap-1"
            >
              <Filter className="w-3.5 h-3.5" />
              清除筛选
            </button>
          )}
        </div>

        {selectedAccountId && (
          <div className="text-xs text-text-muted">当前查看：{getAccountLabel(selectedAccountId)}</div>
        )}

        {isMessagesLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 text-info animate-spin" />
          </div>
        ) : !messages || messages.length === 0 ? (
          <div className="card flex flex-col items-center justify-center py-20">
            <Mail className="w-16 h-16 text-text-muted mb-4" />
            <p className="text-text-secondary">暂无邮件</p>
            <p className="text-xs text-text-muted mt-2">添加邮箱后点击同步按钮导入</p>
          </div>
        ) : (
          <div className="space-y-2">
            <AnimatePresence>
              {messages.map((msg) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="card group"
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 p-1.5 rounded-[2px] bg-bg-tertiary text-text-secondary shrink-0">
                      <Mail className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-medium text-text-primary truncate">{msg.subject || '(无主题)'}</div>
                        {msg.status === 'imported_to_knowledge' && (
                          <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-success/10 text-success border border-success/30">
                            已入库
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-text-muted mt-1">
                        <span>{msg.sender_name || msg.sender_email || '未知发件人'}</span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatDate(msg.received_at)}
                        </span>
                      </div>
                      <p className="text-xs text-text-secondary mt-2 line-clamp-2 leading-relaxed">
                        {getPreviewText(msg)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => openDetail(msg)}
                        className="p-1.5 rounded-[2px] hover:bg-white/[0.05] text-text-muted hover:text-info transition-colors"
                        title="查看详情"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => openDetail(msg)}
                        className="p-1.5 rounded-[2px] hover:bg-white/[0.05] text-text-muted hover:text-success transition-colors"
                        title="保存到知识库"
                      >
                        <BookOpen className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => deleteMessage(msg.id)}
                        disabled={isDeletingMessage}
                        className="p-1.5 rounded-[2px] hover:bg-white/[0.05] text-text-muted hover:text-danger transition-colors disabled:opacity-50"
                        title="删除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Add Account Modal */}
      <AnimatePresence>
        {isAddAccountOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={() => setIsAddAccountOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg bg-bg-secondary border border-border-color rounded-[2px] overflow-hidden"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-border-color">
                <h3 className="text-sm font-medium text-text-primary">添加邮箱账号</h3>
                <button onClick={() => setIsAddAccountOpen(false)} className="p-1 rounded-[2px] hover:bg-white/[0.05] text-text-muted">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="block text-xs text-text-muted mb-1.5">邮箱服务商</label>
                  <select
                    value={provider}
                    onChange={(e) => handleProviderChange(e.target.value)}
                    className="w-full bg-bg-primary border border-border-color rounded-[2px] px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:border-info/50"
                  >
                    {PROVIDER_OPTIONS.map((p) => (
                      <option key={p.key} value={p.key}>{p.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1.5">邮箱地址</label>
                  <input
                    type="email"
                    value={emailAddress}
                    onChange={(e) => setEmailAddress(e.target.value)}
                    placeholder="name@example.com"
                    className="w-full bg-bg-primary border border-border-color rounded-[2px] px-4 py-2.5 text-sm text-text-primary placeholder-text-secondary focus:outline-none focus:border-info/50 transition-colors"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-text-muted mb-1.5">IMAP 服务器</label>
                    <input
                      type="text"
                      value={imapHost}
                      onChange={(e) => setImapHost(e.target.value)}
                      placeholder="imap.example.com"
                      disabled={provider !== 'imap_other'}
                      className="w-full bg-bg-primary border border-border-color rounded-[2px] px-4 py-2.5 text-sm text-text-primary placeholder-text-secondary focus:outline-none focus:border-info/50 transition-colors disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-text-muted mb-1.5">端口</label>
                    <input
                      type="number"
                      value={imapPort}
                      onChange={(e) => setImapPort(parseInt(e.target.value) || 993)}
                      placeholder="993"
                      disabled={provider !== 'imap_other'}
                      className="w-full bg-bg-primary border border-border-color rounded-[2px] px-4 py-2.5 text-sm text-text-primary placeholder-text-secondary focus:outline-none focus:border-info/50 transition-colors disabled:opacity-50"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1.5">
                    授权码 / 应用专用密码
                    <span className="ml-2 text-[10px] text-[#484f58]">不保存邮箱登录密码</span>
                  </label>
                  <input
                    type="password"
                    value={authCode}
                    onChange={(e) => setAuthCode(e.target.value)}
                    placeholder="填入邮箱提供的授权码"
                    className="w-full bg-bg-primary border border-border-color rounded-[2px] px-4 py-2.5 text-sm text-text-primary placeholder-text-secondary focus:outline-none focus:border-info/50 transition-colors"
                  />
                  <p className="text-[10px] text-text-muted mt-1.5">
                    QQ/163/126 等国内邮箱需要先在设置里开启 IMAP/SMTP 服务，并使用「授权码」而非登录密码。
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border-color">
                <button onClick={() => setIsAddAccountOpen(false)} className="btn-secondary text-xs py-2 px-4">
                  取消
                </button>
                <button
                  onClick={handleAddAccount}
                  disabled={isCreating}
                  className="btn-primary flex items-center gap-2 text-xs py-2 px-4 disabled:opacity-60"
                >
                  {isCreating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  添加并验证
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Detail Modal */}
      <AnimatePresence>
        {isDetailOpen && detailMessage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={() => setIsDetailOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-3xl max-h-[85vh] bg-bg-secondary border border-border-color rounded-[2px] overflow-hidden flex flex-col"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-border-color">
                <h3 className="text-sm font-medium text-text-primary truncate pr-4">{detailMessage.subject || '(无主题)'}</h3>
                <button onClick={() => setIsDetailOpen(false)} className="p-1 rounded-[2px] hover:bg-white/[0.05] text-text-muted shrink-0">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-5 space-y-4 overflow-y-auto">
                <div className="flex items-center justify-between text-xs text-text-muted">
                  <div>
                    <span className="text-text-primary">发件人：</span>
                    {detailMessage.sender_name || detailMessage.sender_email || '未知'}
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatDate(detailMessage.received_at)}
                  </div>
                </div>
                <div className="bg-bg-primary border border-border-color rounded-[2px] p-4 max-h-96 overflow-y-auto">
                  <div className="text-sm text-text-primary whitespace-pre-wrap leading-relaxed">
                    {detailMessage.body_text || emailServiceExtractPreview(detailMessage.body_html) || '(无正文)'}
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1.5 flex items-center gap-1">
                    <Tag className="w-3.5 h-3.5" />
                    保存时附加标签（可选）
                  </label>
                  <TagSelector
                    availableTags={allTags || []}
                    value={saveTagIds}
                    onChange={setSaveTagIds}
                    isLoading={isTagsLoading}
                    placeholder="输入标签..."
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border-color">
                <button onClick={() => setIsDetailOpen(false)} className="btn-secondary text-xs py-2 px-4">
                  关闭
                </button>
                <button
                  onClick={() => handleSaveToKnowledge(detailMessage)}
                  disabled={isSavingToKnowledge}
                  className="btn-primary flex items-center gap-2 text-xs py-2 px-4 disabled:opacity-60"
                >
                  {isSavingToKnowledge ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BookOpen className="w-3.5 h-3.5" />}
                  保存到知识库
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// Helper to extract preview from HTML in detail modal without importing service
function emailServiceExtractPreview(htmlContent: string | null, maxLen = 2000) {
  if (!htmlContent) return '';
  const text = htmlContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
}

export default EmailPage;
