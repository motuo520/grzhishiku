import { FC } from 'react';
import { AlertCircle } from 'lucide-react';

const extractMessage = (err: any): string => {
  const detail = err?.response?.data?.detail;
  if (typeof detail === 'string' && detail) return detail;
  return err?.message || '操作失败，请稍后重试';
};

interface Props {
  error: any;
  className?: string;
}

/** AI 功能（计费）调用失败的统一提示条：余额不足时附充值入口。 */
const AiErrorNotice: FC<Props> = ({ error, className = '' }) => {
  if (!error) return null;
  const msg = extractMessage(error);
  const insufficient = msg.includes('余额不足');
  return (
    <div className={`glass-card p-4 border-danger/20 bg-danger/5 flex items-start gap-2 ${className}`}>
      <AlertCircle className="w-4 h-4 text-danger flex-shrink-0 mt-0.5" />
      <p className="text-sm text-danger">
        {msg}
        {insufficient && (
          <>
            ，<a href="/topup" className="underline hover:opacity-80">去充值</a>
          </>
        )}
      </p>
    </div>
  );
};

export default AiErrorNotice;
