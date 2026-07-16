import { FC } from 'react';
import { motion } from 'framer-motion';
import { Activity, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { WeeklyDimension, WeeklyStats } from '@/api/cognitive';

interface Props {
  score: number;
  summary: string;
  dimensions: WeeklyDimension[];
  stats: WeeklyStats;
  loading?: boolean;
}

const TREND_ICON = {
  up: TrendingUp,
  down: TrendingDown,
  stable: Minus,
};

const TREND_COLOR = {
  up: 'text-success',
  down: 'text-danger',
  stable: 'text-text-muted',
};

export const WeeklyReportScore: FC<Props> = ({ score, summary, dimensions, stats, loading }) => {
  if (loading) {
    return (
      <div className="glass-card p-8 animate-pulse">
        <div className="h-8 bg-white/[0.05] rounded w-1/3 mb-4" />
        <div className="h-40 bg-white/[0.03] rounded-xl" />
      </div>
    );
  }

  const circumference = 2 * Math.PI * 80;
  const offset = circumference - (score / 100) * circumference;
  const scoreColor = score >= 80 ? 'text-success' : score >= 60 ? 'text-warning' : 'text-danger';

  return (
    <div className="glass-card p-6 md:p-8">
      <div className="flex flex-col lg:flex-row gap-8">
        <div className="flex flex-col items-center justify-center">
          <div className="relative w-48 h-48">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 200 200">
              <circle cx="100" cy="100" r="80" stroke="#30363d" strokeWidth="12" fill="none" />
              <motion.circle
                cx="100"
                cy="100"
                r="80"
                stroke="currentColor"
                strokeWidth="12"
                fill="none"
                strokeLinecap="round"
                className={scoreColor}
                initial={{ strokeDashoffset: circumference }}
                animate={{ strokeDashoffset: offset }}
                transition={{ duration: 1, ease: 'easeOut' }}
                style={{ strokeDasharray: circumference }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <Activity className={`w-8 h-8 ${scoreColor} mb-1`} />
              <div className={`text-4xl font-extrabold ${scoreColor}`}>{score}</div>
              <div className="text-xs text-text-secondary">认知健康分</div>
            </div>
          </div>
        </div>

        <div className="flex-1 space-y-5">
          <div>
            <h2 className="text-xl font-bold text-text-primary mb-2">本周总评</h2>
            <p className="text-text-secondary leading-relaxed">{summary || '暂无本周总结'}</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: '笔记', value: stats.notes_count },
              { label: '知识', value: stats.knowledge_count },
              { label: '挑战', value: stats.challenges_completed },
              { label: '审计', value: stats.decisions_audited },
              { label: '模拟', value: stats.simulations_run },
            ].map((s) => (
              <div key={s.label} className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.05] text-center">
                <div className="text-xl font-bold text-text-primary">{s.value}</div>
                <div className="text-xs text-text-secondary">{s.label}</div>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-bold text-text-secondary">五维能力</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {dimensions.map((dim) => {
                const TrendIcon = TREND_ICON[dim.trend];
                return (
                  <div key={dim.name} className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.05]">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-text-primary">{dim.name}</span>
                      <span className={`text-xs flex items-center gap-0.5 ${TREND_COLOR[dim.trend]}`}>
                        <TrendIcon className="w-3 h-3" />
                        {dim.score}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-white/[0.05] overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${dim.score}%` }}
                        transition={{ duration: 0.8 }}
                        className={`h-full rounded-full ${
                          dim.score >= 80 ? 'bg-success' : dim.score >= 60 ? 'bg-warning' : 'bg-danger'
                        }`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WeeklyReportScore;
