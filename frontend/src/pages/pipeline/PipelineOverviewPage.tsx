import { FC, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Workflow, Database, SquareStack, Filter, Shuffle, Pencil, ArrowRight,
  Layers, Clock, Globe, BookOpen, FileText, FolderOpen, Rss,
  Loader2, AlertCircle, X, Play, Sparkles, TrendingUp, CheckSquare, Square, Calendar,
} from 'lucide-react';
import PipelineBrainToggle from './components/PipelineBrainToggle';
import PipelineStageBar from './components/PipelineStageBar';
import { useNavigation } from '@/store/navigation';
import ErrorState from '@/components/ErrorState';
import {
  usePipelineStats,
  usePipelineItems,
  useRecentPipelineItems,
  useTransitionItem,
  useExtractConcepts,
  useCollideConcept,
} from '@/hooks/usePipeline';
import type { PipelineItem } from '@/api/pipeline';

const STAGE_CONFIG = [
  { id: 'raw', key: 'raw', label: '原始素材', desc: '剪藏、书摘、笔记、语音', icon: Database, path: '/pipeline/raw', color: 'bg-info/10' },
  { id: 'card', key: 'card', label: '卡片化', desc: '切割为可复用的原子卡片', icon: SquareStack, path: '/pipeline/cards', color: 'bg-fusion-primary/10' },
  { id: 'extract', key: 'extracted', label: '抽取', desc: '提取概念、模型、行动建议', icon: Filter, path: '/pipeline/extract', color: 'bg-warning/10' },
  { id: 'collision', key: 'collided', label: '碰撞', desc: '跨领域连接与创意杂交', icon: Shuffle, path: '/pipeline/collision', color: 'bg-success/10' },
  { id: 'annotate', key: 'approved', label: '注卡', desc: '注入个人语境与下一步行动', icon: Pencil, path: '/pipeline/annotate', color: 'bg-personal-primary/10' },
];

const CONTENT_TYPE_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  note: { label: '笔记', icon: FileText, color: 'text-personal-primary' },
  knowledge: { label: '知识单元', icon: Layers, color: 'text-info' },
  clip: { label: '剪藏', icon: Globe, color: 'text-network-primary' },
  rss: { label: 'RSS', icon: Rss, color: 'text-warning' },
  read_later: { label: '稍后读', icon: BookOpen, color: 'text-network-secondary' },
  document: { label: '文档', icon: FolderOpen, color: 'text-text-secondary' },
};

const PipelineOverviewPage: FC = () => {
  const navigate = useNavigate();
  const { brainSide } = useNavigation();
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [runProgress, setRunProgress] = useState(0);
  const [selectedRawIds, setSelectedRawIds] = useState<Set<string>>(new Set());
  const [showSelector, setShowSelector] = useState(true);

  const { stats, isLoading: isStatsLoading, error: statsError, refetch: refetchStats } = usePipelineStats(brainSide);
  const { items: rawItems, error: rawError, refetch: refetchRaw } = usePipelineItems('raw', brainSide);
  const { items: recentItems, isLoading: isRecentLoading, error: recentError, refetch: refetchRecent } = useRecentPipelineItems(brainSide, 5);
  const transitionItem = useTransitionItem();
  const extractConcepts = useExtractConcepts();
  const collideConcept = useCollideConcept();
  const [runSummary, setRunSummary] = useState<string | null>(null);

  // 默认全选原始素材，用户可以取消勾选来控制一键管线的范围
  useEffect(() => {
    if (rawItems && rawItems.length > 0) {
      setSelectedRawIds((prev) => (prev.size === 0 ? new Set(rawItems.map((item) => item.id)) : prev));
    }
  }, [rawItems]);

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

  const totalItems = useMemo(() => {
    return (stats?.raw || 0) + (stats?.card || 0) + (stats?.extracted || 0) + (stats?.collided || 0) + (stats?.approved || 0);
  }, [stats]);

  const handleRunPipeline = async () => {
    const targets = selectedRawIds.size > 0
      ? (rawItems || []).filter((item) => selectedRawIds.has(item.id))
      : (rawItems || []);
    if (targets.length === 0) return;
    const n = targets.length;
    // Real one-click pipeline: run each raw item through card -> extract -> collide.
    // Upfront estimate so the user knows the AI cost before anything is spent.
    if (!confirm(
      `将对 ${n} 条原始素材串跑完整管线：卡片化 → 抽取 → 碰撞（每条取 1 个主概念碰撞）。\n` +
      `每条最多 2 次 AI 调用，共最多 ${n * 2} 次，会消耗 AI 额度。确定开始？`
    )) return;
    setIsRunning(true);
    setRunProgress(0);
    setError(null);
    setRunSummary(null);
    let done = 0;
    let failed = 0;
    let collisions = 0;
    try {
      for (let i = 0; i < targets.length; i++) {
        const item = targets[i];
        try {
          // 1) raw -> card (returns the card ref: note id, or new knowledge id for external items)
          const card = await transitionItem.mutateAsync({
            content_type: item.content_type,
            content_id: item.content_id,
            stage: 'card',
          });
          // 2) card -> extract concepts (AI)
          const ext = await extractConcepts.mutateAsync({
            content_type: card.content_type,
            content_id: card.content_id,
            preferred_model: undefined,
          });
          const ids = (ext?.concepts || []).map((c: any) => c.id).filter(Boolean);
          // 3) collide the primary concept only (AI) — 1 per card, matching the extract page
          if (ids.length > 0) {
            await collideConcept.mutateAsync({ concept_id: ids[0], preferred_model: undefined });
            collisions++;
          }
          done++;
        } catch (err) {
          failed++;
          console.error('一键管线单项失败', item.id, err);
        }
        setRunProgress(i + 1);
      }
      setRunSummary(
        `管线完成：${done} 条处理成功，产生 ${collisions} 条碰撞${failed > 0 ? `，${failed} 条失败` : ''}。`
      );
      setSelectedRawIds(new Set());
      refetchStats();
      refetchRaw();
      refetchRecent();
      // Stay on the overview so the live-updated funnel and the summary banner are
      // visible; the user can click into 碰撞 to review the new insights.
    } catch (err: any) {
      setError(err.message || '一键运行管线失败');
    } finally {
      setIsRunning(false);
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

  const getExcerpt = (content?: string | null, maxLen = 120) => {
    if (!content) return '';
    const plain = content.replace(/[#*`[\]()]/g, '').replace(/\s+/g, ' ').trim();
    return plain.length > maxLen ? plain.slice(0, maxLen) + '...' : plain;
  };

  const renderRecentItem = (item: PipelineItem) => {
    const config = CONTENT_TYPE_CONFIG[item.content_type] || { label: item.content_type, icon: Layers, color: 'text-text-secondary' };
    const Icon = config.icon;
    const stageInfo = STAGE_CONFIG.find((s) => s.key === item.pipeline_stage) || STAGE_CONFIG[0];
    const domain = item.source_url ? (() => { try { return new URL(item.source_url).hostname; } catch { return item.source_url; } })() : null;

    return (
      <div
        key={item.id}
        onClick={() => navigate(stageInfo.path)}
        className="flex items-start gap-3 p-3 rounded-[2px] bg-white/[0.02] border border-white/[0.06] hover:border-info/20 hover:bg-white/[0.04] cursor-pointer transition-colors"
      >
        <div className={`mt-0.5 ${config.color}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-text-primary truncate max-w-[200px]">{item.title || '无标题'}</span>
            <span className="px-1.5 py-0.5 rounded-md text-[10px] border bg-white/[0.03] text-text-secondary border-white/[0.08]">{config.label}</span>
            <span className="px-1.5 py-0.5 rounded-md text-[10px] border bg-info/10 text-info border-info/30">{stageInfo.label}</span>
          </div>
          <p className="text-xs text-text-secondary mt-1 line-clamp-2 break-all">{getExcerpt(item.content_raw)}</p>
          <div className="flex items-center gap-3 text-[10px] text-text-muted mt-1.5 flex-wrap">
            {domain && <span className="truncate max-w-[160px]">{domain}</span>}
            <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatDate(item.created_at)}</span>
          </div>
        </div>
        <ArrowRight className="w-3.5 h-3.5 text-text-muted shrink-0 mt-1" />
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <Workflow className="w-6 h-6 text-info" />
            认知生产管线
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            知识不是仓库，是一条阶段化生产线：原始 → 卡片 → 抽取 → 碰撞 → 注卡。
          </p>
        </div>
        <div className="flex flex-col items-start md:items-end gap-3">
          <PipelineBrainToggle stageAware />
          <PipelineStageBar counts={stageCounts} />
        </div>
      </div>

      {/* Query Error Banner */}
      {(statsError || rawError || recentError) && (
        <ErrorState
          title="管线数据加载失败"
          message={(statsError || rawError || recentError)?.message || '无法获取管线统计或内容'}
          onRetry={() => {
            refetchStats();
            refetchRaw();
            refetchRecent();
          }}
        />
      )}

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

      {/* Run Summary Banner */}
      {runSummary && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-[2px] bg-success/10 border border-success/30 text-success text-sm">
          <Sparkles className="w-4 h-4" />
          {runSummary}
          <button onClick={() => setRunSummary(null)} className="ml-auto">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Raw Material Selector */}
      {(rawItems || []).length > 0 && (
        <div className="glass-card p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-info" />
              <h2 className="text-sm font-semibold text-text-primary">选择要处理的原始素材</h2>
              <span className="text-xs text-text-muted">已选 {selectedRawIds.size} / {(rawItems || []).length} 条</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelectedRawIds(new Set((rawItems || []).map((i) => i.id)))}
                className="px-2.5 py-1.5 rounded-[2px] text-xs bg-white/[0.03] border border-white/[0.08] text-text-secondary hover:text-text-primary hover:bg-white/[0.06] transition-colors"
              >
                全选
              </button>
              <button
                onClick={() => {
                  const today = new Date().toDateString();
                  const ids = (rawItems || [])
                    .filter((i) => new Date(i.created_at).toDateString() === today)
                    .map((i) => i.id);
                  setSelectedRawIds(new Set(ids));
                }}
                className="px-2.5 py-1.5 rounded-[2px] text-xs bg-white/[0.03] border border-white/[0.08] text-text-secondary hover:text-text-primary hover:bg-white/[0.06] transition-colors flex items-center gap-1"
              >
                <Calendar className="w-3 h-3" /> 仅今日
              </button>
              <button
                onClick={() => setSelectedRawIds(new Set())}
                disabled={selectedRawIds.size === 0}
                className="px-2.5 py-1.5 rounded-[2px] text-xs bg-white/[0.03] border border-white/[0.08] text-text-secondary hover:text-text-primary hover:bg-white/[0.06] transition-colors disabled:opacity-50"
              >
                清除
              </button>
              <button
                onClick={() => setShowSelector((v) => !v)}
                className="px-2.5 py-1.5 rounded-[2px] text-xs bg-white/[0.03] border border-white/[0.08] text-text-secondary hover:text-text-primary hover:bg-white/[0.06] transition-colors"
              >
                {showSelector ? '收起' : '展开'}
              </button>
            </div>
          </div>

          {showSelector && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[320px] overflow-y-auto pr-1">
              {(rawItems || []).map((item) => {
                const config = CONTENT_TYPE_CONFIG[item.content_type] || { label: item.content_type, icon: Layers, color: 'text-text-secondary' };
                const Icon = config.icon;
                const isSelected = selectedRawIds.has(item.id);
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setSelectedRawIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(item.id)) next.delete(item.id);
                        else next.add(item.id);
                        return next;
                      });
                    }}
                    className={`flex items-start gap-3 p-3 rounded-[2px] border text-left transition-colors ${
                      isSelected
                        ? 'bg-info/10 border-info/30'
                        : 'bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04]'
                    }`}
                  >
                    {isSelected ? <CheckSquare className="w-4 h-4 text-info shrink-0 mt-0.5" /> : <Square className="w-4 h-4 text-text-muted shrink-0 mt-0.5" />}
                    <div className={`mt-0.5 ${config.color} shrink-0`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium text-text-primary truncate max-w-[180px]">{item.title || '未命名'}</span>
                        <span className="px-1.5 py-0.5 rounded-md text-[10px] border bg-white/[0.03] text-text-secondary border-white/[0.08]">{config.label}</span>
                      </div>
                      <p className="text-[10px] text-text-secondary mt-1 line-clamp-2 break-all">{getExcerpt(item.content_raw, 80)}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Today Output Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="glass-card p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-[2px] bg-fusion-primary/10 text-fusion-primary flex items-center justify-center">
            <SquareStack className="w-5 h-5" />
          </div>
          <div>
            <div className="text-2xl font-bold text-text-primary">{isStatsLoading ? '-' : stats?.today.new_cards ?? 0}</div>
            <div className="text-xs text-text-secondary">今日新卡片</div>
          </div>
        </div>
        <div className="glass-card p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-[2px] bg-warning/10 text-warning flex items-center justify-center">
            <Filter className="w-5 h-5" />
          </div>
          <div>
            <div className="text-2xl font-bold text-text-primary">{isStatsLoading ? '-' : stats?.today.new_concepts ?? 0}</div>
            <div className="text-xs text-text-secondary">今日新概念</div>
          </div>
        </div>
        <div className="glass-card p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-[2px] bg-success/10 text-success flex items-center justify-center">
            <Shuffle className="w-5 h-5" />
          </div>
          <div>
            <div className="text-2xl font-bold text-text-primary">{isStatsLoading ? '-' : stats?.today.new_collisions ?? 0}</div>
            <div className="text-xs text-text-secondary">今日新碰撞</div>
          </div>
        </div>
      </div>

      {/* Funnel + Run Button */}
      <div className="glass-card p-5 space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-info" />
            <h2 className="text-sm font-semibold text-text-primary">五阶段生产漏斗</h2>
            <span className="text-xs text-text-muted">{totalItems} 件内容在管线中</span>
          </div>
          <button
            onClick={handleRunPipeline}
            disabled={isRunning || (rawItems || []).length === 0 || selectedRawIds.size === 0}
            className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-[2px] text-sm font-medium hover:bg-[var(--accent-hover)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {isRunning ? `运行中 ${runProgress}/${(selectedRawIds.size > 0
              ? (rawItems || []).filter((i) => selectedRawIds.has(i.id)).length
              : rawItems?.length || 0)}` : `一键运行已选 (${selectedRawIds.size})`}
          </button>
        </div>

        <div className="flex rounded-[2px] overflow-hidden bg-white/[0.03] border border-white/[0.08] h-14">
          {STAGE_CONFIG.map((stage) => {
            const count = stageCounts[stage.id] || 0;
            // Give every stage a minimum pixel width so a 0-count stage doesn't collapse
            // to 0 and overlap its neighbours' labels (the "文字叠加" bug). When the
            // pipeline is empty, fall back to equal widths.
            const widthPct = totalItems > 0 ? (count / totalItems) * 100 : 100 / STAGE_CONFIG.length;
            const Icon = stage.icon;
            return (
              <button
                key={stage.id}
                onClick={() => navigate(stage.path)}
                disabled={count === 0}
                className={`relative flex flex-col items-center justify-center gap-0.5 transition-all hover:brightness-110 overflow-hidden min-w-0 ${count === 0 ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                style={{ width: `${widthPct}%`, minWidth: '72px' }}
              >
                <div className={`absolute inset-0 ${stage.color}`} />
                <div className="relative z-10 flex items-center gap-1 min-w-0 overflow-hidden">
                  <Icon className="w-3.5 h-3.5 text-text-primary/80 shrink-0" />
                  <span className="text-xs font-medium text-text-primary truncate">{stage.label}</span>
                </div>
                <div className="relative z-10 text-[10px] text-text-secondary">{count}</div>
              </button>
            );
          })}
        </div>

        {/* Stage Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {STAGE_CONFIG.map((stage, index) => {
            const Icon = stage.icon;
            const count = stageCounts[stage.id] || 0;
            return (
              <button
                key={stage.id}
                onClick={() => navigate(stage.path)}
                className="text-left p-3 rounded-[2px] bg-white/[0.02] border border-white/[0.06] hover:border-info/20 hover:bg-white/[0.04] transition-colors group"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-white/[0.06] text-[10px] text-text-secondary">{index + 1}</span>
                  <Icon className="w-4 h-4 text-text-muted group-hover:text-info transition-colors" />
                </div>
                <div className="text-lg font-bold text-text-primary">{isStatsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : count}</div>
                <div className="text-xs text-text-secondary mt-0.5">{stage.label}</div>
                <div className="text-[10px] text-text-muted mt-0.5 line-clamp-2">{stage.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Recent Active */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-fusion-primary" />
          <h2 className="text-sm font-semibold text-text-primary">最近活跃</h2>
        </div>
        {isRecentLoading ? (
          <div className="glass-card flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-info" />
          </div>
        ) : recentItems.length === 0 ? (
          <div className="glass-card flex flex-col items-center justify-center py-12 text-center">
            <Database className="w-12 h-12 text-text-muted/40 mb-3" />
            <p className="text-text-secondary text-sm">管线中暂无内容</p>
            <p className="text-text-muted text-xs mt-1">去采集或导入一些素材开始生产</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {recentItems.map((item) => renderRecentItem(item))}
          </div>
        )}
      </div>
    </div>
  );
};

export default PipelineOverviewPage;
