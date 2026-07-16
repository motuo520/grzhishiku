import { FC } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNavigation } from '@/store/navigation';
import { useEmbodied } from '@/hooks/useEmbodied';
import {
  Heart, ShieldAlert, TrendingUp, MapPin,
  ArrowRight, CheckCircle2
} from 'lucide-react';

const MODULES = [
  {
    id: 'depth-check',
    label: '内容深度检查',
    desc: '保存时 AI 自动评估：这条内容是否太肤浅？作为认知防御系统，拦截低质量输入。',
    icon: ShieldAlert,
    path: '/embodied-cognition/depth-check',
    color: 'text-info',
    bg: 'bg-info/10',
  },
  {
    id: 'true-evolution',
    label: '真进化 vs 伪成熟',
    desc: '真正的进化伴随摩擦与痛苦后的喜悦；舒服往往只是在吃老本。',
    icon: TrendingUp,
    path: '/embodied-cognition/true-evolution',
    color: 'text-warning',
    bg: 'bg-warning/10',
  },
  {
    id: 'mood-location',
    label: '情绪与环境',
    desc: '记忆不只是文字，还有当时的情绪、位置、身体状态。聚合胶囊中的具身信息。',
    icon: MapPin,
    path: '/embodied-cognition/mood-location',
    color: 'text-purple-400',
    bg: 'bg-purple-400/10',
  },
];

const EmbodiedOverviewPage: FC = () => {
  const navigate = useNavigate();
  const { brainSide } = useNavigation();
  const {
    depthLogs,
    evolutionReflections,
    moodLocationData,
    isLoadingDepthLogs,
    isLoadingEvolutionReflections,
    isLoadingMoodLocation,
  } = useEmbodied(brainSide);

  const sideLabel = brainSide === 'personal' ? '个人脑' : brainSide === 'network' ? '网络脑' : '双脑';
  const trueCount = evolutionReflections.filter((r) => r.is_true_evolution).length;
  const ratio = evolutionReflections.length > 0 ? trueCount / evolutionReflections.length : 0;

  const topMood = Object.entries(moodLocationData.stats.mood_distribution)
    .sort((a, b) => b[1] - a[1])[0];
  const topLocation = Object.entries(moodLocationData.stats.location_distribution)
    .sort((a, b) => b[1] - a[1])[0];

  return (
    <div className="p-6 max-w-7xl mx-auto h-full overflow-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-text-primary flex items-center gap-2">
          <Heart className="w-5 h-5 text-danger" />
          具身认知
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          身体、情绪与环境作为记忆载体。当前视角：{sideLabel}。
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="rounded-xl border border-white/[0.06] bg-bg-secondary p-4">
          <div className="flex items-center gap-2 mb-2">
            <ShieldAlert className="w-4 h-4 text-info" />
            <span className="text-sm text-text-secondary">深度检查拦截次数</span>
          </div>
          <p className="text-2xl font-bold text-text-primary">
            {isLoadingDepthLogs ? '—' : depthLogs.filter((l) => !l.is_passed).length}
          </p>
          <p className="text-xs text-text-muted">总检查 {depthLogs.length} 次</p>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-bg-secondary p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-warning" />
            <span className="text-sm text-text-secondary">真进化比例</span>
          </div>
          <p className={`text-2xl font-bold ${ratio >= 0.6 ? 'text-success' : ratio >= 0.3 ? 'text-warning' : 'text-danger'}`}>
            {isLoadingEvolutionReflections ? '—' : `${(ratio * 100).toFixed(0)}%`}
          </p>
          <p className="text-xs text-text-muted">共 {evolutionReflections.length} 条反思</p>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-bg-secondary p-4">
          <div className="flex items-center gap-2 mb-2">
            <MapPin className="w-4 h-4 text-purple-400" />
            <span className="text-sm text-text-secondary">具身记录</span>
          </div>
          <p className="text-2xl font-bold text-text-primary">
            {isLoadingMoodLocation ? '—' : moodLocationData.stats.total}
          </p>
          <p className="text-xs text-text-muted">
            {topMood ? `主要情绪：${topMood[0]}` : '暂无情绪数据'}
            {topLocation ? ` · 主要地点：${topLocation[0]}` : ''}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {MODULES.map((m) => {
          const Icon = m.icon;
          return (
            <button
              key={m.id}
              onClick={() => navigate(m.path)}
              className="text-left p-4 rounded-xl border border-white/[0.06] bg-bg-secondary hover:bg-white/[0.03] transition-all group"
            >
              <div className="flex items-start gap-4">
                <div className={`w-10 h-10 rounded-lg ${m.bg} flex items-center justify-center shrink-0`}>
                  <Icon className={`w-5 h-5 ${m.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium text-text-primary group-hover:text-info transition-colors">
                      {m.label}
                    </div>
                    <ArrowRight className="w-4 h-4 text-text-muted group-hover:text-info transition-colors" />
                  </div>
                  <div className="text-xs text-text-secondary mt-1">{m.desc}</div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-6 p-4 rounded-xl border border-white/[0.06] bg-bg-secondary">
        <h3 className="text-sm font-medium text-text-primary mb-2 flex items-center gap-2">
          <Heart className="w-4 h-4 text-danger" />
          模块关联
        </h3>
        <ul className="space-y-2 text-xs text-text-secondary">
          <li className="flex items-start gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-success mt-0.5 shrink-0" />
            <span><strong>内容深度检查</strong>可作用于笔记、知识单元；低质量内容会被标记，帮你建立输入防御。</span>
          </li>
          <li className="flex items-start gap-2">
            <TrendingUp className="w-3.5 h-3.5 text-warning mt-0.5 shrink-0" />
            <span><strong>真进化 vs 伪成熟</strong>可关联到笔记、知识单元或实验记录，让成长有迹可循。</span>
          </li>
          <li className="flex items-start gap-2">
            <MapPin className="w-3.5 h-3.5 text-purple-400 mt-0.5 shrink-0" />
            <span><strong>情绪与环境</strong>自动聚合时间胶囊中的 mood、location、能量等级，点击记录可进入胶囊详情。</span>
          </li>
        </ul>
      </div>
    </div>
  );
};

export default EmbodiedOverviewPage;
