import { FC, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, Shuffle, Search, AlertCircle, RefreshCw } from 'lucide-react';
import { pipelineApi, type CollisionCandidate } from '@/api/pipeline';
import { knowledgeApi } from '@/api/knowledge';
import type { BrainSide, KnowledgeUnit } from '@/types';

interface CollisionPartnerModalProps {
  isOpen: boolean;
  onClose: () => void;
  conceptId: string;
  conceptTitle: string;
  brainSide: BrainSide;
  onConfirm: (partnerId: string) => Promise<void>;
  isConfirming?: boolean;
}

const PAIRING_CONFIG: Record<CollisionCandidate['pairing'], { label: string; className: string }> = {
  graphify: { label: '图谱推荐', className: 'bg-purple-500/15 text-purple-300 border-purple-500/30' },
  embedding: { label: '向量相似', className: 'bg-info/15 text-info border-info/30' },
  recent: { label: '最近', className: 'bg-white/[0.03] text-text-secondary border-white/[0.08]' },
};

const getExcerpt = (content?: string | null, maxLen = 60) => {
  if (!content) return '';
  const plain = content.replace(/[#*`[\]()]/g, '').replace(/\s+/g, ' ').trim();
  return plain.length > maxLen ? plain.slice(0, maxLen) + '...' : plain;
};

const CollisionPartnerModal: FC<CollisionPartnerModalProps> = ({
  isOpen,
  onClose,
  conceptId,
  conceptTitle,
  brainSide,
  onConfirm,
  isConfirming = false,
}) => {
  const [candidates, setCandidates] = useState<CollisionCandidate[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<KnowledgeUnit[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [customPartner, setCustomPartner] = useState<KnowledgeUnit | null>(null);
  const searchSeq = useRef(0);

  const loadCandidates = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await pipelineApi.collisionCandidates(conceptId);
      const list = (res.data.candidates || []).slice(0, 5);
      setCandidates(list);
      const autoPick = res.data.auto_pick;
      setSelectedId(autoPick && list.some((c) => c.content_id === autoPick) ? autoPick : list[0]?.content_id ?? null);
    } catch (err: any) {
      setLoadError(err.message || '候选加载失败');
    } finally {
      setIsLoading(false);
    }
  };

  // 打开时拉取候选并重置状态
  useEffect(() => {
    if (isOpen && conceptId) {
      setCandidates([]);
      setSelectedId(null);
      setLoadError(null);
      setSearchQuery('');
      setSearchResults([]);
      setCustomPartner(null);
      loadCandidates();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, conceptId]);

  // 自定义对手搜索（防抖 300ms）
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
        const res = await knowledgeApi.list({
          content_subtype: 'concept',
          q,
          ...(brainSide !== 'unknown' ? { brain_side: brainSide } : {}),
        });
        if (seq !== searchSeq.current) return;
        // 排除概念 A 自身
        setSearchResults((res.data || []).filter((u) => u.id !== conceptId).slice(0, 8));
      } catch (err) {
        if (seq !== searchSeq.current) return;
        console.error('自定义对手搜索失败', err);
        setSearchResults([]);
      } finally {
        if (seq === searchSeq.current) setIsSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, isOpen, brainSide, conceptId]);

  const selectCandidate = (id: string) => {
    setSelectedId(id);
    setCustomPartner(null);
  };

  const selectCustom = (unit: KnowledgeUnit) => {
    setCustomPartner(unit);
    setSelectedId(unit.id);
  };

  const handleConfirm = async () => {
    if (!selectedId) return;
    await onConfirm(selectedId);
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
                <Shuffle className="w-4 h-4 text-success" />
                选择碰撞对手
              </h3>
              <button
                type="button"
                onClick={onClose}
                className="p-1 rounded-[2px] hover:bg-white/[0.05] text-text-muted"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto">
              <p className="text-xs text-text-secondary">
                概念 A：<span className="text-text-primary">{conceptTitle || '未命名概念'}</span>
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
                    <label className="block text-xs text-text-muted">推荐对手</label>
                    {candidates.map((c) => {
                      const pairing = PAIRING_CONFIG[c.pairing] || PAIRING_CONFIG.recent;
                      const checked = selectedId === c.content_id;
                      return (
                        <label
                          key={c.content_id}
                          className={`flex items-center gap-3 px-3 py-2.5 rounded-[2px] border cursor-pointer transition-colors ${checked ? 'bg-info/10 border-info/30' : 'bg-white/[0.03] border-white/[0.08] hover:bg-white/[0.06]'}`}
                        >
                          <input
                            type="radio"
                            name="collision-partner"
                            checked={checked}
                            onChange={() => selectCandidate(c.content_id)}
                            className="accent-info shrink-0"
                          />
                          <span className="flex-1 min-w-0 text-sm text-text-primary truncate">{c.title || '未命名概念'}</span>
                          <span className="text-xs text-info shrink-0">{Math.round(c.similarity * 100)}%</span>
                          <span className={`px-1.5 py-0.5 rounded-md text-[10px] border shrink-0 ${pairing.className}`}>
                            {pairing.label}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )
              )}

              {/* 自定义对手 */}
              <div className="space-y-2 pt-3 border-t border-white/[0.06]">
                <label className="block text-xs text-text-muted">自定义对手</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="搜索其他概念..."
                    className="w-full bg-white/[0.03] border border-white/[0.08] rounded-[2px] pl-10 pr-4 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-info/40 transition-colors"
                  />
                  {isSearching && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-info" />
                  )}
                </div>
                {customPartner && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-[2px] bg-info/10 border border-info/30 text-xs">
                    <span className="flex-1 min-w-0 text-text-primary truncate">
                      {getExcerpt(customPartner.content_raw) || '未命名概念'}
                    </span>
                    <span className="px-1.5 py-0.5 rounded-md text-[10px] border bg-info/15 text-info border-info/30 shrink-0">
                      自定义
                    </span>
                  </div>
                )}
                {searchResults.length > 0 && (
                  <div className="space-y-1.5">
                    {searchResults.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => selectCustom(u)}
                        className={`w-full flex items-center gap-2 px-3 py-2 rounded-[2px] border text-left transition-colors ${selectedId === u.id ? 'bg-info/10 border-info/30' : 'bg-white/[0.03] border-white/[0.08] hover:bg-white/[0.06]'}`}
                      >
                        <span className="flex-1 min-w-0 text-xs text-text-primary truncate">
                          {getExcerpt(u.content_raw) || '未命名概念'}
                        </span>
                        {selectedId === u.id && (
                          <span className="px-1.5 py-0.5 rounded-md text-[10px] border bg-info/15 text-info border-info/30 shrink-0">
                            自定义
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {showEmpty && (
                <div className="flex flex-col items-center justify-center py-6 text-center">
                  <Shuffle className="w-10 h-10 text-text-muted/40 mb-3" />
                  <p className="text-text-secondary text-sm">没有可碰撞的其他概念，先去抽取更多概念</p>
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-border-color shrink-0 space-y-2">
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
                  disabled={!selectedId || isConfirming}
                  className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-[2px] text-xs font-medium hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-60"
                >
                  {isConfirming ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Shuffle className="w-3.5 h-3.5" />
                  )}
                  开始碰撞
                </button>
              </div>
              <p className="text-right text-[10px] text-text-muted">碰撞将调用一次 AI（按量计费）</p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default CollisionPartnerModal;
