import { FC, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  BookOpen, Trash2, Loader2, Tag, Clock, Filter, FileText, Package, BookMarked,
  AlertCircle, CheckCircle, ArrowRight, Shuffle, Flame, GitMerge, GitBranch, Network,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { emergenceApi, type BrainSide } from '@/api/emergence';

const BRAIN_SIDE_CLASS: Record<string, string> = {
  personal: 'bg-personal-primary/10 text-personal-primary border-personal-primary/20',
  network: 'bg-network-primary/10 text-network-primary border-network-primary/20',
  both: 'bg-fusion-primary/10 text-fusion-primary border-fusion-primary/20',
  unknown: 'bg-white/[0.03] text-text-muted border-white/[0.08]',
};

const BRAIN_SIDE_LABEL: Record<string, string> = {
  personal: '个人脑',
  network: '网络脑',
  both: '双脑',
  unknown: '未知',
};

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  saved: '已保存',
  converted: '已转化',
  archived: '已归档',
};

const STATUS_CLASS: Record<string, string> = {
  draft: 'bg-info/10 text-info border-info/20',
  saved: 'bg-warning/10 text-warning border-warning/20',
  converted: 'bg-success/10 text-success border-success/20',
  archived: 'bg-text-muted/10 text-text-muted border-white/[0.08]',
};

const PROMOTE_OPTIONS: { key: 'note' | 'capsule' | 'knowledge'; label: string; icon: React.ElementType }[] = [
  { key: 'note', label: '转笔记', icon: FileText },
  { key: 'capsule', label: '转胶囊', icon: Package },
  { key: 'knowledge', label: '转知识', icon: BookMarked },
];

const IdeaLibraryPage: FC = () => {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [brainFilter, setBrainFilter] = useState<BrainSide | 'all'>('all');
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const quickTools = [
    { label: '跨域联想', path: '/emergence/associate', icon: Shuffle },
    { label: '创意碰撞', path: '/emergence/collision', icon: Flame },
    { label: '概念杂交', path: '/emergence/hybrid', icon: GitMerge },
    { label: '反事实探索', path: '/emergence/counterfactual', icon: GitBranch },
    { label: '涌现画布', path: '/emergence/canvas', icon: Network },
  ];

  const { data, isLoading } = useQuery({
    queryKey: ['emergence', 'ideas', statusFilter, brainFilter],
    queryFn: async () => {
      const response = await emergenceApi.getIdeas(
        statusFilter === 'all' ? undefined : statusFilter,
        brainFilter === 'all' ? undefined : brainFilter,
        0,
        100
      );
      return response.data;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: emergenceApi.deleteIdea,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emergence', 'ideas'] });
    },
    onError: () => setError('删除失败，请重试'),
  });

  const promoteMutation = useMutation({
    mutationFn: ({ id, target_type }: { id: string; target_type: 'note' | 'capsule' | 'knowledge' }) =>
      emergenceApi.promoteIdea(id, { target_type }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['emergence', 'ideas'] });
      setPromotingId(null);
      // 转化完成直接带去看产物，不用猜落在哪个二级菜单
      const targetPaths = { note: '/ingest/notes', capsule: '/capsules/my', knowledge: '/knowledge/network' } as const;
      navigate(targetPaths[variables.target_type]);
    },
    onError: () => setError('转化失败，请重试'),
  });

  const handleDelete = (id: string) => {
    if (!confirm('确定要删除这个创意成果吗？')) return;
    setError(null);
    deleteMutation.mutate(id);
  };

  const handlePromote = (id: string, target_type: 'note' | 'capsule' | 'knowledge') => {
    setError(null);
    promoteMutation.mutate({ id, target_type });
  };

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const ideas = data?.items || [];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="w-6 h-6 text-fusion-primary" />
          <h1 className="text-2xl font-bold text-text-primary">成果库</h1>
        </div>
      </div>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex items-center gap-2 px-4 py-3 rounded-[2px] bg-danger/10 border border-danger/30 text-danger text-sm"
          >
            <AlertCircle className="w-4 h-4" />
            {error}
            <button onClick={() => setError(null)} className="ml-auto">
              <Trash2 className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Filters */}
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="flex items-center gap-1 bg-bg-tertiary rounded-[2px] p-1">
          {(['all', 'draft', 'converted', 'archived'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                statusFilter === s
                  ? 'bg-bg-secondary text-text-primary shadow-sm'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              {s === 'all' ? '全部状态' : STATUS_LABEL[s] || s}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 bg-bg-tertiary rounded-[2px] p-1">
          {(['all', 'personal', 'network', 'both'] as const).map((b) => (
            <button
              key={b}
              onClick={() => setBrainFilter(b)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                brainFilter === b
                  ? 'bg-bg-secondary text-text-primary shadow-sm'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              {b === 'all' ? '全部脑侧' : BRAIN_SIDE_LABEL[b]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 text-xs text-text-muted">
          <Filter className="w-3.5 h-3.5" />
          共 {data?.total ?? 0} 条
        </div>
      </div>

      {/* Ideas Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 text-info animate-spin" />
        </div>
      ) : ideas.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-16">
          <BookOpen className="w-16 h-16 text-text-muted mb-4" />
          <p className="text-text-secondary mb-2">成果库为空</p>
          <p className="text-xs text-text-muted mt-1 mb-4">在涌现工具中保存创意，它们会出现在这里</p>
          <div className="flex flex-wrap items-center justify-center gap-2 max-w-lg">
            {quickTools.map((tool) => {
              const Icon = tool.icon;
              return (
                <button
                  key={tool.path}
                  onClick={() => navigate(tool.path)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-[2px] bg-white/[0.03] border border-white/[0.08] hover:border-fusion-primary/30 hover:bg-fusion-primary/5 text-text-secondary hover:text-text-primary text-xs transition-colors"
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tool.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <AnimatePresence>
            {ideas.map((idea) => (
              <motion.div
                key={idea.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="card flex flex-col justify-between group"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <h3 className="text-sm font-medium text-text-primary line-clamp-1 flex-1">{idea.title}</h3>
                    <button
                      onClick={() => handleDelete(idea.id)}
                      disabled={deleteMutation.isPending}
                      className="p-1.5 rounded-[2px] hover:bg-danger/10 text-text-muted hover:text-danger transition-colors disabled:opacity-50"
                      title="删除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <p className="text-xs text-text-secondary line-clamp-3 leading-relaxed mb-3">
                    {idea.summary || '暂无摘要'}
                  </p>

                  <div className="flex items-center gap-2 flex-wrap mb-3">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 text-[10px] rounded-[2px] border ${
                        BRAIN_SIDE_CLASS[idea.brain_side] || BRAIN_SIDE_CLASS.unknown
                      }`}
                    >
                      {BRAIN_SIDE_LABEL[idea.brain_side] || BRAIN_SIDE_LABEL.unknown}
                    </span>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 text-[10px] rounded-[2px] border ${
                        STATUS_CLASS[idea.status] || STATUS_CLASS.draft
                      }`}
                    >
                      {STATUS_LABEL[idea.status] || idea.status}
                    </span>
                  </div>

                  {idea.tags && idea.tags.length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap mb-3">
                      <Tag className="w-3 h-3 text-text-muted" />
                      {idea.tags.slice(0, 3).map((tag, i) => (
                        <span
                          key={i}
                          className="text-[10px] text-text-secondary bg-white/[0.05] px-1.5 py-0.5 rounded"
                        >
                          {tag}
                        </span>
                      ))}
                      {idea.tags.length > 3 && (
                        <span className="text-[10px] text-text-muted">+{idea.tags.length - 3}</span>
                      )}
                    </div>
                  )}
                </div>

                <div className="mt-4 pt-3 border-t border-border-color">
                  <div className="flex items-center justify-between text-xs text-text-muted mb-3">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDate(idea.created_at)}
                    </span>
                    <span>{idea.source_result_ids?.length || 0} 来源</span>
                  </div>

                  {idea.status === 'converted' && idea.target_type ? (
                    <div className="flex items-center gap-1 text-xs text-success">
                      <CheckCircle className="w-3.5 h-3.5" />
                      已转化为 {PROMOTE_OPTIONS.find((o) => o.key === idea.target_type)?.label || idea.target_type}
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      {promotingId === idea.id ? (
                        <div className="flex items-center gap-1">
                          {PROMOTE_OPTIONS.map((opt) => {
                            const Icon = opt.icon;
                            return (
                              <button
                                key={opt.key}
                                onClick={() => handlePromote(idea.id, opt.key)}
                                disabled={promoteMutation.isPending}
                                className="flex items-center gap-1 px-2 py-1 rounded-[2px] bg-white/[0.05] hover:bg-info/10 text-text-secondary hover:text-info border border-white/[0.08] text-[10px] transition-colors disabled:opacity-60"
                              >
                                <Icon className="w-3 h-3" />
                                {opt.label}
                              </button>
                            );
                          })}
                          <button
                            onClick={() => setPromotingId(null)}
                            className="p-1 rounded-[2px] hover:bg-white/[0.05] text-text-muted"
                          >
                            ×
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setPromotingId(idea.id)}
                          className="btn-primary text-[10px] py-1.5 px-2.5 flex items-center gap-1"
                        >
                          转化
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
};

export default IdeaLibraryPage;
