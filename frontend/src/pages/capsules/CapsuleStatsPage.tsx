import { FC } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { BarChart2, Package, Lock, Unlock, Eye, Globe, User, Layers } from 'lucide-react';
import { useCapsules } from '@/hooks/useCapsules';

const CapsuleStatsPage: FC = () => {
  const navigate = useNavigate();
  const { stats, isLoading } = useCapsules();

  const cards = [
    { key: 'personal', label: '个人脑', icon: User, color: 'text-personal-primary', bg: 'bg-personal-primary/10', border: 'border-personal-primary/20' },
    { key: 'network', label: '网络脑', icon: Globe, color: 'text-network-primary', bg: 'bg-network-primary/10', border: 'border-network-primary/20' },
    { key: 'both', label: '双脑总计', icon: Layers, color: 'text-fusion-primary', bg: 'bg-fusion-primary/10', border: 'border-fusion-primary/20' },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">胶囊统计</h1>
          <p className="text-sm text-text-secondary mt-1">双脑胶囊数据洞察</p>
        </div>
      </div>

      {isLoading || !stats ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin w-8 h-8 border-2 border-info border-t-transparent rounded-full" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {cards.map((card, i) => {
              const Icon = card.icon;
              const data = (stats as any)[card.key];
              return (
                <motion.div
                  key={card.key}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                  onClick={() => navigate('/capsules/my')}
                  className={`card cursor-pointer hover:border-info/30 ${card.bg} border ${card.border}`}
                >
                  <div className="flex items-center gap-3 mb-4">
                    <Icon className={`w-6 h-6 ${card.color}`} />
                    <h3 className="text-lg font-semibold text-text-primary">{card.label}</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <StatItem icon={Package} label="总数" value={data.total} />
                    <StatItem icon={Lock} label="已封存" value={data.locked} />
                    <StatItem icon={Unlock} label="已解锁" value={data.unlocked + data.opened} />
                    <StatItem icon={Eye} label="解锁率" value={`${data.unlock_rate}%`} />
                  </div>
                </motion.div>
              );
            })}
          </div>

          <div className="card">
            <div className="flex items-center gap-2 mb-4">
              <BarChart2 className="w-5 h-5 text-info" />
              <h3 className="text-lg font-semibold text-text-primary">下钻说明</h3>
            </div>
            <ul className="space-y-2 text-sm text-text-secondary">
              <li>· 点击任意卡片跳转我的胶囊列表</li>
              <li>· 「网络脑」统计仅包含你自己创建的网络脑胶囊，广场胶囊需收藏后才会进入个人脑统计</li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
};

const StatItem: FC<{ icon: React.ElementType; label: string; value: string | number }> = ({
  icon: Icon, label, value,
}) => (
  <div className="flex items-center gap-2">
    <Icon className="w-4 h-4 text-text-muted" />
    <div>
      <div className="text-xl font-bold text-text-primary">{value}</div>
      <div className="text-[10px] text-text-muted">{label}</div>
    </div>
  </div>
);

export default CapsuleStatsPage;
