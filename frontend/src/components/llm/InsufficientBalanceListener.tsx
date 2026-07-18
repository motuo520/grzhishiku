import { FC, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wallet, X, Cpu, ArrowRight } from 'lucide-react';

interface BalanceAlert {
  show: boolean;
  message: string;
  url: string;
}

export const InsufficientBalanceListener: FC = () => {
  const navigate = useNavigate();
  const [alert, setAlert] = useState<BalanceAlert>({ show: false, message: '', url: '/topup' });

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      setAlert({
        show: true,
        message: detail.message || '余额不足，无法完成 AI 调用',
        url: detail.url || '/topup',
      });
    };
    window.addEventListener('psb:llm:insufficient-balance', handler);
    return () => window.removeEventListener('psb:llm:insufficient-balance', handler);
  }, []);

  if (!alert.show) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[100] w-80 rounded-[2px] border border-danger/30 bg-bg-secondary/95 p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 p-2 rounded-[2px] bg-danger/10 text-danger">
          <Wallet className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-text-primary">余额不足</h4>
          <p className="text-xs text-text-secondary mt-1 leading-relaxed">{alert.message}</p>
          <div className="mt-3 flex flex-col gap-2">
            <button
              onClick={() => {
                setAlert((a) => ({ ...a, show: false }));
                navigate(alert.url);
              }}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-[2px] bg-danger/15 text-danger border border-danger/30 text-xs font-medium hover:bg-danger/25 transition-colors"
            >
              前往充值
              <ArrowRight className="w-3 h-3" />
            </button>
            <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
              <Cpu className="w-3 h-3 text-success" />
              <span>或在任意 AI 入口切换为「本地模型」免费使用</span>
            </div>
          </div>
        </div>
        <button
          onClick={() => setAlert((a) => ({ ...a, show: false }))}
          className="p-1 rounded-md hover:bg-white/[0.06] text-text-muted"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

export default InsufficientBalanceListener;
