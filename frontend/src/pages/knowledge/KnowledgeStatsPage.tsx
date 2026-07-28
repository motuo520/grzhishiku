import { FC, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Activity, Brain, Globe, User, ShieldCheck, AlertTriangle,
  XCircle, HelpCircle, BarChart3, RefreshCw
} from 'lucide-react';
import { useKnowledge } from '@/hooks/useKnowledge';
import ErrorState from '@/components/ErrorState';
import type { SideStats, KnowledgeStatsResponse } from '@/types';

interface StatCardProps {
  label: string;
  value: number;
  icon: React.ElementType;
  colorClass: string;
}

const StatCard: FC<StatCardProps> = ({ label, value, icon: Icon, colorClass }) => (
  <div className="glass-card p-4 flex items-center gap-3">
    <div className={`p-2 rounded-lg bg-white/[0.03] ${colorClass}`}>
      <Icon className="w-5 h-5" />
    </div>
    <div>
      <div className="text-xl font-bold text-text-primary">{value}</div>
      <div className="text-[11px] text-text-muted">{label}</div>
    </div>
  </div>
);

interface SideSectionProps {
  title: string;
  icon: React.ElementType;
  stats: SideStats | undefined;
  color: string;
}

const SideSection: FC<SideSectionProps> = ({ title, icon: Icon, stats, color }) => {
  if (!stats) return null;
  const confidence = stats.average_confidence;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card p-5 space-y-4"
    >
      <div className="flex items-center gap-2">
        <Icon className={`w-5 h-5 ${color}`} />
        <h2 className="text-base font-semibold text-text-primary">{title}</h2>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard label="总数" value={stats.total} icon={Activity} colorClass="text-text-primary" />
        <StatCard label="已验证" value={stats.verified} icon={ShieldCheck} colorClass="text-success" />
        <StatCard label="争议" value={stats.disputed} icon={AlertTriangle} colorClass="text-warning" />
        <StatCard label="已证伪" value={stats.debunked} icon={XCircle} colorClass="text-danger" />
        <StatCard label="待验证" value={stats.unverified} icon={HelpCircle} colorClass="text-text-muted" />
        <StatCard label="验证中" value={stats.checking} icon={RefreshCw} colorClass="text-info" />
      </div>

      <div>
        <div className="flex items-center justify-between text-xs text-text-secondary mb-1.5">
          <span className="flex items-center gap-1"><BarChart3 className="w-3.5 h-3.5" /> 平均可信度</span>
          <span className={confidence >= 75 ? 'text-success' : confidence >= 50 ? 'text-warning' : 'text-danger'}>
            {confidence.toFixed(1)}%
          </span>
        </div>
        <div className="h-2 bg-bg-tertiary rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${Math.min(confidence, 100)}%` }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            className={`h-full rounded-full ${confidence >= 75 ? 'bg-success' : confidence >= 50 ? 'bg-warning' : 'bg-danger'}`}
          />
        </div>
      </div>
    </motion.div>
  );
};

const KnowledgeStatsPage: FC = () => {
  const { stats: rawStats, isStatsLoading, statsError, refetchStats } = useKnowledge();

  // 兼容后端新旧两种 stats 格式
  const stats = useMemo(() => {
    if (!rawStats) return undefined;
    const s = rawStats as any;
    if (s.both) return rawStats as KnowledgeStatsResponse;
    const sideStats: SideStats = {
      total: s.total ?? 0,
      verified: s.verified ?? 0,
      disputed: s.disputed ?? 0,
      debunked: s.debunked ?? 0,
      unverified: s.unverified ?? 0,
      checking: s.checking ?? 0,
      outdated: s.outdated ?? 0,
      average_confidence: s.average_confidence ?? 0,
    };
    return { personal: sideStats, network: sideStats, both: sideStats };
  }, [rawStats]);

  const healthScore = useMemo(() => {
    if (!stats) return 0;
    const both = stats.both;
    if (both.total === 0) return 0;
    const verifiedRatio = both.verified / both.total;
    const disputedRatio = both.disputed / both.total;
    const debunkedRatio = both.debunked / both.total;
    const checkingRatio = (both.checking ?? 0) / both.total;
    const outdatedRatio = (both.outdated ?? 0) / both.total;
    return Math.max(
      0,
      Math.round(
        verifiedRatio * 100 -
        disputedRatio * 30 -
        debunkedRatio * 60 -
        checkingRatio * 10 -
        outdatedRatio * 40
      )
    );
  }, [stats]);

  if (isStatsLoading) {
    return (
      <div className="max-w-7xl mx-auto p-6 flex items-center justify-center h-96">
        <div className="animate-spin w-10 h-10 border-2 border-info border-t-transparent rounded-full" />
      </div>
    );
  }

  if (statsError) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <ErrorState title="统计洞察加载失败" message={statsError?.message || '无法获取知识统计'} onRetry={refetchStats} />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <Activity className="w-6 h-6 text-info" /> 统计洞察
          </h1>
          <p className="text-sm text-text-secondary mt-1">双脑知识库健康度全景分析</p>
        </div>
        <div className="glass-card px-4 py-3 flex items-center gap-3">
          <Brain className="w-6 h-6 text-info" />
          <div>
            <div className="text-xs text-text-muted">知识健康分</div>
            <div className={`text-2xl font-bold ${healthScore >= 80 ? 'text-success' : healthScore >= 50 ? 'text-warning' : 'text-danger'}`}>
              {healthScore}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SideSection title="网络脑" icon={Globe} stats={stats?.network} color="text-info" />
        <SideSection title="个人脑" icon={User} stats={stats?.personal} color="text-personal-primary" />
      </div>

      <SideSection title="双脑汇总" icon={Brain} stats={stats?.both} color="text-success" />
    </div>
  );
};

export default KnowledgeStatsPage;
