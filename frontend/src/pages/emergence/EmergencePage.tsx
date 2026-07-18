/* eslint-disable react-refresh/only-export-components */
import { FC, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shuffle, Flame, GitMerge, GitBranch, ArrowRight, ArrowLeft, Sparkles, Lightbulb, Zap,
  Database, BookOpen, Clock, Loader2, X, Trash, Network,
} from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { emergenceApi, EmergenceHistoryItem } from '@/api/emergence';

const tools = [
  {
    id: 'associate',
    title: '跨域联想',
    description: '输入两个看似无关的主题，让 AI 发现它们之间的隐藏连接，激发创新灵感。',
    example: '神经网络 × 城市交通',
    icon: Shuffle,
    color: 'text-info',
    bgColor: 'bg-info/10',
    borderColor: 'border-info/20',
    path: '/emergence/associate',
  },
  {
    id: 'collision',
    title: '创意碰撞',
    description: '选择一个话题，从多个专业视角进行观点交锋，发现不同立场下的共识与分歧。',
    example: '人工智能版权',
    icon: Flame,
    color: 'text-warning',
    bgColor: 'bg-warning/10',
    borderColor: 'border-warning/20',
    path: '/emergence/collision',
  },
  {
    id: 'hybrid',
    title: '概念杂交',
    description: '融合两个核心概念，生成具有全新特征的创新概念，并评估其可行性与风险。',
    example: '区块链 × 民主投票',
    icon: GitMerge,
    color: 'text-fusion-primary',
    bgColor: 'bg-fusion-primary/10',
    borderColor: 'border-fusion-primary/20',
    path: '/emergence/hybrid',
  },
  {
    id: 'counterfactual',
    title: '反事实探索',
    description: '假设一个历史或现实条件从未发生，推演时间线的分支与连锁反应。',
    example: '如果互联网从未被发明',
    icon: GitBranch,
    color: 'text-success',
    bgColor: 'bg-success/10',
    borderColor: 'border-success/20',
    path: '/emergence/counterfactual',
  },
];

const extraEntries = [
  {
    id: 'source-pool',
    title: '素材池',
    description: '浏览、搜索和筛选跨域素材，为涌现工具准备灵感来源。',
    icon: Database,
    color: 'text-info',
    bgColor: 'bg-info/10',
    borderColor: 'border-info/20',
    path: '/emergence/sources',
  },
  {
    id: 'canvas',
    title: '涌现画布',
    description: '拖拽组合创意、素材和便签，在可视化画布中发现新的连接与涌现。',
    icon: Network,
    color: 'text-fusion-primary',
    bgColor: 'bg-fusion-primary/10',
    borderColor: 'border-fusion-primary/20',
    path: '/emergence/canvas',
  },
  {
    id: 'library',
    title: '成果库',
    description: '查看、管理和转化已保存的创意成果为笔记、胶囊或知识单元。',
    icon: BookOpen,
    color: 'text-success',
    bgColor: 'bg-success/10',
    borderColor: 'border-success/20',
    path: '/emergence/library',
  },
];

const typeLabels: Record<string, string> = {
  associate: '跨域联想',
  collision: '创意碰撞',
  hybrid: '概念杂交',
  counterfactual: '反事实',
};

const typeColors: Record<string, string> = {
  associate: 'text-network-primary',
  collision: 'text-warning',
  hybrid: 'text-fusion-primary',
  counterfactual: 'text-success',
};

const EmergencePage: FC = () => {
  const navigate = useNavigate();
  const [hovered, setHovered] = useState<string | null>(null);

  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ['emergence', 'history', 'overview'],
    queryFn: async () => {
      const response = await emergenceApi.history(undefined, 0, 3);
      return response.data;
    },
  });

  const { data: ideasData, isLoading: ideasLoading } = useQuery({
    queryKey: ['emergence', 'ideas', 'overview'],
    queryFn: async () => {
      const response = await emergenceApi.getIdeas(undefined, 'all', 0, 3);
      return response.data;
    },
  });

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-[2px] glass-card border-fusion-primary/30">
          <Sparkles className="w-5 h-5 text-fusion-primary" />
          <span className="text-sm font-medium text-fusion-primary">涌现工作室</span>
        </div>
        <h1 className="text-3xl font-bold text-text-primary">创意涌现工坊</h1>
        <p className="text-text-secondary max-w-xl mx-auto">
          通过 AI 驱动的跨域联想、多视角碰撞、概念融合和反事实推演，激发突破性的创新思维。
        </p>
      </div>

      {/* Tool Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {tools.map((tool) => {
          const Icon = tool.icon;
          const isHovered = hovered === tool.id;

          return (
            <motion.div
              key={tool.id}
              className="glass-card p-6 cursor-pointer group relative overflow-hidden h-full flex flex-col"
              onMouseEnter={() => setHovered(tool.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => navigate(tool.path)}
              whileHover={{ scale: 1.02, y: -4 }}
              transition={{ duration: 0.3 }}
            >
              <AnimatePresence>
                {isHovered && (
                  <motion.div
                    className="absolute inset-0 opacity-10"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 0.1 }}
                    exit={{ opacity: 0 }}
                    style={{
                      background: `radial-gradient(circle at 50% 50%, currentColor, transparent 70%)`,
                    }}
                  />
                )}
              </AnimatePresence>

              <div className="relative z-10 flex flex-col flex-1">
                <div className="flex items-start justify-between mb-4">
                  <div className={`p-3 rounded-[2px] ${tool.bgColor} ${tool.borderColor} border`}>
                    <Icon className={`w-6 h-6 ${tool.color}`} />
                  </div>
                  <ArrowRight
                    className={`w-5 h-5 transition-all duration-300 ${
                      isHovered ? `${tool.color} translate-x-1` : 'text-text-muted'
                    }`}
                  />
                </div>

                <h3 className="text-xl font-bold text-text-primary mb-2 group-hover:text-text-primary transition-colors">
                  {tool.title}
                </h3>
                <p className="text-text-secondary text-sm leading-relaxed mb-4 flex-1">
                  {tool.description}
                </p>

                <div className="flex items-center gap-2 text-xs text-text-muted mt-auto">
                  <Zap className="w-3 h-3" />
                  <span>示例：{tool.example}</span>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Extra Entry Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {extraEntries.map((entry) => {
          const Icon = entry.icon;
          const isHovered = hovered === entry.id;

          return (
            <motion.div
              key={entry.id}
              className="glass-card p-6 cursor-pointer group relative overflow-hidden h-full flex flex-col"
              onMouseEnter={() => setHovered(entry.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => navigate(entry.path)}
              whileHover={{ scale: 1.02, y: -4 }}
              transition={{ duration: 0.3 }}
            >
              <AnimatePresence>
                {isHovered && (
                  <motion.div
                    className="absolute inset-0 opacity-10"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 0.1 }}
                    exit={{ opacity: 0 }}
                    style={{
                      background: `radial-gradient(circle at 50% 50%, currentColor, transparent 70%)`,
                    }}
                  />
                )}
              </AnimatePresence>

              <div className="relative z-10 flex flex-col flex-1">
                <div className="flex items-start justify-between mb-4">
                  <div className={`p-3 rounded-[2px] ${entry.bgColor} ${entry.borderColor} border`}>
                    <Icon className={`w-6 h-6 ${entry.color}`} />
                  </div>
                  <ArrowRight
                    className={`w-5 h-5 transition-all duration-300 ${
                      isHovered ? `${entry.color} translate-x-1` : 'text-text-muted'
                    }`}
                  />
                </div>

                <h3 className="text-xl font-bold text-text-primary mb-2 group-hover:text-text-primary transition-colors">
                  {entry.title}
                </h3>
                <p className="text-text-secondary text-sm leading-relaxed mb-4 flex-1">
                  {entry.description}
                </p>

                <div className="flex items-center gap-2 text-xs text-text-muted mt-auto">
                  <ArrowRight className="w-3 h-3" />
                  <span>点击进入</span>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-4 h-4 text-text-secondary" />
            <h3 className="font-bold text-text-primary text-sm">最近历史</h3>
          </div>
          {historyLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 text-text-muted animate-spin" />
            </div>
          ) : !historyData?.items || historyData.items.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-6">暂无历史记录</p>
          ) : (
            <div className="space-y-2">
              {historyData.items.map((item) => (
                <div
                  key={item.id}
                  className="p-3 rounded-[2px] bg-white/[0.02] border border-white/[0.05]"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-xs font-medium ${typeColors[item.type] || 'text-text-muted'}`}>
                      {typeLabels[item.type] || item.type}
                    </span>
                    {(item.source_ids?.length || 0) > 0 && (
                      <span className="text-[10px] text-info">{item.source_ids?.length} 素材</span>
                    )}
                  </div>
                  <p className="text-sm text-text-primary truncate">
                    {typeof item.input === 'object' && item.input !== null
                      ? (Object.values(item.input).filter(v => typeof v === 'string').join(' × ').slice(0, 60) || '未知')
                      : String(item.input || '未知').slice(0, 60)}
                  </p>
                  <p className="text-xs text-text-muted mt-1">
                    {new Date(item.created_at).toLocaleString('zh-CN')}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <BookOpen className="w-4 h-4 text-text-secondary" />
            <h3 className="font-bold text-text-primary text-sm">最新成果</h3>
          </div>
          {ideasLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 text-text-muted animate-spin" />
            </div>
          ) : !ideasData?.items || ideasData.items.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-6">暂无保存的创意</p>
          ) : (
            <div className="space-y-2">
              {ideasData.items.map((idea) => (
                <div
                  key={idea.id}
                  onClick={() => navigate('/emergence/library')}
                  className="p-3 rounded-[2px] bg-white/[0.02] border border-white/[0.05] hover:border-fusion-primary/30 cursor-pointer transition-colors"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-text-primary font-medium line-clamp-1">{idea.title}</span>
                    <span className="text-[10px] text-fusion-primary">{idea.status === 'converted' ? '已转化' : '草稿'}</span>
                  </div>
                  <p className="text-xs text-text-secondary line-clamp-2">{idea.summary || '暂无摘要'}</p>
                  <p className="text-xs text-text-muted mt-1">
                    {new Date(idea.created_at).toLocaleString('zh-CN')}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Introduction */}
      <div className="glass-card p-6 border-fusion-primary/10">
        <div className="flex items-center gap-2 mb-3">
          <Lightbulb className="w-5 h-5 text-warning" />
          <h3 className="font-bold text-text-primary">什么是涌现？</h3>
        </div>
        <p className="text-sm text-text-secondary leading-relaxed">
          涌现（Emergence）是指当简单元素以特定方式组合时，产生出超越各部分简单相加的新特性。
          在涌现工作室中，我们利用 AI 的跨域推理能力，帮助你打破思维定势，在看似无关的领域间建立连接，
          从而产生真正创新的想法和洞察。
        </p>
      </div>
    </div>
  );
};

export default EmergencePage;

// ─────────────────────────── Shared Components for Sub-pages ───────────────────────────

export const getScoreColor = (score: number): string => {
  if (score <= 3) return '#7d8f6a';
  if (score <= 6) return '#b08a3e';
  if (score <= 8) return '#b03a2e';
  return '#7d8f6a';
};

export const getScoreLabel = (score: number): string => {
  if (score <= 3) return '低';
  if (score <= 6) return '中';
  if (score <= 8) return '高';
  return '极高';
};

export const LoadingOverlay: FC<{ text?: string }> = ({ text = '生成中...' }) => (
  <div className="flex items-center justify-center py-12">
    <div className="flex flex-col items-center gap-3">
      <Loader2 className="w-8 h-8 text-info animate-spin" />
      <span className="text-sm text-text-secondary">{text}</span>
    </div>
  </div>
);

interface HistoryPanelProps {
  currentType?: string;
  onLoadHistory?: (item: EmergenceHistoryItem) => void;
}

export const HistoryPanel: FC<HistoryPanelProps> = ({ currentType, onLoadHistory }) => {
  const [isOpen, setIsOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['emergence', 'history', currentType],
    queryFn: async () => {
      const response = await emergenceApi.history(currentType, 0, 50);
      return response.data;
    },
    enabled: isOpen,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => emergenceApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emergence', 'history'] });
    },
  });

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed right-4 top-24 z-40 p-3 rounded-[2px] bg-bg-secondary border border-white/[0.08] hover:border-white/[0.15] transition-all group"
        title="历史记录"
      >
        <Clock className="w-5 h-5 text-text-secondary group-hover:text-text-primary transition-colors" />
        {data && data.items.length > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-info text-[10px] text-white flex items-center justify-center font-bold">
            {data.items.length > 9 ? '9+' : data.items.length}
          </span>
        )}
      </button>

      {isOpen && (
        <motion.div
          initial={{ x: 320, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 320, opacity: 0 }}
          transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
          className="fixed right-0 top-16 bottom-0 w-80 z-50 bg-bg-secondary border-l border-white/[0.08] flex flex-col"
        >
          <div className="flex items-center justify-between p-4 border-b border-white/[0.06]">
            <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
              <Clock className="w-4 h-4 text-text-muted" />
              历史记录
            </h3>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1.5 rounded-[2px] hover:bg-white/[0.08] text-text-secondary transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 text-text-muted animate-spin" />
              </div>
            ) : data?.items.length === 0 ? (
              <div className="text-center py-8 text-text-muted text-sm">暂无历史记录</div>
            ) : (
              data?.items.map((item) => (
                <div
                  key={item.id}
                  className="group p-3 rounded-[2px] bg-white/[0.03] border border-white/[0.06] hover:border-white/[0.12] transition-all cursor-pointer"
                  onClick={() => onLoadHistory?.(item)}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-xs font-medium ${typeColors[item.type] || 'text-text-muted'}`}>
                      {typeLabels[item.type] || item.type}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteMutation.mutate(item.id);
                      }}
                      className="p-1 rounded hover:bg-danger/10 text-text-muted hover:text-danger opacity-0 group-hover:opacity-100 transition-all"
                      disabled={deleteMutation.isPending}
                    >
                      <Trash className="w-3 h-3" />
                    </button>
                  </div>
                  <p className="text-sm text-text-primary truncate">
                    {typeof item.input === 'object' && item.input !== null
                      ? (Object.values(item.input).filter(v => typeof v === 'string').join(' × ').slice(0, 60) || '未知')
                      : String(item.input || '未知').slice(0, 60)}
                  </p>
                  {(item.source_ids?.length || 0) > 0 && (
                    <p className="text-[10px] text-info mt-1">{item.source_ids?.length} 条素材</p>
                  )}
                  <p className="text-xs text-text-muted mt-1">
                    {new Date(item.created_at).toLocaleString('zh-CN')}
                  </p>
                </div>
              ))
            )}
          </div>
        </motion.div>
      )}
    </>
  );
};

export const EmergenceSubLayout: FC<{ title: string; icon: React.ElementType; children: React.ReactNode }> = ({ title, icon: Icon, children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const currentType = location.pathname.split('/').pop();

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => navigate('/emergence')}
            className="p-2 rounded-[2px] hover:bg-white/[0.06] text-text-secondary hover:text-text-primary transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-8 h-8 rounded-[2px] bg-white/[0.05] flex items-center justify-center">
            <Icon className="w-4 h-4 text-fusion-primary" />
          </div>
          <h1 className="text-xl font-bold text-text-primary">{title}</h1>
        </div>
        {children}
      </div>
      <HistoryPanel currentType={currentType} />
    </div>
  );
};
