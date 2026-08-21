import { FC, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  SquareStack, Filter, Search, Globe, BookOpen, FileText, FolderOpen, Rss,
  Layers, Clock, Loader2, AlertCircle, X, CheckSquare, Square,
  ArrowRight, Sparkles,
} from 'lucide-react';
import PipelineBrainToggle from './components/PipelineBrainToggle';
import PipelineStageBar from './components/PipelineStageBar';
import { useNavigation } from '@/store/navigation';
import { usePipelineStats, usePipelineItems, useExtractConcepts, useTransitionItem } from '@/hooks/usePipeline';
import type { PipelineItem } from '@/api/pipeline';
import StageContextBanner from './components/StageContextBanner';
import ModelSelector from '@/components/llm/ModelSelector';
import { BrainSideBadge, SourceLink } from './components/PipelineHelpers';
import ErrorState from '@/components/ErrorState';
import PipelineItemActions from './components/PipelineItemActions';

const CONTENT_TYPE_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  note: { label: '笔记', icon: FileText, color: 'text-personal-primary' },
  knowledge: { label: '知识卡片', icon: Layers, color: 'text-info' },
  clip: { label: '剪藏', icon: Globe, color: 'text-network-primary' },
  rss: { label: 'RSS', icon: Rss, color: 'text-warning' },
  read_later: { label: '稍后读', icon: BookOpen, color: 'text-network-secondary' },
  document: { label: '文档', icon: FolderOpen, color: 'text-text-secondary' },
};

const CardsPage: FC = () => {
  const navigate = useNavigate();
  const { brainSide } = useNavigation();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);
  const [extractingId, setExtractingId] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string>('');

  const { stats } = usePipelineStats(brainSide);
  // 递增加载：后端按 limit 截断且无 offset，靠放大 limit 重取；上限与后端 le=1000 对齐
  const [limit, setLimit] = useState(50);
  const { items, isLoading: isItemsLoading, error: queryError, refetch } = usePipelineItems('card', brainSide, limit);
  const { items: rawItems } = usePipelineItems('raw', brainSide);
  const extractConcepts = useExtractConcepts();
  const transitionItem = useTransitionItem();
  const [isPulling, setIsPulling] = useState(false);

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

  const handleExtract = async (item: PipelineItem) => {
    setError(null);
    setExtractingId(item.id);
    try {
      await extractConcepts.mutateAsync({
        content_type: item.content_type,
        content_id: item.content_id,
        preferred_model: modelId || undefined,
      });
    } catch (err: any) {
      setError(err.message || '抽取概念失败');
    } finally {
      setExtractingId(null);
    }
  };

  const handleBatchExtract = async () => {
    if (selectedIds.size === 0) return;
    const selected = filteredItems.filter((item) => selectedIds.has(item.id));
    if (!confirm(`确定对选中的 ${selected.length} 张卡片抽取概念？这会调用 AI 进行分析。`)) return;
    setIsBatchRunning(true);
    setBatchProgress(0);
    setError(null);
    let failed = 0;
    try {
      for (let i = 0; i < selected.length; i++) {
        try {
          await extractConcepts.mutateAsync({
            content_type: selected[i].content_type,
            content_id: selected[i].content_id,
            preferred_model: modelId || undefined,
          });
        } catch (err: any) {
          failed++;
          console.error('批量抽取单项失败', selected[i].id, err);
        }
        setBatchProgress(i + 1);
      }
      if (failed > 0) {
        setError(`${selected.length - failed} 张成功，${failed} 张失败`);
      }
      setSelectedIds(new Set());
      if (failed === 0) {
        // 全部成功：自动进入下一阶段（碰撞）
        navigate('/pipeline/extract');
      }
    } catch (err: any) {
      setError(err.message || '批量抽取失败');
    } finally {
      setIsBatchRunning(false);
    }
  };

  const handlePullFromRaw = async () => {
    const candidates = (rawItems || []).slice(0, 10);
    if (candidates.length === 0) return;
    if (!confirm(`将把上一阶段 ${candidates.length} 条原始素材卡片化，确定继续？`)) return;
    setIsPulling(true);
    setError(null);
    let failed = 0;
    try {
      for (const item of candidates) {
        try {
          await transitionItem.mutateAsync({
            content_type: item.content_type,
            content_id: item.content_id,
            stage: 'card',
          });
        } catch (err: any) {
          failed++;
          console.error('从原始素材拉取单项失败', item.id, err);
        }
      }
      if (failed > 0) {
        setError(`${candidates.length - failed} 条成功卡片化，${failed} 条失败`);
      }
    } catch (err: any) {
      setError(err.message || '从原始素材拉取失败');
    } finally {
      setIsPulling(false);
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

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <SquareStack className="w-6 h-6 text-fusion-primary" />
            卡片化
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            将原始素材切割为可复用的原子卡片，每个卡片只承载一个概念或行动。
          </p>
        </div>
        <div className="flex flex-col items-start md:items-end gap-3">
          <PipelineBrainToggle stageAware />
          <PipelineStageBar counts={stageCounts} />
        </div>
      </div>

      <StageContextBanner
        currentStage="card"
        stageCounts={stageCounts}
        onPullFromPrevious={handlePullFromRaw}
        isPulling={isPulling}
        pullLabel="一键卡片化前 10 条"
      />

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
                placeholder="搜索卡片标题、内容..."
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
            {selectedIds.size > 0 && <span className="text-xs text-info">已选 {selectedIds.size} 张</span>}
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
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-3">
              <ModelSelector value={modelId} onChange={setModelId} taskType="analysis" className="w-48" />
            </div>
            <button
              onClick={handleBatchExtract}
              disabled={selectedIds.size === 0 || isBatchRunning}
              className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-[2px] text-sm font-medium hover:bg-[var(--accent-hover)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isBatchRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {isBatchRunning ? `抽取中 ${batchProgress}/${selectedIds.size}` : '批量抽取概念'}
            </button>
          </div>
        </div>
      </div>

      {/* List */}
      {queryError && !isItemsLoading && (
        <ErrorState title="卡片加载失败" message={queryError?.message || '无法获取数据'} onRetry={refetch} />
      )}
      {isItemsLoading ? (
        <div className="glass-card flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-info" />
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="glass-card flex flex-col items-center justify-center py-20 text-center">
          <SquareStack className="w-16 h-16 text-text-muted/40 mb-4" />
          <p className="text-text-secondary text-sm">暂无卡片</p>
          <p className="text-text-muted text-xs mt-1">先去原始素材页面把内容卡片化</p>
          <button
            onClick={() => navigate('/pipeline/raw')}
            className="mt-4 px-4 py-2 bg-white/[0.05] border border-white/[0.08] rounded-[2px] text-xs text-text-primary hover:bg-white/[0.08] transition-colors flex items-center gap-1.5"
          >
            去原始素材 <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredItems.map((item) => {
            const config = CONTENT_TYPE_CONFIG[item.content_type] || { label: item.content_type, icon: Layers, color: 'text-text-secondary' };
            const Icon = config.icon;
            const isSelected = selectedIds.has(item.id);
            const isExtracting = extractingId === item.id;

            return (
              <div key={item.id} className="glass-card p-4 flex items-start gap-4 group">
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
                    <span className="px-1.5 py-0.5 rounded-md text-[10px] border bg-white/[0.03] text-text-secondary border-white/[0.08]">{config.label}</span>
                    <BrainSideBadge side={item.brain_side} />
                  </div>
                  <p className="text-xs text-text-secondary mt-1.5 line-clamp-2 break-all">{getExcerpt(item.content_raw)}</p>
                  <div className="flex items-center gap-3 text-[10px] text-text-muted mt-2 flex-wrap">
                    <SourceLink url={item.source_url} />
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatDate(item.created_at)}</span>
                  </div>
                </div>
                <button
                  onClick={() => handleExtract(item)}
                  disabled={isExtracting || isBatchRunning}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.05] border border-white/[0.08] rounded-[2px] text-xs text-text-primary hover:bg-warning/10 hover:border-warning/30 hover:text-warning transition-all disabled:opacity-50 shrink-0"
                >
                  {isExtracting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Filter className="w-3.5 h-3.5" />}
                  抽取概念
                </button>
                <PipelineItemActions item={item} />
              </div>
            );
          })}
          {(stageCounts.card ?? 0) > (items?.length ?? 0) && (
            limit < 1000 ? (
              <button
                onClick={() => setLimit((l) => Math.min(l + 200, 1000))}
                className="w-full py-2.5 rounded-[2px] border border-white/[0.08] text-xs text-text-secondary hover:text-text-primary hover:bg-white/[0.04] transition-colors"
              >
                加载更多（已显示 {items?.length ?? 0} / 共 {stageCounts.card}）
              </button>
            ) : (
              <p className="text-center text-xs text-text-muted py-2">已达上限，请先处理当前卡片</p>
            )
          )}
        </div>
      )}
    </div>
  );
};

export default CardsPage;
