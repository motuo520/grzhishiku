import { FC } from 'react';
import ModelSelector from '@/components/llm/ModelSelector';
import LLMCostBadge from '@/components/llm/LLMCostBadge';
import type { BrainSide } from '@/api/emergence';

interface ToolOptionsProps {
  brainSide: BrainSide;
  onBrainSideChange: (side: BrainSide) => void;
  preferredModel: string;
  onPreferredModelChange: (value: string) => void;
  inputText?: string;
  taskType?: 'creative' | 'analysis' | 'reasoning' | 'default';
}

const BRAIN_SIDES: { key: BrainSide; label: string }[] = [
  { key: 'personal', label: '个人脑' },
  { key: 'network', label: '网络脑' },
  { key: 'both', label: '双脑' },
];

const BRAIN_SIDE_CLASS: Record<BrainSide, string> = {
  personal: 'bg-personal-primary/10 text-personal-primary border-personal-primary/20',
  network: 'bg-network-primary/10 text-network-primary border-network-primary/20',
  both: 'bg-fusion-primary/10 text-fusion-primary border-fusion-primary/20',
};

export const BrainSideSelector: FC<{ value: BrainSide; onChange: (side: BrainSide) => void }> = ({
  value,
  onChange,
}) => {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-text-muted">脑侧</span>
      {BRAIN_SIDES.map((side) => (
        <button
          key={side.key}
          type="button"
          onClick={() => onChange(side.key)}
          className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
            value === side.key
              ? BRAIN_SIDE_CLASS[side.key]
              : 'bg-white/[0.03] text-text-secondary border-white/[0.08] hover:border-white/[0.15]'
          }`}
        >
          {side.label}
        </button>
      ))}
    </div>
  );
};

export const ToolOptionsBar: FC<ToolOptionsProps> = ({
  brainSide,
  onBrainSideChange,
  preferredModel,
  onPreferredModelChange,
  inputText = '',
  taskType = 'creative',
}) => {
  return (
    <div className="flex flex-col md:flex-row md:items-start gap-3 mb-4">
      <BrainSideSelector value={brainSide} onChange={onBrainSideChange} />
      <div className="flex-1 min-w-[220px] space-y-1.5">
        <ModelSelector
          value={preferredModel}
          onChange={onPreferredModelChange}
          taskType={taskType}
          showPrice
        />
        <LLMCostBadge modelId={preferredModel} inputText={inputText} outputTokenEstimate={250} />
      </div>
    </div>
  );
};
