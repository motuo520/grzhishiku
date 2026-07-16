import { FC, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  GitBranch, ChevronDown, ChevronUp, Brain, Globe, Layers,
  Clock, Target, AlertCircle, TrendingUp, Sparkles,
  Trash2, Edit3, Play, Zap, Link2
} from 'lucide-react';
import { FutureSimulation, DecisionAudit } from '@/api/cognitive';

interface Props {
  simulation: FutureSimulation;
  audits?: DecisionAudit[];
  onRun: (id: string) => void;
  onEdit: (sim: FutureSimulation) => void;
  onDelete: (id: string) => void;
  running?: boolean;
}

const STATUS_BADGE: Record<string, { label: string; color: string; bg: string; border: string }> = {
  pending: { label: '待模拟', color: 'text-text-muted', bg: 'bg-white/[0.03]', border: 'border-white/[0.08]' },
  simulated: { label: '已推演', color: 'text-success', bg: 'bg-success/10', border: 'border-success/20' },
};

const BRAIN_SIDE_ICON: Record<string, typeof Brain> = {
  personal: Brain,
  network: Globe,
  both: Layers,
};

export const FutureSimulationCard: FC<Props> = ({ simulation, audits = [], onRun, onEdit, onDelete, running }) => {
  const [expanded, setExpanded] = useState(false);
  const status = STATUS_BADGE[simulation.status] || STATUS_BADGE.pending;
  const result = simulation.result || {};
  const SideIcon = BRAIN_SIDE_ICON[simulation.brain_side] || Brain;
  const relatedAudit = simulation.related_audit_id
    ? audits.find((a) => a.id === simulation.related_audit_id)
    : null;

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
              {simulation.brain_side === 'personal' ? '个人脑' : simulation.brain_side === 'network' ? '网络脑' : '双脑'}
            </span>
            <span className="text-xs text-text-muted flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {simulation.timeframes.join(' / ')}
            </span>
            {relatedAudit && (
              <span className="text-xs text-fusion-primary flex items-center gap-1">
                <Link2 className="w-3 h-3" />
                关联：{relatedAudit.title}
              </span>
            )}
          </div>
          <h3 className="text-lg font-bold text-text-primary">{simulation.title}</h3>
          <p className="text-sm text-text-secondary mt-1 line-clamp-2">{simulation.context}</p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onEdit(simulation)}
            className="p-2 rounded-lg text-text-muted hover:text-fusion-primary hover:bg-white/[0.05] transition-colors"
          >
            <Edit3 className="w-4 h-4" />
          </button>
          <button
            onClick={() => onDelete(simulation.id)}
            className="p-2 rounded-lg text-text-muted hover:text-danger hover:bg-white/[0.05] transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {simulation.variables.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {simulation.variables.map((v, idx) => (
            <span
              key={idx}
              className="px-2.5 py-1 rounded-full text-xs bg-info/10 border border-info/20 text-info"
            >
              {v}
            </span>
          ))}
        </div>
      )}

      {simulation.status === 'simulated' && (
        <div className="p-4 rounded-xl bg-fusion-primary/5 border border-fusion-primary/10">
          <div className="flex items-start gap-2">
            <Sparkles className="w-5 h-5 text-fusion-primary flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-bold text-text-primary mb-1">推演结论</div>
              <p className="text-sm text-text-secondary leading-relaxed">{result.summary || '暂无结论'}</p>
            </div>
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
        {simulation.status !== 'simulated' ? (
          <button
            onClick={() => onRun(simulation.id)}
            disabled={running}
            className="btn-primary flex items-center gap-2 text-sm"
          >
            {running ? <Zap className="w-4 h-4 animate-pulse" /> : <Play className="w-4 h-4" />}
            <span>{running ? '推演中...' : '运行模拟'}</span>
          </button>
        ) : (
          <button
            onClick={() => onRun(simulation.id)}
            disabled={running}
            className="btn-secondary flex items-center gap-2 text-sm"
          >
            {running ? <Zap className="w-4 h-4 animate-pulse" /> : <GitBranch className="w-4 h-4" />}
            <span>{running ? '推演中...' : '重新推演'}</span>
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
            <div className="pt-4 border-t border-white/[0.05] space-y-5">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Target className="w-4 h-4 text-info" />
                  <span className="text-sm font-bold text-text-primary">情景设定</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {simulation.scenarios.map((s, idx) => (
                    <div key={idx} className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.05]">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-bold text-text-primary">{s.name}</span>
                        <span className="text-xs text-info">{s.probability}%</span>
                      </div>
                      <ul className="space-y-1">
                        {s.assumptions.map((a, i) => (
                          <li key={i} className="text-xs text-text-secondary flex items-start gap-1">
                            <span className="text-text-muted">•</span>
                            {a}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>

              {simulation.status === 'simulated' && result.outcomes && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-success" />
                    <span className="text-sm font-bold text-text-primary">情景推演结果</span>
                  </div>
                  {result.outcomes.map((outcome, idx) => (
                    <div key={idx} className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.05]">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm font-bold text-fusion-primary">{outcome.scenario}</span>
                        <span className="text-xs text-text-muted">概率 {outcome.probability}%</span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm mb-3">
                        <div className="p-2 rounded-lg bg-success/5 border border-success/10">
                          <div className="text-xs text-success font-bold mb-1">短期</div>
                          <p className="text-text-secondary">{outcome.short_term}</p>
                        </div>
                        <div className="p-2 rounded-lg bg-warning/5 border border-warning/10">
                          <div className="text-xs text-warning font-bold mb-1">中期</div>
                          <p className="text-text-secondary">{outcome.medium_term}</p>
                        </div>
                        <div className="p-2 rounded-lg bg-info/5 border border-info/10">
                          <div className="text-xs text-info font-bold mb-1">长期</div>
                          <p className="text-text-secondary">{outcome.long_term}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                        <div>
                          <div className="text-text-secondary font-bold mb-1">关键指标</div>
                          <ul className="space-y-1">
                            {outcome.key_indicators.map((k, i) => (
                              <li key={i} className="text-text-muted">• {k}</li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <div className="text-text-secondary font-bold mb-1">风险</div>
                          <ul className="space-y-1">
                            {outcome.risks.map((r, i) => (
                              <li key={i} className="text-danger">• {r}</li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <div className="text-text-secondary font-bold mb-1">机会</div>
                          <ul className="space-y-1">
                            {outcome.opportunities.map((o, i) => (
                              <li key={i} className="text-success">• {o}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  ))}

                  <div className="p-4 rounded-xl bg-warning/5 border border-warning/10">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertCircle className="w-4 h-4 text-warning" />
                      <span className="text-sm font-bold text-text-primary">综合建议</span>
                    </div>
                    <p className="text-sm text-text-secondary leading-relaxed">{result.recommendation || '暂无建议'}</p>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default FutureSimulationCard;
