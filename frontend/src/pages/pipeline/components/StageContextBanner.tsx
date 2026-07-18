import { FC } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ArrowLeft, Loader2, Database, SquareStack, Filter, Shuffle, Pencil } from 'lucide-react';

interface StageInfo {
  id: string;
  label: string;
  path: string;
  icon: React.ElementType;
}

const STAGES: StageInfo[] = [
  { id: 'raw', label: '原始素材', path: '/pipeline/raw', icon: Database },
  { id: 'card', label: '卡片化', path: '/pipeline/cards', icon: SquareStack },
  { id: 'extract', label: '抽取', path: '/pipeline/extract', icon: Filter },
  { id: 'collision', label: '碰撞', path: '/pipeline/collision', icon: Shuffle },
  { id: 'annotate', label: '注卡', path: '/pipeline/annotate', icon: Pencil },
];

interface StageContextBannerProps {
  currentStage: string;
  stageCounts?: Record<string, number>;
  onPullFromPrevious?: () => void;
  isPulling?: boolean;
  pullLabel?: string;
  className?: string;
}

const StageContextBanner: FC<StageContextBannerProps> = ({
  currentStage,
  stageCounts,
  onPullFromPrevious,
  isPulling = false,
  pullLabel,
  className = '',
}) => {
  const navigate = useNavigate();
  const currentIndex = STAGES.findIndex((s) => s.id === currentStage);
  const previousStage = currentIndex > 0 ? STAGES[currentIndex - 1] : null;
  const nextStage = currentIndex >= 0 && currentIndex < STAGES.length - 1 ? STAGES[currentIndex + 1] : null;
  const currentInfo = currentIndex >= 0 ? STAGES[currentIndex] : null;

  const previousCount = previousStage ? stageCounts?.[previousStage.id] ?? 0 : 0;
  const currentCount = currentInfo ? stageCounts?.[currentInfo.id] ?? 0 : 0;

  return (
    <div className={`glass-card p-4 flex flex-col md:flex-row md:items-center gap-3 ${className}`}>
      {/* Previous stage inlet */}
      {previousStage ? (
        <div className="flex-1 flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate(previousStage.path)}
            className="flex items-center gap-2 px-3 py-2 rounded-[2px] bg-white/[0.03] border border-white/[0.08] hover:bg-white/[0.06] hover:text-text-primary text-text-secondary text-xs transition-colors shrink-0"
          >
            <previousStage.icon className="w-3.5 h-3.5" />
            {previousStage.label}
            <ArrowLeft className="w-3 h-3" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-text-secondary">
              上一阶段还剩 <span className="text-info font-medium">{previousCount}</span> 件待处理
            </div>
            {previousCount === 0 && (
              <div className="text-[10px] text-text-muted">上一阶段暂无内容，先去补充原料</div>
            )}
          </div>
          {onPullFromPrevious && previousCount > 0 && (
            <button
              onClick={onPullFromPrevious}
              disabled={isPulling}
              className="flex items-center gap-1.5 px-3 py-2 rounded-[2px] bg-info/10 border border-info/30 text-info text-xs hover:bg-info/20 transition-colors disabled:opacity-50 shrink-0"
            >
              {isPulling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRight className="w-3.5 h-3.5" />}
              {pullLabel || `从${previousStage.label}拉取`}
            </button>
          )}
        </div>
      ) : (
        <div className="flex-1 text-xs text-text-secondary">
          这是管线起点，内容来自 <span className="text-info cursor-pointer hover:underline" onClick={() => navigate('/ingest')}>采集模块</span>
        </div>
      )}

      {/* Current stage indicator */}
      {currentInfo && (
        <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-[2px] bg-info/10 border border-info/20 text-info text-xs shrink-0">
          <currentInfo.icon className="w-3.5 h-3.5" />
          当前：{currentInfo.label}（{currentCount}）
        </div>
      )}

      {/* Next stage outlet */}
      {nextStage ? (
        <div className="flex items-center gap-3 md:justify-end min-w-0">
          <div className="text-xs text-text-secondary text-right">
            下一阶段：<span className="text-text-primary">{nextStage.label}</span>
          </div>
          <button
            onClick={() => navigate(nextStage.path)}
            className="flex items-center gap-2 px-3 py-2 rounded-[2px] bg-white/[0.03] border border-white/[0.08] hover:bg-white/[0.06] hover:text-text-primary text-text-secondary text-xs transition-colors shrink-0"
          >
            {nextStage.label}
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <div className="text-xs text-text-secondary md:text-right">
          注卡完成后进入 <span className="text-personal-primary">个人脑知识库</span>
        </div>
      )}
    </div>
  );
};

export default StageContextBanner;
