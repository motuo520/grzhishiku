import { FC, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Clock, Loader2, AlertCircle, FileText, Scissors, BookOpen, Package, HelpCircle,
  Rss, Mail, MessageCircle, Bookmark, FolderOpen,
} from 'lucide-react';
import { emergenceApi } from '@/api/emergence';
import type { EmergenceSource } from '@/api/emergence';

interface TypeConfig {
  label: string;
  icon: typeof FileText;
  path?: string;
}

// 数据源是涌现素材池的跨类型聚合（非图谱节点），图标风格对齐 SourcePool
// detail：有详情页的类型点进原内容；只有 path（列表页）的类型退化为跳列表
const TYPE_CONFIG: Record<string, TypeConfig> = {
  note: { label: '笔记', icon: FileText, path: '/ingest/notes' },
  clip: { label: '剪藏', icon: Scissors, path: '/ingest/clipper' },
  knowledge: { label: '知识单元', icon: BookOpen, path: '/knowledge/network' },
  capsule: { label: '胶囊', icon: Package, path: '/capsules/my' },
  read_later: { label: '稍后读', icon: Bookmark, path: '/ingest/read-later' },
  document: { label: '文档', icon: FolderOpen, path: '/ingest/documents' },
  rss_entry: { label: 'RSS', icon: Rss, path: '/ingest/rss' },
  email: { label: '邮件', icon: Mail, path: '/ingest/email' },
  social: { label: '社交', icon: MessageCircle, path: '/ingest/social' },
};

// 有详情页的类型：点击直达原内容（此前一律跳列表页「目录」，找不到条目）
const detailPathFor = (item: EmergenceSource): string | null => {
  if (item.type === 'note') return `/ingest/notes/${item.id}`;
  if (item.type === 'knowledge') return `/knowledge/${item.id}`;
  return null;
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

const minuteKey = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// 日内的二级分组：批次簇（同一分钟的连续条目）或孤立单条
type Segment =
  | { kind: 'cluster'; time: string; items: EmergenceSource[] }
  | { kind: 'single'; item: EmergenceSource };

// 同一分钟内 created_at 相同的连续条目聚成一簇（一次批量导入的产物）；
// 孤立单条不分簇，直接列在当日下
const buildSegments = (items: EmergenceSource[]): Segment[] => {
  const segments: Segment[] = [];
  let i = 0;
  while (i < items.length) {
    const item = items[i];
    if (!item.created_at) {
      segments.push({ kind: 'single', item });
      i++;
      continue;
    }
    const mk = minuteKey(item.created_at);
    let j = i + 1;
    while (j < items.length && items[j].created_at && minuteKey(items[j].created_at!) === mk) {
      j++;
    }
    if (j - i >= 2) {
      segments.push({ kind: 'cluster', time: mk, items: items.slice(i, j) });
    } else {
      segments.push({ kind: 'single', item });
    }
    i = j;
  }
  return segments;
};

const GraphTimelinePage: FC = () => {
  const navigate = useNavigate();
  // 全量内容（跨类型聚合，不要求建过图谱），一次拉够做全量批次回顾
  // queryKey 挂 'emergence' 前缀：导入完成后 invalidateContentQueries 会连带失效本页
  const { data, isLoading, error } = useQuery({
    queryKey: ['emergence', 'sources', 'timeline'],
    queryFn: async () => {
      const response = await emergenceApi.getSources(undefined, undefined, undefined, 1000);
      return response.data;
    },
  });
  const items = useMemo(() => data?.items || [], [data]);

  // 按日分组（降序），无 created_at 的归入「未知日期」；日内再按批次簇分段
  const groups = useMemo(() => {
    const map = new Map<string, EmergenceSource[]>();
    items.forEach((n) => {
      const key = n.created_at ? dayKey(n.created_at) : '未知日期';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(n);
    });
    return [...map.entries()]
      .sort((a, b) => {
        if (a[0] === '未知日期') return 1;
        if (b[0] === '未知日期') return -1;
        return b[0].localeCompare(a[0]);
      })
      .map(([day, dayItems]) => ({ day, segments: buildSegments(dayItems), count: dayItems.length }));
  }, [items]);

  // 顶部汇总：总数、时间跨度、各类型计数
  const summary = useMemo(() => {
    if (items.length === 0) return null;
    const days = groups.map((g) => g.day).filter((k) => k !== '未知日期');
    const typeCounts: Record<string, number> = {};
    items.forEach((n) => {
      typeCounts[n.type] = (typeCounts[n.type] || 0) + 1;
    });
    return {
      total: data?.total ?? items.length,
      span: days.length > 0 ? `${days[days.length - 1]} ~ ${days[0]}` : null,
      typeCounts,
    };
  }, [items, groups, data]);

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

  if (items.length === 0) {
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

  const renderItem = (item: EmergenceSource) => {
    const config = TYPE_CONFIG[item.type];
    const Icon = config?.icon || HelpCircle;
    const target = detailPathFor(item) || config?.path;
    const clickable = Boolean(target);
    return (
      <button
        key={`${item.type}-${item.id}`}
        onClick={() => { if (target) navigate(target); }}
        disabled={!clickable}
        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors ${
          clickable
            ? 'hover:bg-white/[0.04] cursor-pointer'
            : 'cursor-default opacity-70'
        }`}
      >
        <Icon className="w-3.5 h-3.5 text-text-muted shrink-0" />
        <span className="text-[10px] text-text-muted shrink-0 w-14">
          {config?.label || item.type}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-text-primary truncate">{item.title || '（无标题）'}</div>
          {item.excerpt && (
            <div className="text-xs text-text-secondary truncate mt-0.5">{item.excerpt}</div>
          )}
        </div>
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ background: BRAIN_SIDE_COLORS[item.brain_side] || BRAIN_SIDE_COLORS.unknown }}
          title={item.brain_side}
        />
      </button>
    );
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">时间轴</h1>
          <p className="text-sm text-text-secondary mt-1">按时间回顾你的知识积累，同一批导入的内容会聚成一簇</p>
        </div>

        {summary && (
          <div className="glass-card px-4 py-3 rounded-xl flex flex-wrap items-center gap-3 text-xs text-text-secondary">
            <span>
              共 <span className="text-text-primary font-semibold">{summary.total}</span> 条
            </span>
            {summary.span && <span className="text-text-muted">{summary.span}</span>}
            {data && data.total > items.length && (
              <span className="text-warning">仅显示最近 {items.length} 条，更早的内容请按类型到各列表页查看</span>
            )}
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
          {groups.map(({ day, segments, count }) => (
            <div key={day}>
              {/* 日期分隔线 */}
              <div className="flex items-center gap-3 mb-3">
                <span className="text-xs font-semibold text-text-primary whitespace-nowrap">{day}</span>
                <span className="text-[10px] text-text-muted">{count} 条</span>
                <div className="flex-1 h-px bg-white/[0.06]" />
              </div>

              <div className="space-y-3 ml-2 border-l border-white/[0.08] pl-4">
                {segments.map((seg, idx) =>
                  seg.kind === 'cluster' ? (
                    <div key={`${seg.time}-${idx}`} className="rounded-lg bg-white/[0.03] border border-white/[0.06]">
                      {/* 批次簇头：同一分钟的连续条目 = 一次批量导入 */}
                      <div className="flex items-center gap-2 px-3 pt-2 pb-1">
                        <Clock className="w-3 h-3 text-info shrink-0" />
                        <span className="text-[10px] font-medium text-info">
                          {seg.time} · {seg.items.length} 条
                        </span>
                      </div>
                      <div className="space-y-1.5 px-1 pb-1">
                        {seg.items.map(renderItem)}
                      </div>
                    </div>
                  ) : (
                    <div key={`${seg.item.type}-${seg.item.id}-${idx}`}>{renderItem(seg.item)}</div>
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default GraphTimelinePage;
