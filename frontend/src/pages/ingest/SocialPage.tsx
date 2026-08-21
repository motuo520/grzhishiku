import { FC, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Share2, Plus, Search, Trash2, AlertCircle, X, Loader2,
  Check, BookOpen, Clock, Eye, Tag, Filter, MessageCircle, Upload,
  Home, Globe, Brain,
} from 'lucide-react';
import { useSocialAccounts, useSocialMessages, useSocialUpload } from '@/hooks/useSocial';
import { useTags } from '@/hooks/useTags';
import TagSelector from '@/components/TagSelector';
import type { SocialAccount, SocialMessage } from '@/api/social';

const PROVIDER_OPTIONS: { key: SocialAccount['provider']; label: string; color: string; ext: string }[] = [
  { key: 'wechat', label: '微信', color: 'text-success', ext: '.txt / .csv / .html / .zip' },
  { key: 'dingtalk', label: '钉钉', color: 'text-network-primary', ext: '.txt / .csv / .html' },
  { key: 'feishu', label: '飞书', color: 'text-network-primary', ext: '.txt / .csv / .json / .html' },
];

const PROVIDER_LABEL: Record<string, string> = {
  wechat: '微信',
  dingtalk: '钉钉',
  feishu: '飞书',
};

const SocialPage: FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [isAddAccountOpen, setIsAddAccountOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [detailMessage, setDetailMessage] = useState<SocialMessage | null>(null);
  const [saveTagIds, setSaveTagIds] = useState<string[]>([]);
  const [saveBrainSide, setSaveBrainSide] = useState<'personal' | 'network' | 'both'>('network');

  const [provider, setProvider] = useState<SocialAccount['provider']>('wechat');
  const [accountName, setAccountName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // 服务端分页上限（无 total 返回，靠「返回数达到 limit」判断可能还有更多）；上限与后端 le=1000 对齐
  const [limit, setLimit] = useState(200);

  const { accounts, isLoading: isAccountsLoading, createAccount, deleteAccount, isCreating, isDeleting } = useSocialAccounts();
  const { tags: allTags, isLoading: isTagsLoading } = useTags();
  const { uploadFile, isUploading } = useSocialUpload();
  const {
    messages,
    isLoading: isMessagesLoading,
    saveToKnowledge,
    deleteMessage,
    isSavingToKnowledge,
    isDeleting: isDeletingMessage,
  } = useSocialMessages({
    account_id: selectedAccountId || undefined,
    q: searchQuery || undefined,
    limit,
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

  const resetAddForm = () => {
    setProvider('wechat');
    setAccountName('');
    setError(null);
  };

  const handleAddAccount = async () => {
    try {
      await createAccount({ provider, account_name: accountName.trim() || undefined });
      setIsAddAccountOpen(false);
      resetAddForm();
      showSuccess('导入源添加成功');
    } catch (err: any) {
      showError(err?.response?.data?.detail || err.message || '添加失败');
    }
  };

  const handleDeleteAccount = async (id: string) => {
    if (!confirm('确定要删除这个导入源吗？已解析的消息也会被移除。')) return;
    try {
      await deleteAccount(id);
      if (selectedAccountId === id) setSelectedAccountId('');
      showSuccess('导入源已删除');
    } catch (err: any) {
      showError(err?.response?.data?.detail || err.message || '删除失败');
    }
  };

  const handleUpload = async (accountId: string, file: File) => {
    try {
      const res = await uploadFile({ id: accountId, file });
      const { parsed_count, skipped_count } = res.data;
      showSuccess(`解析完成：新增 ${parsed_count} 条，跳过 ${skipped_count} 条`);
    } catch (err: any) {
      showError(err?.response?.data?.detail || err.message || '解析失败');
    }
  };

  const handleSaveToKnowledge = async (msg: SocialMessage) => {
    try {
      await saveToKnowledge({ id: msg.id, tag_ids: saveTagIds, brain_side: saveBrainSide });
      showSuccess('已保存到 知识库 · 网络脑知识');
      setIsDetailOpen(false);
      setSaveTagIds([]);
      setSaveBrainSide('network');
    } catch (err: any) {
      showError(err?.response?.data?.detail || err.message || '保存失败');
    }
  };

  const handleQuickSaveToKnowledge = async (msg: SocialMessage) => {
    try {
      await saveToKnowledge({ id: msg.id, tag_ids: [], brain_side: 'network' });
      showSuccess('已保存到 知识库 · 网络脑知识');
    } catch (err: any) {
      showError(err?.response?.data?.detail || err.message || '保存失败');
    }
  };

  const handleDeleteMessage = async (id: string) => {
    if (!confirm('确定要删除这条消息吗？')) return;
    try {
      await deleteMessage(id);
    } catch (err: any) {
      showError(err?.response?.data?.detail || err.message || '删除失败');
    }
  };

  const openDetail = (msg: SocialMessage) => {
    setDetailMessage(msg);
    setSaveTagIds([]);
    setSaveBrainSide('network');
    setIsDetailOpen(true);
  };

  const selectedAccount = accounts?.find((a) => a.id === selectedAccountId);
  const providerInfo = PROVIDER_OPTIONS.find((p) => p.key === selectedAccount?.provider);

  const groupedMessages = useMemo(() => {
    const map = new Map<string, SocialMessage[]>();
    messages?.forEach((msg) => {
      const key = msg.conversation_id || 'default';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(msg);
    });
    return Array.from(map.entries()).map(([id, items]) => ({
      id,
      name: items[0]?.conversation_name || '未知会话',
      items,
    }));
  }, [messages]);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getPreviewText = (msg: SocialMessage, maxLen = 120) => {
    const text = msg.content_text || '';
    const clean = text.replace(/\s+/g, ' ').trim();
    return clean.length > maxLen ? clean.slice(0, maxLen) + '...' : clean;
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">社交聚合</h1>
          <p className="text-sm text-text-secondary mt-1">整合微信、钉钉、飞书等社交/协作数据</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="badge-network">Network Brain</span>
          <button
            onClick={() => { resetAddForm(); setIsAddAccountOpen(true); }}
            className="btn-primary flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            添加导入源
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
            <Share2 className="w-4 h-4" />
            已添加导入源
          </h3>
          <span className="text-xs text-text-muted">{accounts?.length || 0} 个源</span>
        </div>
        {isAccountsLoading ? (
          <Loader2 className="w-5 h-5 animate-spin text-info" />
        ) : !accounts || accounts.length === 0 ? (
          <div className="text-sm text-text-secondary">暂无导入源，点击右上角添加</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {accounts.map((account) => {
              const info = PROVIDER_OPTIONS.find((p) => p.key === account.provider);
              return (
                <div
                  key={account.id}
                  className={`flex flex-col p-3 rounded-[2px] border transition-colors ${
                    selectedAccountId === account.id ? 'border-info/50 bg-info/5' : 'border-border-color bg-bg-primary'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div
                      className="flex-1 cursor-pointer"
                      onClick={() => setSelectedAccountId(account.id === selectedAccountId ? '' : account.id)}
                    >
                      <div className="flex items-center gap-2">
                        <MessageCircle className={`w-4 h-4 ${info?.color || 'text-text-secondary'}`} />
                        <span className="text-sm font-medium text-text-primary">
                          {account.account_name || PROVIDER_LABEL[account.provider] || account.provider}
                        </span>
                      </div>
                      <div className="text-xs text-text-muted mt-1">
                        {info?.label || account.provider} · 已导入 {account.sync_count} 条
                      </div>
                      <div className="text-xs text-text-muted mt-0.5">
                        {account.sync_status === 'syncing' ? (
                          <span className="text-info">解析中</span>
                        ) : account.sync_status === 'error' ? (
                          <span className="text-danger">失败</span>
                        ) : account.last_sync_at ? (
                          <span className="text-success">已同步</span>
                        ) : (
                          <span>未导入</span>
                        )}
                      </div>
                      {account.last_error && (
                        <div className="text-[10px] text-danger mt-0.5 line-clamp-2">{account.last_error}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <label
                        className={`p-1.5 rounded-[2px] hover:bg-white/[0.05] text-text-muted hover:text-info transition-colors cursor-pointer ${isUploading ? 'opacity-50 pointer-events-none' : ''}`}
                        title="上传导出文件"
                      >
                        <Upload className="w-4 h-4" />
                        <input
                          type="file"
                          className="hidden"
                          accept=".txt,.csv,.html,.htm,.json,.zip"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleUpload(account.id, file);
                            e.target.value = '';
                          }}
                        />
                      </label>
                      <button
                        onClick={() => handleDeleteAccount(account.id)}
                        disabled={isDeleting}
                        className="p-1.5 rounded-[2px] hover:bg-white/[0.05] text-text-muted hover:text-danger transition-colors disabled:opacity-50"
                        title="删除导入源"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 text-[10px] text-[#484f58]">支持格式：{info?.ext}</div>
                </div>
              );
            })}
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
              placeholder="搜索消息内容、发送者或会话名称..."
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

        {selectedAccount && (
          <div className="text-xs text-text-muted">
            当前查看：{selectedAccount.account_name || PROVIDER_LABEL[selectedAccount.provider]} ({providerInfo?.ext})
          </div>
        )}

        {isMessagesLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 text-info animate-spin" />
          </div>
        ) : !messages || messages.length === 0 ? (
          <div className="card flex flex-col items-center justify-center py-20">
            <Share2 className="w-16 h-16 text-text-muted mb-4" />
            <p className="text-text-secondary">暂无社交消息</p>
            <p className="text-xs text-text-muted mt-2 max-w-md text-center px-4">
              选择上方导入源并上传聊天记录导出文件。微信请使用 PC 端「备份与恢复」或第三方导出工具生成 .txt/.csv/.html；钉钉/飞书请使用管理员导出功能。
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {groupedMessages.map((group) => (
              <div key={group.id} className="card">
                <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border-color/40">
                  <MessageCircle className="w-4 h-4 text-info" />
                  <span className="text-sm font-medium text-text-primary">{group.name}</span>
                  <span className="text-xs text-text-muted ml-auto">{group.items.length} 条</span>
                </div>
                <div className="space-y-2">
                  <AnimatePresence>
                    {group.items.map((msg) => (
                      <motion.div
                        key={msg.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="group p-3 rounded-[2px] bg-bg-primary border border-border-color/50 hover:border-border-color transition-colors"
                      >
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 p-1.5 rounded-[2px] bg-bg-tertiary text-text-secondary shrink-0">
                            <MessageCircle className="w-4 h-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium text-text-primary">
                                {msg.sender_name || '未知发送者'}
                              </span>
                              {msg.is_me && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-info/10 text-info border border-info/20">
                                  我
                                </span>
                              )}
                              {msg.status === 'imported_to_knowledge' && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-success/10 text-success border border-success/30">
                                  已入库
                                </span>
                              )}
                              <span className="text-[10px] text-text-muted flex items-center gap-1 ml-auto">
                                <Clock className="w-3 h-3" />
                                {formatDate(msg.sent_at)}
                              </span>
                            </div>
                            <p className="text-xs text-text-secondary mt-2 line-clamp-2 leading-relaxed">
                              {getPreviewText(msg)}
                            </p>
                            {msg.attachments && (
                              <div className="mt-2 text-[10px] text-text-muted">
                                附件：{msg.attachments}
                              </div>
                            )}
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
                              onClick={() => handleQuickSaveToKnowledge(msg)}
                              disabled={isSavingToKnowledge}
                              className="p-1.5 rounded-[2px] hover:bg-white/[0.05] text-text-muted hover:text-success transition-colors disabled:opacity-50"
                              title="保存到知识库"
                            >
                              {isSavingToKnowledge ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookOpen className="w-4 h-4" />}
                            </button>
                            <button
                              onClick={() => handleDeleteMessage(msg.id)}
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
              </div>
            ))}
            {(messages?.length ?? 0) >= limit && (
              limit < 1000 ? (
                <button
                  onClick={() => setLimit((l) => Math.min(l + 200, 1000))}
                  className="w-full py-2.5 rounded-[2px] border border-border-color text-xs text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
                >
                  加载更多（已显示 {messages?.length ?? 0} 条）
                </button>
              ) : (
                <p className="text-center text-xs text-text-muted py-2">
                  已达上限，请用搜索缩小范围
                </p>
              )
            )}
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
                <h3 className="text-sm font-medium text-text-primary">添加社交导入源</h3>
                <button onClick={() => setIsAddAccountOpen(false)} className="p-1 rounded-[2px] hover:bg-white/[0.05] text-text-muted">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="block text-xs text-text-muted mb-1.5">平台</label>
                  <div className="grid grid-cols-3 gap-3">
                    {PROVIDER_OPTIONS.map((p) => (
                      <button
                        key={p.key}
                        onClick={() => setProvider(p.key)}
                        className={`flex flex-col items-center gap-2 p-3 rounded-[2px] border transition-all ${
                          provider === p.key
                            ? 'border-info/50 bg-info/10 text-white'
                            : 'border-border-color bg-bg-primary text-text-secondary hover:border-info/30'
                        }`}
                      >
                        <MessageCircle className={`w-5 h-5 ${p.color}`} />
                        <span className="text-xs font-medium">{p.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1.5">
                    账号/会话名称（可选）
                  </label>
                  <input
                    type="text"
                    value={accountName}
                    onChange={(e) => setAccountName(e.target.value)}
                    placeholder="例如：工作群、家庭群"
                    className="w-full bg-bg-primary border border-border-color rounded-[2px] px-4 py-2.5 text-sm text-text-primary placeholder-text-secondary focus:outline-none focus:border-info/50 transition-colors"
                  />
                </div>
                <div className="rounded-[2px] bg-bg-primary border border-border-color p-3 space-y-2">
                  <div className="text-xs text-text-muted flex items-center gap-2">
                    <Upload className="w-3.5 h-3.5" />
                    导入说明
                  </div>
                  <p className="text-xs text-text-secondary leading-relaxed">
                    当前仅支持本地文件导入。请从对应 App 导出聊天记录后上传。
                    数据仅在本地解析，不会上传到任何第三方服务。
                  </p>
                  <p className="text-[10px] text-[#484f58]">
                    支持格式：{PROVIDER_OPTIONS.find((p) => p.key === provider)?.ext}
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
                  添加
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
                <div className="flex items-center gap-2 min-w-0">
                  <MessageCircle className="w-4 h-4 text-info shrink-0" />
                  <h3 className="text-sm font-medium text-text-primary truncate pr-4">
                    {detailMessage.sender_name || '未知发送者'}
                  </h3>
                </div>
                <button onClick={() => setIsDetailOpen(false)} className="p-1 rounded-[2px] hover:bg-white/[0.05] text-text-muted shrink-0">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-5 space-y-4 overflow-y-auto">
                <div className="flex items-center justify-between text-xs text-text-muted">
                  <div>
                    <span className="text-text-primary">会话：</span>
                    {detailMessage.conversation_name || '未知会话'}
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatDate(detailMessage.sent_at)}
                  </div>
                </div>
                <div className="bg-bg-primary border border-border-color rounded-[2px] p-4 max-h-96 overflow-y-auto">
                  <div className="text-sm text-text-primary whitespace-pre-wrap leading-relaxed">
                    {detailMessage.content_text || detailMessage.content_raw || '(无内容)'}
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1.5">存入脑侧</label>
                  <div className="inline-flex items-center gap-1 p-1 rounded-[2px] bg-bg-primary border border-border-color">
                    {[
                      { value: 'personal', label: '个人脑', icon: Home, color: 'text-personal-primary' },
                      { value: 'network', label: '网络脑', icon: Globe, color: 'text-network-primary' },
                      { value: 'both', label: '双脑', icon: Brain, color: 'text-fusion-primary' },
                    ].map((opt) => {
                      const Icon = opt.icon;
                      return (
                        <button
                          key={opt.value}
                          onClick={() => setSaveBrainSide(opt.value as typeof saveBrainSide)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[2px] text-xs font-medium transition-all ${
                            saveBrainSide === opt.value
                              ? `${opt.color} bg-white/[0.08]`
                              : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.05]'
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                          {opt.label}
                        </button>
                      );
                    })}
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

export default SocialPage;
