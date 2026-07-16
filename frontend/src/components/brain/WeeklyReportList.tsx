import { FC } from 'react';
import { motion } from 'framer-motion';
import { Calendar, ChevronRight, Activity } from 'lucide-react';
import { WeeklyReport } from '@/api/cognitive';

interface Props {
  reports: WeeklyReport[];
  selectedId?: string;
  onSelect: (report: WeeklyReport) => void;
  loading?: boolean;
}

export const WeeklyReportList: FC<Props> = ({ reports, selectedId, onSelect, loading }) => {
  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="glass-card p-4 h-16 bg-white/[0.03]" />
        ))}
      </div>
    );
  }

  if (reports.length === 0) {
    return (
      <div className="glass-card p-6 text-center text-text-secondary text-sm">
        还没有周报，点击生成获取第一份认知健康周报。
      </div>
    );
  }

  return (
    <div className="glass-card p-4">
      <div className="flex items-center gap-2 mb-3 px-2">
        <Calendar className="w-4 h-4 text-fusion-primary" />
        <span className="text-sm font-bold text-text-primary">历史周报</span>
      </div>
      <div className="space-y-2">
        {reports.map((report, index) => {
          const start = report.week_start.slice(0, 10);
          const end = report.week_end.slice(0, 10);
          const active = report.id === selectedId;
          const scoreColor = report.health_score >= 80 ? 'text-success' : report.health_score >= 60 ? 'text-warning' : 'text-danger';
          return (
            <motion.button
              key={report.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
              onClick={() => onSelect(report)}
              className={`w-full flex items-center justify-between p-3 rounded-xl transition-colors text-left ${
                active
                  ? 'bg-fusion-primary/10 border border-fusion-primary/20'
                  : 'bg-white/[0.02] border border-transparent hover:bg-white/[0.04]'
              }`}
            >
              <div className="flex items-center gap-3">
                <Activity className={`w-4 h-4 ${scoreColor}`} />
                <div>
                  <div className="text-sm font-bold text-text-primary">{start} ~ {end}</div>
                  <div className="text-xs text-text-secondary">健康分 {report.health_score}</div>
                </div>
              </div>
              <ChevronRight className={`w-4 h-4 ${active ? 'text-fusion-primary' : 'text-text-muted'}`} />
            </motion.button>
          );
        })}
      </div>
    </div>
  );
};

export default WeeklyReportList;
