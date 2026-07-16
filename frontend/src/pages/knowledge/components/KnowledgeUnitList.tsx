import { FC, useState, useMemo, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BookOpen, ShieldCheck, AlertTriangle, XCircle, HelpCircle, Clock,
  Search, Filter, ArrowUpDown, Plus, ExternalLink, Layers,
  BarChart3, Globe, Loader2, Activity, Dumbbell, Zap, Sprout, AlertCircle
} from 'lucide-react';
import { useKnowledge } from '@/hooks/useKnowledge';
import ErrorState from '@/components/ErrorState';
import type { KnowledgeUnit } from '@/types';

const MAX_DISPLAY_UNITS = 200;
const MOTION_THRESHOLD = 20;

const evolutionConfig: Record<string, { label: string; badgeClass: string }> = {
  collected: { label: '已收集', badgeClass: 'bg-bg-tertiary text-text-muted border-border-color' },
  understood: { label: '已理解', badgeClass: 'bg-info/10 text-info border-info/30' },
  practiced: { label: '已践行', badgeClass: 'bg-success/10 text-success border-success/30' },
  validated: { label: '已验证', badgeClass: 'bg-warning/10 text-warning border-warning/30' },
  internalized: { label: '已内化', badgeClass: 'bg-network-primary/10 text-network-primary border-network-primary/30' },
};

const statusConfig: Record<string, { icon: React.ElementType; label: string; colorClass: string; badgeClass: string }> = {
  confirmed: {
    icon: ShieldCheck, label: '已验证', colorClass: 'text-success',
    badgeClass: 'bg-success/10 text-success border-success/30',
  },
  disputed: {
    icon: AlertTriangle, label: '有争议', colorClass: 'text-warning',
    badgeClass: 'bg-warning/10 text-warning border-warning/30',
  },
  debunked: {
    icon: XCircle, label: '已证伪', colorClass: 'text-danger',
    badgeClass: 'bg-danger/10 text-danger border-danger/30',
  },
  unverified: {
    icon: HelpCircle, label: '待验证', colorClass: 'text-text-muted',
    badgeClass: 'bg-bg-tertiary text-text-muted border-border-color',
  },
  checking: {
    icon: Loader2, label: '验证中', colorClass: 'text-info',
    badgeClass: 'bg-info/10 text-info border-info/30',
  },
  outdated: {
    icon: Clock, label: '已过期', colorClass: 'text-warning',
    badgeClass: 'bg-warning/10 text-warning border-warning/30',
  },
};

const extractDomain = (url?: string | null) => {
  if (!url) return '';
  try { return new URL(url).hostname; } catch { return url; }
};

type StatusFilter = 'all' | 'confirmed' | 'disputed' | 'debunked' | 'unverified' | 'checking' | 'outdated';
type EvolutionFilter = 'all' | 'collected' | 'understood' | 'practiced' | 'validated' | 'internalized';
type SortBy = 'created_at' | 'confidence' | 'verification_status' | 'invoke_count' | 'practice_depth' | 'personal_relevance_score' | 'value_score';

interface KnowledgeUnitListProps {
  brainSide: 'personal' | 'network' | 'both';
  title: string;
  subtitle?: string;
  showCreate?: boolean;
}

interface KnowledgeUnitRowProps {
  unit: KnowledgeUnit;
  brainSide: 'personal' | 'network' | 'both';
  index: number;
  useMotion: boolean;
}

const KnowledgeUnitRow = memo<KnowledgeUnitRowProps>(({ unit, brainSide, useMotion }) => {
  const navigate = useNavigate();
  const status = statusConfig[unit.verification_status] || statusConfig.unverified;
  const StatusIcon = status.icon;
  const domain = useMemo(() => extractDomain(unit.source_url), [unit.source_url]);
  const dateText = useMemo(() => new Date(unit.created_at).toLocaleDateString('zh-CN'), [unit.created_at]);

  const content = (
    <div
      className="glass-card p-4 hover:border-info/20 cursor-pointer transition-colors"
      onClick={() => navigate(`/knowledge/${unit.id}`, { state: { from: brainSide === 'both' ? '/knowledge/network' : `/knowledge/${brainSide}` } })}
    >
      <div className="flex items-start gap-4">
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium shrink-0 ${status.badgeClass}`}>
          <StatusIcon className={`w-3.5 h-3.5 ${unit.verification_status === 'checking' ? 'animate-spin' : ''}`} />
          {status.label}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-text-primary font-medium line-clamp-2 leading-relaxed break-all overflow-hidden max-w-full">{unit.content_raw}</div>
          <div className="flex items-center gap-3 text-xs text-text-muted mt-2 flex-wrap">
            {unit.content_type && <span className="flex items-center gap-1"><Layers className="w-3 h-3" />{unit.content_type}</span>}
            {unit.source_url && <span className="flex items-center gap-1 break-all max-w-full"><ExternalLink className="w-3 h-3 shrink-0" />{unit.source_title || domain}</span>}
            {unit.verification_consensus != null && <span className="flex items-center gap-1"><BarChart3 className="w-3 h-3" />可信度 {unit.verification_consensus?.toFixed(0)}%</span>}
            <span className="flex items-center gap-1"><ShieldCheck className="w-3 h-3" />审查 {unit.review_count} 次</span>
          </div>
          <div className="flex items-center gap-2 text-xs mt-2 flex-wrap">
            {unit.evolution_stage && (
              <span className={`flex items-center gap-1 px-2 py-0.5 rounded-md border ${evolutionConfig[unit.evolution_stage]?.badgeClass || evolutionConfig.collected.badgeClass}`}>
                <Sprout className="w-3 h-3" />
                {evolutionConfig[unit.evolution_stage]?.label || unit.evolution_stage}
              </span>
            )}
            {(unit.practice_depth || 0) > 0 && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-md border bg-[var(--glass-bg)] text-text-secondary border-[var(--glass-border)]">
                <Dumbbell className="w-3 h-3" />深度 {unit.practice_depth}
              </span>
            )}
            {(unit.invoke_count || 0) > 0 && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-md border bg-[var(--glass-bg)] text-text-secondary border-[var(--glass-border)]">
                <Activity className="w-3 h-3" />调用 {unit.invoke_count}
              </span>
            )}
            {(unit.value_score || 0) > 0 && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-md border bg-[var(--glass-bg)] text-text-secondary border-[var(--glass-border)]">
                <Zap className="w-3 h-3" />价值 {unit.value_score?.toFixed(1)}
              </span>
            )}
          </div>
        </div>
        <div className="text-xs text-text-muted shrink-0">{dateText}</div>
      </div>
    </div>
  );

  if (useMotion) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.2 }}
      >
        {content}
      </motion.div>
    );
  }

  return content;
});
KnowledgeUnitRow.displayName = 'KnowledgeUnitRow';

const KnowledgeUnitList: FC<KnowledgeUnitListProps> = ({ brainSide, title, subtitle, showCreate = true }) => {
  const navigate = useNavigate();
  const { units, isLoading, error, refetch } = useKnowledge(brainSide === 'both' ? undefined : brainSide);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [evolutionFilter, setEvolutionFilter] = useState<EvolutionFilter>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [domainFilter, setDomainFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [showFilters, setShowFilters] = useState(false);

  const filteredUnits = useMemo(() => {
    let data = (units || []) as KnowledgeUnit[];
    if (statusFilter !== 'all') {
      data = data.filter((u) => u.verification_status === statusFilter);
    }
    if (evolutionFilter !== 'all') {
      data = data.filter((u) => (u.evolution_stage || 'collected') === evolutionFilter);
    }
    if (typeFilter !== 'all') {
      data = data.filter((u) => u.content_type === typeFilter);
    }
    if (domainFilter.trim()) {
      const d = domainFilter.toLowerCase();
      data = data.filter((u) => u.source_url?.toLowerCase().includes(d));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      data = data.filter(
        (u) =>
          u.content_raw.toLowerCase().includes(q) ||
          u.source_title?.toLowerCase().includes(q) ||
          u.source_author?.toLowerCase().includes(q)
      );
    }
    data = [...data].sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'created_at') {
        cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      } else if (sortBy === 'confidence') {
        cmp = (a.verification_consensus || 0) - (b.verification_consensus || 0);
      } else if (sortBy === 'verification_status') {
        const order = { confirmed: 0, disputed: 1, debunked: 2, unverified: 3, checking: 4, outdated: 5 };
        cmp = (order[a.verification_status as keyof typeof order] ?? 99) -
              (order[b.verification_status as keyof typeof order] ?? 99);
      } else if (sortBy === 'invoke_count') {
        cmp = (a.invoke_count || 0) - (b.invoke_count || 0);
      } else if (sortBy === 'practice_depth') {
        cmp = (a.practice_depth || 0) - (b.practice_depth || 0);
      } else if (sortBy === 'personal_relevance_score') {
        cmp = (a.personal_relevance_score || 0) - (b.personal_relevance_score || 0);
      } else if (sortBy === 'value_score') {
        cmp = (a.value_score || 0) - (b.value_score || 0);
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });
    return data;
  }, [units, statusFilter, evolutionFilter, typeFilter, domainFilter, searchQuery, sortBy, sortOrder]);

  const displayUnits = useMemo(
    () => filteredUnits.slice(0, MAX_DISPLAY_UNITS),
    [filteredUnits]
  );

  const hiddenCount = filteredUnits.length - displayUnits.length;
  const useRowMotion = filteredUnits.length <= MOTION_THRESHOLD;

  const contentTypes = useMemo(() => {
    const types = new Set<string>();
    (units || []).forEach((u) => { if (u.content_type) types.add(u.content_type); });
    return Array.from(types);
  }, [units]);

  const toggleSort = (field: SortBy) => {
    if (sortBy === field) { setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc')); }
    else { setSortBy(field); setSortOrder('desc'); }
  };

  if (isLoading) {
    return (
      <div className="w-full h-full p-6">
        <div className="flex items-center justify-center h-96">
          <div className="animate-spin w-10 h-10 border-2 border-info border-t-transparent rounded-full" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-full p-6">
        <ErrorState
          title="知识单元加载失败"
          message={error?.message || '无法获取知识列表'}
          onRetry={refetch}
        />
      </div>
    );
  }

  return (
    <div className="w-full h-full p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{title}</h1>
          <p className="text-sm text-text-secondary mt-1">
            {subtitle || `共 ${(units || []).length} 条知识单元`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters((s) => !s)}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--glass-bg)] backdrop-blur border border-[var(--glass-border)] rounded-xl text-sm text-text-primary hover:bg-bg-tertiary transition-all"
          >
            <Filter className="w-4 h-4" /> 筛选
          </button>
          {showCreate && (
            <button
              onClick={() => navigate('/knowledge/create', { state: { brainSide } })}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-info to-network-secondary text-white rounded-xl text-sm font-medium hover:shadow-[0_0_20px_rgba(88,166,255,0.4)] transition-all"
            >
              <Plus className="w-4 h-4" /> 新增知识
            </button>
          )}
        </div>
      </div>

      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="glass-card p-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-text-secondary mb-1.5 block">验证状态</label>
                  <div className="flex flex-wrap gap-2">
                    {(['all', 'confirmed', 'disputed', 'debunked', 'unverified', 'checking', 'outdated'] as StatusFilter[]).map((s) => (
                      <button key={s} onClick={() => setStatusFilter(s)}
                        className={`px-2.5 py-1 rounded-lg text-xs border transition-all ${statusFilter === s ? 'bg-info/15 text-info border-info/30' : 'bg-[var(--glass-bg)] text-text-secondary border-[var(--glass-border)]'}`}>
                        {s === 'all' ? '全部' : statusConfig[s]?.label || s}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs text-text-secondary mb-1.5 block">进化阶段</label>
                  <div className="flex flex-wrap gap-2">
                    {(['all', 'collected', 'understood', 'practiced', 'validated', 'internalized'] as EvolutionFilter[]).map((s) => (
                      <button key={s} onClick={() => setEvolutionFilter(s)}
                        className={`px-2.5 py-1 rounded-lg text-xs border transition-all ${evolutionFilter === s ? 'bg-info/15 text-info border-info/30' : 'bg-[var(--glass-bg)] text-text-secondary border-[var(--glass-border)]'}`}>
                        {s === 'all' ? '全部' : s === 'collected' ? '已收集' : s === 'understood' ? '已理解' : s === 'practiced' ? '已践行' : s === 'validated' ? '已验证' : '已内化'}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs text-text-secondary mb-1.5 block">内容类型</label>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => setTypeFilter('all')}
                      className={`px-2.5 py-1 rounded-lg text-xs border transition-all ${typeFilter === 'all' ? 'bg-info/15 text-info border-info/30' : 'bg-[var(--glass-bg)] text-text-secondary border-[var(--glass-border)]'}`}>全部</button>
                    {contentTypes.map((t) => (
                      <button key={t} onClick={() => setTypeFilter(t)}
                        className={`px-2.5 py-1 rounded-lg text-xs border transition-all ${typeFilter === t ? 'bg-info/15 text-info border-info/30' : 'bg-[var(--glass-bg)] text-text-secondary border-[var(--glass-border)]'}`}>{t}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs text-text-secondary mb-1.5 block">来源域名</label>
                  <div className="relative">
                    <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
                    <input type="text" value={domainFilter} onChange={(e) => setDomainFilter(e.target.value)}
                      placeholder="例如: github.com"
                      className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-lg pl-9 pr-3 py-1.5 text-xs text-text-primary placeholder-text-muted focus:outline-none focus:border-info/40 transition-colors" />
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px] max-w-md">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索知识内容、标题、作者..."
              className="w-full bg-[var(--glass-bg)] border border-[var(--glass-border)] rounded-xl pl-10 pr-4 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-info/40 transition-colors" />
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => toggleSort('created_at')}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs border transition-all ${sortBy === 'created_at' ? 'bg-info/10 text-info border-info/20' : 'bg-[var(--glass-bg)] text-text-secondary border-[var(--glass-border)]'}`}>
            <ArrowUpDown className="w-3 h-3" /> 时间 {sortBy === 'created_at' && (sortOrder === 'asc' ? '↑' : '↓')}
          </button>
          <button onClick={() => toggleSort('confidence')}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs border transition-all ${sortBy === 'confidence' ? 'bg-info/10 text-info border-info/20' : 'bg-[var(--glass-bg)] text-text-secondary border-[var(--glass-border)]'}`}>
            <BarChart3 className="w-3 h-3" /> 可信度 {sortBy === 'confidence' && (sortOrder === 'asc' ? '↑' : '↓')}
          </button>
          <button onClick={() => toggleSort('verification_status')}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs border transition-all ${sortBy === 'verification_status' ? 'bg-info/10 text-info border-info/20' : 'bg-[var(--glass-bg)] text-text-secondary border-[var(--glass-border)]'}`}>
            <Layers className="w-3 h-3" /> 状态 {sortBy === 'verification_status' && (sortOrder === 'asc' ? '↑' : '↓')}
          </button>
          <button onClick={() => toggleSort('invoke_count')}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs border transition-all ${sortBy === 'invoke_count' ? 'bg-info/10 text-info border-info/20' : 'bg-[var(--glass-bg)] text-text-secondary border-[var(--glass-border)]'}`}>
            <Activity className="w-3 h-3" /> 调用 {sortBy === 'invoke_count' && (sortOrder === 'asc' ? '↑' : '↓')}
          </button>
          <button onClick={() => toggleSort('practice_depth')}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs border transition-all ${sortBy === 'practice_depth' ? 'bg-info/10 text-info border-info/20' : 'bg-[var(--glass-bg)] text-text-secondary border-[var(--glass-border)]'}`}>
            <Dumbbell className="w-3 h-3" /> 深度 {sortBy === 'practice_depth' && (sortOrder === 'asc' ? '↑' : '↓')}
          </button>
          <button onClick={() => toggleSort('value_score')}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs border transition-all ${sortBy === 'value_score' ? 'bg-info/10 text-info border-info/20' : 'bg-[var(--glass-bg)] text-text-secondary border-[var(--glass-border)]'}`}>
            <Zap className="w-3 h-3" /> 价值 {sortBy === 'value_score' && (sortOrder === 'asc' ? '↑' : '↓')}
          </button>
        </div>
      </div>

      {filteredUnits.length === 0 ? (
        <div className="glass-card flex flex-col items-center justify-center py-20">
          <BookOpen className="w-16 h-16 text-text-muted/40 mb-4" />
          <p className="text-text-secondary text-sm">暂无知识单元</p>
          <p className="text-text-muted text-xs mt-1">请添加知识或调整筛选条件</p>
        </div>
      ) : (
        <div className="space-y-3">
          {useRowMotion ? (
            <AnimatePresence>
              {displayUnits.map((unit, index) => (
                <KnowledgeUnitRow
                  key={unit.id}
                  unit={unit}
                  brainSide={brainSide}
                  index={index}
                  useMotion={true}
                />
              ))}
            </AnimatePresence>
          ) : (
            displayUnits.map((unit, index) => (
              <KnowledgeUnitRow
                key={unit.id}
                unit={unit}
                brainSide={brainSide}
                index={index}
                useMotion={false}
              />
            ))
          )}
          {hiddenCount > 0 && (
            <div className="flex items-center justify-center gap-2 py-4 text-sm text-text-muted">
              <AlertCircle className="w-4 h-4" />
              还有 {hiddenCount} 条记录未显示，请使用筛选缩小范围
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default KnowledgeUnitList;
