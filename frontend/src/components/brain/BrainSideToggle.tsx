import { FC } from 'react';
import { motion } from 'framer-motion';
import { Brain, Globe, Layers } from 'lucide-react';
import type { BrainSide } from '@/types';

interface Props {
  value: BrainSide;
  onChange: (side: BrainSide) => void;
  allowBoth?: boolean;
  size?: 'sm' | 'md';
}

const OPTIONS: { value: BrainSide; label: string; icon: typeof Brain; desc: string; color: string }[] = [
  { value: 'personal', label: '个人脑', icon: Brain, desc: '笔记与自我反思', color: 'text-fusion-primary' },
  { value: 'network', label: '网络脑', icon: Globe, desc: '外部采集与知识', color: 'text-info' },
  { value: 'both', label: '双脑融合', icon: Layers, desc: '全景认知镜像', color: 'text-warning' },
];

export const BrainSideToggle: FC<Props> = ({ value, onChange, allowBoth = true, size = 'md' }) => {
  const items = allowBoth ? OPTIONS : OPTIONS.filter((o) => o.value !== 'both');
  const height = size === 'sm' ? 'h-8 text-xs' : 'h-10 text-sm';

  return (
    <div className={`inline-flex items-center gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/[0.08] ${height}`}>
      {items.map((opt) => {
        const active = value === opt.value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`relative flex items-center gap-1.5 px-3 rounded-lg transition-colors ${
              active ? 'text-white' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {active && (
              <motion.div
                layoutId="brain-side-active"
                className="absolute inset-0 rounded-lg bg-white/[0.1] border border-white/[0.12]"
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-1.5">
              <Icon className={`w-3.5 h-3.5 ${active ? opt.color : ''}`} />
              <span className="font-medium">{opt.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
};

export default BrainSideToggle;
