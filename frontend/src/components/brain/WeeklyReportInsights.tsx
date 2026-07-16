import { FC } from 'react';
import { motion } from 'framer-motion';
import { Sparkles, AlertTriangle, Lightbulb } from 'lucide-react';

interface Props {
  highlights: string[];
  risks: string[];
  suggestions: string[];
}

export const WeeklyReportInsights: FC<Props> = ({ highlights, risks, suggestions }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card p-5 border-success/10"
      >
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-5 h-5 text-success" />
          <h3 className="font-bold text-text-primary">本周亮点</h3>
        </div>
        <ul className="space-y-2">
          {highlights.length > 0 ? (
            highlights.map((item, idx) => (
              <li key={idx} className="flex items-start gap-2 text-sm text-text-secondary">
                <span className="text-success mt-0.5">•</span>
                <span className="leading-relaxed">{item}</span>
              </li>
            ))
          ) : (
            <li className="text-sm text-text-muted">暂无亮点</li>
          )}
        </ul>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="glass-card p-5 border-danger/10"
      >
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="w-5 h-5 text-danger" />
          <h3 className="font-bold text-text-primary">风险提示</h3>
        </div>
        <ul className="space-y-2">
          {risks.length > 0 ? (
            risks.map((item, idx) => (
              <li key={idx} className="flex items-start gap-2 text-sm text-text-secondary">
                <span className="text-danger mt-0.5">•</span>
                <span className="leading-relaxed">{item}</span>
              </li>
            ))
          ) : (
            <li className="text-sm text-text-muted">暂无显著风险</li>
          )}
        </ul>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="glass-card p-5 border-warning/10"
      >
        <div className="flex items-center gap-2 mb-3">
          <Lightbulb className="w-5 h-5 text-warning" />
          <h3 className="font-bold text-text-primary">下周建议</h3>
        </div>
        <ul className="space-y-2">
          {suggestions.length > 0 ? (
            suggestions.map((item, idx) => (
              <li key={idx} className="flex items-start gap-2 text-sm text-text-secondary">
                <span className="text-warning mt-0.5">•</span>
                <span className="leading-relaxed">{item}</span>
              </li>
            ))
          ) : (
            <li className="text-sm text-text-muted">暂无建议</li>
          )}
        </ul>
      </motion.div>
    </div>
  );
};

export default WeeklyReportInsights;
