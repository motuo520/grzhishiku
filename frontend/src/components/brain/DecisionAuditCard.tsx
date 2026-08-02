import { FC, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ClipboardCheck, ChevronDown, ChevronUp, Brain, Globe, Layers,
  AlertTriangle, Lightbulb, XCircle, Zap,
  BarChart3, Trash2, Edit3, Play
} from 'lucide-react';
import { DecisionAudit } from '@/api/cognitive';

interface Props {
  audit: DecisionAudit;
  onAnalyze: (id: string) => void;
  onEdit: (audit: DecisionAudit) => void;
  onDelete: (id: string) => void;
  analyzing?: boolean;
}

const STATUS_BADGE: Record<string, { label: string; color: string; bg: string; border: string }> = {
  pending: { label: '待分析', color: 'text-text-muted', bg: 'bg-white/[0.03]', border: 'border-white/[0.08]' },
  reviewed: { label: '已审计', color: 'text-success', bg: 'bg-success/10', border: 'border-success/20' },
  closed: { label: '已关闭', color: 'text-text-muted', bg: 'bg-white/[0.03]', border: 'border-white/[0.08]' },
};

const BRAIN_SIDE_ICON: Record<string, typeof Brain> = {
  personal: Brain,
  network: Globe,
  both: Layers,
};

export const DecisionAuditCard: FC<Props> = ({ audit, onAnalyze, onEdit, onDelete, analyzing }) => {
  const [expanded, setExpanded] = useState(false);
  const status = STATUS_BADGE[audit.status] || STATUS_BADGE.pending;
  const analysis = audit.analysis_result || {};
  const SideIcon = BRAIN_SIDE_ICON[audit.brain_side] || Brain;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card p-5 space-y-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className={`px-2 py-0.5 text-xs font-bold rounded-full border ${status.border} ${status.bg} ${status.color}`}>
              {status.label}
            </span>
            <span className="text-xs text-text-muted flex items-center gap-1">
              <SideIcon className="w-3 h-3" />
              {audit.brain_side === 'personal' ? '个人脑' : audit.brain_side === 'network' ? '网络脑' : '双脑'}
            </span>
            {audit.decision_date && (
              <span className="text-xs text-text-muted">{audit.decision_date.slice(0, 10)}</span>
            )}
          </div>
          <h3 className="text-lg font-bold text-text-primary">{audit.title}</h3>
          <p className="text-sm text-text-secondary mt-1 line-clamp-2">{audit.context}</p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onEdit(audit)}
            className="p-2 rounded-lg text-text-muted hover:text-fusion-primary hover:bg-white/[0.05] transition-colors"
          >
            <Edit3 className="w-4 h-4" />
          </button>
          <button
            onClick={() => onDelete(audit.id)}
            className="p-2 rounded-lg text-text-muted hover:text-danger hover:bg-white/[0.05] transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {audit.options.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {audit.options.map((opt, idx) => (
            <span
              key={opt.id || idx}
              className="px-2.5 py-1 rounded-full text-xs bg-white/[0.03] border border-white/[0.08] text-text-secondary"
            >
              方案{idx + 1}: {opt.text}
            </span>
          ))}
        </div>
      )}

      {audit.status === 'reviewed' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="p-3 rounded-xl bg-info/5 border border-info/10 text-center">
            <div className="text-xs text-text-secondary mb-1">决策信心</div>
            <div className="text-xl font-bold text-info">{Math.round(analysis.confidence || 0)}</div>
          </div>
          <div className="p-3 rounded-xl bg-warning/5 border border-warning/10 text-center">
            <div className="text-xs text-text-secondary mb-1">潜在偏差</div>
            <div className="text-xl font-bold text-warning">{(analysis.biases || []).length}</div>
          </div>
          <div className="p-3 rounded-xl bg-danger/5 border border-danger/10 text-center">
            <div className="text-xs text-text-secondary mb-1">风险点</div>
            <div className="text-xl font-bold text-danger">{(analysis.risks || []).length}</div>
          </div>
          <div className="p-3 rounded-xl bg-success/5 border border-success/10 text-center">
            <div className="text-xs text-text-secondary mb-1">建议</div>
            <div className="text-xl font-bold text-success">{(analysis.suggestions || []).length}</div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary transition-colors"
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          <span>{expanded ? '收起详情' : '展开详情'}</span>
        </button>
        {audit.status !== 'reviewed' ? (
          <button
            onClick={() => onAnalyze(audit.id)}
            disabled={analyzing}
            className="btn-primary flex items-center gap-2 text-sm"
          >
            {analyzing ? <Zap className="w-4 h-4 animate-pulse" /> : <Play className="w-4 h-4" />}
            <span>{analyzing ? '分析中...' : 'AI 审计'}</span>
          </button>
        ) : (
          <button
            onClick={() => onAnalyze(audit.id)}
            disabled={analyzing}
            className="btn-secondary flex items-center gap-2 text-sm"
          >
            {analyzing ? <Zap className="w-4 h-4 animate-pulse" /> : <ClipboardCheck className="w-4 h-4" />}
            <span>{analyzing ? '分析中...' : '重新审计'}</span>
          </button>
        )}
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="pt-4 border-t border-white/[0.05] space-y-4">
              {audit.expected_outcome && (
                <div>
                  <div className="text-xs font-bold text-text-secondary mb-1">预期结果</div>
                  <p className="text-sm text-text-primary">{audit.expected_outcome}</p>
                </div>
              )}
              {audit.actual_outcome && (
                <div>
                  <div className="text-xs font-bold text-text-secondary mb-1">实际结果</div>
                  <p className="text-sm text-text-primary">{audit.actual_outcome}</p>
                </div>
              )}

              {audit.status === 'reviewed' && (
                <>
                  <div className="p-4 rounded-xl bg-fusion-primary/5 border border-fusion-primary/10">
                    <div className="flex items-center gap-2 mb-2">
                      <ClipboardCheck className="w-4 h-4 text-fusion-primary" />
                      <span className="text-sm font-bold text-text-primary">审计结论</span>
                    </div>
                    <p className="text-sm text-text-secondary leading-relaxed">{analysis.verdict || '暂无结论'}</p>
                  </div>

                  {(analysis.biases || []).length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <AlertTriangle className="w-4 h-4 text-warning" />
                        <span className="text-sm font-bold text-text-primary">潜在认知偏差</span>
                      </div>
                      <ul className="space-y-1.5">
                        {analysis.biases.map((b, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-text-secondary">
                            <span className="text-warning mt-0.5">•</span>
                            {b}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {(analysis.risks || []).length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <XCircle className="w-4 h-4 text-danger" />
                        <span className="text-sm font-bold text-text-primary">风险点</span>
                      </div>
                      <ul className="space-y-1.5">
                        {analysis.risks.map((r, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-text-secondary">
                            <span className="text-danger mt-0.5">•</span>
                            {r}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {(analysis.suggestions || []).length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Lightbulb className="w-4 h-4 text-warning" />
                        <span className="text-sm font-bold text-text-primary">改进建议</span>
                      </div>
                      <ul className="space-y-1.5">
                        {analysis.suggestions.map((s, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-text-secondary">
                            <span className="text-success mt-0.5">•</span>
                            {s}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {analysis.option_scores && Object.keys(analysis.option_scores).length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <BarChart3 className="w-4 h-4 text-info" />
                        <span className="text-sm font-bold text-text-primary">方案评分</span>
                      </div>
                      <div className="space-y-2">
                        {Object.entries(analysis.option_scores).map(([name, score]) => (
                          <div key={name} className="space-y-1">
                            <div className="flex justify-between text-xs text-text-secondary">
                              <span>{name}</span>
                              <span>{score} 分</span>
                            </div>
                            <div className="h-2 rounded-full bg-white/[0.05] overflow-hidden">
                              <div
                                className="h-full rounded-full bg-info"
                                style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default DecisionAuditCard;
