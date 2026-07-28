import { FC, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Calendar, Clock, Lock, Unlock, User, Globe, Layers } from 'lucide-react';
import { useCapsuleSchedule } from '@/hooks/useCapsules';

const BRAIN_TABS = [
  { key: 'both', label: '全部', icon: Layers },
  { key: 'personal', label: '个人脑', icon: User },
  { key: 'network', label: '网络脑', icon: Globe },
];

const CapsuleSchedulePage: FC = () => {
  const navigate = useNavigate();
  const [brainSide, setBrainSide] = useState<'both' | 'personal' | 'network'>('both');
  const { capsules, isLoading } = useCapsuleSchedule(brainSide);

  const parseUnlockDate = (config: string | null) => {
    if (!config) return null;
    try {
      const cfg = JSON.parse(config);
      return cfg.unlock_date ? new Date(cfg.unlock_date) : null;
    } catch { return null; }
  };

  const items = (capsules || [])
    .filter((c) => c.unlock_status === 'locked')
    .map((c) => ({
      ...c,
      unlockDate: parseUnlockDate(c.unlock_config),
    })).sort((a, b) => {
      const da = a.unlockDate?.getTime() || new Date(a.created_at).getTime();
      const db = b.unlockDate?.getTime() || new Date(b.created_at).getTime();
      return da - db;
    });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">解锁日程</h1>
          <p className="text-sm text-text-secondary mt-1">按时间线查看待解锁胶囊</p>
        </div>
        <div className="flex items-center gap-2 p-1 rounded-xl bg-white/[0.03] border border-white/[0.08]">
          {BRAIN_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = brainSide === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setBrainSide(tab.key as typeof brainSide)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  active ? 'bg-info/15 text-info' : 'text-text-muted hover:text-text-primary'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin w-8 h-8 border-2 border-info border-t-transparent rounded-full" />
        </div>
      ) : items.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-16 text-text-secondary">
          <Calendar className="w-16 h-16 text-text-muted mb-4" />
          <p>暂无待解锁胶囊</p>
        </div>
      ) : (
        <div className="relative pl-6">
          <div className="absolute left-2 top-0 bottom-0 w-0.5 bg-white/[0.08]" />
          <div className="space-y-4">
            {items.map((capsule, index) => (
              <motion.div
                key={capsule.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                onClick={() => navigate(`/capsules/${capsule.id}`)}
                className="card relative cursor-pointer hover:border-info/30"
              >
                <div className="absolute -left-[26px] top-4 w-3 h-3 rounded-full border-2 border-bg-secondary bg-info" />
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-medium border ${
                        capsule.brain_side === 'network'
                          ? 'border-network-primary/30 text-network-primary bg-network-primary/10'
                          : 'border-personal-primary/30 text-personal-primary bg-personal-primary/10'
                      }`}>
                        {capsule.brain_side === 'network' ? '网络脑' : '个人脑'}
                      </span>
                      <span className="text-xs text-text-muted flex items-center gap-1">
                        {capsule.unlock_status === 'locked' ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                        {capsule.unlock_status === 'locked' ? '已封存' : '已解锁'}
                      </span>
                    </div>
                    <div className="text-sm text-text-primary line-clamp-2 mb-1">{capsule.content_body}</div>
                    <div className="text-xs text-text-muted flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {capsule.unlockDate
                        ? capsule.unlockDate.toLocaleString('zh-CN')
                        : new Date(capsule.created_at).toLocaleDateString('zh-CN')}
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default CapsuleSchedulePage;
