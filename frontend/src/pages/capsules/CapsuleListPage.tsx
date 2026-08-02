import { FC, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Package, Plus, Lock, Unlock, Calendar, Search, Grid, List as ListIcon, User, Globe } from 'lucide-react';
import { useCapsules } from '@/hooks/useCapsules';

const CapsuleListPage: FC = () => {
  const navigate = useNavigate();
  const { capsules, isLoading } = useCapsules('personal');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [filter, setFilter] = useState<'all' | 'locked' | 'unlocked'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredCapsules = (capsules || []).filter((capsule) => {
    if (filter === 'locked' && capsule.unlock_status !== 'locked') return false;
    if (filter === 'unlocked' && capsule.unlock_status === 'locked') return false;
    if (searchQuery && !capsule.content_body.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'locked': return <Lock className="w-4 h-4 text-warning" />;
      case 'unlocked': return <Unlock className="w-4 h-4 text-success" />;
      case 'opened': return <Unlock className="w-4 h-4 text-info" />;
      default: return <Lock className="w-4 h-4 text-text-muted" />;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'locked': return '已封存';
      case 'unlocked': return '已解锁';
      case 'opened': return '已开启';
      default: return '未知';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'locked': return 'bg-warning/10 text-warning border-warning/30';
      case 'unlocked': return 'bg-success/10 text-success border-success/30';
      case 'opened': return 'bg-info/10 text-info border-info/30';
      default: return 'bg-bg-tertiary text-text-muted border-border-color';
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">我的胶囊</h1>
          <p className="text-sm text-text-secondary mt-1">个人脑封存与收藏的记忆</p>
        </div>
        <button
          onClick={() => navigate('/capsules/create')}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          创建胶囊
        </button>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-1 bg-bg-tertiary rounded-lg p-1">
          {(['all', 'locked', 'unlocked'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                filter === f
                  ? 'bg-bg-secondary text-text-primary shadow-sm'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              {f === 'all' ? '全部' : f === 'locked' ? '已封存' : '已解锁'}
            </button>
          ))}
        </div>

        <div className="flex-1 max-w-md">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索胶囊..."
              className="w-full bg-bg-tertiary border border-border-color rounded-lg pl-10 pr-4 py-2 text-sm focus:outline-none focus:border-info transition-colors"
            />
          </div>
        </div>

        <div className="flex items-center gap-1 bg-bg-tertiary rounded-lg p-1">
          <button
            onClick={() => setViewMode('grid')}
            className={`p-2 rounded-md transition-all ${viewMode === 'grid' ? 'bg-bg-secondary text-text-primary' : 'text-text-muted'}`}
          >
            <Grid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-2 rounded-md transition-all ${viewMode === 'list' ? 'bg-bg-secondary text-text-primary' : 'text-text-muted'}`}
          >
            <ListIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin w-8 h-8 border-2 border-info border-t-transparent rounded-full" />
        </div>
      ) : filteredCapsules.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-16">
          <Package className="w-16 h-16 text-text-muted mb-4" />
          <p className="text-text-secondary mb-2">还没有个人胶囊</p>
          <button onClick={() => navigate('/capsules/create')} className="btn-primary mt-4">
            创建第一个胶囊
          </button>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <AnimatePresence>
            {filteredCapsules.map((capsule, index) => (
              <motion.div
                key={capsule.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                onClick={() => navigate(`/capsules/${capsule.id}`)}
                className="card hover:border-info/30 cursor-pointer group"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className={`flex items-center gap-2 px-2.5 py-1 rounded-full border text-xs font-medium ${getStatusColor(capsule.unlock_status)}`}>
                    {getStatusIcon(capsule.unlock_status)}
                    {getStatusLabel(capsule.unlock_status)}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-text-muted">
                    {capsule.brain_side === 'network' ? <Globe className="w-3 h-3" /> : <User className="w-3 h-3" />}
                    {capsule.brain_side === 'network' ? '网络脑' : '个人脑'}
                  </div>
                </div>
                <div className="text-sm font-medium text-text-primary line-clamp-2 mb-2">
                  {capsule.content_body}
                </div>
                <div className="flex items-center justify-between text-xs text-text-muted">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {new Date(capsule.created_at).toLocaleDateString('zh-CN')}
                  </span>
                  <span className="flex items-center gap-1">
                    <Lock className="w-3 h-3" />
                    {capsule.unlock_type === 'temporal' ? '时间解锁' : '条件解锁'}
                  </span>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence>
            {filteredCapsules.map((capsule, index) => (
              <motion.div
                key={capsule.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.03 }}
                onClick={() => navigate(`/capsules/${capsule.id}`)}
                className="card flex items-center gap-4 hover:border-info/30 cursor-pointer py-3"
              >
                <div className={`flex items-center gap-2 px-2.5 py-1 rounded-full border text-xs font-medium ${getStatusColor(capsule.unlock_status)}`}>
                  {getStatusIcon(capsule.unlock_status)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-text-primary truncate">{capsule.content_body}</div>
                  <div className="text-xs text-text-muted mt-0.5">
                    {new Date(capsule.created_at).toLocaleDateString('zh-CN')} · {capsule.unlock_type === 'temporal' ? '时间解锁' : '条件解锁'}
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
};

export default CapsuleListPage;
