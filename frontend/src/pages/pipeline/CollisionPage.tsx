import { FC, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Shuffle, Search, Loader2, AlertCircle, X, CheckSquare, Square,
  ArrowRight, Zap, CheckCircle2, XCircle, Clock,
} from 'lucide-react';
import PipelineBrainToggle from './components/PipelineBrainToggle';
import PipelineStageBar from './components/PipelineStageBar';
import { useNavigation } from '@/store/navigation';
import { usePipelineStats, usePipelineItems, useReviewCollision, useCollideConcept } from '@/hooks/usePipeline';
import type { PipelineItem } from '@/api/pipeline';
import StageContextBanner from './components/StageContextBanner';
import ModelSelector from '@/components/llm/ModelSelector';
import ErrorState from '@/components/ErrorState';
import PipelineItemActions from './components/PipelineItemActions';

const CollisionPage: FC = () => {
  const navigate = useNavigate();
  const { brainSide } = useNavigation();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);
  const [actingId, setActingId] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string>('');
  // 审批弹窗：Electron 不支持 window.prompt（调用即抛错，曾导致批准静默失效），
  // 用内嵌弹窗同时承载确认与可选注记输入。
  const [reviewPrompt, setReviewPrompt] = useState<{ item: PipelineItem; action: 'approve' | 'reject' } | null>(null);
  const [feedbackText, setFeedbackText] = useState('');

  const { stats } = usePipelineStats(brainSide);
  const { items, isLoading: isItemsLoading, error: queryError, refetch } = usePipelineItems('collided', brainSide);
  const { items: conceptItems } = usePipelineItems('extracted', brainSide);
  const reviewCollision = useReviewCollision();
  const collideConcept = useCollideConcept();
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
    // Only show actual collision results in this stage; source concepts that were
    // moved to 'collided' stage should not appear here.
    let data = (items || []).filter((item) => item.content_subtype === 'collision_result');
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      data = data.filter((item) => (item.content_raw || '').toLowerCase().includes(q));
    }
    return data;
  }, [items, searchQuery]);

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

  const handleReview = (item: PipelineItem, action: 'approve' | 'reject') => {
    setError(null);
    setFeedbackText('');
    setReviewPrompt({ item, action });
  };

  const confirmReview = async () => {
    if (!reviewPrompt) return;
    const { item, action } = reviewPrompt;
    const feedback = feedbackText.trim() || undefined;
    setReviewPrompt(null);
    setActingId(item.id);
    try {
      await reviewCollision.mutateAsync({ collision_id: item.content_id, action, feedback });
    } catch (err: any) {
      setError(err.message || `${action === 'approve' ? '批准' : '拒绝'}失败`);
    } finally {
      setActingId(null);
    }
  };

  const handleBatchReview = async (action: 'approve' | 'reject') => {
    if (selectedIds.size === 0) return;
    const selected = filteredItems.filter((item) => selectedIds.has(item.id));
    if (!confirm(`确定${action === 'approve' ? '批准' : '拒绝'}选中的 ${selected.length} 个碰撞结果？`)) return;
    setIsBatchRunning(true);
    setBatchProgress(0);
    setError(null);
    let failed = 0;
    try {
      for (let i = 0; i < selected.length; i++) {
        try {
          await reviewCollision.mutateAsync({ collision_id: selected[i].content_id, action });
        } catch (err: any) {
          failed++;
          console.error('批量审批单项失败', selected[i].id, err);
        }
        setBatchProgress(i + 1);
      }
      if (failed > 0) {
        setError(`${selected.length - failed} 个成功，${failed} 个失败`);
      }
      setSelectedIds(new Set());
      if (action === 'approve' && failed === 0) {
        // 批量批准全部成功：自动进入下一阶段（注卡）
        navigate('/pipeline/annotate');
      }
    } catch (err: any) {
      setError(err.message || '批量操作失败');
    } finally {
      setIsBatchRunning(false);
    }
  };

  const handlePullFromExtracted = async () => {
    const candidates = (conceptItems || []).filter((item) => item.content_subtype === 'concept').slice(0, 10);
    if (candidates.length === 0) {
      setError('抽取阶段暂无核心概念可碰撞，请先在抽取页生成概念');
      return;
    }
    if (!confirm(`将对上一阶段 ${candidates.length} 个核心概念执行碰撞，这会调用 AI，确定继续？`)) return;
    setIsPulling(true);
    setError(null);
    setNotice(null);
    let failed = 0;
    const pairingCount: Record<string, number> = {};
    try {
      for (const item of candidates) {
        try {
          const resp = await collideConcept.mutateAsync({
            concept_id: item.content_id,
            preferred_model: modelId || undefined,
          });
          const p = (resp as any)?.pairing || 'embedding';
          pairingCount[p] = (pairingCount[p] || 0) + 1;
        } catch (err: any) {
          failed++;
          console.error('批量碰撞单项失败', item.id, err);
        }
      }
      const pairingLabels: Record<string, string> = {
        graphify: '语义图谱配对',
        embedding: '向量相似配对',
        recent: '最近概念配对',
      };
      const pairingSummary = Object.entries(pairingCount)
        .map(([k, v]) => `${pairingLabels[k] || k} ${v}`)
        .join(' · ');
      if (failed > 0) {
        setError(`${candidates.length - failed} 个碰撞成功，${failed} 个失败`);
      } else if (candidates.length > 0) {
        setNotice(`${candidates.length} 个碰撞完成（${pairingSummary}）`);
      }
    } catch (err: any) {
      setError(err.message || '从抽取阶段拉取失败');
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

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <Shuffle className="w-6 h-6 text-success" />
            碰撞
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            跨领域连接不同卡片，触发创意杂交与新的知识组合。
          </p>
        </div>
        <div className="flex flex-col items-start md:items-end gap-3">
          <PipelineBrainToggle stageAware />
          <PipelineStageBar counts={stageCounts} />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-end gap-3">
          <ModelSelector value={modelId} onChange={setModelId} taskType="creative" className="w-48" />
        </div>
        <StageContextBanner
          currentStage="collision"
          stageCounts={stageCounts}
          onPullFromPrevious={handlePullFromExtracted}
          isPulling={isPulling}
          pullLabel="一键碰撞前 10 个概念"
        />
      </div>

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

      {/* Success Notice */}
      {notice && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-[2px] bg-success/10 border border-success/30 text-success text-sm">
          <CheckCircle2 className="w-4 h-4" />
          {notice}
          <button onClick={() => setNotice(null)} className="ml-auto">
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
                placeholder="搜索碰撞洞见..."
                className="w-full bg-white/[0.03] border border-white/[0.08] rounded-[2px] pl-10 pr-4 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-info/40 transition-colors"
              />
            </div>
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
            {selectedIds.size > 0 && <span className="text-xs text-info">已选 {selectedIds.size} 个</span>}
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
            <button
              onClick={() => handleBatchReview('reject')}
              disabled={selectedIds.size === 0 || isBatchRunning}
              className="flex items-center gap-1.5 px-3 py-2 bg-white/[0.05] border border-white/[0.08] rounded-[2px] text-xs text-text-primary hover:bg-danger/10 hover:border-danger/30 hover:text-danger transition-all disabled:opacity-50"
            >
              <XCircle className="w-3.5 h-3.5" />
              批量拒绝
            </button>
            <button
              onClick={() => handleBatchReview('approve')}
              disabled={selectedIds.size === 0 || isBatchRunning}
              className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-[2px] text-xs font-medium hover:bg-[var(--accent-hover)] transition-all disabled:opacity-50"
            >
              {isBatchRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              {isBatchRunning ? `处理中 ${batchProgress}/${selectedIds.size}` : '批量批准'}
            </button>
          </div>
        </div>
      </div>

      {/* List */}
      {queryError && !isItemsLoading && (
        <ErrorState title="碰撞结果加载失败" message={queryError?.message || '无法获取数据'} onRetry={refetch} />
      )}
      {isItemsLoading ? (
        <div className="glass-card flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-info" />
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="glass-card flex flex-col items-center justify-center py-20 text-center">
          <Zap className="w-16 h-16 text-text-muted/40 mb-4" />
          <p className="text-text-secondary text-sm">暂无碰撞结果</p>
          <p className="text-text-muted text-xs mt-1">先去抽取页面对核心概念执行碰撞</p>
          <button
            onClick={() => navigate('/pipeline/extract')}
            className="mt-4 px-4 py-2 bg-white/[0.05] border border-white/[0.08] rounded-[2px] text-xs text-text-primary hover:bg-white/[0.08] transition-colors flex items-center gap-1.5"
          >
            去抽取 <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredItems.map((item) => {
            const isSelected = selectedIds.has(item.id);
            const isActing = actingId === item.id;

            return (
              <div key={item.id} className="glass-card p-4 flex items-start gap-4 group">
                <button
                  onClick={() => toggleSelect(item.id)}
                  className="mt-1 text-text-muted hover:text-info transition-colors"
                >
                  {isSelected ? <CheckSquare className="w-4 h-4 text-info" /> : <Square className="w-4 h-4" />}
                </button>
                <div className="mt-1 text-success">
                  <Zap className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-1.5 py-0.5 rounded-md text-[10px] border bg-success/10 text-success border-success/30">碰撞洞见</span>
                    {item.brain_side === 'both' ? (
                      <span className="badge-fusion text-[10px]">双脑</span>
                    ) : item.brain_side === 'personal' ? (
                      <span className="badge-personal text-[10px]">个人脑</span>
                    ) : (
                      <span className="badge-network text-[10px]">网络脑</span>
                    )}
                    <span className="flex items-center gap-1 text-[10px] text-text-muted"><Clock className="w-3 h-3" />{formatDate(item.created_at)}</span>
                  </div>
                  <p className="text-sm text-text-primary mt-2 leading-relaxed break-all">{item.content_raw}</p>
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  <button
                    onClick={() => handleReview(item, 'approve')}
                    disabled={isActing || isBatchRunning}
                    className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-success/10 border border-success/30 rounded-[2px] text-xs text-success hover:bg-success/20 transition-all disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    批准
                  </button>
                  <button
                    onClick={() => handleReview(item, 'reject')}
                    disabled={isActing || isBatchRunning}
                    className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-white/[0.05] border border-white/[0.08] rounded-[2px] text-xs text-text-secondary hover:bg-danger/10 hover:border-danger/30 hover:text-danger transition-all disabled:opacity-50"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    拒绝
                  </button>
                  <PipelineItemActions item={item} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 审批确认弹窗（替代 Electron 不支持的 window.prompt） */}
      {reviewPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="glass-card p-5 w-full max-w-md">
            <h3 className="text-sm font-medium text-text-primary">
              {reviewPrompt.action === 'approve' ? '批准碰撞洞见' : '拒绝碰撞结果'}
            </h3>
            <p className="text-xs text-text-secondary mt-2 leading-relaxed">
              {reviewPrompt.action === 'approve'
                ? reviewPrompt.item.brain_side === 'network'
                  ? '批准将把这条网络脑碰撞洞见转入个人脑并注卡。'
                  : '批准后将进入注卡阶段，成为个人知识库的一部分。'
                : '拒绝后这条碰撞结果将被标记为拒绝。'}
            </p>
            <textarea
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              rows={3}
              autoFocus
              placeholder={
                reviewPrompt.action === 'approve'
                  ? '添加个人注记（可选，会保存到卡片个人语境中）'
                  : '拒绝原因（可选）'
              }
              className="mt-3 w-full px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded-[2px] text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-info/50 resize-none"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setReviewPrompt(null)}
                className="px-3 py-1.5 bg-white/[0.05] border border-white/[0.08] rounded-[2px] text-xs text-text-secondary hover:bg-white/[0.08] transition-colors"
              >
                取消
              </button>
              <button
                onClick={confirmReview}
                className={
                  reviewPrompt.action === 'approve'
                    ? 'px-3 py-1.5 bg-success/10 border border-success/30 rounded-[2px] text-xs text-success hover:bg-success/20 transition-colors'
                    : 'px-3 py-1.5 bg-danger/10 border border-danger/30 rounded-[2px] text-xs text-danger hover:bg-danger/20 transition-colors'
                }
              >
                {reviewPrompt.action === 'approve' ? '批准' : '拒绝'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CollisionPage;
