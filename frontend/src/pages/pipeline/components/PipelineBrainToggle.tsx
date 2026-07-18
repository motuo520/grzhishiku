import { FC } from 'react';
import { useLocation } from 'react-router-dom';
import { Brain, Home, Globe, Info } from 'lucide-react';
import { useNavigation } from '@/store/navigation';
import type { BrainSide } from '@/types';

interface PipelineBrainToggleProps {
  value?: BrainSide;
  onChange?: (side: BrainSide) => void;
  stageAware?: boolean;
}

const options: { id: BrainSide; label: string; icon: React.ElementType; color: string }[] = [
  { id: 'personal', label: '个人脑', icon: Home, color: 'text-personal-primary' },
  { id: 'both', label: '双脑', icon: Brain, color: 'text-fusion-primary' },
  { id: 'network', label: '网络脑', icon: Globe, color: 'text-network-primary' },
];

const STAGE_HINTS: Record<string, { recommended: BrainSide; discouraged?: BrainSide; message: string }> = {
  raw: { recommended: 'network', discouraged: 'personal', message: '原始素材主要来自外部采集，推荐只看网络脑' },
  cards: { recommended: 'both', message: '个人笔记和网络素材都需要被切割为卡片' },
  extract: { recommended: 'both', message: '双脑卡片都可以提取核心概念' },
  collision: { recommended: 'both', message: '跨界碰撞需要同时调动双脑素材' },
  annotate: { recommended: 'personal', discouraged: 'network', message: '注卡是注入个人语境，推荐只看个人脑' },
};

const PipelineBrainToggle: FC<PipelineBrainToggleProps> = ({ value, onChange, stageAware = false }) => {
  const { brainSide, setBrainSide } = useNavigation();
  const location = useLocation();
  const active = value || brainSide;

  // Infer stage from location path when stageAware is enabled
  let stage: string | null = null;
  if (stageAware) {
    const match = location.pathname.match(/^\/pipeline\/([^/]+)/);
    stage = match ? match[1] : 'overview';
  }
  const hint = stage ? STAGE_HINTS[stage] : null;

  const handleChange = (side: BrainSide) => {
    if (onChange) {
      onChange(side);
    } else {
      setBrainSide(side);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="inline-flex items-center gap-1 p-1 rounded-[2px] bg-white/[0.03] border border-white/[0.08]">
        {options.map((opt) => {
          const Icon = opt.icon;
          const isActive = active === opt.id;
          const isDiscouraged = stageAware && hint?.discouraged === opt.id && !isActive;
          return (
            <button
              key={opt.id}
              onClick={() => handleChange(opt.id)}
              title={isDiscouraged ? '当前阶段不推荐此脑侧' : opt.label}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[2px] text-xs font-medium transition-all ${
                isActive
                  ? `${opt.color} bg-white/[0.08]`
                  : isDiscouraged
                  ? 'text-text-muted hover:text-text-secondary hover:bg-white/[0.03] opacity-50'
                  : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.05]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {opt.label}
            </button>
          );
        })}
      </div>
      {stageAware && hint && (
        <div className="flex items-center gap-1 text-[10px] text-text-muted max-w-[280px] text-right">
          <Info className="w-3 h-3 shrink-0" />
          <span>{hint.message}</span>
        </div>
      )}
    </div>
  );
};

export default PipelineBrainToggle;
