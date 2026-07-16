import { FC } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export const ErrorState: FC<ErrorStateProps> = ({
  title = '加载失败',
  message = '数据加载出错，请稍后重试',
  onRetry,
}) => (
  <div className="glass-card flex flex-col items-center justify-center py-16 px-6 text-center">
    <AlertCircle className="w-12 h-12 text-danger/70 mb-3" />
    <h3 className="text-text-secondary text-sm font-medium">{title}</h3>
    {message && <p className="text-text-muted text-xs mt-1 max-w-sm">{message}</p>}
    {onRetry && (
      <button
        onClick={onRetry}
        className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.05] text-text-secondary hover:text-info hover:bg-white/[0.08] transition-colors text-xs border border-white/[0.08]"
      >
        <RefreshCw className="w-3.5 h-3.5" /> 重试
      </button>
    )}
  </div>
);

export default ErrorState;
