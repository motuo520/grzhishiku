import { FC, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle, ShieldCheck, AlertTriangle, XCircle, HelpCircle, AlertCircle, Clock,
  Search, RefreshCw, Loader2, BarChart3, ArrowRight
} from 'lucide-react';
import { useKnowledge } from '@/hooks/useKnowledge';
import ErrorState from '@/components/ErrorState';
import ModelSelector from '@/components/llm/ModelSelector';
import LLMCostBadge from '@/components/llm/LLMCostBadge';
import type { KnowledgeUnit } from '@/types';

const statusConfig: Record<string, { icon: React.ElementType; label: string; badgeClass: string }> = {
  confirmed: { icon: ShieldCheck, label: '已验证', badgeClass: 'bg-success/10 text-success border-success/30' },
  disputed: { icon: AlertTriangle, label: '有争议', badgeClass: 'bg-warning/10 text-warning border-warning/30' },
  debunked: { icon: XCircle, label: '已证伪', badgeClass: 'bg-danger/10 text-danger border-danger/30' },
  unverified: { icon: HelpCircle, label: '待验证', badgeClass: 'bg-bg-tertiary text-text-muted border-border-color' },
  checking: { icon: Loader2, label: '验证中', badgeClass: 'bg-info/10 text-info border-info/30' },
  outdated: { icon: Clock, label: '已过期', badgeClass: 'bg-warning/10 text-warning border-warning/30' },
};

const VerificationCenterPage: FC = () => {
  const navigate = useNavigate();
  const { units, isLoading, error, refetch, verifyUnit } = useKnowledge();
  const [searchQuery, setSearchQuery] = useState('');
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [modelId, setModelId] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { pending, verified, disputed } = useMemo(() => {
    const all = (units || []) as KnowledgeUnit[];
    return {
      pending: all.filter((u) => ['unverified', 'checking'].includes(u.verification_status)),
      verified: all.filter((u) => u.verification_status === 'confirmed'),
      disputed: all.filter((u) => ['disputed', 'debunked'].includes(u.verification_status)),
    };
  }, [units]);

  const filteredPending = useMemo(() => {
    if (!searchQuery.trim()) return pending;
    const q = searchQuery.toLowerCase();
    return pending.filter((u) =>
      u.content_raw.toLowerCase().includes(q) ||
      u.source_title?.toLowerCase().includes(q)
    );
  }, [pending, searchQuery]);

  const handleVerify = async (id: string) => {
    if (verifyingId) return;
    setVerifyingId(id);
    setErrorMsg(null);
    try {
      await verifyUnit({ id, preferred_model: modelId || undefined });
    } catch (err: any) {
      setErrorMsg(err?.response?.data?.detail || err.message || '验证失败');
    } finally {
      setVerifyingId(null);
    }
  };

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
        <ErrorState title="验证中心加载失败" message={error?.message || '无法获取知识数据'} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <AnimatePresence>
        {errorMsg && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-danger/10 border border-danger/20 text-danger text-sm"
          >
            <AlertCircle className="w-4 h-4" /> {errorMsg}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <CheckCircle className="w-6 h-6 text-info" /> 验证中心
          </h1>
          <p className="text-sm text-text-secondary mt-1">批量审查知识可信度，触发 LLM 多模型验证</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="glass-card px-3 py-2 text-center min-w-[80px]">
            <div className="text-lg font-bold text-warning">{pending.length}</div>
            <div className="text-[10px] text-text-muted">待验证</div>
          </div>
          <div className="glass-card px-3 py-2 text-center min-w-[80px]">
            <div className="text-lg font-bold text-success">{verified.length}</div>
            <div className="text-[10px] text-text-muted">已确认</div>
          </div>
          <div className="glass-card px-3 py-2 text-center min-w-[80px]">
            <div className="text-lg font-bold text-danger">{disputed.length}</div>
            <div className="text-[10px] text-text-muted">争议</div>
          </div>
          <div className="w-44 space-y-2">
            <ModelSelector value={modelId} onChange={setModelId} taskType="analysis" className="w-full" />
            {pending.length > 0 ? (
              <LLMCostBadge modelId={modelId} inputText={pending[0]?.content_raw || ''} outputTokenEstimate={600} className="w-full" />
            ) : (
              <div className="text-[10px] text-text-muted text-center py-1">暂无待验证内容</div>
            )}
          </div>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索待验证知识..."
          className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl pl-10 pr-4 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-info/40 transition-colors"
        />
      </div>

      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <RefreshCw className="w-4 h-4 text-info" /> 待验证队列
        </h2>
        {filteredPending.length === 0 ? (
          <div className="glass-card flex flex-col items-center justify-center py-16">
            <ShieldCheck className="w-12 h-12 text-success/40 mb-3" />
            <p className="text-text-secondary text-sm">暂无待验证知识</p>
          </div>
        ) : (
          <div className="space-y-3">
            <AnimatePresence>
              {filteredPending.map((unit, index) => {
                const status = statusConfig[unit.verification_status] || statusConfig.unverified;
                const StatusIcon = status.icon;
                const consensus = unit.verification_consensus ?? 0;
                const isVerifyingThis = verifyingId === unit.id;
                const isBusy = verifyingId !== null;
                return (
                  <motion.div
                    key={unit.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.03 }}
                    className="glass-card p-4"
                  >
                    <div className="flex items-start gap-4">
                      <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium shrink-0 ${status.badgeClass}`}>
                        <StatusIcon className={`w-3.5 h-3.5 ${unit.verification_status === 'checking' ? 'animate-spin' : ''}`} />
                        {status.label}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-text-primary font-medium line-clamp-2 leading-relaxed break-all overflow-hidden max-w-full">{unit.content_raw}</div>
                        {unit.verification_consensus != null && (
                          <div className="mt-2">
                            <div className="flex items-center justify-between text-xs text-text-secondary mb-1">
                              <span className="flex items-center gap-1"><BarChart3 className="w-3 h-3" /> 当前可信度</span>
                              <span className={consensus >= 75 ? 'text-success' : consensus >= 50 ? 'text-warning' : 'text-danger'}>{consensus.toFixed(0)}%</span>
                            </div>
                            <div className="h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${consensus >= 75 ? 'bg-success' : consensus >= 50 ? 'bg-warning' : 'bg-danger'}`} style={{ width: `${Math.min(consensus, 100)}%` }} />
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <button
                          onClick={() => handleVerify(unit.id)}
                          disabled={isVerifyingThis || isBusy}
                          className="flex items-center gap-1 px-3 py-1.5 bg-info/15 text-info border border-info/30 rounded-lg text-xs font-medium hover:bg-info/25 transition-all disabled:opacity-50"
                        >
                          {isVerifyingThis ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                          {isVerifyingThis ? '验证中' : '验证'}
                        </button>
                        <button
                          onClick={() => navigate(`/knowledge/${unit.id}`)}
                          className="flex items-center gap-1 text-xs text-text-muted hover:text-info transition-colors"
                        >
                          详情 <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
};

export default VerificationCenterPage;
