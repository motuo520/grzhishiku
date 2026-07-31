/** 模型价格档位：用户端只展示档位，不展示 per-1K 单价（避免与上游公开价直接对比） */

export interface TierInfo {
  label: string;
  className: string;
}

interface PriceLike {
  price_input_per_1k?: number;
  price_output_per_1k?: number;
}

export function llmPriceTier(model: PriceLike): TierInfo {
  const total = (model.price_input_per_1k || 0) + (model.price_output_per_1k || 0);
  if (total <= 0) return { label: '免费', className: 'bg-success/10 text-success border-success/25' };
  if (total <= 0.02) return { label: '经济', className: 'bg-info/10 text-info border-info/25' };
  if (total <= 0.1) return { label: '标准', className: 'bg-warning/10 text-warning border-warning/25' };
  if (total <= 0.4) return { label: '高级', className: 'bg-accent/10 text-accent border-accent/25' };
  return { label: '旗舰', className: 'bg-danger/10 text-danger border-danger/25' };
}
