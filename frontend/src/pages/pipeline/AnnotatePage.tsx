import { FC, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Pencil, Search, Loader2, ArrowRight, Sparkles, Clock,
  CheckCircle2, Dumbbell, TrendingUp, AlertCircle, X
} from 'lucide-react';
import PipelineBrainToggle from './components/PipelineBrainToggle';
import PipelineStageBar from './components/PipelineStageBar';
import AnnotateCardModal from './components/AnnotateCardModal';
import { useNavigation } from '@/store/navigation';
import { useSettings } from '@/store/settings';
import { usePipelineStats, usePipelineItems, useReviewCollision } from '@/hooks/usePipeline';
import { useUpdateKnowledgeUnit } from '@/hooks/useKnowledge';
import StageContextBanner from './components/StageContextBanner';
import { BrainSideBadge, SourceLink } from './components/PipelineHelpers';
import ErrorState from '@/components/ErrorState';

const AnnotatePage: FC = () => {
  const navigate = useNavigate();
  const { brainSide } = useNavigation();
  const isClassic = useSettings((s) => s.uiMode === 'classic');
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<import('@/api/pipeline').PipelineItem | null>(null);

  // 注卡阶段的内容（批准的碰撞洞见）一律落在个人脑；用户手动停在网络脑侧时
  // 按个人脑查询，否则刚批准的内容在本页不可见（「要刷新才显示」的根因之一）
  const effectiveSide = brainSide === 'network' ? 'personal' : brainSide;

  const { stats } = usePipelineStats(effectiveSide);
  // 递增加载：后端按 limit 截断且无 offset，靠放大 limit 重取；上限与后端 le=1000 对齐
  const [limit, setLimit] = useState(50);
  const { items, isLoading: isItemsLoading, error: queryError, refetch } = usePipelineItems('approved', effectiveSide, limit);
  const { items: collisionItems } = usePipelineItems('collided', effectiveSide);
  const reviewCollision = useReviewCollision();
  const updateUnit = useUpdateKnowledgeUnit();
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
      data = data.filter((item) => (item.content_raw || '').toLowerCase().includes(q));
    }
    return data;
  }, [items, searchQuery]);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handlePullFromCollision = async () => {
    const candidates = (collisionItems || [])
      .filter((item) => item.content_subtype === 'collision_result')
      .slice(0, 10);
    if (candidates.length === 0) return;
    if (!confirm(`将批准上一阶段 ${candidates.length} 个碰撞结果进入注卡，确定继续？`)) return;
    setIsPulling(true);
    setError(null);
    let failed = 0;
    try {
      for (const item of candidates) {
        try {
          await reviewCollision.mutateAsync({ collision_id: item.content_id, action: 'approve' });
        } catch (err: any) {
          failed++;
          console.error('批准碰撞结果单项失败', item.id, err);
        }
      }
      if (failed > 0) {
        setError(`${candidates.length - failed} 个批准成功，${failed} 个失败`);
      }
    } catch (err: any) {
      setError(err.message || '从碰撞阶段拉取失败');
    } finally {
      setIsPulling(false);
    }
  };

  const handleSaveAnnotation = async (id: string, data: import('@/api/knowledge').KnowledgeUpdateData) => {
    await updateUnit.mutateAsync({ id, data });
    setSavedToast({ id });
    setTimeout(() => setSavedToast(null), 6000);
  };

  const [savedToast, setSavedToast] = useState<{ id: string } | null>(null);

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-5">
      {/* 注卡完成去向提示 */}
      {savedToast && (
        <div className="fixed bottom-6 right-6 z-50 glass-card px-4 py-3 rounded-xl flex items-center gap-3 text-sm border border-success/30">
          <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
          <span className="text-text-primary">已注卡，归入个人脑知识，问答检索已加权</span>
          <button
            onClick={() => navigate(`/knowledge/${savedToast.id}`)}
            className="text-xs text-info hover:underline shrink-0"
          >
            查看知识
          </button>
          <button onClick={() => setSavedToast(null)} className="text-text-muted hover:text-text-primary shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      <AnnotateCardModal
        isOpen={!!editingItem}
        onClose={() => setEditingItem(null)}
        item={editingItem}
        onSave={handleSaveAnnotation}
        isSaving={updateUnit.isPending}
      />
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <Pencil className="w-6 h-6 text-personal-primary" />
            注卡
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            为卡片注入个人语境、情绪、身体状态与下一步行动，完成知识的个人化。
          </p>
        </div>
        <div className="flex flex-col items-start md:items-end gap-3">
          <PipelineBrainToggle stageAware />
          <PipelineStageBar counts={stageCounts} />
        </div>
      </div>

      <StageContextBanner
        currentStage="annotate"
        stageCounts={stageCounts}
        onPullFromPrevious={handlePullFromCollision}
        isPulling={isPulling}
        pullLabel="一键批准前 10 个碰撞结果"
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
      <div className="glass-card p-4">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索已批准的洞见..."
                className="w-full bg-white/[0.03] border border-white/[0.08] rounded-[2px] pl-10 pr-4 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-info/40 transition-colors"
              />
            </div>
          </div>
        </div>
      </div>

      {/* List */}
      {queryError && !isItemsLoading && (
        <ErrorState title="已注卡内容加载失败" message={queryError?.message || '无法获取数据'} onRetry={refetch} />
      )}
      {isItemsLoading ? (
        <div className="glass-card flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-info" />
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="glass-card flex flex-col items-center justify-center py-20 text-center">
          <CheckCircle2 className="w-16 h-16 text-text-muted/40 mb-4" />
          <p className="text-text-secondary text-sm">暂无已批准的洞见</p>
          <p className="text-text-muted text-xs mt-1">先去碰撞页面批准碰撞结果</p>
          <button
            onClick={() => navigate('/pipeline/collision')}
            className="mt-4 px-4 py-2 bg-white/[0.05] border border-white/[0.08] rounded-[2px] text-xs text-text-primary hover:bg-white/[0.08] transition-colors flex items-center gap-1.5"
          >
            去碰撞 <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredItems.map((item) => {
            return (
              <div
                key={item.id}
                className="glass-card p-4 flex items-start gap-4 hover:border-info/20 hover:bg-white/[0.04] transition-colors group"
              >
                <div
                  className="flex-1 min-w-0 cursor-pointer"
                  onClick={() => navigate(`/knowledge/${item.content_id}`)}
                >
                  <div className="flex items-start gap-4">
                    <div className="mt-1 text-personal-primary">
                      <Sparkles className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-1.5 py-0.5 rounded-md text-[10px] border bg-personal-primary/10 text-personal-primary border-personal-primary/30">已注卡</span>
                        <BrainSideBadge side={item.brain_side} />
                      </div>
                      <p className="text-sm text-text-primary mt-2 leading-relaxed break-all">{item.content_raw}</p>
                      <div className="flex items-center gap-3 text-[10px] text-text-muted mt-2 flex-wrap">
                        <SourceLink url={item.source_url} />
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatDate(item.created_at)}</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  <button
                    onClick={() => setEditingItem(item)}
                    className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-personal-primary/10 border border-personal-primary/30 rounded-[2px] text-xs text-personal-primary hover:bg-personal-primary/20 transition-colors"
                    title="编辑这条知识的个人语境"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    编辑注卡
                  </button>
                  {isClassic && (
                    <>
                      <button
                        onClick={() => navigate(`/social-brain/practice-records?target_id=${item.content_id}&target_type=knowledge_unit`)}
                        className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-warning/10 border border-warning/30 rounded-[2px] text-xs text-warning hover:bg-warning/20 transition-colors"
                        title="记录这条知识的落地实践"
                      >
                        <Dumbbell className="w-3.5 h-3.5" />
                        记录实操
                      </button>
                      <button
                        onClick={() => navigate(`/social-brain/evolution-track?id=${item.content_id}`)}
                        className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-fusion-primary/10 border border-fusion-primary/30 rounded-[2px] text-xs text-fusion-primary hover:bg-fusion-primary/20 transition-colors"
                        title="查看这条知识从采集到注卡的进化轨迹"
                      >
                        <TrendingUp className="w-3.5 h-3.5" />
                        进化轨迹
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
          {(stageCounts.annotate ?? 0) > (items?.length ?? 0) && (
            limit < 1000 ? (
              <button
                onClick={() => setLimit((l) => Math.min(l + 200, 1000))}
                className="w-full py-2.5 rounded-[2px] border border-white/[0.08] text-xs text-text-secondary hover:text-text-primary hover:bg-white/[0.04] transition-colors"
              >
                加载更多（已显示 {items?.length ?? 0} / 共 {stageCounts.annotate}）
              </button>
            ) : (
              <p className="text-center text-xs text-text-muted py-2">已达上限</p>
            )
          )}
        </div>
      )}
    </div>
  );
};

export default AnnotatePage;
