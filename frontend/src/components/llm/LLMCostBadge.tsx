import { FC } from 'react';
import { Wallet, AlertCircle } from 'lucide-react';
import { useLLMPriceEstimate, formatCost } from '@/hooks/useLLMPriceEstimate';
import { useLLMBalance } from '@/hooks/useLLMBalance';

interface LLMCostBadgeProps {
  modelId?: string;
  inputText: string;
  outputTokenEstimate?: number;
  showBalance?: boolean;
  className?: string;
}

export const LLMCostBadge: FC<LLMCostBadgeProps> = ({
  modelId,
  inputText,
  outputTokenEstimate = 150,
  showBalance = true,
  className = '',
}) => {
  const estimate = useLLMPriceEstimate(modelId, inputText, outputTokenEstimate);
  const { balance } = useLLMBalance(60000);

  const balanceAmount = balance?.balance ?? 0;
  const insufficient = estimate.totalCost > 0 && balanceAmount < estimate.totalCost;
  const symbol = estimate.currency === 'USD' ? '$' : '¥';

  return (
    <div className={`flex flex-wrap items-center gap-3 text-xs ${className}`}>
      {modelId && (
        <div className="flex items-center gap-1.5 text-text-muted">
          <span>预计消耗</span>
          <span className={`font-medium ${insufficient ? 'text-danger' : 'text-info'}`}>
            {formatCost(estimate.totalCost, estimate.currency)}
          </span>
          {estimate.model && (
            <span className="text-text-muted/60">
              ({estimate.inputTokens} tokens)
            </span>
          )}
        </div>
      )}

      {showBalance && (
        <div className="flex items-center gap-1.5 text-text-muted">
          <Wallet className="w-3 h-3" />
          <span>余额</span>
          <span className={`font-medium ${insufficient ? 'text-danger' : 'text-emerald-400'}`}>
            {formatCost(balanceAmount, estimate.currency)}
          </span>
        </div>
      )}

      {insufficient && (
        <div className="flex items-center gap-1 text-danger">
          <AlertCircle className="w-3 h-3" />
          <span>余额不足</span>
        </div>
      )}
    </div>
  );
};

export default LLMCostBadge;
