import { useEffect, useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Check, X, AlertTriangle, Eye, FileText, Globe, BookOpen, Calendar,
  Loader2, MessageSquare, ChevronLeft, ChevronRight
} from 'lucide-react';
import adminApi from '../../services/adminApi';

interface ContentItem {
  id: string;
  type: string;
  title: string;
  content: string;
  status: string;
  brain_side: string;
  author_id: string;
  author_name: string;
  created_at: string;
  flag_reason: string;
}

const TYPE_ICON: Record<string, { icon: typeof FileText; label: string; color: string }> = {
  note: { icon: FileText, label: '笔记', color: 'text-[#d29922] bg-[#d29922]/10' },
  clip: { icon: Globe, label: '剪藏', color: 'text-info bg-[#58a6ff]/10' },
  knowledge: { icon: BookOpen, label: '知识', color: 'text-[#a371f7] bg-[#a371f7]/10' },
  capsule: { icon: Calendar, label: '胶囊', color: 'text-[#3fb950] bg-[#3fb950]/10' },
};

const STATUS_MAP: Record<string, { label: string; color: string; raw: string }> = {
  active: { label: '已通过', color: 'bg-[#3fb950]/10 text-[#3fb950]', raw: 'approved' },
  approved: { label: '已通过', color: 'bg-[#3fb950]/10 text-[#3fb950]', raw: 'approved' },
  pending: { label: '待审核', color: 'bg-[#d29922]/10 text-[#d29922]', raw: 'pending' },
  rejected: { label: '已驳回', color: 'bg-[#f85149]/10 text-[#f85149]', raw: 'rejected' },
};

function mapStatus(status: string) {
  return STATUS_MAP[status] || { label: '待审核', color: 'bg-[#d29922]/10 text-[#d29922]', raw: 'pending' };
}

const PAGE_SIZE = 15;

export default function AdminContent() {
  const [content, setContent] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showFlaggedOnly, setShowFlaggedOnly] = useState(false);

  const [page, setPage] = useState(1);
  const [detailItem, setDetailItem] = useState<ContentItem | null>(null);
  const [rejectItem, setRejectItem] = useState<ContentItem | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  const loadContent = useCallback(() => {
    setLoading(true);
    adminApi.getContent()
      .then((res: any) => {
        setContent(Array.isArray(res.data) ? res.data : []);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadContent();
  }, [loadContent]);

  const filteredContent = useMemo(() => {
    return content.filter((item: ContentItem) => {
      const s = search.toLowerCase();
      const matchSearch =
        search === '' ||
        item.title?.toLowerCase().includes(s) ||
        item.content?.toLowerCase().includes(s) ||
        item.author_name?.toLowerCase().includes(s);
      const matchType = typeFilter === 'all' || item.type === typeFilter;
      const mapped = mapStatus(item.status);
      const matchStatus = statusFilter === 'all' || mapped.raw === statusFilter;
      const matchFlagged = !showFlaggedOnly || !!item.flag_reason;
      return matchSearch && matchType && matchStatus && matchFlagged;
    });
  }, [content, search, typeFilter, statusFilter, showFlaggedOnly]);

  const pagedContent = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredContent.slice(start, start + PAGE_SIZE);
  }, [filteredContent, page]);

  const totalPages = Math.max(1, Math.ceil(filteredContent.length / PAGE_SIZE));

  useEffect(() => {
    setPage(1);
  }, [search, typeFilter, statusFilter, showFlaggedOnly]);

  const handleModerate = async (item: ContentItem, action: string, reason?: string) => {
    setActionLoading(item.id);
    setActionError('');
    try {
      await adminApi.moderateContent(item.id, action);
      setContent((prev: ContentItem[]) =>
        prev.map((c: ContentItem) =>
          c.id === item.id ? { ...c, status: action === 'approve' ? 'active' : 'rejected', flag_reason: reason || c.flag_reason } : c
        )
      );
      if (action === 'reject') {
        setRejectItem(null);
        setRejectReason('');
      }
    } catch (err: any) {
      setActionError(err.response?.data?.detail || '操作失败');
    } finally {
      setActionLoading(null);
    }
  };

  const ShimmerRow = () => (
    <tr className="border-b border-border-color">
      {Array.from({ length: 7 }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 bg-bg-tertiary rounded animate-pulse w-full" />
        </td>
      ))}
    </tr>
  );

  const typeBadge = (type: string) => {
    const cfg = TYPE_ICON[type] || { icon: FileText, label: type, color: 'text-text-secondary bg-[#8b949e]/10' };
    const Icon = cfg.icon;
    return (
      <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium ${cfg.color}`}>
        <Icon className="w-3.5 h-3.5" />
        {cfg.label}
      </span>
    );
  };

  const formatDate = (d: string) => {
    if (!d) return '—';
    return new Date(d).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary mb-2">内容审核</h1>
        <p className="text-text-secondary">审核用户生成的内容</p>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
          <input
            type="text"
            value={search}
            onChange={(e: any) => setSearch(e.target.value)}
            placeholder="搜索标题、内容或作者..."
            className="w-full pl-10 pr-4 py-2.5 bg-bg-tertiary border border-border-color rounded-lg text-text-primary placeholder-text-secondary focus:outline-none focus:border-[#58a6ff] text-sm"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e: any) => setTypeFilter(e.target.value)}
          className="px-3 py-2.5 bg-bg-tertiary border border-border-color rounded-lg text-text-primary focus:outline-none focus:border-[#58a6ff] text-sm"
        >
          <option value="all">全部类型</option>
          <option value="note">笔记</option>
          <option value="clip">剪藏</option>
          <option value="knowledge">知识</option>
          <option value="capsule">胶囊</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e: any) => setStatusFilter(e.target.value)}
          className="px-3 py-2.5 bg-bg-tertiary border border-border-color rounded-lg text-text-primary focus:outline-none focus:border-[#58a6ff] text-sm"
        >
          <option value="all">全部状态</option>
          <option value="pending">待审核</option>
          <option value="approved">已通过</option>
          <option value="rejected">已驳回</option>
        </select>
        <label className="flex items-center gap-2 px-3 py-2.5 bg-bg-tertiary border border-border-color rounded-lg text-sm text-text-primary cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showFlaggedOnly}
            onChange={(e: any) => setShowFlaggedOnly(e.target.checked)}
            className="w-4 h-4 accent-[#d29922]"
          />
          仅显示被举报
        </label>
      </div>

      {/* Error Banner */}
      {actionError && (
        <div className="p-3 bg-[#f85149]/10 border border-[#f85149]/20 rounded-lg text-[#f85149] text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          {actionError}
          <button onClick={() => setActionError('')} className="ml-auto text-[#f85149] hover:underline">
            关闭
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-bg-tertiary rounded-xl border border-border-color overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-color bg-bg-tertiary">
                <th className="px-4 py-3 text-left font-medium text-text-secondary">ID</th>
                <th className="px-4 py-3 text-left font-medium text-text-secondary">类型</th>
                <th className="px-4 py-3 text-left font-medium text-text-secondary">标题</th>
                <th className="px-4 py-3 text-left font-medium text-text-secondary">作者</th>
                <th className="px-4 py-3 text-left font-medium text-text-secondary">状态</th>
                <th className="px-4 py-3 text-left font-medium text-text-secondary">创建时间</th>
                <th className="px-4 py-3 text-left font-medium text-text-secondary">举报</th>
                <th className="px-4 py-3 text-left font-medium text-text-secondary">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => <ShimmerRow key={i} />)
              ) : (
                pagedContent.map((item: ContentItem, index: number) => {
                  const statusCfg = mapStatus(item.status);
                  return (
                    <motion.tr
                      key={item.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: index * 0.02 }}
                      className="border-b border-border-color hover:bg-[#1f2937] transition-colors"
                    >
                      <td className="px-4 py-3 text-text-secondary font-mono text-xs">{item.id.slice(0, 8)}...</td>
                      <td className="px-4 py-3">{typeBadge(item.type)}</td>
                      <td className="px-4 py-3">
                        <div className="text-text-primary font-medium max-w-[200px] truncate">{item.title || '无标题'}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 text-text-secondary">
                          <MessageSquare className="w-3.5 h-3.5" />
                          {item.author_name}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${statusCfg.color}`}>
                          {statusCfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-text-secondary">{formatDate(item.created_at)}</td>
                      <td className="px-4 py-3">
                        {item.flag_reason ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-[#f85149]/10 text-[#f85149]">
                            <AlertTriangle className="w-3 h-3" />
                            1
                          </span>
                        ) : (
                          <span className="text-text-secondary">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => setDetailItem(item)}
                            className="p-1.5 rounded hover:bg-[#58a6ff]/10 text-info transition-colors"
                            title="查看详情"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          {item.status !== 'active' && item.status !== 'approved' && (
                            <button
                              onClick={() => handleModerate(item, 'approve')}
                              disabled={actionLoading === item.id}
                              className="p-1.5 rounded hover:bg-[#3fb950]/10 text-[#3fb950] transition-colors"
                              title="审核通过"
                            >
                              {actionLoading === item.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                            </button>
                          )}
                          {item.status !== 'rejected' && (
                            <button
                              onClick={() => { setRejectItem(item); setRejectReason(item.flag_reason || ''); }}
                              disabled={actionLoading === item.id}
                              className="p-1.5 rounded hover:bg-[#f85149]/10 text-[#f85149] transition-colors"
                              title="驳回"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </motion.tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {filteredContent.length === 0 && !loading && (
          <div className="p-8 text-center text-text-secondary">
            <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>未找到内容</p>
          </div>
        )}

        {/* Pagination */}
        {!loading && filteredContent.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border-color">
            <div className="text-xs text-text-secondary">
              共 {filteredContent.length} 条，第 {page} / {totalPages} 页
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p: number) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 rounded border border-border-color text-text-primary hover:bg-bg-tertiary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const p = i + 1;
                return (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`min-w-[32px] px-2 py-1 rounded text-sm font-medium transition-colors ${
                      page === p
                        ? 'bg-[#58a6ff] text-white'
                        : 'border border-border-color text-text-primary hover:bg-bg-tertiary'
                    }`}
                  >
                    {p}
                  </button>
                );
              })}
              {totalPages > 5 && <span className="text-text-secondary">...</span>}
              <button
                onClick={() => setPage((p: number) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="p-1.5 rounded border border-border-color text-text-primary hover:bg-bg-tertiary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      <AnimatePresence>
        {detailItem && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
            onClick={() => setDetailItem(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e: any) => e.stopPropagation()}
              className="bg-bg-secondary border border-border-color rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto"
            >
              <div className="px-6 py-4 border-b border-border-color flex items-center justify-between sticky top-0 bg-bg-secondary">
                <div className="flex items-center gap-3">
                  {typeBadge(detailItem.type)}
                  <h3 className="text-lg font-semibold text-text-primary truncate">{detailItem.title || '无标题'}</h3>
                </div>
                <button onClick={() => setDetailItem(null)} className="text-text-secondary hover:text-text-primary">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="flex items-center gap-4 text-sm text-text-secondary">
                  <div className="flex items-center gap-1.5">
                    <MessageSquare className="w-4 h-4" />
                    {detailItem.author_name}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-4 h-4" />
                    {formatDate(detailItem.created_at)}
                  </div>
                  <div>{mapStatus(detailItem.status).label}</div>
                </div>

                {detailItem.flag_reason && (
                  <div className="p-3 bg-[#f85149]/10 border border-[#f85149]/20 rounded-lg text-sm text-[#f85149]">
                    <AlertTriangle className="w-4 h-4 inline mr-2" />
                    举报原因：{detailItem.flag_reason}
                  </div>
                )}

                <div className="bg-bg-primary border border-border-color rounded-lg p-4">
                  <div className="text-xs text-text-secondary mb-2">内容正文</div>
                  <div className="text-sm text-text-primary whitespace-pre-wrap leading-relaxed max-h-[400px] overflow-y-auto">
                    {detailItem.content}
                  </div>
                </div>
              </div>
              <div className="px-6 py-4 border-t border-border-color flex justify-end gap-2 sticky bottom-0 bg-bg-secondary">
                <button
                  onClick={() => setDetailItem(null)}
                  className="px-4 py-2 rounded-lg border border-border-color text-text-primary hover:bg-bg-tertiary text-sm transition-colors"
                >
                  关闭
                </button>
                {detailItem.status !== 'active' && detailItem.status !== 'approved' && (
                  <button
                    onClick={() => {
                      setDetailItem(null);
                      handleModerate(detailItem, 'approve');
                    }}
                    className="px-4 py-2 rounded-lg bg-[#3fb950] text-white hover:bg-[#3fb950]/90 text-sm transition-colors"
                  >
                    审核通过
                  </button>
                )}
                {detailItem.status !== 'rejected' && (
                  <button
                    onClick={() => {
                      setDetailItem(null);
                      setRejectItem(detailItem);
                      setRejectReason(detailItem.flag_reason || '');
                    }}
                    className="px-4 py-2 rounded-lg bg-[#f85149] text-white hover:bg-[#f85149]/90 text-sm transition-colors"
                  >
                    驳回
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reject Modal */}
      <AnimatePresence>
        {rejectItem && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
            onClick={() => setRejectItem(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e: any) => e.stopPropagation()}
              className="bg-bg-secondary border border-border-color rounded-xl shadow-2xl w-full max-w-md"
            >
              <div className="px-6 py-4 border-b border-[#f85149]/20">
                <h3 className="text-lg font-semibold text-[#f85149]">驳回内容</h3>
                <p className="text-sm text-text-secondary mt-1">
                  {rejectItem.title || '无标题'}（{TYPE_ICON[rejectItem.type]?.label || rejectItem.type}）
                </p>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm text-text-secondary mb-2">驳回原因（必填）</label>
                  <textarea
                    value={rejectReason}
                    onChange={(e: any) => setRejectReason(e.target.value)}
                    placeholder="请输入驳回原因，如：违反社区规定、包含不当内容..."
                    rows={4}
                    className="w-full px-3 py-2.5 bg-bg-tertiary border border-border-color rounded-lg text-text-primary placeholder-text-secondary focus:outline-none focus:border-[#58a6ff] text-sm resize-none"
                  />
                </div>
              </div>
              <div className="px-6 py-4 border-t border-border-color flex justify-end gap-2">
                <button
                  onClick={() => setRejectItem(null)}
                  className="px-4 py-2 rounded-lg border border-border-color text-text-primary hover:bg-bg-tertiary text-sm transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={() => handleModerate(rejectItem, 'reject', rejectReason)}
                  disabled={actionLoading === rejectItem.id || !rejectReason.trim()}
                  className="px-4 py-2 rounded-lg bg-[#f85149] text-white hover:bg-[#f85149]/90 text-sm transition-colors flex items-center gap-2 disabled:opacity-60"
                >
                  {actionLoading === rejectItem.id && <Loader2 className="w-4 h-4 animate-spin" />}
                  确认驳回
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
