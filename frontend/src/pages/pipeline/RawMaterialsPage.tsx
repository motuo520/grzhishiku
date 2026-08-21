import { FC, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Database, SquareStack, Search, Globe, BookOpen, FileText, FolderOpen, Rss,
  Layers, Clock, Loader2, AlertCircle, X, CheckSquare, Square,
  ArrowRight, Trash2,
} from 'lucide-react';
import PipelineBrainToggle from './components/PipelineBrainToggle';
import PipelineStageBar from './components/PipelineStageBar';
import { useNavigation } from '@/store/navigation';
import { usePipelineStats, usePipelineItems, useTransitionItem } from '@/hooks/usePipeline';
import type { PipelineItem } from '@/api/pipeline';
import { notesApi } from '@/api/notes';
import { clipsApi } from '@/api/clips';
import { knowledgeApi } from '@/api/knowledge';
import { readLaterApi } from '@/api/readLater';
import { rssApi } from '@/api/rss';
import { documentApi } from '@/api/document';
import { invalidateContentQueries } from '@/utils/invalidateContent';
import StageContextBanner from './components/StageContextBanner';
import ErrorState from '@/components/ErrorState';
import { BrainSideBadge, SourceLink } from './components/PipelineHelpers';

const CONTENT_TYPE_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  note: { label: '笔记', icon: FileText, color: 'text-personal-primary' },
  knowledge: { label: '知识单元', icon: Layers, color: 'text-info' },
  clip: { label: '剪藏', icon: Globe, color: 'text-network-primary' },
  rss: { label: 'RSS', icon: Rss, color: 'text-warning' },
  read_later: { label: '稍后读', icon: BookOpen, color: 'text-network-secondary' },
  document: { label: '文档', icon: FolderOpen, color: 'text-text-secondary' },
};

// content_type → 删除 API（软删底层内容后 raw 列表自动消失：管线查询只取 active）
const DELETE_BY_TYPE: Record<string, (id: string) => Promise<any>> = {
  note: (id) => notesApi.delete(id),
  knowledge: (id) => knowledgeApi.delete(id),
  clip: (id) => clipsApi.delete(id),
  rss: (id) => rssApi.deleteEntry(id),
  read_later: (id) => readLaterApi.delete(id),
  document: (id) => documentApi.delete(id),
};

const RawMaterialsPage: FC = () => {
  const navigate = useNavigate();
  const { brainSide } = useNavigation();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);
  const [actingId, setActingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const queryClient = useQueryClient();

  const { stats } = usePipelineStats(brainSide);
  // 递增加载：后端按 limit 截断且无 offset，靠放大 limit 重取；上限与后端 le=1000 对齐
  const [limit, setLimit] = useState(50);
  const { items, isLoading: isItemsLoading, error: queryError, refetch } = usePipelineItems('raw', brainSide, limit);
  const transitionItem = useTransitionItem();

  const stageCounts = useMemo(() => {
    if (!stats) return {} as Record<string, number>;
    return {
      raw: stats.raw,
      card: stats.card,
      extract: stats.extracted,
      collision: stats.collided,
      annotate: stats.approved,
    };
  }, [stats]);

  const filteredItems = useMemo(() => {
    let data = items || [];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      data = data.filter(
        (item) =>
          (item.title || '').toLowerCase().includes(q) ||
          (item.content_raw || '').toLowerCase().includes(q) ||
          (item.source_title || '').toLowerCase().includes(q)
      );
    }
    if (selectedType !== 'all') {
      data = data.filter((item) => item.content_type === selectedType);
    }
    return data;
  }, [items, searchQuery, selectedType]);

  const contentTypes = useMemo(() => {
    const types = new Set<string>();
    (items || []).forEach((item) => types.add(item.content_type));
    return Array.from(types);
  }, [items]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredItems.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredItems.map((item) => item.id)));
    }
  };

  const handleDelete = async (item: PipelineItem) => {
    const fn = DELETE_BY_TYPE[item.content_type];
    if (!fn) {
      setError('该类型素材暂不支持删除');
      return;
    }
    if (!confirm(`确定删除「${item.title || '无标题'}」？此操作不可恢复。`)) return;
    setError(null);
    setActingId(item.id);
    try {
      await fn(item.content_id);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
      invalidateContentQueries(queryClient);
    } catch (err: any) {
      setError(err?.response?.data?.detail || err.message || '删除失败');
    } finally {
      setActingId(null);
    }
  };

  const handleBatchDelete = async () => {
    const selected = filteredItems.filter((item) => selectedIds.has(item.id) && DELETE_BY_TYPE[item.content_type]);
    if (selected.length === 0 || deleting) return;
    if (!confirm(`确定删除选中的 ${selected.length} 条素材？此操作不可恢复。`)) return;
    setDeleting(true);
    setError(null);
    let failed = 0;
    for (const item of selected) {
      try {
        await DELETE_BY_TYPE[item.content_type](item.content_id);
      } catch {
        failed++;
      }
    }
    setDeleting(false);
    setSelectedIds(new Set());
    invalidateContentQueries(queryClient);
    if (failed > 0) setError(`${selected.length - failed} 条已删除，${failed} 条失败`);
  };

  const handleCardize = async (item: PipelineItem) => {
    setError(null);
    setActingId(item.id);
    try {
      await transitionItem.mutateAsync({
        content_type: item.content_type,
        content_id: item.content_id,
        stage: 'card',
      });
    } catch (err: any) {
      setError(err.message || '卡片化失败');
    } finally {
      setActingId(null);
    }
  };

  const handleBatchCardize = async () => {
    if (selectedIds.size === 0) return;
    const selected = filteredItems.filter((item) => selectedIds.has(item.id));
    if (!confirm(`确定将选中的 ${selected.length} 条素材卡片化？`)) return;
    setIsBatchRunning(true);
    setBatchProgress(0);
    setError(null);
    let failed = 0;
    try {
      for (let i = 0; i < selected.length; i++) {
        try {
          await transitionItem.mutateAsync({
            content_type: selected[i].content_type,
            content_id: selected[i].content_id,
            stage: 'card',
          });
        } catch (err: any) {
          failed++;
          console.error('批量卡片化单项失败', selected[i].id, err);
        }
        setBatchProgress(i + 1);
      }
      if (failed > 0) {
        setError(`${selected.length - failed} 条成功，${failed} 条失败`);
      }
      setSelectedIds(new Set());
      if (failed === 0) {
        // 全部成功：自动进入下一阶段，不用猜卡片去哪了
        navigate('/pipeline/cards');
      }
    } catch (err: any) {
      setError(err.message || '批量卡片化失败');
    } finally {
      setIsBatchRunning(false);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getExcerpt = (content?: string | null, maxLen = 160) => {
    if (!content) return '';
    const plain = content.replace(/[#*`[\]()]/g, '').replace(/\s+/g, ' ').trim();
    return plain.length > maxLen ? plain.slice(0, maxLen) + '...' : plain;
  };

  const renderEmpty = () => (
    <div className="glass-card flex flex-col items-center justify-center py-20 text-center">
      <Database className="w-16 h-16 text-text-muted/40 mb-4" />
      <p className="text-text-secondary text-sm">暂无原始素材</p>
      <p className="text-text-muted text-xs mt-1">去采集、剪藏或导入一些内容开始管线生产</p>
      <button
        onClick={() => navigate('/ingest')}
        className="mt-4 px-4 py-2 bg-white/[0.05] border border-white/[0.08] rounded-[2px] text-xs text-text-primary hover:bg-white/[0.08] transition-colors flex items-center gap-1.5"
      >
        去采集 <ArrowRight className="w-3 h-3" />
      </button>
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <Database className="w-6 h-6 text-info" />
            原始素材
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            未经处理的输入、剪藏、书摘、笔记，作为生产管线的原料入口。
          </p>
        </div>
        <div className="flex flex-col items-start md:items-end gap-3">
          <PipelineBrainToggle stageAware />
          <PipelineStageBar counts={stageCounts} />
        </div>
      </div>

      <StageContextBanner currentStage="raw" stageCounts={stageCounts} />

      {/* Error Banner */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-[2px] bg-danger/10 border border-danger/30 text-danger text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className="glass-card p-4 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索标题、内容、来源..."
                className="w-full bg-white/[0.03] border border-white/[0.08] rounded-[2px] pl-10 pr-4 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-info/40 transition-colors"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setSelectedType('all')}
              className={`px-2.5 py-1 rounded-[2px] text-xs border transition-all ${selectedType === 'all' ? 'bg-info/15 text-info border-info/30' : 'bg-white/[0.03] text-text-secondary border-white/[0.08] hover:bg-white/[0.06]'}`}
            >
              全部
            </button>
            {contentTypes.map((type) => {
              const config = CONTENT_TYPE_CONFIG[type] || { label: type, icon: Layers, color: 'text-text-secondary' };
              return (
                <button
                  key={type}
                  onClick={() => setSelectedType(type)}
                  className={`px-2.5 py-1 rounded-[2px] text-xs border transition-all ${selectedType === type ? 'bg-info/15 text-info border-info/30' : 'bg-white/[0.03] text-text-secondary border-white/[0.08] hover:bg-white/[0.06]'}`}
                >
                  {config.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Bulk Actions */}
        <div className="flex items-center justify-between flex-wrap gap-3 pt-3 border-t border-white/[0.06]">
          <div className="flex items-center gap-2">
            <button
              onClick={toggleSelectAll}
              disabled={filteredItems.length === 0}
              className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
            >
              {selectedIds.size === filteredItems.length && filteredItems.length > 0 ? <CheckSquare className="w-4 h-4 text-info" /> : <Square className="w-4 h-4" />}
              全选
            </button>
            {selectedIds.size > 0 && (
              <span className="text-xs text-info">已选 {selectedIds.size} 条</span>
            )}
            {selectedIds.size > 0 && (
              <button
                onClick={() => setSelectedIds(new Set())}
                disabled={isBatchRunning}
                className="text-xs text-text-muted hover:text-danger transition-colors disabled:opacity-50"
              >
                清除选择
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {selectedIds.size > 0 && (
              <button
                onClick={handleBatchDelete}
                disabled={deleting || isBatchRunning}
                className="flex items-center gap-1.5 px-3 py-2 rounded-[2px] text-xs bg-danger/10 border border-danger/30 text-danger hover:bg-danger/20 transition-colors disabled:opacity-50"
              >
                {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                {deleting ? '删除中...' : '删除所选'}
              </button>
            )}
            <button
              onClick={handleBatchCardize}
              disabled={selectedIds.size === 0 || isBatchRunning || deleting}
              className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-[2px] text-sm font-medium hover:bg-[var(--accent-hover)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isBatchRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <SquareStack className="w-4 h-4" />}
              {isBatchRunning ? `卡片化中 ${batchProgress}/${selectedIds.size}` : '一键卡片化'}
            </button>
          </div>
        </div>
      </div>

      {/* List */}
      {queryError && !isItemsLoading && (
        <ErrorState title="原始素材加载失败" message={queryError?.message || '无法获取数据'} onRetry={refetch} />
      )}
      {isItemsLoading ? (
        <div className="glass-card flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-info" />
        </div>
      ) : filteredItems.length === 0 ? (
        renderEmpty()
      ) : (
        <div className="space-y-3">
          {filteredItems.map((item) => {
            const config = CONTENT_TYPE_CONFIG[item.content_type] || { label: item.content_type, icon: Layers, color: 'text-text-secondary' };
            const Icon = config.icon;
            const isSelected = selectedIds.has(item.id);
            const isActing = actingId === item.id;

            return (
              <div
                key={item.id}
                className="glass-card p-4 flex items-start gap-4 group"
              >
                <button
                  onClick={() => toggleSelect(item.id)}
                  className="mt-1 text-text-muted hover:text-info transition-colors"
                >
                  {isSelected ? <CheckSquare className="w-4 h-4 text-info" /> : <Square className="w-4 h-4" />}
                </button>
                <div className={`mt-1 ${config.color}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-text-primary truncate max-w-[260px]">{item.title || '无标题'}</span>
                    <span className={`px-1.5 py-0.5 rounded-md text-[10px] border bg-white/[0.03] text-text-secondary border-white/[0.08]`}>
                      {config.label}
                    </span>
                    <BrainSideBadge side={item.brain_side} />
                  </div>
                  <p className="text-xs text-text-secondary mt-1.5 line-clamp-2 break-all">{getExcerpt(item.content_raw)}</p>
                  <div className="flex items-center gap-3 text-[10px] text-text-muted mt-2 flex-wrap">
                    <SourceLink url={item.source_url} />
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDate(item.created_at)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {DELETE_BY_TYPE[item.content_type] && (
                    <button
                      onClick={() => handleDelete(item)}
                      disabled={isActing || isBatchRunning || deleting}
                      title="删除该素材"
                      className="p-1.5 rounded-[2px] text-text-muted hover:text-danger hover:bg-danger/10 transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => handleCardize(item)}
                    disabled={isActing || isBatchRunning || deleting}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.05] border border-white/[0.08] rounded-[2px] text-xs text-text-primary hover:bg-info/10 hover:border-info/30 hover:text-info transition-all disabled:opacity-50 shrink-0"
                  >
                    {isActing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <SquareStack className="w-3.5 h-3.5" />}
                    卡片化
                  </button>
                </div>
              </div>
            );
          })}
          {(stageCounts.raw ?? 0) > (items?.length ?? 0) && (
            limit < 1000 ? (
              <button
                onClick={() => setLimit((l) => Math.min(l + 200, 1000))}
                className="w-full py-2.5 rounded-[2px] border border-white/[0.08] text-xs text-text-secondary hover:text-text-primary hover:bg-white/[0.04] transition-colors"
              >
                加载更多（已显示 {items?.length ?? 0} / 共 {stageCounts.raw}）
              </button>
            ) : (
              <p className="text-center text-xs text-text-muted py-2">已达上限，请先卡片化当前素材</p>
            )
          )}
        </div>
      )}
    </div>
  );
};

export default RawMaterialsPage;
