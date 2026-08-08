import { FC, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Rss, Plus, Trash2, RefreshCw, ExternalLink, BookOpen, Check, Loader2,
  AlertCircle, X, Globe, Save, ChevronDown, ChevronUp, Info, Sparkles, Clock
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRssFeeds, useRssEntries } from '@/hooks/useRss';
import { rssApi } from '@/api/rss';
import ModelSelector from '@/components/llm/ModelSelector';
import { summarizeText } from '@/api/llm';

const AUTO_FETCH_INTERVALS = [
  { value: 30, label: '30 分钟' },
  { value: 60, label: '1 小时' },
  { value: 360, label: '6 小时' },
  { value: 1440, label: '24 小时' },
];

/** 单源自动刷新配置面板：开关 + 间隔 + 下次到期时间 */
const FeedAutoFetchPanel: FC<{ feedId: string }> = ({ feedId }) => {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['rss-auto-fetch', feedId],
    queryFn: () => rssApi.getAutoFetch(feedId).then(r => r.data),
  });
  const [enabled, setEnabled] = useState(false);
  const [intervalMinutes, setIntervalMinutes] = useState(60);

  // 切换 feedId 时重置本地状态，避免旧配置覆盖后端设置
  useEffect(() => {
    setEnabled(false);
    setIntervalMinutes(60);
  }, [feedId]);

  useEffect(() => {
    if (data) {
      setEnabled(data.enabled);
      setIntervalMinutes(data.interval_minutes || 60);
    }
  }, [data]);

  const mutation = useMutation({
    mutationFn: (cfg: { enabled: boolean; interval_minutes: number }) =>
      rssApi.setAutoFetch(feedId, cfg),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rss-auto-fetch', feedId] }),
    onError: () => {
      // 失败回滚到后端值
      if (data) {
        setEnabled(data.enabled);
        setIntervalMinutes(data.interval_minutes || 60);
      }
    },
  });

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-[2px] border border-white/[0.08] bg-bg-primary/50 text-xs">
      <span className="flex items-center gap-1.5 text-text-secondary">
        <Clock className="w-3.5 h-3.5" />
        自动刷新
      </span>
      <button
        onClick={() => {
          const next = !enabled;
          setEnabled(next);
          mutation.mutate({ enabled: next, interval_minutes: intervalMinutes });
        }}
        disabled={mutation.isPending}
        className={`relative w-9 h-5 rounded-full transition-colors ${enabled ? 'bg-info' : 'bg-bg-tertiary'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${enabled ? 'translate-x-4' : ''}`} />
      </button>
      <select
        value={intervalMinutes}
        onChange={(e) => {
          const v = Number(e.target.value);
          setIntervalMinutes(v);
          mutation.mutate({ enabled, interval_minutes: v });
        }}
        disabled={!enabled || mutation.isPending}
        className="bg-bg-primary border border-white/[0.08] rounded-[2px] px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-info/40 disabled:opacity-50"
      >
        {AUTO_FETCH_INTERVALS.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      {enabled && data?.next_due_at && (
        <span className="text-text-muted">下次：{new Date(data.next_due_at).toLocaleString('zh-CN')}</span>
      )}
      {mutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin text-info" />}
    </div>
  );
};

const RssPage: FC = () => {
  const [newUrl, setNewUrl] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [selectedFeedId, setSelectedFeedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showErrorFeeds, setShowErrorFeeds] = useState<Record<string, boolean>>({});
  const [entryBatchMode, setEntryBatchMode] = useState(false);
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(new Set());
  const [modelId, setModelId] = useState('');
  const [summarizingId, setSummarizingId] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<Record<string, string>>({});

  // 切换 Feed 时清空批量选择，避免误删其他 Feed 的条目
  useEffect(() => {
    setSelectedEntryIds(new Set());
    setEntryBatchMode(false);
  }, [selectedFeedId]);

  const {
    feeds,
    isLoading,
    createFeed,
    deleteFeed,
    fetchFeed,
    isCreating,
    isDeleting,
    isFetching,
  } = useRssFeeds();

  const selectedFeed = feeds?.find(f => f.id === selectedFeedId);
  const {
    entries,
    isLoading: entriesLoading,
    markRead,
    saveEntry,
    deleteEntry,
    isDeletingEntry,
  } = useRssEntries(selectedFeedId);

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

  const handleAddFeed = async () => {
    if (!newUrl.trim()) {
      showError('请输入 RSS 地址');
      return;
    }
    try {
      await createFeed({ url: newUrl.trim(), title: newTitle.trim() || undefined });
      setNewUrl('');
      setNewTitle('');
      showSuccess('RSS 源添加成功');
    } catch (e: any) {
      showError(formatError(e) || '添加失败');
    }
  };

  const handleFetch = async (feedId: string) => {
    try {
      const result = await fetchFeed(feedId);
      const added = (result as any)?.data?.added ?? 0;
      showSuccess(added > 0 ? `拉取成功，新增 ${added} 条内容` : '拉取成功，当前没有新条目');
    } catch (e: any) {
      showError(formatError(e) || '拉取失败');
    }
  };

  const handleDelete = async (feedId: string) => {
    if (!confirm('确定要删除这个 RSS 源吗？')) return;
    try {
      await deleteFeed(feedId);
      if (selectedFeedId === feedId) setSelectedFeedId(null);
    } catch (e: any) {
      showError(e?.message || '删除失败');
    }
  };

  const toggleSelectEntry = (entryId: string) => {
    setSelectedEntryIds(prev => {
      const next = new Set(prev);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  };

  const handleSummarize = async (entry: any) => {
    const text = entry.title ? `${entry.title}\n\n${entry.summary || entry.content || ''}` : (entry.summary || entry.content || '');
    if (!text || text.trim().length < 10) {
      showError('内容太短，无法生成摘要');
      return;
    }
    setSummarizingId(entry.id);
    setError(null);
    try {
      const result = await summarizeText({
        text,
        length: 'medium',
        model: modelId || undefined,
      });
      setSummaries((prev) => ({ ...prev, [entry.id]: result.summary }));
    } catch (e: any) {
      showError(e?.response?.data?.detail || e.message || '摘要生成失败');
    } finally {
      setSummarizingId(null);
    }
  };

  const allEntriesSelected = entries && entries.length > 0 && entries.every(e => selectedEntryIds.has(e.id));

  const handleSelectAllEntries = () => {
    if (allEntriesSelected) {
      setSelectedEntryIds(new Set());
    } else {
      setSelectedEntryIds(new Set(entries?.map(e => e.id) || []));
    }
  };

  const handleBatchDeleteEntries = async () => {
    if (selectedEntryIds.size === 0) {
      showError('请先选择要删除的消息');
      return;
    }
    const count = selectedEntryIds.size;
    if (!confirm(`确定要删除选中的 ${count} 条消息吗？`)) return;
    const failed: string[] = [];
    for (const entryId of selectedEntryIds) {
      try {
        await deleteEntry(entryId);
      } catch {
        failed.push(entryId);
      }
    }
    setSelectedEntryIds(new Set(failed));
    if (failed.length === 0) {
      setEntryBatchMode(false);
      showSuccess(`已删除 ${count} 条消息`);
    } else {
      showError(`${count - failed.length} 条删除成功，${failed.length} 条失败`);
    }
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

  const safeUrl = (url?: string) => {
    if (!url) return '';
    try {
      const u = new URL(url);
      return u.protocol === 'http:' || u.protocol === 'https:' ? url : '';
    } catch {
      return '';
    }
  };

  const formatError = (err: any): string => {
    const detail = err?.response?.data?.detail || err?.message || '未知错误';
    if (typeof detail !== 'string') return JSON.stringify(detail);
    if (typeof detail === 'string' && detail.startsWith('Fetch failed:')) {
      const raw = detail.replace('Fetch failed:', '').trim();
      if (raw.includes('HTTP Error')) return '无法访问该地址，请检查 URL 是否正确';
      if (raw.includes('Not Found') || raw.includes('404')) return '地址返回 404，请确认 RSS 链接有效';
      if (raw.includes('timed out') || raw.includes('Timeout')) return '请求超时，请检查网络或稍后重试';
      if (raw.includes('ssl') || raw.includes('SSL')) return 'SSL 证书错误';
      if (raw.includes('no host given') || raw.includes('Name or service not known')) return '域名解析失败，请检查 URL';
      if (raw.includes('not well-formed') || raw.includes('syntax error')) return '返回内容不是有效的 RSS/XML 格式';
      return `拉取失败：${raw}`;
    }
    if (typeof detail === 'string' && detail.includes('already exists')) return '该 RSS 源已存在';
    if (typeof detail === 'string' && detail.includes('not a valid RSS')) return detail;
    return detail;
  };

  const toggleError = (feedId: string) => {
    setShowErrorFeeds(prev => ({ ...prev, [feedId]: !prev[feedId] }));
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">RSS 聚合</h1>
          <p className="text-sm text-text-secondary mt-1">订阅源管理与手动采集</p>
        </div>
        <div className="flex items-center gap-3">
          <ModelSelector value={modelId} onChange={setModelId} taskType="analysis" className="w-48" />
          <span className="badge-network">Network Brain</span>
        </div>
      </div>

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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Feed List */}
        <div className="lg:col-span-1 space-y-4">
          <div className="glass-card p-4 space-y-3">
            <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
              <Plus className="w-4 h-4" />
              添加 RSS 源
            </h2>
            <input
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              placeholder="源名称（可选）"
              className="w-full bg-bg-tertiary border border-white/[0.08] rounded-[2px] px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-info/50"
            />
            <input
              value={newUrl}
              onChange={e => setNewUrl(e.target.value)}
              placeholder="https://example.com/feed.xml"
              className="w-full bg-bg-tertiary border border-white/[0.08] rounded-[2px] px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-info/50"
            />
            <button
              onClick={handleAddFeed}
              disabled={isCreating}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {isCreating && <Loader2 className="w-4 h-4 animate-spin" />}
              <Plus className="w-4 h-4" />
              添加
            </button>
          </div>

          <div className="glass-card p-2 space-y-1 max-h-[500px] overflow-y-auto">
            {isLoading ? (
              <div className="p-4 flex justify-center">
                <Loader2 className="w-6 h-6 text-info animate-spin" />
              </div>
            ) : feeds?.length === 0 ? (
              <div className="p-6 text-center text-sm text-text-muted">
                <Rss className="w-10 h-10 mx-auto mb-2 opacity-40" />
                暂无 RSS 源
              </div>
            ) : (
              feeds?.map(feed => (
                <div
                  key={feed.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedFeedId(feed.id)}
                  className={`group w-full text-left p-3 rounded-[2px] transition-all cursor-pointer ${
                    selectedFeedId === feed.id
                      ? 'bg-info/10 border border-info/20'
                      : 'hover:bg-white/[0.03] border border-transparent'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <Rss className="w-4 h-4 mt-0.5 text-info shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-text-primary truncate">
                        {feed.title || feed.url}
                      </div>
                      <div className="text-xs text-text-muted truncate">{feed.url}</div>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-info/10 text-info">
                          {feed.unread_count || 0} 未读
                        </span>
                        {feed.fetch_status === 'error' && (
                          <>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-danger/10 text-danger">
                              错误
                            </span>
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation();
                                toggleError(feed.id);
                              }}
                              className="text-[10px] flex items-center gap-0.5 text-danger hover:underline"
                            >
                              {showErrorFeeds[feed.id] ? '收起' : '查看错误详情'}
                              {showErrorFeeds[feed.id] ? (
                                <ChevronUp className="w-3 h-3" />
                              ) : (
                                <ChevronDown className="w-3 h-3" />
                              )}
                            </button>
                          </>
                        )}
                      </div>
                      <AnimatePresence>
                        {feed.fetch_status === 'error' && showErrorFeeds[feed.id] && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="mt-2 text-xs text-danger bg-danger/5 border border-danger/20 rounded-[2px] p-2 break-words">
                              {feed.fetch_error || '未知错误'}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          handleFetch(feed.id);
                        }}
                        disabled={isFetching}
                        title="拉取"
                        className="p-1.5 rounded-[2px] text-text-muted hover:text-info hover:bg-white/[0.05] transition-colors"
                      >
                        {isFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          handleDelete(feed.id);
                        }}
                        disabled={isDeleting}
                        title="删除"
                        className="p-1.5 rounded-[2px] text-text-muted hover:text-danger hover:bg-danger/10 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Entries */}
        <div className="lg:col-span-2">
          {selectedFeed ? (
            <div className="space-y-4">
              <div className="glass-card p-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-text-primary">{selectedFeed.title || 'RSS 源'}</h2>
                  <div className="text-xs text-text-muted">{selectedFeed.url}</div>
                </div>
                <div className="flex items-center gap-2">
                  {entryBatchMode ? (
                    <>
                      <button
                        onClick={() => {
                          setEntryBatchMode(false);
                          setSelectedEntryIds(new Set());
                        }}
                        className="btn-secondary text-xs"
                      >
                        取消
                      </button>
                      <button
                        onClick={handleSelectAllEntries}
                        className="btn-secondary text-xs"
                      >
                        {allEntriesSelected ? '取消全选' : '全选'}
                      </button>
                      <button
                        onClick={handleBatchDeleteEntries}
                        disabled={isDeletingEntry || selectedEntryIds.size === 0}
                        className="btn-danger text-xs flex items-center gap-1"
                      >
                        {isDeletingEntry && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        <Trash2 className="w-3.5 h-3.5" />
                        删除选中 ({selectedEntryIds.size})
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => handleFetch(selectedFeed.id)}
                        disabled={isFetching}
                        className="btn-secondary flex items-center gap-2 text-xs"
                      >
                        {isFetching && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        <RefreshCw className="w-3.5 h-3.5" />
                        拉取
                      </button>
                      <button
                        onClick={() => setEntryBatchMode(true)}
                        className="btn-secondary flex items-center gap-2 text-xs"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        批量删除
                      </button>
                      <button
                        onClick={() => handleDelete(selectedFeed.id)}
                        disabled={isDeleting}
                        className="p-2 rounded-[2px] bg-danger/10 text-danger hover:bg-danger/20 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {selectedFeed.fetch_status === 'error' && (
                <div className="flex items-start gap-3 px-4 py-3 rounded-[2px] bg-danger/10 border border-danger/30 text-danger text-sm">
                  <Info className="w-4 h-4 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium">该 RSS 源拉取失败</p>
                    <p className="text-xs text-danger/80 mt-1 break-words">
                      {selectedFeed.fetch_error || '未知错误，请点击「拉取」重试'}
                    </p>
                  </div>
                </div>
              )}

              <FeedAutoFetchPanel feedId={selectedFeed.id} />

              {entriesLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="w-8 h-8 text-info animate-spin" />
                </div>
              ) : entries?.length === 0 ? (
                <div className="card flex flex-col items-center justify-center py-16">
                  <BookOpen className="w-12 h-12 text-text-muted mb-3" />
                  <p className="text-text-secondary text-sm">
                    {selectedFeed.fetch_status === 'error' ? '暂无可用条目' : '暂无条目'}
                  </p>
                  <p className="text-xs text-text-muted mt-1 text-center px-4">
                    {selectedFeed.fetch_status === 'error'
                      ? '请修复 RSS 源错误后再试'
                      : selectedFeed.last_fetched_at
                        ? `已拉取，当前没有新条目（上次：${formatDate(selectedFeed.last_fetched_at)}）`
                        : '点击「拉取」获取最新内容'}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {entries?.map(entry => (
                    <div
                      key={entry.id}
                      onClick={() => entryBatchMode && toggleSelectEntry(entry.id)}
                      className={`card transition-opacity ${entry.is_read ? 'opacity-60' : ''} ${entryBatchMode ? 'cursor-pointer' : ''}`}
                    >
                      <div className="flex items-start gap-3">
                        {entryBatchMode && (
                          <input
                            type="checkbox"
                            checked={selectedEntryIds.has(entry.id)}
                            onChange={() => toggleSelectEntry(entry.id)}
                            onClick={e => e.stopPropagation()}
                            className="mt-1 w-4 h-4 accent-info shrink-0"
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <div className="text-sm font-medium text-text-primary hover:text-info transition-colors">
                              <a href={safeUrl(entry.link)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1">
                                {entry.title || '无标题'}
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>
                          </div>
                          {entry.summary && (
                            <p className="text-xs text-text-secondary mt-1.5 line-clamp-2">{entry.summary}</p>
                          )}
                          <div className="flex items-center gap-3 mt-2 text-[10px] text-text-muted">
                            {entry.author && <span>作者：{entry.author}</span>}
                            <span>{formatDate(entry.published_at)}</span>
                          </div>
                        </div>
                        {!entryBatchMode && (
                          <div className="flex items-center gap-1 shrink-0">
                            {!entry.is_read && (
                              <button
                                onClick={() => markRead(entry.id)}
                                className="p-1.5 rounded-[2px] hover:bg-white/[0.05] text-text-muted hover:text-success transition-colors"
                                title="标记已读"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              onClick={() => saveEntry(entry.id)}
                              disabled={entry.is_saved}
                              className={`p-1.5 rounded-[2px] transition-colors ${
                                entry.is_saved
                                  ? 'text-success'
                                  : 'text-text-muted hover:text-info hover:bg-white/[0.05]'
                              }`}
                              title={entry.is_saved ? '已保存' : '保存为剪藏'}
                            >
                              <Save className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleSummarize(entry)}
                              disabled={summarizingId === entry.id}
                              className="p-1.5 rounded-[2px] text-text-muted hover:text-warning hover:bg-white/[0.05] transition-colors disabled:opacity-50"
                              title="AI 摘要"
                            >
                              {summarizingId === entry.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Sparkles className="w-4 h-4" />
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                      {summaries[entry.id] && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="mt-3 pt-3 border-t border-white/[0.06]">
                            <div className="flex items-center gap-1.5 text-xs text-warning mb-1.5">
                              <Sparkles className="w-3.5 h-3.5" />
                              <span>AI 摘要</span>
                            </div>
                            <p className="text-xs text-text-secondary leading-relaxed">{summaries[entry.id]}</p>
                          </div>
                        </motion.div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="card flex flex-col items-center justify-center py-20">
              <Globe className="w-16 h-16 text-text-muted mb-4" />
              <p className="text-text-secondary">选择一个 RSS 源查看条目</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default RssPage;
