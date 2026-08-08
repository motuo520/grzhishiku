import { FC, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  XCircle, AlertTriangle, Search, MessageSquarePlus, ArrowRight,
  ShieldCheck, HelpCircle, Loader2, Clock, Pencil, Eye, Trash2, Check, X
} from 'lucide-react';
import { useCounterEvidence, useUpdateKnowledgeUnit } from '@/hooks/useKnowledge';
import { knowledgeApi } from '@/api/knowledge';
import ErrorState from '@/components/ErrorState';
import type { KnowledgeUnit } from '@/types';

const statusConfig: Record<string, { icon: React.ElementType; label: string; badgeClass: string }> = {
  confirmed: { icon: ShieldCheck, label: '已验证', badgeClass: 'bg-success/10 text-success border-success/30' },
  disputed: { icon: AlertTriangle, label: '有争议', badgeClass: 'bg-warning/10 text-warning border-warning/30' },
  debunked: { icon: XCircle, label: '已证伪', badgeClass: 'bg-danger/10 text-danger border-danger/30' },
  unverified: { icon: HelpCircle, label: '待验证', badgeClass: 'bg-bg-tertiary text-text-muted border-border-color' },
  checking: { icon: Loader2, label: '验证中', badgeClass: 'bg-info/10 text-info border-info/30' },
  outdated: { icon: Clock, label: '已过期', badgeClass: 'bg-warning/10 text-warning border-warning/30' },
};

const CounterEvidenceWallPage: FC = () => {
  const navigate = useNavigate();
  const { units, isLoading, error, refetch } = useCounterEvidence();
  const updateUnit = useUpdateKnowledgeUnit();
  const [searchQuery, setSearchQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [editingUnit, setEditingUnit] = useState<KnowledgeUnit | null>(null);
  const [editText, setEditText] = useState('');

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // 处置台：修正重验 / 保留观察 / 移除
  const handleKeep = async (unit: KnowledgeUnit) => {
    setBusyId(unit.id);
    try {
      await updateUnit.mutateAsync({ id: unit.id, data: { verification_status: 'unverified' } as any });
      showToast('已转为待验证，移出反证墙');
      refetch();
    } catch (e: any) {
      showToast(e?.message || '操作失败');
    } finally {
      setBusyId(null);
    }
  };

  const handleRemove = async (unit: KnowledgeUnit) => {
    if (!confirm('确定移除这条知识？（软删除，不再参与检索与图谱）')) return;
    setBusyId(unit.id);
    try {
      await knowledgeApi.delete(unit.id);
      showToast('已移除');
      refetch();
    } catch (e: any) {
      showToast(e?.message || '移除失败');
    } finally {
      setBusyId(null);
    }
  };

  const handleEditSaveAndVerify = async () => {
    if (!editingUnit) return;
    setBusyId(editingUnit.id);
    try {
      await updateUnit.mutateAsync({
        id: editingUnit.id,
        data: { content_raw: editText.trim() || undefined },
      });
      await knowledgeApi.verify(editingUnit.id);
      showToast('已保存修正并重新验证');
      setEditingUnit(null);
      refetch();
    } catch (e: any) {
      showToast(e?.response?.data?.detail || e?.message || '保存或验证失败');
    } finally {
      setBusyId(null);
    }
  };

  const filtered = useMemo(() => {
    const all = (units || []) as KnowledgeUnit[];
    if (!searchQuery.trim()) return all;
    const q = searchQuery.toLowerCase();
    return all.filter((u) =>
      u.content_raw.toLowerCase().includes(q) ||
      u.source_title?.toLowerCase().includes(q)
    );
  }, [units, searchQuery]);

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto p-6 flex items-center justify-center h-96">
        <div className="animate-spin w-10 h-10 border-2 border-info border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <ErrorState title="反证墙加载失败" message={error?.message || '无法获取争议知识'} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 glass-card px-4 py-3 rounded-xl flex items-center gap-2 text-sm border border-success/30">
          <Check className="w-4 h-4 text-success" />
          <span className="text-text-primary">{toast}</span>
        </div>
      )}

      {/* 修正重验弹窗 */}
      {editingUnit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="glass-card p-5 w-full max-w-lg">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-text-primary">修正并重验</h3>
              <button onClick={() => setEditingUnit(null)} className="text-text-muted hover:text-text-primary">
                <X className="w-4 h-4" />
              </button>
            </div>
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              rows={6}
              className="w-full px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded-[2px] text-sm text-text-primary focus:outline-none focus:border-info/50 resize-none"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setEditingUnit(null)}
                className="px-3 py-1.5 bg-white/[0.05] border border-white/[0.08] rounded-[2px] text-xs text-text-secondary hover:bg-white/[0.08] transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleEditSaveAndVerify}
                disabled={busyId === editingUnit.id || !editText.trim()}
                className="px-3 py-1.5 bg-info/10 border border-info/30 rounded-[2px] text-xs text-info hover:bg-info/20 transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                {busyId === editingUnit.id && <Loader2 className="w-3 h-3 animate-spin" />}
                保存并重新验证
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <XCircle className="w-6 h-6 text-danger" /> 反证墙
          </h1>
          <p className="text-sm text-text-secondary mt-1">集中审查争议、证伪与过期的知识单元</p>
        </div>
        <div className="glass-card px-4 py-2 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-warning" />
          <div>
            <div className="text-lg font-bold text-text-primary">{filtered.length}</div>
            <div className="text-[10px] text-text-muted">待审查条目</div>
          </div>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索争议知识..."
          className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl pl-10 pr-4 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-info/40 transition-colors"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="glass-card flex flex-col items-center justify-center py-20">
          <ShieldCheck className="w-12 h-12 text-success/40 mb-3" />
          <p className="text-text-secondary text-sm">暂无争议或证伪知识</p>
          <p className="text-text-muted text-xs mt-1">你的知识体系目前很稳健</p>
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence>
            {filtered.map((unit, index) => {
              const status = statusConfig[unit.verification_status] || statusConfig.unverified;
              const StatusIcon = status.icon;
              return (
                <motion.div
                  key={unit.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.03 }}
                  className="glass-card p-4 hover:border-danger/30 transition-colors cursor-pointer"
                  onClick={() => navigate(`/knowledge/${unit.id}`)}
                >
                  <div className="flex items-start gap-4">
                    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium shrink-0 ${status.badgeClass}`}>
                      <StatusIcon className="w-3.5 h-3.5" />
                      {status.label}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-text-primary font-medium line-clamp-2 leading-relaxed break-words">{unit.content_raw}</div>
                      <div className="flex items-center gap-3 text-xs text-text-muted mt-2 flex-wrap">
                        <span className="flex items-center gap-1"><MessageSquarePlus className="w-3 h-3" /> 审查 {unit.review_count} 次</span>
                        {unit.source_url && <span className="flex items-center gap-1 break-all max-w-full"><XCircle className="w-3 h-3 shrink-0" />{unit.source_url}</span>}
                      </div>
                      {/* 处置台 */}
                      <div className="flex items-center gap-2 mt-3" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => { setEditingUnit(unit); setEditText(unit.content_raw || ''); }}
                          disabled={busyId === unit.id}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-[2px] text-xs text-info border border-info/30 bg-info/10 hover:bg-info/20 transition-colors disabled:opacity-50"
                        >
                          <Pencil className="w-3 h-3" /> 修正重验
                        </button>
                        <button
                          onClick={() => handleKeep(unit)}
                          disabled={busyId === unit.id}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-[2px] text-xs text-text-secondary border border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.08] transition-colors disabled:opacity-50"
                          title="转为待验证，移出反证墙，稍后再审"
                        >
                          {busyId === unit.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />} 保留观察
                        </button>
                        <button
                          onClick={() => handleRemove(unit)}
                          disabled={busyId === unit.id}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-[2px] text-xs text-danger border border-danger/30 bg-danger/10 hover:bg-danger/20 transition-colors disabled:opacity-50"
                        >
                          <Trash2 className="w-3 h-3" /> 移除
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-text-muted hover:text-info transition-colors">
                      详情 <ArrowRight className="w-3 h-3" />
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
};

export default CounterEvidenceWallPage;
