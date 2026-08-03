import { FC, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Globe, Search, Heart, Loader2, Lock, Unlock, Calendar } from 'lucide-react';
import { useCapsulePlaza } from '@/hooks/useCapsules';

const CapsulePlazaPage: FC = () => {
  const navigate = useNavigate();
  const { capsules, isLoading, collectCapsule, isCollecting } = useCapsulePlaza();
  const [searchQuery, setSearchQuery] = useState('');
  const [collectingId, setCollectingId] = useState<string | null>(null);
  const [collectNotice, setCollectNotice] = useState<string | null>(null);

  const filteredCapsules = (capsules || []).filter((capsule) => {
    if (searchQuery && !capsule.content_body.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const handleCollect = async (id: string) => {
    setCollectingId(id);
    try {
      await collectCapsule(id);
      // 收藏成功但留在广场页（方便连续收藏），提示产物去向
      setCollectNotice('已收藏，可在「我的胶囊」查看');
      setTimeout(() => setCollectNotice(null), 3000);
    } finally {
      setCollectingId(null);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">胶囊广场</h1>
          <p className="text-sm text-text-secondary mt-1">看看大家公开封存的胶囊，收藏感兴趣的到个人脑</p>
        </div>
        {collectNotice && (
          <button
            onClick={() => navigate('/capsules/my')}
            className="px-3 py-1.5 bg-success/10 border border-success/30 rounded-[2px] text-xs text-success hover:bg-success/20 transition-colors"
          >
            {collectNotice} →
          </button>
        )}
      </div>

      <div className="flex items-center gap-4">
        <div className="flex-1 max-w-md">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索广场胶囊..."
              className="w-full bg-bg-tertiary border border-border-color rounded-lg pl-10 pr-4 py-2 text-sm focus:outline-none focus:border-info transition-colors"
            />
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin w-8 h-8 border-2 border-info border-t-transparent rounded-full" />
        </div>
      ) : filteredCapsules.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-16">
          <Globe className="w-16 h-16 text-text-muted mb-4" />
          <p className="text-text-secondary mb-2">广场暂无公开胶囊</p>
          <button onClick={() => navigate('/capsules/create')} className="btn-primary mt-4">
            创建并公开一个
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <AnimatePresence>
            {filteredCapsules.map((capsule, index) => (
              <motion.div
                key={capsule.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="card hover:border-info/30"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className={`flex items-center gap-2 px-2.5 py-1 rounded-full border text-xs font-medium ${
                    capsule.unlock_status === 'locked'
                      ? 'bg-warning/10 text-warning border-warning/30'
                      : 'bg-success/10 text-success border-success/30'
                  }`}>
                    {capsule.unlock_status === 'locked' ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                    {capsule.unlock_status === 'locked' ? '已封存' : '已解锁'}
                  </div>
                  <span className="text-xs text-text-muted flex items-center gap-1">
                    <Globe className="w-3 h-3" />
                    {capsule.privacy_level === 'public' ? '公开' : '共享'}
                  </span>
                </div>
                <div className="text-sm font-medium text-text-primary line-clamp-2 mb-2">
                  {capsule.content_body}
                </div>
                <div className="flex items-center justify-between text-xs text-text-muted mb-4">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {new Date(capsule.created_at).toLocaleDateString('zh-CN')}
                  </span>
                  <span>{capsule.unlock_type === 'temporal' ? '时间解锁' : '条件解锁'}</span>
                </div>
                <button
                  onClick={() => handleCollect(capsule.id)}
                  disabled={isCollecting}
                  className="w-full btn-secondary flex items-center justify-center gap-2 text-xs"
                >
                  {collectingId === capsule.id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Heart className="w-3.5 h-3.5" />
                  )}
                  收藏到我的胶囊
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
};

export default CapsulePlazaPage;
