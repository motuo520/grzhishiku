import { FC, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  GitCommit, Globe, Search, ExternalLink, BarChart3
} from 'lucide-react';
import { useSourceAggregates } from '@/hooks/useKnowledge';
import ErrorState from '@/components/ErrorState';

const reputationClass: Record<string, string> = {
  high: 'text-success',
  medium: 'text-warning',
  low: 'text-danger',
  'very low': 'text-danger',
  unknown: 'text-text-muted',
};

const SourceTraceabilityPage: FC = () => {
  const { sources, isLoading, error, refetch } = useSourceAggregates();
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = useMemo(() => {
    if (!sources) return [];
    if (!searchQuery.trim()) return sources;
    const q = searchQuery.toLowerCase();
    return sources.filter((s) => s.domain.toLowerCase().includes(q));
  }, [sources, searchQuery]);

  const totalUnits = useMemo(() => filtered.reduce((sum, s) => sum + s.count, 0), [filtered]);

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
        <ErrorState title="来源追溯加载失败" message={error?.message || '无法获取来源数据'} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <GitCommit className="w-6 h-6 text-info" /> 来源追溯
          </h1>
          <p className="text-sm text-text-secondary mt-1">按域名聚合来源，追踪知识出处与可信度</p>
        </div>
        <div className="glass-card px-4 py-2 flex items-center gap-3">
          <Globe className="w-5 h-5 text-text-muted" />
          <div>
            <div className="text-lg font-bold text-text-primary">{filtered.length}</div>
            <div className="text-[10px] text-text-muted">来源域名 · {totalUnits} 条知识</div>
          </div>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索来源域名..."
          className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl pl-10 pr-4 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-info/40 transition-colors"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="glass-card flex flex-col items-center justify-center py-20">
          <Globe className="w-12 h-12 text-text-muted/40 mb-3" />
          <p className="text-text-secondary text-sm">暂无来源数据</p>
          <p className="text-text-muted text-xs mt-1">请先添加带 URL 的知识单元</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((source, index) => (
            <motion.div
              key={source.domain}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="glass-card p-4 space-y-3 hover:border-info/20 transition-colors"
            >
              <div className="flex items-start justify-between min-w-0">
                <div className="flex items-center gap-2 min-w-0 overflow-hidden">
                  <Globe className="w-4 h-4 text-info shrink-0" />
                  <h3 className="text-sm font-semibold text-text-primary truncate min-w-0">{source.domain}</h3>
                </div>
                <a
                  href={`https://${source.domain}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-text-muted hover:text-info transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white/[0.03] rounded-lg p-2">
                  <div className="text-lg font-bold text-text-primary">{source.count}</div>
                  <div className="text-[10px] text-text-muted">知识单元</div>
                </div>
                <div className="bg-white/[0.03] rounded-lg p-2">
                  <div className={`text-lg font-bold ${reputationClass[source.reputation] || 'text-text-muted'}`}>
                    {source.avg_source_credibility.toFixed(1)}
                  </div>
                  <div className="text-[10px] text-text-muted">来源可信度</div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-xs text-text-secondary mb-1">
                  <span className="flex items-center gap-1"><BarChart3 className="w-3 h-3" /> 平均验证共识</span>
                  <span>{source.avg_verification_consensus.toFixed(0)}%</span>
                </div>
                <div className="h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-info"
                    style={{ width: `${Math.min(source.avg_verification_consensus, 100)}%` }}
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-1">
                {source.factors.slice(0, 3).map((factor, i) => (
                  <span key={i} className="px-1.5 py-0.5 rounded bg-white/[0.05] text-text-muted text-[10px] border border-white/[0.06]">
                    {factor}
                  </span>
                ))}
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SourceTraceabilityPage;
