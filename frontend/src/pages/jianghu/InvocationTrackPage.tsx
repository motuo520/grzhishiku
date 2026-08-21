import { FC, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useLocation } from 'react-router-dom';
import { useNavigation } from '@/store/navigation';
import { motion } from 'framer-motion';
import {
  Activity, TrendingUp, Clock,
  Flame, Trophy, Search, BarChart3,
  Layers, Dumbbell, Sprout
} from 'lucide-react';
import { useKnowledgeHealth } from '@/hooks/useJianghu';
import { knowledgeApi } from '@/api/knowledge';
import EvolutionChainBar from '@/components/EvolutionChainBar';
import type { KnowledgeUnit } from '@/types';

const evolutionLabel: Record<string, string> = {
  collected: '已收集',
  understood: '已理解',
  practiced: '已践行',
  validated: '已验证',
  internalized: '已内化',
};

const InvocationTrackPage: FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { brainSide } = useNavigation();
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | 'all'>('all');

  const { data: health, isLoading: healthLoading } = useKnowledgeHealth(brainSide);

  const { data: topUnits, isLoading: unitsLoading } = useQuery<KnowledgeUnit[]>({
    queryKey: ['knowledge-top-invoked', timeRange, brainSide],
    queryFn: () =>
      knowledgeApi
        .list({ sort_by: 'invoke_count', sort_order: 'desc', brain_side: brainSide === 'both' ? undefined : brainSide })
        .then((r) => {
          const rangeDays = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : null;
          const cutoff = rangeDays ? Date.now() - rangeDays * 24 * 60 * 60 * 1000 : null;
          return r.data
            .filter((u) => (u.invoke_count || 0) > 0)
            .filter((u) => !cutoff || (u.last_invoked_at ? new Date(u.last_invoked_at).getTime() >= cutoff : false))
            .slice(0, 10);
        }),
  });

  const { data: recentPracticed, isLoading: practicedLoading } = useQuery<KnowledgeUnit[]>({
    queryKey: ['knowledge-recent-practiced', brainSide],
    queryFn: () =>
      knowledgeApi
        .list({ sort_by: 'practice_depth', sort_order: 'desc', brain_side: brainSide === 'both' ? undefined : brainSide })
        .then((r) => r.data.filter((u) => (u.practice_depth || 0) > 0).slice(0, 10)),
  });

  const isLoading = healthLoading || unitsLoading || practicedLoading;

  const statCards = [
    {
      label: '今日活跃',
      value: health ? `${Math.round((health.daily_active_rate || 0) * 100)}%` : '--',
      sub: health ? `${health.total_items} 条知识` : '',
      icon: Flame,
      color: 'text-warning',
      bg: 'bg-warning/10',
    },
    {
      label: '平均调用',
      value: health ? `${health.avg_invoke_count ?? 0}` : '--',
      sub: '每条知识',
      icon: TrendingUp,
      color: 'text-network-primary',
      bg: 'bg-network-primary/10',
    },
    {
      label: '高频价值',
      value: health ? `${health.high_value_items ?? 0}` : '--',
      sub: '深度≥3 且 调用≥5',
      icon: Trophy,
      color: 'text-warning',
      bg: 'bg-warning/10',
    },
    {
      label: '沉睡知识',
      value: health ? `${health.zombie_items ?? 0}` : '--',
      sub: '从未调用且创建超30天',
      icon: Clock,
      color: 'text-text-muted',
      bg: 'bg-white/[0.05]',
    },
  ];

  const distribution = health?.evolution_distribution;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-xl font-semibold text-text-primary flex items-center gap-2">
          <Activity className="w-5 h-5 text-network-primary" />
          调用追踪
        </h1>
        <div className="flex items-center gap-2">
          {(['7d', '30d', 'all'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setTimeRange(r)}
              className={`px-3 py-1.5 rounded-[2px] text-xs border transition-all ${
                timeRange === r
                  ? 'bg-info/15 text-info border-info/30'
                  : 'bg-white/[0.03] text-text-secondary border-white/[0.06] hover:bg-white/[0.06]'
              }`}
            >
              {r === '7d' ? '近7天' : r === '30d' ? '近30天' : '全部'}
            </button>
          ))}
        </div>
      </div>

      <EvolutionChainBar />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card p-4"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-text-secondary">{card.label}</div>
                <div className="text-2xl font-semibold text-text-primary mt-1">
                  {isLoading ? <span className="inline-block w-8 h-6 bg-white/5 rounded animate-pulse" /> : card.value}
                </div>
                {card.sub && <div className="text-xs text-text-muted mt-1">{card.sub}</div>}
              </div>
              <div className={`p-2.5 rounded-[2px] ${card.bg}`}>
                <card.icon className={`w-5 h-5 ${card.color}`} />
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="glass-card p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium text-text-primary flex items-center gap-2">
                <Trophy className="w-4 h-4 text-warning" /> 调用排行榜
              </h2>
              <span className="text-xs text-text-muted">按调用次数排序</span>
            </div>
            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-12 bg-white/5 rounded-[2px] animate-pulse" />
                ))}
              </div>
            ) : (topUnits || []).length === 0 ? (
              <div className="text-center py-10 text-text-secondary text-sm">
                <Search className="w-8 h-8 mx-auto mb-2 text-text-muted/40" />
                暂无调用记录，去知识库触发验证或践行吧
              </div>
            ) : (
              <div className="space-y-2">
                {(topUnits || []).map((unit, index) => (
                  <div
                    key={unit.id}
                    onClick={() => navigate(`/knowledge/${unit.id}`, { state: { from: location.pathname } })}
                    className="flex items-center gap-3 p-3 rounded-[2px] bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.04] hover:border-info/20 cursor-pointer transition-all"
                  >
                    <div className={`w-6 h-6 flex items-center justify-center rounded-[2px] text-xs font-bold ${
                      index === 0 ? 'bg-warning/15 text-warning' :
                      index === 1 ? 'bg-gray-300/15 text-gray-300' :
                      index === 2 ? 'bg-warning/15 text-warning' :
                      'bg-white/[0.05] text-text-muted'
                    }`}>
                      {index + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-text-primary truncate">{unit.content_raw}</div>
                      <div className="flex items-center gap-2 text-xs text-text-muted mt-1 flex-wrap">
                        {unit.evolution_stage && (
                          <span className="flex items-center gap-1">
                            <Sprout className="w-3 h-3" />
                            {evolutionLabel[unit.evolution_stage] || unit.evolution_stage}
                          </span>
                        )}
                        {unit.content_type && (
                          <span className="flex items-center gap-1">
                            <Layers className="w-3 h-3" />{unit.content_type}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-semibold text-network-primary">{unit.invoke_count || 0}</div>
                      <div className="text-xs text-text-muted">次调用</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="glass-card p-4">
            <h2 className="text-sm font-medium text-text-primary flex items-center gap-2 mb-4">
              <BarChart3 className="w-4 h-4 text-info" /> 进化分布
            </h2>
            {isLoading || !distribution ? (
              <div className="h-32 bg-white/5 rounded-[2px] animate-pulse" />
            ) : (
              <div className="space-y-3">
                {Object.entries(distribution).map(([stage, count]) => {
                  const total = health?.total_items || 1;
                  const pct = Math.round((count / total) * 100);
                  const drillSide = brainSide === 'personal' ? 'personal' : brainSide === 'network' ? 'network' : 'all';
                  return (
                    <div
                      key={stage}
                      className={count > 0 ? 'cursor-pointer group' : 'opacity-50 cursor-default'}
                      onClick={() => { if (count > 0) navigate(`/knowledge/${drillSide}?evolution_stage=${stage}`); }}
                      title={count > 0 ? `查看「${evolutionLabel[stage] || stage}」知识列表` : '该阶段暂无条目'}
                    >
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-text-secondary group-hover:text-info transition-colors">{evolutionLabel[stage] || stage}</span>
                        <span className="text-text-primary">{count} ({pct}%)</span>
                      </div>
                      <div className="h-2 bg-white/[0.05] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-accent rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="glass-card p-4">
            <h2 className="text-sm font-medium text-text-primary flex items-center gap-2 mb-4">
              <Dumbbell className="w-4 h-4 text-success" /> 最近践行
            </h2>
            {(recentPracticed || []).length === 0 ? (
              <div className="text-center py-6 text-text-secondary text-xs">
                暂无践行记录
              </div>
            ) : (
              <div className="space-y-2">
                {(recentPracticed || []).slice(0, 5).map((unit) => (
                  <div
                    key={unit.id}
                    onClick={() => navigate(`/knowledge/${unit.id}`, { state: { from: location.pathname } })}
                    className="flex items-center justify-between p-2.5 rounded-[2px] bg-white/[0.02] hover:bg-white/[0.05] cursor-pointer transition-all"
                  >
                    <div className="text-xs text-text-primary truncate pr-2">{unit.content_raw}</div>
                    <div className="text-xs font-medium text-success shrink-0">深度 {unit.practice_depth}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default InvocationTrackPage;
