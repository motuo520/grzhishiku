import { FC, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShieldCheck, AlertTriangle, XCircle, HelpCircle, ArrowLeft,
  RefreshCw, ExternalLink, BarChart3, Clock, Globe, User,
  Calendar, CheckCircle2, AlertCircle, FileText, ChevronDown,
  ChevronUp, Loader2, Layers
} from 'lucide-react';
import { useKnowledgeUnit } from '@/hooks/useKnowledge';
import ErrorState from '@/components/ErrorState';
import ModelSelector from '@/components/llm/ModelSelector';
import type { VerificationHistoryEntry } from '@/types';

const statusConfig: Record<string, { icon: React.ElementType; label: string; badgeClass: string; desc: string }> = {
  confirmed: {
    icon: ShieldCheck, label: '已验证', badgeClass: 'bg-success/10 text-success border-success/30',
    desc: '该知识经过验证，可信度较高',
  },
  disputed: {
    icon: AlertTriangle, label: '有争议', badgeClass: 'bg-warning/10 text-warning border-warning/30',
    desc: '该知识存在争议，需要进一步审查',
  },
  debunked: {
    icon: XCircle, label: '已证伪', badgeClass: 'bg-danger/10 text-danger border-danger/30',
    desc: '该知识已被证伪或不可靠',
  },
  unverified: {
    icon: HelpCircle, label: '待验证', badgeClass: 'bg-bg-tertiary text-text-muted border-border-color',
    desc: '该知识尚未验证',
  },
  checking: {
    icon: Loader2, label: '验证中', badgeClass: 'bg-info/10 text-info border-info/30',
    desc: '正在验证中...',
  },
  outdated: {
    icon: Clock, label: '已过期', badgeClass: 'bg-warning/10 text-warning border-warning/30',
    desc: '该知识可能已过时，建议重新验证',
  },
};

// source_bias_indicator is stored as a JSON array string (e.g. '["a","b"]' or
// '[]'). Parse it into clean labels, falling back to comma-splitting for any
// legacy plain-string value so brackets/quotes never leak into the chips.
function parseBiasIndicators(raw?: string | null): string[] {
  if (!raw) return [];
  const s = raw.trim();
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) {
      return parsed.map((x) => String(x).trim()).filter(Boolean);
    }
  } catch {
    // not valid JSON — treat as a legacy comma-separated string
  }
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}

const KnowledgeDetail: FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { unit, sources, credibility, isLoading, error, refetch, verifyUnit, isVerifying, submitCounterEvidence, isSubmittingEvidence } = useKnowledgeUnit(id || '');
  const fromPath = (location.state as { from?: string } | null)?.from;

  const [showFullContent, setShowFullContent] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [showHistory, setShowHistory] = useState(true);
  const [showCounterForm, setShowCounterForm] = useState(false);
  const [counterText, setCounterText] = useState('');
  const [counterUrl, setCounterUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string>('');

  const handleVerify = async () => {
    setErrorMsg(null);
    try {
      await verifyUnit(modelId || undefined);
      setSuccessMsg('验证已触发，结果将在后台更新');
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setErrorMsg(err?.response?.data?.detail || '验证失败');
    }
  };

  const handleCounterEvidence = async () => {
    if (!counterText.trim()) return;
    setErrorMsg(null);
    try {
      await submitCounterEvidence({ evidence_text: counterText, evidence_url: counterUrl || undefined });
      setSuccessMsg('反证已提交');
      setCounterText('');
      setCounterUrl('');
      setShowCounterForm(false);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setErrorMsg(err?.response?.data?.detail || '提交失败');
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <div className="flex items-center justify-center h-96">
          <div className="animate-spin w-10 h-10 border-2 border-info border-t-transparent rounded-full" />
        </div>
      </div>
    );
  }

  if (error && !unit) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <ErrorState title="知识单元加载失败" message={error?.message || '无法获取详情'} onRetry={refetch} />
      </div>
    );
  }

  if (!unit) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <div className="glass-card flex flex-col items-center justify-center py-20">
          <HelpCircle className="w-12 h-12 text-text-muted/40 mb-3" />
          <p className="text-text-secondary">未找到知识单元</p>
          <button onClick={() => navigate(fromPath || '/knowledge/network')} className="btn-secondary text-xs mt-4">返回列表</button>
        </div>
      </div>
    );
  }

  const status = statusConfig[unit.verification_status] || statusConfig.unverified;
  const StatusIcon = status.icon;
  const consensus = unit.verification_consensus ?? 0;
  // 验证历史：优先取详情接口的 verification_history（JSON 字符串，含反证条目），兜底 sources 接口
  const history: VerificationHistoryEntry[] = (() => {
    if (unit.verification_history) {
      try {
        const parsed = JSON.parse(unit.verification_history);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        // 落回 sources 接口数据
      }
    }
    return sources?.verification_history || [];
  })();
  // 反证争议决议结果
  const disputeResolution = unit.dispute_resolution
    ? { corrected: { label: '已修正', badgeClass: 'bg-success/10 text-success border-success/30' },
        kept: { label: '保留观察', badgeClass: 'bg-info/10 text-info border-info/30' },
        rejected: { label: '已驳回', badgeClass: 'bg-danger/10 text-danger border-danger/30' } }[unit.dispute_resolution]
    : null;

  return (
    <div className="max-w-screen-2xl mx-auto p-6 space-y-6">
      <AnimatePresence>
        {errorMsg && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-[2px] bg-danger/10 border border-danger/20 text-danger text-sm">
            <AlertCircle className="w-4 h-4" /> {errorMsg}
          </motion.div>
        )}
        {successMsg && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-[2px] bg-success/10 border border-success/20 text-success text-sm">
            <CheckCircle2 className="w-4 h-4" /> {successMsg}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-center gap-3">
        <button onClick={() => navigate(fromPath || '/knowledge/network')}
          className="p-2 bg-white/[0.03] border border-white/[0.08] rounded-[2px] text-text-secondary hover:text-text-primary hover:bg-white/[0.06] transition-all">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${status.badgeClass}`}>
            <StatusIcon className={`w-3.5 h-3.5 ${unit.verification_status === 'checking' ? 'animate-spin' : ''}`} />
            {status.label}
          </div>
          {disputeResolution && (
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${disputeResolution.badgeClass}`}>
              争议决议：{disputeResolution.label}
            </div>
          )}
          <span className="text-xs text-text-muted">{status.desc}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 min-w-0">
        <div className="lg:col-span-2 space-y-6 min-w-0">
          <div className="glass-card p-5 overflow-hidden min-w-0">
            <div className="flex items-center gap-2 mb-4">
              <FileText className="w-4 h-4 text-info" />
              <h2 className="text-sm font-semibold text-text-primary">知识内容</h2>
            </div>
            <div className={`text-sm text-text-primary leading-relaxed whitespace-pre-line break-all overflow-hidden max-w-full ${!showFullContent ? 'line-clamp-6' : ''}`}>
              {unit.content_raw || '（暂无内容）'}
            </div>
            {(unit.content_raw?.length ?? 0) > 300 && (
              <button onClick={() => setShowFullContent((s) => !s)}
                className="flex items-center gap-1 text-xs text-info mt-3 hover:underline">
                {showFullContent ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                {showFullContent ? '收起' : '展开全文'}
              </button>
            )}
          </div>

          <div className="glass-card p-5 overflow-hidden min-w-0">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="w-4 h-4 text-info" />
              <h2 className="text-sm font-semibold text-text-primary">验证结果</h2>
            </div>
            {unit.verification_status === 'unverified' || unit.verification_status === 'checking' ? (
              <div className="text-sm text-text-secondary">
                {unit.verification_status === 'checking' ? '正在验证中，请稍后刷新查看结果...' : '尚未进行验证。点击右侧「触发验证」开始。'}
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between text-xs text-text-secondary mb-1.5">
                    <span>可信度评分</span>
                    <span className={consensus >= 75 ? 'text-success' : consensus >= 50 ? 'text-warning' : 'text-danger'}>
                      {consensus.toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-2 bg-bg-tertiary rounded-full overflow-hidden">
                    <motion.div initial={{ width: 0 }} animate={{ width: `${Math.min(consensus, 100)}%` }}
                      transition={{ duration: 0.8, ease: 'easeOut' }}
                      className={`h-full rounded-full ${consensus >= 75 ? 'bg-success' : consensus >= 50 ? 'bg-warning' : 'bg-danger'}`} />
                  </div>
                </div>
                {parseBiasIndicators(unit.source_bias_indicator).length > 0 && (
                  <div>
                    <div className="text-xs text-text-secondary mb-2">偏见指示器</div>
                    <div className="flex flex-wrap gap-2">
                      {parseBiasIndicators(unit.source_bias_indicator).map((trimmed) => (
                        <span key={trimmed} className="px-2 py-1 rounded-md bg-warning/10 text-warning border border-warning/20 text-xs break-words max-w-full">{trimmed}</span>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <div className="flex items-center justify-between text-xs text-text-secondary mb-1.5">
                    <span>来源可信度</span>
                    <span>{credibility && credibility.credibility_score != null ? `${credibility.credibility_score.toFixed(1)} (${credibility.reputation})` : 'N/A'}</span>
                  </div>
                  <div className="h-2 bg-bg-tertiary rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-info" style={{ width: `${credibility?.credibility_score ?? 0}%` }} />
                  </div>
                  {credibility?.domain && <div className="text-xs text-text-muted mt-1 break-all">域名: {credibility.domain}</div>}
                </div>
              </div>
            )}
          </div>

          <div className="glass-card p-5 overflow-hidden min-w-0">
            <button onClick={() => setShowHistory((s) => !s)} className="flex items-center justify-between w-full">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-info" />
                <h2 className="text-sm font-semibold text-text-primary">验证历史</h2>
                <span className="text-xs text-text-muted">({history.length})</span>
              </div>
              {showHistory ? <ChevronUp className="w-4 h-4 text-text-muted" /> : <ChevronDown className="w-4 h-4 text-text-muted" />}
            </button>
            <AnimatePresence>
              {showHistory && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <div className="mt-4 space-y-3">
                    {history.length === 0 ? (
                      <p className="text-xs text-text-muted">暂无验证历史</p>
                    ) : (
                      [...history].reverse().map((entry, idx) => {
                        // 反证条目：徽标 + 反证正文 + 来源链接 + 时间
                        if (entry.type === 'counter_evidence') {
                          const counterTime = entry.created_at || entry.timestamp;
                          return (
                            <div key={idx} className="flex items-start gap-3">
                              <div className="mt-0.5"><AlertTriangle className="w-4 h-4 text-warning" /></div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="px-1.5 py-0.5 rounded bg-warning/10 text-warning text-[10px] border border-warning/20">反证</span>
                                  {counterTime && <span className="text-[10px] text-text-muted">{new Date(counterTime).toLocaleString('zh-CN')}</span>}
                                </div>
                                {entry.evidence_text && (
                                  <div className="text-xs text-text-secondary mt-1 break-words">{entry.evidence_text}</div>
                                )}
                                {entry.evidence_url && (
                                  <a href={entry.evidence_url} target="_blank" rel="noreferrer"
                                    className="flex items-center gap-1 text-[10px] text-info hover:underline mt-1 break-all">
                                    <ExternalLink className="w-3 h-3 shrink-0" />{entry.evidence_url}
                                  </a>
                                )}
                              </div>
                            </div>
                          );
                        }
                        const entryStatus = statusConfig[entry.verdict || ''] || statusConfig.unverified;
                        const EntryIcon = entryStatus.icon;
                        return (
                          <div key={idx} className="flex items-start gap-3">
                            <div className="mt-0.5"><EntryIcon className={`w-4 h-4 ${entryStatus.badgeClass.split(' ')[1]}`} /></div>
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-text-primary">{entryStatus.label}</span>
                                <span className="text-[10px] text-text-muted">{entry.timestamp ? new Date(entry.timestamp).toLocaleString('zh-CN') : ''}</span>
                              </div>
                              <div className="text-xs text-text-secondary mt-0.5">
                                可信度: {Math.round((entry.confidence || 0) * 100)}% · 来源可靠度: {Math.round((entry.source_reliability || 0) * 100)}%
                              </div>
                              {entry.bias_indicators && entry.bias_indicators.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {entry.bias_indicators.map((b: string, i: number) => (
                                    <span key={i} className="px-1.5 py-0.5 rounded bg-warning/10 text-warning text-[10px] border border-warning/20 break-words max-w-full">{b}</span>
                                  ))}
                                </div>
                              )}
                              {entry.note && <div className="text-[10px] text-text-muted mt-1 break-words">{entry.note}</div>}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="space-y-6 min-w-0">
          <div className="glass-card p-5 overflow-hidden min-w-0">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-info" />
                <h2 className="text-sm font-semibold text-text-primary">来源信息</h2>
              </div>
              <button onClick={() => setShowSources((s) => !s)} className="text-xs text-info hover:underline shrink-0">{showSources ? '收起' : '展开'}</button>
            </div>
            <div className="space-y-2 text-xs text-text-secondary min-w-0">
              {unit.source_url ? (
                <a href={unit.source_url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-info hover:underline min-w-0 max-w-full overflow-hidden" title={unit.source_url}>
                  <ExternalLink className="w-3 h-3 shrink-0" />
                  <span className="break-all min-w-0 max-w-full">{unit.source_url}</span>
                </a>
              ) : <span className="text-text-muted">无来源 URL</span>}
              {unit.source_title && <div className="flex items-center gap-1.5 min-w-0 max-w-full overflow-hidden"><FileText className="w-3 h-3 text-text-muted shrink-0" /><span className="break-all min-w-0 max-w-full">{unit.source_title}</span></div>}
              {unit.source_author && <div className="flex items-center gap-1.5 min-w-0 max-w-full overflow-hidden"><User className="w-3 h-3 text-text-muted shrink-0" /><span className="break-all min-w-0 max-w-full">{unit.source_author}</span></div>}
              {unit.source_publish_date && <div className="flex items-center gap-1.5"><Calendar className="w-3 h-3 text-text-muted shrink-0" />{new Date(unit.source_publish_date).toLocaleDateString('zh-CN')}</div>}
              {unit.source_type && <div className="flex items-center gap-1.5"><Layers className="w-3 h-3 text-text-muted shrink-0" />{unit.source_type}</div>}
            </div>
            <AnimatePresence>
              {showSources && sources?.sources && sources.sources.length > 0 && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <div className="mt-3 pt-3 border-t border-border-color space-y-3">
                    {sources.sources.map((s: { source_title?: string | null; source_credibility_score?: number | null; source_bias_indicator: string[] }, i: number) => (
                      <div key={i} className="space-y-1 min-w-0">
                        <div className="text-xs text-text-primary font-medium break-all min-w-0">{s.source_title || '来源 ' + (i + 1)}</div>
                        <div className="text-[10px] text-text-muted">可信度评分: {s.source_credibility_score?.toFixed(1) ?? 'N/A'}</div>
                        {s.source_bias_indicator.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {s.source_bias_indicator.map((b: string, j: number) => (
                              <span key={j} className="px-1 py-0.5 rounded bg-warning/10 text-warning text-[10px] break-words max-w-full">{b}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="glass-card p-5 space-y-3 overflow-hidden min-w-0">
            <h2 className="text-sm font-semibold text-text-primary">操作</h2>
            <div className="space-y-2">
              <ModelSelector value={modelId} onChange={setModelId} taskType="analysis" className="w-full" />
            </div>
            <button onClick={handleVerify} disabled={isVerifying}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-accent text-white rounded-[2px] text-sm font-medium hover:bg-[var(--accent-hover)] transition-all disabled:opacity-60 disabled:cursor-not-allowed">
              {isVerifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {isVerifying ? '验证中...' : '触发验证'}
            </button>
            <button onClick={() => setShowCounterForm((s) => !s)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-white/[0.05] text-warning border border-warning/20 rounded-[2px] text-sm font-medium hover:bg-warning/10 transition-all">
              <AlertTriangle className="w-4 h-4" /> 添加反证
            </button>
            <AnimatePresence>
              {showCounterForm && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden space-y-2">
                  <textarea value={counterText} onChange={(e) => setCounterText(e.target.value)} placeholder="输入反证内容..." rows={3}
                    className="w-full bg-white/[0.03] border border-white/[0.08] rounded-[2px] px-3 py-2 text-xs text-text-primary placeholder-text-muted focus:outline-none focus:border-warning/40 transition-colors resize-none" />
                  <input type="text" value={counterUrl} onChange={(e) => setCounterUrl(e.target.value)} placeholder="反证来源 URL（可选）"
                    className="w-full bg-white/[0.03] border border-white/[0.08] rounded-[2px] px-3 py-2 text-xs text-text-primary placeholder-text-muted focus:outline-none focus:border-warning/40 transition-colors" />
                  <button onClick={handleCounterEvidence} disabled={isSubmittingEvidence || !counterText.trim()}
                    className="w-full px-3 py-2 bg-warning/15 text-warning border border-warning/30 rounded-[2px] text-xs font-medium hover:bg-warning/25 transition-all disabled:opacity-50">
                    {isSubmittingEvidence ? '提交中...' : '提交反证'}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="glass-card p-5 space-y-2 text-xs text-text-muted overflow-hidden min-w-0">
            <div className="flex items-center justify-between"><span>创建时间</span><span className="text-text-secondary">{new Date(unit.created_at).toLocaleString('zh-CN')}</span></div>
            <div className="flex items-center justify-between"><span>最后验证</span><span className="text-text-secondary">{unit.last_verified ? new Date(unit.last_verified).toLocaleString('zh-CN') : '未验证'}</span></div>
            <div className="flex items-center justify-between"><span>审查次数</span><span className="text-text-secondary">{unit.review_count}</span></div>
            <div className="flex items-center justify-between">
              <span>信任等级</span>
              <span className={unit.trust_level === 'trusted' ? 'text-success' : unit.trust_level === 'suspicious' ? 'text-danger' : 'text-warning'}>{unit.trust_level}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default KnowledgeDetail;
