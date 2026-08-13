import { FC, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Search,
  Filter,
  Loader2,
  FileText,
  Package,
  Globe,
  BookOpen,
  Rss,
  Mail,
  MessageCircle,
  Bookmark,
  FolderOpen,
  Tag,
  Database,
  CheckSquare,
  Square,
  Trash2,
} from 'lucide-react';
import { emergenceApi, EmergenceSource, type BrainSide, type SelectedSource } from '@/api/emergence';

const SOURCE_TYPES = [
  { key: 'note', label: '笔记', icon: FileText },
  { key: 'capsule', label: '胶囊', icon: Package },
  { key: 'clip', label: '剪藏', icon: Globe },
  { key: 'knowledge', label: '知识', icon: BookOpen },
  { key: 'rss_entry', label: 'RSS', icon: Rss },
  { key: 'email', label: '邮件', icon: Mail },
  { key: 'social', label: '社交', icon: MessageCircle },
  { key: 'read_later', label: '稍后读', icon: Bookmark },
  { key: 'document', label: '文档', icon: FolderOpen },
  // 「标签」不再作为素材类型展示（组织工具不是素材，混进来是删不了的幽灵卡片）
];

const BRAIN_SIDES: { key: BrainSide | 'all'; label: string; color: string }[] = [
  { key: 'all', label: '全部', color: 'text-text-secondary' },
  { key: 'personal', label: '个人脑', color: 'text-personal-primary' },
  { key: 'network', label: '网络脑', color: 'text-network-primary' },
  { key: 'both', label: '双脑', color: 'text-fusion-primary' },
];

const TYPE_ICON_MAP: Record<string, React.ElementType> = {
  note: FileText,
  capsule: Package,
  clip: Globe,
  knowledge: BookOpen,
  rss_entry: Rss,
  email: Mail,
  social: MessageCircle,
  read_later: Bookmark,
  document: FolderOpen,
  tag: Tag,
};

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

const formatDate = (dateStr: string) =>
  new Date(dateStr).toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
  });

interface SourcePoolProps {
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  selectedSources?: SelectedSource[];
  onSelectedSourcesChange?: (sources: SelectedSource[]) => void;
  /** 提供时卡片右上角显示删除按钮（素材池页用；工具页不传则无变化） */
  onDeleteItem?: (item: EmergenceSource) => void;
}

const SourcePool: FC<SourcePoolProps> = ({
  selectedIds: externalSelectedIds,
  onSelectionChange,
  selectedSources: externalSelectedSources,
  onSelectedSourcesChange,
  onDeleteItem,
}) => {
  const isControlledBySources = externalSelectedSources !== undefined;
  const selectedIds = isControlledBySources
    ? externalSelectedSources.map((s) => s.id)
    : (externalSelectedIds ?? []);

  const [brainSide, setBrainSide] = useState<BrainSide | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [query, setQuery] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['emergence', 'sources', brainSide, typeFilter, query],
    queryFn: async () => {
      const response = await emergenceApi.getSources(
        brainSide === 'all' ? undefined : brainSide,
        typeFilter === 'all' ? undefined : typeFilter,
        query.trim() || undefined,
        100
      );
      return response.data;
    },
    staleTime: 60 * 1000,
  });

  const items = useMemo(() => data?.items || [], [data]);

  const emitSelection = (nextIds: string[]) => {
    if (isControlledBySources) {
      const nextSources = nextIds
        .map((id) => items.find((item) => item.id === id))
        .filter(Boolean)
        .map((item) => ({ id: item!.id, type: item!.type }));
      onSelectedSourcesChange?.(nextSources);
    } else {
      onSelectionChange?.(nextIds);
    }
  };

  const toggleSelection = (id: string) => {
    const next = selectedIds.includes(id)
      ? selectedIds.filter((x) => x !== id)
      : [...selectedIds, id];
    emitSelection(next);
  };

  const toggleAll = () => {
    if (selectedIds.length === items.length && items.length > 0) {
      emitSelection([]);
    } else {
      emitSelection(items.map((item) => item.id));
    }
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索素材标题、摘要..."
            className="w-full bg-bg-secondary border border-border-color rounded-xl pl-10 pr-4 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-info/50 transition-colors"
          />
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-bg-tertiary rounded-lg p-1">
            {BRAIN_SIDES.map((side) => (
              <button
                key={side.key}
                onClick={() => setBrainSide(side.key)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                  brainSide === side.key
                    ? 'bg-bg-secondary text-text-primary shadow-sm'
                    : `text-text-muted hover:text-text-secondary`
                }`}
              >
                <span className={brainSide === side.key ? side.color : ''}>{side.label}</span>
              </button>
            ))}
          </div>

          <div className="relative group">
            <button className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-tertiary rounded-lg text-xs text-text-secondary hover:text-text-primary transition-colors">
              <Filter className="w-3.5 h-3.5" />
              类型
              {typeFilter !== 'all' && (
                <span className="w-2 h-2 rounded-full bg-info" />
              )}
            </button>
            <div className="absolute right-0 top-full mt-2 w-40 z-20 hidden group-hover:block">
              <div className="glass-card p-2 space-y-1">
                <button
                  onClick={() => setTypeFilter('all')}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-colors ${
                    typeFilter === 'all' ? 'bg-info/15 text-info' : 'text-text-secondary hover:bg-white/[0.04]'
                  }`}
                >
                  <Database className="w-3.5 h-3.5" />
                  全部类型
                </button>
                {SOURCE_TYPES.map((type) => {
                  const Icon = type.icon;
                  return (
                    <button
                      key={type.key}
                      onClick={() => setTypeFilter(type.key)}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-colors ${
                        typeFilter === type.key ? 'bg-info/15 text-info' : 'text-text-secondary hover:bg-white/[0.04]'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {type.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Selection summary */}
      <div className="flex items-center justify-between text-xs text-text-muted">
        <button
          onClick={toggleAll}
          className="flex items-center gap-1.5 hover:text-text-primary transition-colors"
        >
          {selectedIds.length === items.length && items.length > 0 ? (
            <CheckSquare className="w-3.5 h-3.5 text-info" />
          ) : (
            <Square className="w-3.5 h-3.5" />
          )}
          全选
        </button>
        <span>
          已选 <span className="text-info font-medium">{selectedIds.length}</span> 条
          {data?.total !== undefined && ` / 共 ${data.total} 条`}
        </span>
      </div>

      {/* Cards */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 text-info animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-12">
          <Database className="w-12 h-12 text-text-muted mb-3" />
          <p className="text-text-secondary text-sm">暂无素材</p>
          <p className="text-xs text-text-muted mt-1">尝试调整筛选条件或搜索关键词</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[480px] overflow-y-auto pr-1">
          {items.map((item) => (
            <SourceCard
              key={item.id}
              item={item}
              selected={selectedIds.includes(item.id)}
              onToggle={() => toggleSelection(item.id)}
              onDelete={onDeleteItem ? () => onDeleteItem(item) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
};

interface SourceCardProps {
  item: EmergenceSource;
  selected: boolean;
  onToggle: () => void;
  onDelete?: () => void;
}

const SourceCard: FC<SourceCardProps> = ({ item, selected, onToggle, onDelete }) => {
  const Icon = TYPE_ICON_MAP[item.type] || Database;
  const typeLabel = SOURCE_TYPES.find((t) => t.key === item.type)?.label || item.type;

  return (
    <div
      onClick={onToggle}
      className={`relative p-4 rounded-xl border transition-all cursor-pointer ${
        selected
          ? 'bg-info/5 border-info/40'
          : 'bg-white/[0.02] border-white/[0.06] hover:border-white/[0.12]'
      }`}
    >
      {onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="删除该素材"
          className="absolute top-2 right-2 p-1.5 rounded-lg text-text-muted hover:text-danger hover:bg-danger/10 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          onClick={(e) => e.stopPropagation()}
          className="accent-info mt-1 cursor-pointer"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full bg-white/[0.05] text-text-secondary border border-white/[0.08]">
              <Icon className="w-3 h-3" />
              {typeLabel}
            </span>
            <span
              className={`inline-flex items-center px-2 py-0.5 text-[10px] rounded-full border ${
                BRAIN_SIDE_CLASS[item.brain_side] || BRAIN_SIDE_CLASS.unknown
              }`}
            >
              {BRAIN_SIDE_LABEL[item.brain_side] || BRAIN_SIDE_LABEL.unknown}
            </span>
          </div>
          <h4 className="text-sm font-medium text-text-primary truncate">{item.title || '无标题'}</h4>
          <p className="text-xs text-text-secondary line-clamp-2 mt-1 leading-relaxed">
            {item.excerpt || '暂无摘要'}
          </p>
          <p className="text-[10px] text-text-muted mt-2">{formatDate(item.created_at)}</p>
        </div>
      </div>
    </div>
  );
};

export default SourcePool;
