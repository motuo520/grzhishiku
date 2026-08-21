import { FC, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Filter, Search, Globe, BookOpen, FileText, FolderOpen, Rss,
  Layers, Clock, Loader2, AlertCircle, X, CheckSquare, Square,
  ArrowRight, Sparkles, Shuffle, Brain, CheckCircle2,
} from 'lucide-react';
import PipelineBrainToggle from './components/PipelineBrainToggle';
import PipelineStageBar from './components/PipelineStageBar';
import { useNavigation } from '@/store/navigation';
import { useSettings } from '@/store/settings';
import { usePipelineStats, usePipelineItems, useCollideConcept, useExtractConcepts, useTransitionItem } from '@/hooks/usePipeline';
import type { PipelineItem } from '@/api/pipeline';
import StageContextBanner from './components/StageContextBanner';
import ModelSelector from '@/components/llm/ModelSelector';
import { BrainSideBadge, SourceLink } from './components/PipelineHelpers';
import ErrorState from '@/components/ErrorState';
import PipelineItemActions from './components/PipelineItemActions';
import CollisionPartnerModal from './components/CollisionPartnerModal';

const CONTENT_TYPE_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  note: { label: '笔记', icon: FileText, color: 'text-personal-primary' },
  knowledge: { label: '知识', icon: Layers, color: 'text-info' },
  clip: { label: '剪藏', icon: Globe, color: 'text-network-primary' },
  rss: { label: 'RSS', icon: Rss, color: 'text-warning' },
  read_later: { label: '稍后读', icon: BookOpen, color: 'text-network-secondary' },
  document: { label: '文档', icon: FolderOpen, color: 'text-text-secondary' },
};

type SubtypeFilter = 'all' | 'concept' | 'source';

const ExtractPage: FC = () => {
  const navigate = useNavigate();
  const { brainSide } = useNavigation();
  const isClassic = useSettings((s) => s.uiMode === 'classic');
  const [searchQuery, setSearchQuery] = useState('');
  const [subtypeFilter, setSubtypeFilter] = useState<SubtypeFilter>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);
  const [batchTotal, setBatchTotal] = useState(0);
  const [collidingId, setCollidingId] = useState<string | null>(null);
  const [partnerModalItem, setPartnerModalItem] = useState<PipelineItem | null>(null);
  const [extractModelId, setExtractModelId] = useState<string>('');
  const [collideModelId, setCollideModelId] = useState<string>('');

  const { stats } = usePipelineStats(brainSide);
  // 递增加载：后端按 limit 截断且无 offset，靠放大 limit 重取；上限与后端 le=1000 对齐
  const [limit, setLimit] = useState(50);
  const { items, isLoading: isItemsLoading, error: queryError, refetch } = usePipelineItems('extracted', brainSide, limit);
  const { items: cardItems } = usePipelineItems('card', brainSide);
  const collideConcept = useCollideConcept();
  const transitionItem = useTransitionItem();
  const extractConcepts = useExtractConcepts();
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

  const conceptCount = useMemo(() => (items || []).filter((i) => i.content_subtype === 'concept').length, [items]);

  const filteredItems = useMemo(() => {
    let data = items || [];
    if (subtypeFilter === 'concept') {
      data = data.filter((item) => item.content_subtype === 'concept');
    } else if (subtypeFilter === 'source') {
      data = data.filter((item) => item.content_subtype !== 'concept');
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      data = data.filter(
        (item) =>
          (item.title || '').toLowerCase().includes(q) ||
          (item.content_raw || '').toLowerCase().includes(q)
      );
    }
    return data;
  }, [items, subtypeFilter, searchQuery]);

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

  const handleCollide = (item: PipelineItem) => {
    if (item.content_subtype !== 'concept') return;
    setPartnerModalItem(item);
  };

  const handleConfirmCollide = async (partnerId: string) => {
    const item = partnerModalItem;
    if (!item) return;
    setError(null);
    setCollidingId(item.id);
    try {
      await collideConcept.mutateAsync({
        concept_id: item.content_id,
        preferred_model: collideModelId || undefined,
        partner_id: partnerId,
      });
      setPartnerModalItem(null);
    } catch (err: any) {
      setError(err.message || '碰撞失败');
      setPartnerModalItem(null);
    } finally {
      setCollidingId(null);
    }
  };

  // 免编辑注卡：不开编辑器，直接把概念转入注卡完成态（approved）
  const handleQuickAnnotate = async (item: PipelineItem) => {
    setError(null);
    try {
      await transitionItem.mutateAsync({
        content_type: 'knowledge',
        content_id: item.content_id,
        stage: 'approved',
      });
    } catch (err: any) {
      setError(err.message || '注卡失败');
    }
  };

  // 原出处直达：按来源类型跳到那条内容（笔记/知识有详情页，其余落对应列表页）
  const sourcePathFor = (item: PipelineItem): string => {
    const sid = item.source_id || '';
    switch (item.source_content_type) {
      case 'note': return `/ingest/notes/${sid}`;
      case 'knowledge': return `/knowledge/${sid}`;
      case 'clip': return '/ingest/clipper';
      case 'rss': return '/ingest/rss';
      case 'read_later': return '/ingest/read-later';
      case 'document': return '/ingest/documents';
      default: return '/ingest/notes';
    }
  };

  const handleBatchCollide = async () => {
    const chosen = filteredItems.filter((item) => selectedIds.has(item.id));
    if (chosen.length === 0) return;
    const conceptSel = chosen.filter((item) => item.content_subtype === 'concept');
    const sourceSel = chosen.filter((item) => item.content_subtype !== 'concept');

    // First checkpoint: consent to extraction (costs AI). When only concepts are
    // selected the collision count is already known, so this single confirm covers it.
    const summary = sourceSel.length > 0
      ? `将先从 ${sourceSel.length} 张卡片抽取概念（调用 AI），每张取 1 个主概念。完成后会显示实际碰撞次数，再次确认后才碰撞。确定开始？`
      : `将对选中的 ${conceptSel.length} 个概念逐个碰撞 ${conceptSel.length} 次（每次调用 AI 生成跨界洞见）。确定继续？`;
    if (!confirm(summary)) return;

    setIsBatchRunning(true);
    setBatchProgress(0);
    setError(null);
    let failed = 0;
    let extractFailed = 0;
    let collidedCount = 0;
    try {
      // 1) Extract concepts from any selected source cards first. Option (a): collide
      //    only the primary (first) concept per card, so N cards => at most N collisions.
      //    The other extracted concepts stay in the list for manual collision.
      const conceptIds: string[] = conceptSel.map((c) => c.content_id);
      for (const src of sourceSel) {
        try {
          const res = await extractConcepts.mutateAsync({
            content_type: src.content_type,
            content_id: src.content_id,
            preferred_model: extractModelId || undefined,
          });
          const ids = (res?.concepts || []).map((c: any) => c.id).filter(Boolean);
          if (ids.length > 0) conceptIds.push(ids[0]);
        } catch (err) {
          failed++;
          extractFailed++;
          console.error('批量碰撞-抽取概念失败', src.id, err);
        }
      }

      // 2) Collide each concept
      if (conceptIds.length === 0) {
        setError(
          extractFailed > 0
            ? '概念抽取调用出错（可能是网络或 AI 响应超时），请稍后重试'
            : '这些卡片未抽取出跨学科概念（内容偏事实罗列或单一领域时属正常），可换卡片重试'
        );
        return;
      }

      // Second checkpoint (option b): extraction has produced the real concept count, so
      // confirm the exact number of collision calls before spending them.
      if (sourceSel.length > 0) {
        const ok = confirm(
          `已汇集 ${conceptIds.length} 个概念用于碰撞（已选 ${conceptSel.length} 个 + 卡片主概念 ${conceptIds.length - conceptSel.length} 个）。将逐个碰撞 ${conceptIds.length} 次，每次调用 AI。确定继续？`
        );
        if (!ok) {
          // Extraction already persisted the concepts and refreshed the list; abort the
          // collisions so nothing else is spent. Selection is kept for a later collide.
          return;
        }
      }

      setBatchTotal(conceptIds.length);
      for (let i = 0; i < conceptIds.length; i++) {
        try {
          await collideConcept.mutateAsync({
            concept_id: conceptIds[i],
            preferred_model: collideModelId || undefined,
          });
          collidedCount++;
        } catch (err: any) {
          failed++;
          console.error('批量碰撞单项失败', conceptIds[i], err);
        }
        setBatchProgress(i + 1);
      }
      if (failed > 0) {
        setError(`${collidedCount} 个碰撞成功，${failed} 项失败`);
      }
      setSelectedIds(new Set());
      if (failed === 0 && collidedCount > 0) {
        // 全部成功：自动进入下一阶段（碰撞结果审批）
        navigate('/pipeline/collision');
      }
    } catch (err: any) {
      setError(err.message || '批量碰撞失败');
    } finally {
      setIsBatchRunning(false);
    }
  };

  const handlePullFromCards = async () => {
    const candidates = (cardItems || []).slice(0, 10);
    if (candidates.length === 0) {
      setError('卡片化阶段暂无卡片可抽取');
      return;
    }
    if (!confirm(`将对上一阶段 ${candidates.length} 张卡片抽取概念，这会调用 AI，确定继续？`)) return;
    setIsPulling(true);
    setError(null);
    let failed = 0;
    try {
      for (const item of candidates) {
        try {
          await extractConcepts.mutateAsync({
            content_type: item.content_type,
            content_id: item.content_id,
            preferred_model: extractModelId || undefined,
          });
        } catch (err: any) {
          failed++;
          console.error('从卡片化拉取单项失败', item.id, err);
        }
      }
      if (failed > 0) {
        setError(`${candidates.length - failed} 张抽取成功，${failed} 张失败`);
      }
    } catch (err: any) {
      setError(err.message || '从卡片化拉取失败');
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

  const getExcerpt = (content?: string | null, maxLen = 180) => {
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
            <Filter className="w-6 h-6 text-warning" />
            抽取
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            从卡片中提取核心概念、思维模型、可执行的行动建议。
          </p>
        </div>
        <div className="flex flex-col items-start md:items-end gap-3">
          <PipelineBrainToggle stageAware />
          <PipelineStageBar counts={stageCounts} />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-end gap-3">
          <ModelSelector value={extractModelId} onChange={setExtractModelId} taskType="analysis" className="w-48" />
        </div>
        <StageContextBanner
          currentStage="extract"
          stageCounts={stageCounts}
          onPullFromPrevious={handlePullFromCards}
          isPulling={isPulling}
          pullLabel="一键抽取前 10 张卡片"
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
                placeholder="搜索概念、来源卡片..."
                className="w-full bg-white/[0.03] border border-white/[0.08] rounded-[2px] pl-10 pr-4 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-info/40 transition-colors"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {[
              { key: 'all', label: '全部' },
              { key: 'concept', label: `核心概念 ${conceptCount > 0 ? `(${conceptCount})` : ''}` },
              { key: 'source', label: '来源卡片' },
            ].map((opt) => (
              <button
                key={opt.key}
                onClick={() => setSubtypeFilter(opt.key as SubtypeFilter)}
                className={`px-2.5 py-1 rounded-[2px] text-xs border transition-all ${subtypeFilter === opt.key ? 'bg-info/15 text-info border-info/30' : 'bg-white/[0.03] text-text-secondary border-white/[0.08] hover:bg-white/[0.06]'}`}
              >
                {opt.label}
              </button>
            ))}
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
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-3">
              <ModelSelector value={collideModelId} onChange={setCollideModelId} taskType="creative" className="w-48" />
            </div>
            <button
              onClick={handleBatchCollide}
              disabled={selectedIds.size === 0 || isBatchRunning}
              className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-[2px] text-sm font-medium hover:bg-[var(--accent-hover)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isBatchRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shuffle className="w-4 h-4" />}
              {isBatchRunning ? `碰撞中 ${batchProgress}/${batchTotal || selectedIds.size}` : '批量碰撞'}
            </button>
          </div>
        </div>
      </div>

      {/* List */}
      {queryError && !isItemsLoading && (
        <ErrorState title="抽取结果加载失败" message={queryError?.message || '无法获取数据'} onRetry={refetch} />
      )}
      {isItemsLoading ? (
        <div className="glass-card flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-info" />
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="glass-card flex flex-col items-center justify-center py-20 text-center">
          <Brain className="w-16 h-16 text-text-muted/40 mb-4" />
          <p className="text-text-secondary text-sm">暂无抽取结果</p>
          <p className="text-text-muted text-xs mt-1">先去卡片化页面对卡片抽取概念</p>
          <button
            onClick={() => navigate('/pipeline/cards')}
            className="mt-4 px-4 py-2 bg-white/[0.05] border border-white/[0.08] rounded-[2px] text-xs text-text-primary hover:bg-white/[0.08] transition-colors flex items-center gap-1.5"
          >
            去卡片化 <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredItems.map((item) => {
            const config = CONTENT_TYPE_CONFIG[item.content_type] || { label: item.content_type, icon: Layers, color: 'text-text-secondary' };
            const Icon = config.icon;
            const isSelected = selectedIds.has(item.id);
            const isColliding = collidingId === item.id;
            const isConcept = item.content_subtype === 'concept';

            return (
              <div key={item.id} className="glass-card p-4 flex items-start gap-4 group">
                <button
                  onClick={() => toggleSelect(item.id)}
                  className="mt-1 text-text-muted hover:text-info transition-colors"
                >
                  {isSelected ? <CheckSquare className="w-4 h-4 text-info" /> : <Square className="w-4 h-4" />}
                </button>
                <div className={`mt-1 ${isConcept ? 'text-warning' : config.color}`}>
                  {isConcept ? <Sparkles className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {isConcept ? (
                      <span className="text-sm font-medium text-text-primary truncate max-w-[260px]">概念</span>
                    ) : (
                      <span className="text-sm font-medium text-text-primary truncate max-w-[260px]">{item.title || '无标题'}</span>
                    )}
                    <span className="px-1.5 py-0.5 rounded-md text-[10px] border bg-white/[0.03] text-text-secondary border-white/[0.08]">
                      {isConcept ? '核心概念' : config.label}
                    </span>
                    <BrainSideBadge side={item.brain_side} />
                  </div>
                  <p className="text-xs text-text-secondary mt-1.5 break-all">{getExcerpt(item.content_raw)}</p>
                  <div className="flex items-center gap-3 text-[10px] text-text-muted mt-2 flex-wrap">
                    <SourceLink url={item.source_url} />
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatDate(item.created_at)}</span>
                  </div>
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  {isConcept && (
                    <>
                      <button
                        onClick={() => handleCollide(item)}
                        disabled={isColliding || isBatchRunning}
                        className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-white/[0.05] border border-white/[0.08] rounded-[2px] text-xs text-text-primary hover:bg-success/10 hover:border-success/30 hover:text-success transition-all disabled:opacity-50"
                      >
                        {isColliding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Shuffle className="w-3.5 h-3.5" />}
                        碰撞
                      </button>
                      {/* 免编辑注卡：不开编辑器，直接转入注卡完成态（想细琢的走 编辑注卡） */}
                      <button
                        onClick={() => handleQuickAnnotate(item)}
                        disabled={transitionItem.isPending}
                        className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-personal-primary/10 border border-personal-primary/30 rounded-[2px] text-xs text-personal-primary hover:bg-personal-primary/20 transition-all disabled:opacity-50"
                        title="不做编辑，直接把这条概念归入个人脑知识（注卡完成态）"
                      >
                        {transitionItem.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                        直接注卡
                      </button>
                      {/* 原出处直达：这概念是从哪条内容抽出来的 */}
                      {item.source_id && (
                        <button
                          onClick={() => navigate(sourcePathFor(item))}
                          className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-white/[0.03] border border-white/[0.08] rounded-[2px] text-xs text-text-secondary hover:text-text-primary hover:bg-white/[0.06] transition-all"
                          title="查看这概念抽取自哪条内容"
                        >
                          <BookOpen className="w-3.5 h-3.5" />
                          原出处
                        </button>
                      )}
                      {isClassic && (
                        <button
                          onClick={() => navigate(`/social-brain/relevance-check?content=${encodeURIComponent(item.content_raw)}`)}
                          className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-danger/10 border border-danger/30 rounded-[2px] text-xs text-danger hover:bg-danger/20 transition-colors"
                          title="判断这个概念与你是否相关"
                        >
                          <Filter className="w-3.5 h-3.5" />
                          关我屁事
                        </button>
                      )}
                    </>
                  )}
                  <PipelineItemActions item={item} />
                </div>
              </div>
            );
          })}
          {(stageCounts.extract ?? 0) > (items?.length ?? 0) && (
            limit < 1000 ? (
              <button
                onClick={() => setLimit((l) => Math.min(l + 200, 1000))}
                className="w-full py-2.5 rounded-[2px] border border-white/[0.08] text-xs text-text-secondary hover:text-text-primary hover:bg-white/[0.04] transition-colors"
              >
                加载更多（已显示 {items?.length ?? 0} / 共 {stageCounts.extract}）
              </button>
            ) : (
              <p className="text-center text-xs text-text-muted py-2">已达上限，请先处理当前概念</p>
            )
          )}
        </div>
      )}

      {/* 单条概念碰撞：选择对手弹窗 */}
      <CollisionPartnerModal
        isOpen={partnerModalItem !== null}
        onClose={() => setPartnerModalItem(null)}
        conceptId={partnerModalItem?.content_id || ''}
        conceptTitle={getExcerpt(partnerModalItem?.content_raw, 60) || partnerModalItem?.title || ''}
        brainSide={brainSide}
        onConfirm={handleConfirmCollide}
        isConfirming={collidingId !== null}
      />
    </div>
  );
};

export default ExtractPage;