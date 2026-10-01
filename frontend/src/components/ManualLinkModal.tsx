import { FC, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, Link2, Search, AlertCircle, RefreshCw, FileText } from 'lucide-react';
import { graphApi, type LinkSuggestionCandidate } from '@/api/graph';
import { knowledgeApi } from '@/api/knowledge';
import { notesApi } from '@/api/notes';
import ContentPreview from '@/components/ContentPreview';

interface SearchItem {
  id: string;
  title: string;
  type: string;
}

interface ManualLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceId: string;
  sourceTitle: string;
  onLinked?: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  note: '笔记',
  capsule: '胶囊',
  clip: '剪藏',
  knowledge: '知识',
};

const getExcerpt = (content?: string | null, maxLen = 60) => {
  if (!content) return '';
  const plain = content.replace(/[#*`[\]()]/g, '').replace(/\s+/g, ' ').trim();
  return plain.length > maxLen ? plain.slice(0, maxLen) + '...' : plain;
};

const ManualLinkModal: FC<ManualLinkModalProps> = ({
  isOpen,
  onClose,
  sourceId,
  sourceTitle,
  onLinked,
}) => {
  const [candidates, setCandidates] = useState<LinkSuggestionCandidate[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchSeq = useRef(0);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // 原文预览（09-16）：弹窗内视图切换，非路由跳转——selectedId/搜索词/候选全部原地保留
  const [previewing, setPreviewing] = useState<{ type: string; id: string } | null>(null);

  const loadCandidates = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await graphApi.linkSuggestions(sourceId);
      const list = (res.data.candidates || []).slice(0, 5);
      setCandidates(list);
      setSelectedId(list[0]?.content_id ?? null);
    } catch (err: any) {
      setLoadError(err.message || '推荐加载失败');
    } finally {
      setIsLoading(false);
    }
  };

  // 打开时拉取推荐并重置状态
  useEffect(() => {
    if (isOpen && sourceId) {
      setCandidates([]);
      setSelectedId(null);
      setLoadError(null);
      setSearchQuery('');
      setSearchResults([]);
      setSubmitError(null);
      setNotice(null);
      setPreviewing(null);
      loadCandidates();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, sourceId]);

  // 搜索（防抖 300ms）：知识库 + 笔记合并，截 8 条，排除自身
  useEffect(() => {
    const q = searchQuery.trim();
    if (!isOpen || !q) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    const seq = ++searchSeq.current;
    const timer = setTimeout(async () => {
      try {
        const [kuRes, noteRes] = await Promise.all([
          knowledgeApi.list({ q }),
          notesApi.list({ q }),
        ]);
        if (seq !== searchSeq.current) return;
        const merged: SearchItem[] = [
          ...(noteRes.data || []).map((n) => ({ id: n.id, title: n.title, type: 'note' })),
          ...(kuRes.data || []).map((u) => ({ id: u.id, title: getExcerpt(u.content_raw) || '未命名知识', type: 'knowledge' })),
        ];
        setSearchResults(merged.filter((it) => it.id !== sourceId).slice(0, 8));
      } catch (err) {
        if (seq !== searchSeq.current) return;
        console.error('关联搜索失败', err);
        setSearchResults([]);
      } finally {
        if (seq === searchSeq.current) setIsSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, isOpen, sourceId]);

  const handleConfirm = async () => {
    if (!selectedId || isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError(null);
    setNotice(null);
    try {
      const res = await graphApi.createEdge({ source_id: sourceId, target_id: selectedId });
      if (!res.data.created) {
        setNotice('已存在关联');
        return;
      }
      onLinked?.();
      onClose();
    } catch (err: any) {
      setSubmitError(err.message || '关联失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  const showEmpty = !isLoading && !loadError && candidates.length === 0 && searchResults.length === 0;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg bg-bg-secondary border border-border-color rounded-[2px] overflow-hidden max-h-[90vh] flex flex-col"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border-color shrink-0">
              <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
                <Link2 className="w-4 h-4 text-info" />
                手动关联到…
              </h3>
              <button
                type="button"
                onClick={onClose}
                className="p-1 rounded-[2px] hover:bg-white/[0.05] text-text-muted"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {previewing ? (
              <div className="p-5 flex-1 min-h-0 flex flex-col">
                <ContentPreview type={previewing.type} id={previewing.id} onBack={() => setPreviewing(null)} />
              </div>
            ) : (
            <div className="p-5 space-y-4 overflow-y-auto">
              <p className="text-xs text-text-secondary">
                当前内容：<span className="text-text-primary">{sourceTitle || '未命名'}</span>
              </p>

              {isLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="w-6 h-6 animate-spin text-info" />
                </div>
              ) : loadError ? (
                <div className="flex items-center gap-2 px-4 py-3 rounded-[2px] bg-danger/10 border border-danger/30 text-danger text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span className="flex-1">{loadError}</span>
                  <button
                    type="button"
                    onClick={loadCandidates}
                    className="flex items-center gap-1 px-2 py-1 rounded-[2px] border border-danger/30 hover:bg-danger/20 transition-colors"
                  >
                    <RefreshCw className="w-3 h-3" />
                    重试
                  </button>
                </div>
              ) : (
                candidates.length > 0 && (
                  <div className="space-y-2">
                    <label className="block text-xs text-text-muted">推荐关联</label>
                    {candidates.map((c) => {
                      const checked = selectedId === c.content_id;
                      return (
                        <label
                          key={c.content_id}
                          className={`flex items-center gap-3 px-3 py-2.5 rounded-[2px] border cursor-pointer transition-colors ${checked ? 'bg-info/10 border-info/30' : 'bg-white/[0.03] border-white/[0.08] hover:bg-white/[0.06]'}`}
                        >
                          <input
                            type="radio"
                            name="manual-link-target"
                            checked={checked}
                            onChange={() => setSelectedId(c.content_id)}
                            className="accent-info shrink-0"
                          />
                          <span className="flex-1 min-w-0 text-sm text-text-primary truncate">{c.title || '未命名'}</span>
                          {/* 原文预览：胶囊是加密内容不给入口；stopPropagation+preventDefault 不影响 radio 选中 */}
                          {c.type !== 'capsule' && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                setPreviewing({ type: c.type, id: c.content_id });
                              }}
                              className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-[2px] text-[10px] text-text-muted hover:text-info hover:bg-info/10 transition-colors shrink-0"
                              title="就地看全文，返回后选择状态不变"
                            >
                              <FileText className="w-3 h-3" />
                              原文
                            </button>
                          )}
                          <span className="text-xs text-info shrink-0">{Math.round(c.similarity * 100)}%</span>
                          <span className="px-1.5 py-0.5 rounded-md text-[10px] border shrink-0 bg-white/[0.03] text-text-secondary border-white/[0.08]">
                            {TYPE_LABELS[c.type] || c.type}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )
              )}

              {/* 搜索其他内容 */}
              <div className="space-y-2 pt-3 border-t border-white/[0.06]">
                <label className="block text-xs text-text-muted">搜索其他内容</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="搜索笔记或知识..."
                    className="w-full bg-white/[0.03] border border-white/[0.08] rounded-[2px] pl-10 pr-4 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-info/40 transition-colors"
                  />
                  {isSearching && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-info" />
                  )}
                </div>
                {searchResults.length > 0 && (
                  <div className="space-y-1.5">
                    {searchResults.map((it) => (
                      <div
                        key={it.id}
                        className={`w-full flex items-center gap-2 rounded-[2px] border transition-colors ${selectedId === it.id ? 'bg-info/10 border-info/30' : 'bg-white/[0.03] border-white/[0.08] hover:bg-white/[0.06]'}`}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedId(it.id)}
                          className="flex-1 min-w-0 text-left px-3 py-2 text-xs text-text-primary truncate"
                        >
                          {it.title || '未命名'}
                        </button>
                        {/* 搜索结果只合并笔记+知识（无胶囊），直接给原文入口 */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPreviewing({ type: it.type, id: it.id });
                          }}
                          className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-[2px] text-[10px] text-text-muted hover:text-info hover:bg-info/10 transition-colors shrink-0"
                          title="就地看全文，返回后选择状态不变"
                        >
                          <FileText className="w-3 h-3" />
                          原文
                        </button>
                        <span className="px-1.5 py-0.5 mr-2 rounded-md text-[10px] border shrink-0 bg-white/[0.03] text-text-secondary border-white/[0.08]">
                          {TYPE_LABELS[it.type] || it.type}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {showEmpty && (
                <div className="flex flex-col items-center justify-center py-6 text-center">
                  <Link2 className="w-10 h-10 text-text-muted/40 mb-3" />
                  <p className="text-text-secondary text-sm">暂无可关联的内容，试试上方搜索</p>
                </div>
              )}

              {notice && (
                <div className="flex items-center gap-2 px-4 py-3 rounded-[2px] bg-info/10 border border-info/30 text-info text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {notice}
                </div>
              )}
              {submitError && (
                <div className="flex items-center gap-2 px-4 py-3 rounded-[2px] bg-danger/10 border border-danger/30 text-danger text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {submitError}
                </div>
              )}
            </div>
            )}

            {/* 预览期间隐藏确认栏，防误点 */}
            {!previewing && (
            <div className="px-5 py-4 border-t border-border-color shrink-0">
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-[2px] text-xs text-text-secondary hover:bg-white/[0.05] transition-colors"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={!selectedId || isSubmitting}
                  className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-[2px] text-xs font-medium hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-60"
                >
                  {isSubmitting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Link2 className="w-3.5 h-3.5" />
                  )}
                  确认关联
                </button>
              </div>
            </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default ManualLinkModal;
