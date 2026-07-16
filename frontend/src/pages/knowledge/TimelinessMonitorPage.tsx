import { FC, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Clock, AlertTriangle, Search, ArrowRight, Calendar, RefreshCw,
  ShieldCheck, HelpCircle, XCircle, Loader2
} from 'lucide-react';
import { useTimeliness } from '@/hooks/useKnowledge';
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

const TimelinessMonitorPage: FC = () => {
  const navigate = useNavigate();
  const { units, isLoading, error, refetch } = useTimeliness();
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = useMemo(() => {
    const all = (units || []) as KnowledgeUnit[];
    if (!searchQuery.trim()) return all;
    const q = searchQuery.toLowerCase();
    return all.filter((u) =>
      u.content_raw.toLowerCase().includes(q) ||
      u.source_title?.toLowerCase().includes(q)
    );
  }, [units, searchQuery]);

  const outdatedCount = useMemo(() => filtered.filter((u) => u.timeliness_status === 'outdated').length, [filtered]);

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
        <ErrorState title="时效性监测加载失败" message={error?.message || '无法获取时效数据'} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <Clock className="w-6 h-6 text-info" /> 时效性监测
          </h1>
          <p className="text-sm text-text-secondary mt-1">追踪知识半衰期与过期风险，按下次验证时间排序</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="glass-card px-3 py-2 text-center min-w-[80px]">
            <div className="text-lg font-bold text-warning">{outdatedCount}</div>
            <div className="text-[10px] text-text-muted">已过期</div>
          </div>
          <div className="glass-card px-3 py-2 text-center min-w-[80px]">
            <div className="text-lg font-bold text-text-primary">{filtered.length}</div>
            <div className="text-[10px] text-text-muted">监测中</div>
          </div>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索知识..."
          className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl pl-10 pr-4 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-info/40 transition-colors"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="glass-card flex flex-col items-center justify-center py-20">
          <Clock className="w-12 h-12 text-text-muted/40 mb-3" />
          <p className="text-text-secondary text-sm">暂无时效性数据</p>
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence>
            {filtered.map((unit, index) => {
              const status = statusConfig[unit.verification_status] || statusConfig.unverified;
              const StatusIcon = status.icon;
              const isOutdated = unit.timeliness_status === 'outdated';
              const nextDate = unit.next_scheduled ? new Date(unit.next_scheduled).toLocaleDateString('zh-CN') : '未计划';
              return (
                <motion.div
                  key={unit.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.03 }}
                  className={`glass-card p-4 hover:border-info/20 transition-colors cursor-pointer ${isOutdated ? 'border-warning/30' : ''}`}
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
                        <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> 下次验证：{nextDate}</span>
                        {unit.timeliness_half_life && <span className="flex items-center gap-1"><RefreshCw className="w-3 h-3" /> 半衰期：{unit.timeliness_half_life} 天</span>}
                        {isOutdated && <span className="flex items-center gap-1 text-warning"><AlertTriangle className="w-3 h-3" /> 已过期</span>}
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

export default TimelinessMonitorPage;
