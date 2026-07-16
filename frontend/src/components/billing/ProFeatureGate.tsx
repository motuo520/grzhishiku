import { FC } from 'react';
import { useNavigate } from 'react-router-dom';
import { Crown, Lock, Zap } from 'lucide-react';
import { useRequireSubscription } from '@/hooks/useSubscription';

interface StorageFeatureGateProps {
  children: React.ReactNode;
  minTier?: 'free' | 'storage';
  title?: string;
  description?: string;
}

const StorageFeatureGate: FC<StorageFeatureGateProps> = ({
  children,
  minTier = 'storage',
  title = '存储会员功能',
  description = '此功能需要订阅存储会员（9.9 元/月）后方可使用。模型调用按量计费，无需订阅。',
}) => {
  const { hasAccess, tier, isLoading } = useRequireSubscription(minTier);
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-info border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-bg-secondary border border-white/[0.06] rounded-2xl p-8 text-center">
          <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <Crown className="w-8 h-8 text-amber-400" />
          </div>
          <div className="flex items-center justify-center gap-2 mb-3">
            <Lock className="w-4 h-4 text-amber-400" />
            <h2 className="text-xl font-bold text-text-primary">{title}</h2>
          </div>
          <p className="text-sm text-text-secondary mb-2">{description}</p>
          <p className="text-xs text-text-muted mb-8">
            当前方案：<span className="text-text-secondary capitalize">{tier}</span>
          </p>
          <button
            onClick={() => navigate('/payment')}
            className="w-full px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white text-sm font-bold hover:shadow-[0_0_20px_rgba(245,158,11,0.3)] transition-shadow flex items-center justify-center gap-2"
          >
            <Zap className="w-4 h-4" />
            订阅存储会员
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default StorageFeatureGate;
