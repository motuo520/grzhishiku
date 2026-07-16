import { FC, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, Loader2, AlertCircle, FileText, Scissors, BookOpen, Package, HelpCircle } from 'lucide-react';
import { useGraphNodes } from '@/hooks/useGraph';
import type { GraphNodeItem } from '@/api/graph';

interface TypeConfig {
  label: string;
  icon: typeof FileText;
  path?: string;
}

const TYPE_CONFIG: Record<string, TypeConfig> = {
  note: { label: '笔记', icon: FileText, path: '/ingest/notes' },
  clip: { label: '剪藏', icon: Scissors, path: '/ingest/clipper' },
  knowledge: { label: '知识单元', icon: BookOpen, path: '/knowledge/network' },
  capsule: { label: '胶囊', icon: Package, path: '/capsules/my' },
};

const BRAIN_SIDE_COLORS: Record<string, string> = {
  personal: '#d29922',
  network: '#58a6ff',
  both: '#a371f7',
  unknown: '#8b949e',
};

const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const GraphTimelinePage: FC = () => {
  const navigate = useNavigate();
  const { data, isLoading, error } = useGraphNodes();
  const nodes = useMemo(() => data?.nodes || [], [data]);

  // 按日分组（降序），无 created_at 的归入「未知日期」
  const groups = useMemo(() => {
    const map = new Map<string, GraphNodeItem[]>();
    nodes.forEach((n) => {
      const key = n.created_at ? dayKey(n.created_at) : '未知日期';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(n);
    });
    return [...map.entries()].sort((a, b) => {
      if (a[0] === '未知日期') return 1;
      if (b[0] === '未知日期') return -1;
      return b[0].localeCompare(a[0]);
    });
  }, [nodes]);

  // 顶部汇总：总数、时间跨度、各类型计数
  const summary = useMemo(() => {
    if (nodes.length === 0) return null;
    const days = groups.map(([key]) => key).filter((k) => k !== '未知日期');
    const typeCounts: Record<string, number> = {};
    nodes.forEach((n) => {
      typeCounts[n.type] = (typeCounts[n.type] || 0) + 1;
    });
    return {
      total: data?.total ?? nodes.length,
      span: days.length > 0 ? `${days[days.length - 1]} ~ ${days[0]}` : null,
      typeCounts,
    };
  }, [nodes, groups, data]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-info" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-6">
        <AlertCircle className="w-12 h-12 text-red-400 mb-4" />
        <div className="text-sm text-text-secondary">{(error as any)?.message || '加载失败'}</div>
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-6">
        <Clock className="w-12 h-12 text-text-muted mb-4" />
        <div className="text-text-primary font-semibold mb-2">还没有任何内容</div>
        <div className="text-sm text-text-secondary max-w-md">
          添加笔记、剪藏或知识单元后，这里会按时间展示你的知识积累过程。
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">时间轴</h1>
          <p className="text-sm text-text-secondary mt-1">按时间回顾你的知识积累</p>
        </div>

        {summary && (
          <div className="glass-card px-4 py-3 rounded-xl flex flex-wrap items-center gap-3 text-xs text-text-secondary">
            <span>
              共 <span className="text-text-primary font-semibold">{summary.total}</span> 条
            </span>
            {summary.span && <span className="text-text-muted">{summary.span}</span>}
            <div className="flex flex-wrap items-center gap-1.5 ml-auto">
              {Object.entries(summary.typeCounts).map(([type, count]) => {
                const config = TYPE_CONFIG[type];
                const Icon = config?.icon || HelpCircle;
                return (
                  <span
                    key={type}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.08] text-[10px] text-text-secondary"
                  >
                    <Icon className="w-3 h-3" />
                    {config?.label || type} {count}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        <div className="space-y-6">
          {groups.map(([day, items]) => (
            <div key={day}>
              {/* 日期分隔线 */}
              <div className="flex items-center gap-3 mb-3">
                <span className="text-xs font-semibold text-text-primary whitespace-nowrap">{day}</span>
                <span className="text-[10px] text-text-muted">{items.length} 条</span>
                <div className="flex-1 h-px bg-white/[0.06]" />
              </div>

              <div className="space-y-1.5 ml-2 border-l border-white/[0.08] pl-4">
                {items.map((node) => {
                  const config = TYPE_CONFIG[node.type];
                  const Icon = config?.icon || HelpCircle;
                  const clickable = Boolean(config?.path);
                  return (
                    <button
                      key={node.id}
                      onClick={() => { if (config?.path) navigate(config.path); }}
                      disabled={!clickable}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors ${
                        clickable
                          ? 'hover:bg-white/[0.04] cursor-pointer'
                          : 'cursor-default opacity-70'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5 text-text-muted shrink-0" />
                      <span className="text-[10px] text-text-muted shrink-0 w-14">
                        {config?.label || node.type}
                      </span>
                      <span className="text-sm text-text-primary truncate flex-1">{node.label}</span>
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ background: BRAIN_SIDE_COLORS[node.brain_side] || BRAIN_SIDE_COLORS.unknown }}
                        title={node.brain_side}
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default GraphTimelinePage;
