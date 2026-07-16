import { FC } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Database, SquareStack, Filter, Shuffle, Pencil, CheckCircle2, ArrowRight } from 'lucide-react';

interface Stage {
  id: string;
  label: string;
  path: string;
  icon: React.ElementType;
  from: string;
  to: string;
}

const STAGES: Stage[] = [
  { id: 'raw', label: '原始素材', path: '/pipeline/raw', icon: Database, from: '采集', to: '卡片化' },
  { id: 'card', label: '卡片化', path: '/pipeline/cards', icon: SquareStack, from: '原始素材', to: '抽取' },
  { id: 'extract', label: '抽取', path: '/pipeline/extract', icon: Filter, from: '卡片', to: '碰撞' },
  { id: 'collision', label: '碰撞', path: '/pipeline/collision', icon: Shuffle, from: '概念', to: '注卡' },
  { id: 'annotate', label: '注卡', path: '/pipeline/annotate', icon: Pencil, from: '碰撞洞见', to: '个人脑知识' },
];

interface PipelineStageBarProps {
  counts?: Record<string, number>;
  showFlowHints?: boolean;
}

const PipelineStageBar: FC<PipelineStageBarProps> = ({ counts, showFlowHints = true }) => {
  const navigate = useNavigate();
  const location = useLocation();

  const isOverview = location.pathname === '/pipeline';
  const currentStageIndex = STAGES.findIndex((s) => location.pathname === s.path);
  const currentStage = currentStageIndex >= 0 ? STAGES[currentStageIndex] : null;

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          onClick={() => navigate('/pipeline')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
            isOverview
              ? 'bg-info/15 text-info border border-info/30'
              : 'bg-white/[0.03] text-text-secondary border border-white/[0.08] hover:bg-white/[0.06]'
          }`}
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          管线总览
        </button>
        <div className="hidden md:block w-px h-6 bg-white/[0.08] mx-1" />
        {STAGES.map((stage, index) => {
          const Icon = stage.icon;
          const isActive = location.pathname === stage.path;
          const count = counts?.[stage.id] ?? 0;
          const isLast = index === STAGES.length - 1;
          return (
            <div key={stage.id} className="flex items-center gap-1.5">
              <button
                onClick={() => navigate(stage.path)}
                title={`${stage.label}：从${stage.from}来，到${stage.to}去`}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all border ${
                  isActive
                    ? 'bg-info/15 text-info border-info/30'
                    : count > 0
                    ? 'bg-white/[0.05] text-text-primary border-white/[0.12] hover:bg-white/[0.08]'
                    : 'bg-white/[0.03] text-text-secondary border-white/[0.08] hover:bg-white/[0.06] hover:text-text-primary'
                }`}
              >
                <span className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] ${isActive ? 'bg-info/20' : 'bg-white/[0.06]'}`}>
                  {index + 1}
                </span>
                <Icon className="w-3.5 h-3.5" />
                {stage.label}
                {count > 0 && (
                  <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-white/[0.08] text-[10px]">
                    {count}
                  </span>
                )}
              </button>
              {!isLast && (
                <ArrowRight className="w-3 h-3 text-text-muted/50" />
              )}
            </div>
          );
        })}
      </div>
      {showFlowHints && currentStage && (
        <div className="text-[10px] text-text-muted">
          当前阶段：从 <span className="text-text-secondary">{currentStage.from}</span> 来 → 到 <span className="text-text-secondary">{currentStage.to}</span> 去
        </div>
      )}
    </div>
  );
};

export default PipelineStageBar;
