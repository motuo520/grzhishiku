import { FC, useEffect, useMemo, useRef, useState } from 'react';
import { useKnowledge } from '@/hooks/useKnowledge';
import { useNotes } from '@/hooks/useNotes';
import { useNavigation } from '@/store/navigation';
import { TrendingUp, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Note } from '@/api/notes';
import type { KnowledgeUnit } from '@/types';

const STAGES = [
  { id: 'collected', label: '已收集', desc: '知识进入系统，尚未处理', color: 'text-text-muted', bg: 'bg-text-muted/10', bar: 'bg-text-muted' },
  { id: 'understood', label: '已理解', desc: '能够用自己的话复述', color: 'text-info', bg: 'bg-info/10', bar: 'bg-info' },
  { id: 'practiced', label: '已践行', desc: '至少应用过一次', color: 'text-success', bg: 'bg-success/10', bar: 'bg-success' },
  { id: 'validated', label: '已验证', desc: '在真实场景中得到验证', color: 'text-warning', bg: 'bg-warning/10', bar: 'bg-warning' },
  { id: 'internalized', label: '已内化', desc: '成为默认思维模式', color: 'text-fusion-primary', bg: 'bg-fusion-primary/10', bar: 'bg-fusion-primary' },
];

const STAGE_IDS = new Set(STAGES.map((s) => s.id));
const normalizeStage = (stage?: string): string => (stage && STAGE_IDS.has(stage) ? stage : 'collected');

const EvolutionTrackPage: FC = () => {
  const { brainSide } = useNavigation();
  const { units: knowledgeUnits, isLoading: knowledgeLoading, error: knowledgeError } = useKnowledge(brainSide);
  // useNotes 的入参类型未声明 limit，但其会原样透传给 notesApi.list（支持 limit），故以带 limit 的局部变量传入
  const notesFilters: { q?: string; tag_ids?: string; brain_side?: string; limit?: number } = { brain_side: brainSide, limit: 1000 };
  const { notes, isLoading: notesLoading } = useNotes(notesFilters);
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set(['practiced', 'validated']));
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get('id');

  const items = useMemo(() => {
    const all = [
      ...(knowledgeUnits || []).map((k: KnowledgeUnit) => ({
        id: k.id,
        type: 'knowledge_unit' as const,
        title: (k.content_raw || '').slice(0, 80),
        link: `/knowledge/${k.id}`,
        evolution_stage: k.evolution_stage,
      })),
      ...(notes || []).map((n: Note) => ({
        id: n.id,
        type: 'note' as const,
        title: (n.title || n.content.slice(0, 80) || '(无标题)'),
        link: `/ingest/notes/${n.id}`,
        evolution_stage: n.evolution_stage,
      })),
    ];
    return all;
  }, [knowledgeUnits, notes]);

  const grouped = useMemo(() => {
    const map: Record<string, typeof items> = {};
    STAGES.forEach((s) => { map[s.id] = []; });
    items.forEach((item) => {
      map[normalizeStage(item.evolution_stage)].push(item);
    });
    return map;
  }, [items]);

  const focusStage = useMemo(() => {
    if (!focusId) return null;
    const item = items.find((i) => i.id === focusId);
    return item ? normalizeStage(item.evolution_stage) : null;
  }, [focusId, items]);

  // 深链 ?id=：自动展开目标所在阶段并滚动高亮（每个 id 只自动滚动一次）
  const scrolledRef = useRef(false);
  useEffect(() => {
    scrolledRef.current = false;
  }, [focusId]);

  useEffect(() => {
    if (!focusStage) return;
    setExpandedStages((prev) => (prev.has(focusStage) ? prev : new Set(prev).add(focusStage)));
  }, [focusStage]);

  useEffect(() => {
    if (scrolledRef.current || !focusId || !focusStage || !expandedStages.has(focusStage)) return;
    const el = document.getElementById(`evolution-item-${focusId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      scrolledRef.current = true;
    }
  }, [focusId, focusStage, expandedStages, grouped]);

  const total = items.length;
  const maxCount = Math.max(...STAGES.map((s) => grouped[s.id]?.length || 0), 1);

  const toggleStage = (id: string) => {
    setExpandedStages((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isLoading = knowledgeLoading || notesLoading;
  // useNotes 未暴露 error：请求失败时 notes 保持 undefined，据此兜底判断
  const notesLoadFailed = !notesLoading && notes === undefined;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-semibold text-text-primary flex items-center gap-2 mb-2">
        <TrendingUp className="w-5 h-5 text-fusion-primary" />
        进化轨迹
      </h1>
      <p className="text-sm text-text-secondary mb-6">追踪知识单元与笔记从收集到内化的完整历程。</p>

      {(knowledgeError || notesLoadFailed) && (
        <div className="p-3 rounded-[2px] bg-danger/10 border border-danger/30 text-sm text-danger mb-4">
          {knowledgeError ? (knowledgeError as any)?.message || '知识单元加载失败，请稍后重试' : '笔记加载失败，请稍后重试'}
        </div>
      )}

      {isLoading && (
        <div className="text-sm text-text-secondary flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          加载中...
        </div>
      )}

      {!isLoading && total === 0 && (
        <div className="p-8 rounded-[2px] border border-white/[0.06] bg-bg-secondary text-center text-text-secondary">
          暂无可追踪的知识单元或笔记，先在管线中沉淀内容吧。
        </div>
      )}

      {total > 0 && (
      <div className="space-y-3">
        {STAGES.map((stage) => {
          const stageItems = grouped[stage.id] || [];
          const count = stageItems.length;
          const stageOpen = expandedStages.has(stage.id);
          const showAll = expanded[stage.id] === true;
          const focusIndex = focusId ? stageItems.findIndex((i) => i.id === focusId) : -1;
          const collapsedItems = focusIndex >= 20 ? stageItems.slice(0, focusIndex + 1) : stageItems.slice(0, 20);
          const visibleItems = showAll ? stageItems : collapsedItems;
          return (
            <div key={stage.id} className="rounded-[2px] border border-white/[0.06] bg-bg-secondary overflow-hidden">
              <button
                onClick={() => toggleStage(stage.id)}
                className="w-full flex items-center gap-4 p-4 text-left hover:bg-white/[0.02] transition-colors"
              >
                <div className={`w-10 h-10 rounded-[2px] ${stage.bg} ${stage.color} flex items-center justify-center text-sm font-semibold shrink-0`}>
                  {count}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text-primary">{stage.label}</span>
                    <span className="text-xs text-text-secondary">{stage.desc}</span>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-bg-primary overflow-hidden">
                    <div
                      className={`h-full rounded-full ${stage.bar} transition-all duration-500`}
                      style={{ width: `${(count / maxCount) * 100}%` }}
                    />
                  </div>
                </div>
                <div className="text-xs text-text-muted shrink-0">
                  {total > 0 ? `${((count / total) * 100).toFixed(0)}%` : '0%'}
                </div>
                {stageOpen ? <ChevronUp className="w-4 h-4 text-text-muted shrink-0" /> : <ChevronDown className="w-4 h-4 text-text-muted shrink-0" />}
              </button>

              {stageOpen && stageItems.length > 0 && (
                <div className="border-t border-white/[0.06] px-4 py-3 space-y-2">
                  {visibleItems.map((item) => (
                    <Link
                      key={`${item.type}-${item.id}`}
                      id={`evolution-item-${item.id}`}
                      to={item.link}
                      className={`flex items-center gap-2 p-2 rounded-[2px] hover:bg-white/[0.03] transition-colors group ${item.id === focusId ? 'ring-1 ring-fusion-primary/60 bg-fusion-primary/10' : ''}`}
                    >
                      <span className={`text-xs px-1.5 py-0.5 rounded border ${item.type === 'knowledge_unit' ? 'text-info border-info/30 bg-info/10' : 'text-warning border-warning/30 bg-warning/10'}`}>
                        {item.type === 'knowledge_unit' ? '知识' : '笔记'}
                      </span>
                      <span className="text-sm text-text-secondary group-hover:text-text-primary truncate">{item.title}</span>
                    </Link>
                  ))}
                  {showAll ? (
                    <button
                      onClick={() => setExpanded((prev) => ({ ...prev, [stage.id]: false }))}
                      className="text-xs text-info hover:underline px-2"
                    >
                      收起
                    </button>
                  ) : stageItems.length > visibleItems.length ? (
                    <button
                      onClick={() => setExpanded((prev) => ({ ...prev, [stage.id]: true }))}
                      className="text-xs text-info hover:underline px-2"
                    >
                      还有 {stageItems.length - visibleItems.length} 条 · 查看全部
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
};

export default EvolutionTrackPage;
