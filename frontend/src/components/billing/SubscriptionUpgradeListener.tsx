import { FC, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Crown, X, ArrowRight, Sparkles } from 'lucide-react';

interface UpgradeAlert {
  show: boolean;
  message: string;
  url: string;
}

export const SubscriptionUpgradeListener: FC = () => {
  const navigate = useNavigate();
  const [alert, setAlert] = useState<UpgradeAlert>({ show: false, message: '', url: '/payment' });

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      setAlert({
        show: true,
        message: detail.message || '当前订阅方案无权使用该功能',
        url: detail.url || '/payment',
      });
    };
    window.addEventListener('psb:subscription:upgrade-required', handler);
    return () => window.removeEventListener('psb:subscription:upgrade-required', handler);
  }, []);

  if (!alert.show) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[100] w-80 rounded-2xl border border-amber-500/30 bg-bg-secondary/95 backdrop-blur-md p-4 shadow-2xl">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 p-2 rounded-xl bg-amber-500/10 text-amber-400">
          <Crown className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            Pro 功能受限
          </h4>
          <p className="text-xs text-text-secondary mt-1 leading-relaxed">{alert.message}</p>
          <div className="mt-3 flex flex-col gap-2">
            <button
              onClick={() => {
                setAlert((a) => ({ ...a, show: false }));
                navigate(alert.url);
              }}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-medium hover:shadow-[0_0_15px_rgba(245,158,11,0.3)] transition-shadow"
            >
              升级到 Pro
              <ArrowRight className="w-3 h-3" />
            </button>
            <p className="text-[10px] text-text-muted text-center">
              升级后可解锁深度认知分析、未来模拟等高级 AI 功能
            </p>
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

export default SubscriptionUpgradeListener;
