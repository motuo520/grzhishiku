import { FC, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Map, Globe, Search, ShieldCheck, AlertTriangle, XCircle,
  HelpCircle, BarChart3
} from 'lucide-react';
import { useSourceAggregates } from '@/hooks/useKnowledge';
import ErrorState from '@/components/ErrorState';

const reputationConfig: Record<string, { icon: React.ElementType; label: string; colorClass: string }> = {
  high: { icon: ShieldCheck, label: '高可信度', colorClass: 'text-success' },
  medium: { icon: AlertTriangle, label: '中等可信度', colorClass: 'text-warning' },
  low: { icon: XCircle, label: '低可信度', colorClass: 'text-danger' },
  'very low': { icon: XCircle, label: '极低可信度', colorClass: 'text-danger' },
  unknown: { icon: HelpCircle, label: '未知', colorClass: 'text-text-muted' },
};

const CredibilityMapPage: FC = () => {
  const { sources, isLoading, error, refetch } = useSourceAggregates();
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = useMemo(() => {
    if (!sources) return [];
    if (!searchQuery.trim()) return sources;
    const q = searchQuery.toLowerCase();
    return sources.filter((s) => s.domain.toLowerCase().includes(q));
  }, [sources, searchQuery]);

  const grouped = useMemo(() => {
    const groups: Record<string, typeof filtered> = { high: [], medium: [], low: [], unknown: [] };
    filtered.forEach((s) => {
      const key = s.reputation === 'very low' ? 'low' : (groups[s.reputation] ? s.reputation : 'unknown');
      groups[key].push(s);
    });
    return groups;
  }, [filtered]);

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
        <ErrorState title="可信度地图加载失败" message={error?.message || '无法获取来源可信度'} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <Map className="w-6 h-6 text-info" /> 可信度地图
          </h1>
          <p className="text-sm text-text-secondary mt-1">按来源域名声誉分布，识别知识生态中的风险点</p>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索域名..."
          className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl pl-10 pr-4 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-info/40 transition-colors"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="glass-card flex flex-col items-center justify-center py-20">
          <Globe className="w-12 h-12 text-text-muted/40 mb-3" />
          <p className="text-text-secondary text-sm">暂无来源数据</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {(['high', 'medium', 'low'] as const).map((level) => {
            const config = reputationConfig[level];
            const Icon = config.icon;
            return (
              <div key={level} className="space-y-3">
                <h2 className={`text-sm font-semibold flex items-center gap-2 ${config.colorClass}`}>
                  <Icon className="w-4 h-4" /> {config.label}
                  <span className="text-xs text-text-muted ml-1">({grouped[level].length})</span>
                </h2>
                <div className="space-y-2">
                  {grouped[level].map((source, index) => (
                    <motion.div
                      key={source.domain}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.03 }}
                      className="glass-card p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0 overflow-hidden">
                          <Globe className="w-3.5 h-3.5 text-text-muted shrink-0" />
                          <span className="text-sm text-text-primary font-medium truncate min-w-0">{source.domain}</span>
                        </div>
                        <span className={`text-xs font-bold ${config.colorClass}`}>{source.avg_source_credibility.toFixed(1)}</span>
                      </div>
                      <div>
                        <div className="flex items-center justify-between text-[10px] text-text-muted mb-1">
                          <span className="flex items-center gap-1"><BarChart3 className="w-3 h-3" /> 验证共识</span>
                          <span>{source.avg_verification_consensus.toFixed(0)}%</span>
                        </div>
                        <div className="h-1 bg-bg-tertiary rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${level === 'high' ? 'bg-success' : level === 'medium' ? 'bg-warning' : 'bg-danger'}`}
                            style={{ width: `${Math.min(source.avg_verification_consensus, 100)}%` }}
                          />
                        </div>
                      </div>
                      <div className="text-[10px] text-text-muted">{source.count} 条知识 · {source.factors.slice(0, 2).join('，')}</div>
                    </motion.div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default CredibilityMapPage;
