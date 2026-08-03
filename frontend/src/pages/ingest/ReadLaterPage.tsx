import { FC, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BookOpen, Plus, Trash2, RefreshCw, ExternalLink, Star, Check, Loader2,
  AlertCircle, X, Search, Filter, ArrowRightCircle, Bookmark
} from 'lucide-react';
import { useReadLater } from '@/hooks/useReadLater';
import { useTags } from '@/hooks/useTags';
import type { ReadLaterItem } from '@/api/readLater';

const statusOptions = [
  { value: '', label: '全部' },
  { value: 'unread', label: '未读' },
  { value: 'reading', label: '阅读中' },
  { value: 'read', label: '已读' },
  { value: 'archived', label: '已归档' },
];

const ReadLaterPage: FC = () => {
  const [newUrl, setNewUrl] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [detailItem, setDetailItem] = useState<ReadLaterItem | null>(null);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);

  const { items, isLoading, createItem, updateItem, deleteItem, fetchContent, saveToKnowledge, isCreating, isDeleting, isFetchingContent, isSavingToKnowledge } =
    useReadLater({ status: statusFilter || undefined, q: query || undefined });
  const { tags } = useTags();

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

  const handleAdd = async () => {
    if (!newUrl.trim()) {
      showError('请输入 URL');
      return;
    }
    try {
      await createItem({ url: newUrl.trim(), title: newTitle.trim() || undefined });
      setNewUrl('');
      setNewTitle('');
      showSuccess('已添加到稍后读');
    } catch (e: any) {
      showError(formatError(e) || '添加失败');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这条稍后读吗？')) return;
    try {
      await deleteItem(id);
      if (detailItem?.id === id) setDetailItem(null);
    } catch (e: any) {
      showError(e?.message || '删除失败');
    }
  };

  const handleFetchContent = async (id: string) => {
    try {
      const response = await fetchContent(id);
      showSuccess('内容拉取成功');
      const updated = (response as any)?.data;
      if (detailItem?.id === id && updated) setDetailItem(updated);
    } catch (e: any) {
      showError(formatError(e) || '拉取失败');
    }
  };

  const handleToggleFavorite = async (item: ReadLaterItem) => {
    try {
      await updateItem({ id: item.id, data: { is_favorite: !item.is_favorite } });
    } catch (e: any) {
      showError(e?.message || '操作失败');
    }
  };

  const handleStatusChange = async (item: ReadLaterItem, status: string) => {
    try {
      await updateItem({ id: item.id, data: { status: status as any } });
      if (detailItem?.id === item.id) setDetailItem({ ...item, status: status as any });
    } catch (e: any) {
      showError(e?.message || '操作失败');
    }
  };

  const handleSaveToKnowledge = async (id: string) => {
    try {
      await saveToKnowledge({ id, tagIds: selectedTagIds.length ? selectedTagIds : undefined });
      showSuccess('已保存到 知识库 · 网络脑知识');
      setSelectedTagIds([]);
    } catch (e: any) {
      showError(formatError(e) || '保存失败');
    }
  };

  const formatError = (err: any): string => {
    return err?.response?.data?.detail || err?.message || '未知错误';
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const statusLabel = (status: string) => {
    const found = statusOptions.find(s => s.value === status);
    return found?.label || status;
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">稍后读</h1>
          <p className="text-sm text-text-secondary mt-1">收藏链接，稍后阅读并归档到知识库</p>
        </div>
        <span className="badge-network">Network Brain</span>
      </div>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex items-center gap-2 px-4 py-3 rounded-xl bg-danger/10 border border-danger/30 text-danger text-sm"
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
            className="flex items-center gap-2 px-4 py-3 rounded-xl bg-success/10 border border-success/30 text-success text-sm"
          >
            <Check className="w-4 h-4" />
            {success}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="glass-card p-4 space-y-3">
        <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <Plus className="w-4 h-4" />
          添加链接
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            placeholder="标题（可选）"
            className="md:col-span-1 w-full bg-bg-tertiary border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-info/50"
          />
          <input
            value={newUrl}
            onChange={e => setNewUrl(e.target.value)}
            placeholder="https://example.com/article"
            className="md:col-span-2 w-full bg-bg-tertiary border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-info/50"
          />
          <button
            onClick={handleAdd}
            disabled={isCreating}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            {isCreating && <Loader2 className="w-4 h-4 animate-spin" />}
            <Bookmark className="w-4 h-4" />
            添加
          </button>
        </div>
      </div>

      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0">
          <Filter className="w-4 h-4 text-text-muted shrink-0" />
          {statusOptions.map(opt => (
            <button
              key={opt.value}
              onClick={() => setStatusFilter(opt.value)}
              className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap transition-colors ${
                statusFilter === opt.value
                  ? 'bg-info/20 text-info border border-info/30'
                  : 'bg-white/[0.03] text-text-secondary border border-white/[0.06] hover:bg-white/[0.06]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 md:max-w-xs md:ml-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜索标题、摘要或链接"
            className="w-full bg-bg-tertiary border border-white/[0.08] rounded-xl pl-9 pr-3 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-info/50"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 text-info animate-spin" />
        </div>
      ) : items?.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-20">
          <BookOpen className="w-16 h-16 text-text-muted mb-4" />
          <p className="text-text-secondary">暂无稍后读内容</p>
          <p className="text-xs text-text-muted mt-1">添加一个链接开始收藏</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {items?.map(item => (
            <div key={item.id} className="card group">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-text-primary hover:text-info transition-colors flex items-center gap-1"
                    >
                      {item.title || item.url}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                    {item.domain && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/[0.05] text-text-muted">
                        {item.domain}
                      </span>
                    )}
                  </div>
                  {item.excerpt && (
                    <p className="text-xs text-text-secondary mt-1.5 line-clamp-2">{item.excerpt}</p>
                  )}
                  <div className="flex items-center gap-3 mt-2 text-[10px] text-text-muted flex-wrap">
                    <span className="px-1.5 py-0.5 rounded-full bg-info/10 text-info">{statusLabel(item.status)}</span>
                    <span>{formatDate(item.created_at)}</span>
                    {item.read_progress > 0 && item.read_progress < 100 && (
                      <span>进度 {item.read_progress}%</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleToggleFavorite(item)}
                    className={`p-1.5 rounded-lg transition-colors ${
                      item.is_favorite ? 'text-warning' : 'text-text-muted hover:text-warning hover:bg-white/[0.05]'
                    }`}
                    title={item.is_favorite ? '取消收藏' : '收藏'}
                  >
                    <Star className={`w-4 h-4 ${item.is_favorite ? 'fill-current' : ''}`} />
                  </button>
                  <button
                    onClick={() => setDetailItem(item)}
                    className="p-1.5 rounded-lg text-text-muted hover:text-info hover:bg-white/[0.05] transition-colors"
                    title="详情"
                  >
                    <BookOpen className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleFetchContent(item.id)}
                    disabled={isFetchingContent}
                    className="p-1.5 rounded-lg text-text-muted hover:text-info hover:bg-white/[0.05] transition-colors"
                    title="拉取全文"
                  >
                    {isFetchingContent ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => handleDelete(item.id)}
                    disabled={isDeleting}
                    className="p-1.5 rounded-lg text-text-muted hover:text-danger hover:bg-danger/10 transition-colors"
                    title="删除"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {detailItem && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={() => setDetailItem(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={e => e.stopPropagation()}
              className="bg-bg-secondary border border-white/[0.08] rounded-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col"
            >
              <div className="p-4 border-b border-white/[0.08] flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-text-primary truncate">
                    {detailItem.title || detailItem.url}
                  </h3>
                  <a
                    href={detailItem.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-info hover:underline truncate block"
                  >
                    {detailItem.url}
                  </a>
                </div>
                <button onClick={() => setDetailItem(null)} className="p-1 rounded-lg hover:bg-white/[0.05] text-text-muted shrink-0">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-4 overflow-y-auto space-y-4">
                {detailItem.cover_image && (
                  <img src={detailItem.cover_image} alt="cover" className="w-full h-40 object-cover rounded-xl" />
                )}

                <div className="flex items-center gap-2 flex-wrap">
                  {statusOptions.filter(s => s.value).map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => handleStatusChange(detailItem, opt.value)}
                      className={`px-2.5 py-1 rounded-lg text-xs transition-colors ${
                        detailItem.status === opt.value
                          ? 'bg-info/20 text-info border border-info/30'
                          : 'bg-white/[0.03] text-text-secondary border border-white/[0.06] hover:bg-white/[0.06]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {detailItem.excerpt && (
                  <div>
                    <h4 className="text-xs font-medium text-text-muted mb-1">摘要</h4>
                    <p className="text-sm text-text-secondary whitespace-pre-wrap">{detailItem.excerpt}</p>
                  </div>
                )}

                {detailItem.full_text ? (
                  <div>
                    <h4 className="text-xs font-medium text-text-muted mb-1">全文</h4>
                    <div className="text-sm text-text-secondary whitespace-pre-wrap max-h-[40vh] overflow-y-auto p-3 rounded-xl bg-bg-tertiary border border-white/[0.06]">
                      {detailItem.full_text}
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-text-muted">暂无全文，点击「拉取全文」获取内容</div>
                )}

                <div>
                  <h4 className="text-xs font-medium text-text-muted mb-2">保存到知识库（可选标签）</h4>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {tags?.map(tag => (
                      <button
                        key={tag.id}
                        onClick={() => {
                          setSelectedTagIds(prev =>
                            prev.includes(tag.id) ? prev.filter(id => id !== tag.id) : [...prev, tag.id]
                          );
                        }}
                        className={`px-2 py-1 rounded-lg text-xs border transition-colors ${
                          selectedTagIds.includes(tag.id)
                            ? 'text-white border-transparent'
                            : 'bg-white/[0.03] text-text-secondary border-white/[0.08] hover:bg-white/[0.06]'
                        }`}
                        style={selectedTagIds.includes(tag.id) ? { backgroundColor: tag.color } : {}}
                      >
                        {tag.name}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => handleSaveToKnowledge(detailItem.id)}
                    disabled={isSavingToKnowledge}
                    className="btn-primary flex items-center gap-2 text-xs"
                  >
                    {isSavingToKnowledge && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <ArrowRightCircle className="w-3.5 h-3.5" />
                    保存到知识库
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ReadLaterPage;
