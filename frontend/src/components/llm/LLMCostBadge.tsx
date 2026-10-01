// 开源本地版：无计费/余额概念（剥离面），成本徽标恒不渲染。
// 保留主仓同名组件的 props 形态，调用方零改动。
import type { FC } from 'react';

interface LLMCostBadgeProps {
  modelId?: string;
  inputText: string;
  outputTokenEstimate?: number;
  className?: string;
}

export const LLMCostBadge: FC<LLMCostBadgeProps> = () => null;

export default LLMCostBadge;
