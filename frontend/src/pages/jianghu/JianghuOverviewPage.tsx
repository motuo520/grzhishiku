import { FC } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, HeartPulse, Dumbbell, TrendingUp, Filter, Activity, BrainCircuit, Zap, FlaskConical } from 'lucide-react';

const MODULES = [
  { id: 'ai-context', label: 'AI全知上下文', desc: '让AI基于引导文件理解你的知识库', icon: BrainCircuit, path: '/social-brain/ai-context', color: 'text-info', bg: 'bg-info/10' },
  { id: 'cognitive-potential', label: '认知势能', desc: '能下沉、能产出、能变现的认知资产', icon: Zap, path: '/social-brain/cognitive-potential', color: 'text-warning', bg: 'bg-warning/10' },
  { id: 'experimenter', label: '实验者心态', desc: '每次只控制一个变量，用反馈迭代', icon: FlaskConical, path: '/social-brain/experimenter', color: 'text-success', bg: 'bg-success/10' },
  { id: 'daily-review', label: '每日复盘', desc: '回顾今日输入，发现行为差距', icon: Calendar, path: '/social-brain/daily-review', color: 'text-warning', bg: 'bg-warning/10' },
  { id: 'knowledge-health', label: '知识健康', desc: '查看知识体系进化分布', icon: HeartPulse, path: '/social-brain/knowledge-health', color: 'text-success', bg: 'bg-success/10' },
  { id: 'practice-records', label: '践行记录', desc: '记录知识落地与验证', icon: Dumbbell, path: '/social-brain/practice-records', color: 'text-network-primary', bg: 'bg-network-primary/10' },
  { id: 'evolution-track', label: '进化轨迹', desc: '追踪知识从收集到内化', icon: TrendingUp, path: '/social-brain/evolution-track', color: 'text-fusion-primary', bg: 'bg-fusion-primary/10' },
  { id: 'relevance-check', label: '关我屁事', desc: '判断外部内容与你是否相关', icon: Filter, path: '/social-brain/relevance-check', color: 'text-danger', bg: 'bg-danger/10' },
  { id: 'invocation-track', label: '调用追踪', desc: '统计知识被调用与践行次数', icon: Activity, path: '/social-brain/invocation-track', color: 'text-network-primary', bg: 'bg-network-primary/10' },
];

const JianghuOverviewPage: FC = () => {
  const navigate = useNavigate();

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-text-primary">社会大脑</h1>
        <p className="text-sm text-text-secondary mt-1">
          个体认知与群体智慧的连接：我的认知如何受益于、又能贡献于更大的知识网络？
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {MODULES.map((m) => {
          const Icon = m.icon;
          return (
            <button
              key={m.id}
              onClick={() => navigate(m.path)}
              className="text-left p-4 rounded-[2px] border border-white/[0.06] bg-bg-secondary hover:bg-white/[0.03] transition-all group"
            >
              <div className={`w-10 h-10 rounded-[2px] ${m.bg} flex items-center justify-center mb-3`}>
                <Icon className={`w-5 h-5 ${m.color}`} />
              </div>
              <div className="text-sm font-medium text-text-primary group-hover:text-info transition-colors">{m.label}</div>
              <div className="text-xs text-text-secondary mt-1">{m.desc}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default JianghuOverviewPage;
