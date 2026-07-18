import { FC } from 'react';
import { useKnowledgeHealth } from '@/hooks/useJianghu';
import { useNavigation } from '@/store/navigation';
import { HeartPulse, Loader2, TrendingUp, Zap, Skull, Activity, BarChart3, HelpCircle } from 'lucide-react';
import type { KnowledgeHealthResponse } from '@/api/jianghu';

const KnowledgeHealthPage: FC = () => {
  const { brainSide } = useNavigation();
  const { data: health, isLoading, isError, error } = useKnowledgeHealth(brainSide);

  const stages = health ? [
    { label: '已收集', count: health.evolution_distribution.collected, color: 'bg-text-muted' },
    { label: '已理解', count: health.evolution_distribution.understood, color: 'bg-info' },
    { label: '已践行', count: health.evolution_distribution.practiced, color: 'bg-success' },
    { label: '已验证', count: health.evolution_distribution.validated, color: 'bg-warning' },
    { label: '已内化', count: health.evolution_distribution.internalized, color: 'bg-fusion-primary' },
  ] : [];

  const maxStageCount = stages.length > 0 ? Math.max(...stages.map((s) => s.count), 1) : 1;

  const suggestions = health ? buildSuggestions(health) : [];

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <HeartPulse className="w-5 h-5 text-success" />
        <h1 className="text-xl font-semibold text-text-primary">知识健康</h1>
      </div>

      {isLoading && (
        <div className="text-sm text-text-secondary flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          加载中...
        </div>
      )}

      {isError && (
        <div className="p-3 rounded-[2px] bg-danger/10 border border-danger/30 text-sm text-danger">
          {(error as any)?.message || '操作失败，请重试'}
        </div>
      )}

      {health && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard icon={BarChart3} label="总条目" value={health.total_items} color="text-info" bg="bg-info/10" />
            <StatCard icon={TrendingUp} label="平均践行深度" value={health.avg_practice_depth} color="text-success" bg="bg-success/10" />
            <StatCard icon={Activity} label="平均调用次数" value={health.avg_invoke_count} color="text-warning" bg="bg-warning/10" />
            <StatCard icon={Zap} label="高价值条目" value={health.high_value_items} color="text-fusion-primary" bg="bg-fusion-primary/10" />
            <StatCard icon={Skull} label="僵尸条目" value={health.zombie_items} color="text-danger" bg="bg-danger/10" />
            <StatCard icon={Activity} label="日活跃率" value={`${(health.daily_active_rate * 100).toFixed(0)}%`} color="text-network-primary" bg="bg-network-primary/10" />
            <StatCard icon={Zap} label="价值总分" value={health.value_score_total} color="text-warning" bg="bg-warning/10" />
            <StatCard icon={HeartPulse} label="健康度" value={health.health_score} color="text-success" bg="bg-success/10" suffix="%" tooltip="健康度 = 活跃占比×50 + 践行占比×30 + 高价值占比×20（满分100）。活跃=非僵尸条目比例，践行=有实操记录条目比例" />
          </div>

          <div className="rounded-[2px] border border-white/[0.06] bg-bg-secondary p-5 mb-6">
            <h2 className="text-sm font-semibold text-text-primary mb-4 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-info" />
              进化分布
            </h2>
            <div className="space-y-3">
              {stages.map((stage) => (
                <div key={stage.label} className="flex items-center gap-3">
                  <div className="w-16 text-xs text-text-secondary text-right shrink-0">{stage.label}</div>
                  <div className="flex-1 h-2 rounded-full bg-bg-primary overflow-hidden">
                    <div
                      className={`h-full rounded-full ${stage.color} transition-all duration-500`}
                      style={{ width: `${(stage.count / maxStageCount) * 100}%` }}
                    />
                  </div>
                  <div className="w-10 text-xs text-text-primary text-right shrink-0">{stage.count}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <InsightCard
              title="行动建议"
              items={suggestions}
            />
            <InsightCard
              title="健康解读"
              items={[
                `总条目 ${health.total_items}，平均践行深度 ${health.avg_practice_depth}`,
                `平均调用 ${health.avg_invoke_count} 次，价值总分 ${health.value_score_total}`,
                health.evolution_distribution.internalized > 0
                  ? `已有 ${health.evolution_distribution.internalized} 条知识进入内化阶段`
                  : '尚未有内化知识，持续践行会加速进化',
              ]}
            />
          </div>
        </>
      )}
    </div>
  );
};

const buildSuggestions = (health: KnowledgeHealthResponse): string[] => {
  const items: string[] = [];
  if (health.zombie_items > 0) {
    items.push(`有 ${health.zombie_items} 条僵尸知识长期没被调用，建议清理或重新激活`);
  }
  if (health.avg_practice_depth < 1) {
    items.push('多数知识还没践行过，挑一条记一次实操，让它真正活起来');
  }
  if (health.high_value_items === 0) {
    items.push('还没有高价值知识，践行后记得复盘、提炼高价值内容');
  } else if (health.high_value_items <= 3) {
    items.push(`只有 ${health.high_value_items} 条高价值知识，建议多提炼高价值内容`);
  }
  return items.length > 0 ? items : ['状态良好，继续保持'];
};

const StatCard: FC<{ icon: React.ElementType; label: string; value: string | number; color: string; bg: string; suffix?: string; tooltip?: string }> = ({
  icon: Icon, label, value, color, bg, suffix, tooltip,
}) => (
  <div className="p-4 rounded-[2px] border border-white/[0.06] bg-bg-secondary">
    <div className="flex items-center gap-2 mb-2">
      <div className={`w-7 h-7 rounded-[2px] ${bg} flex items-center justify-center`}>
        <Icon className={`w-3.5 h-3.5 ${color}`} />
      </div>
      <div className="text-xs text-text-secondary flex items-center gap-1">
        {label}
        {tooltip && (
          <span title={tooltip} className="inline-flex cursor-help">
            <HelpCircle className="w-3 h-3 text-text-muted" />
          </span>
        )}
      </div>
    </div>
    <div className="text-2xl font-semibold text-text-primary">
      {value}
      {suffix && <span className="text-sm text-text-secondary ml-0.5">{suffix}</span>}
    </div>
  </div>
);

const InsightCard: FC<{ title: string; items: string[] }> = ({ title, items }) => (
  <div className="rounded-[2px] border border-white/[0.06] bg-bg-secondary p-4">
    <h3 className="text-sm font-semibold text-text-primary mb-3">{title}</h3>
    <ul className="space-y-2">
      {items.map((item, idx) => (
        <li key={idx} className="text-sm text-text-secondary flex items-start gap-2">
          <span className="text-info mt-1.5">•</span>
          {item}
        </li>
      ))}
    </ul>
  </div>
);

export default KnowledgeHealthPage;
