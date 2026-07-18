import { FC, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, FileText, Globe, Package, BookOpen, Calendar, ArrowUpDown, X,
  Brain, User, ChevronDown, Loader2
} from 'lucide-react';
import { useBrain } from '@/hooks/useBrain';
import { brainApi } from '@/api/brain';
import type { BrainSide } from '@/types';

interface SearchResultItem {
  id: string;
  type: string;
  title: string;
  brain_side: BrainSide;
  content: string;
  relevance_score: number;
  source_url: string | null;
  created_at: string;
}

const TYPE_LABELS: Record<string, { label: string; icon: React.ElementType; color: string; bg: string }> = {
  note: { label: '笔记', icon: FileText, color: 'text-personal-primary', bg: 'bg-personal-primary/10' },
  capsule: { label: '胶囊', icon: Package, color: 'text-success', bg: 'bg-success/10' },
  clip: { label: '剪藏', icon: Globe, color: 'text-network-primary', bg: 'bg-network-primary/10' },
  knowledge: { label: '知识', icon: BookOpen, color: 'text-fusion-primary', bg: 'bg-fusion-primary/10' },
};

const TIME_RANGES = [
  { label: '全部', value: 'all' },
  { label: '最近1天', value: '1d' },
  { label: '最近7天', value: '7d' },
  { label: '最近30天', value: '30d' },
];

const SearchPage: FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { activeBrain } = useBrain();

  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'personal' | 'network'>('all');

  const [filterTypes, setFilterTypes] = useState<Record<string, boolean>>({
    note: true, capsule: true, clip: true, knowledge: true,
  });
  const [timeRange, setTimeRange] = useState('all');
  const [sortBy, setSortBy] = useState<'relevance' | 'time'>('relevance');

  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionRef = useRef<HTMLDivElement>(null);

  // Keyboard shortcut "/" to focus
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const fetchSuggestions = useCallback(async (q: string) => {
    if (!q.trim() || q.length < 2) {
      setSuggestions([]);
      return;
    }
    try {
      const res = await brainApi.fusionSearch(q, [activeBrain as BrainSide]);
      const titles = res.data.results.map((r: any) => r.title).filter(Boolean);
      setSuggestions(titles.slice(0, 6));
    } catch (e) {
      setSuggestions([]);
    }
  }, [activeBrain]);

  const performSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const sides: BrainSide[] = activeTab === 'all' ? ['personal', 'network'] : [activeTab as BrainSide];
      const res = await brainApi.fusionSearch(searchQuery, sides);
      setResults(res.data.results || []);
    } catch (e) {
      console.error('Search failed', e);
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    const q = searchParams.get('q') || '';
    setQuery(q);
    if (q) performSearch(q);
  }, [searchParams, performSearch]);

  const handleInputChange = (value: string) => {
    setQuery(value);
    setShowSuggestions(true);
    fetchSuggestions(value);
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    setShowSuggestions(false);
    setSearchParams({ q: query });
    performSearch(query);
  };

  const handleSuggestionClick = (s: string) => {
    setQuery(s);
    setShowSuggestions(false);
    setSearchParams({ q: s });
    performSearch(s);
  };

  // Click outside to close suggestions
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (suggestionRef.current && !suggestionRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filteredResults = useMemo(() => {
    let list = results.filter((r) => filterTypes[r.type]);
    if (activeTab !== 'all') {
      list = list.filter((r) => r.brain_side === activeTab || r.brain_side === 'both');
    }
    if (timeRange !== 'all') {
      const now = new Date();
      const days = timeRange === '1d' ? 1 : timeRange === '7d' ? 7 : 30;
      const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      list = list.filter((r) => r.created_at && new Date(r.created_at) >= cutoff);
    }
    if (sortBy === 'time') {
      list = [...list].sort((a, b) => (new Date(b.created_at).getTime() || 0) - (new Date(a.created_at).getTime() || 0));
    }
    return list;
  }, [results, filterTypes, activeTab, timeRange, sortBy]);

  const grouped = useMemo(() => {
    const personal = filteredResults.filter((r) => r.brain_side === 'personal');
    const network = filteredResults.filter((r) => r.brain_side === 'network');
    const both = filteredResults.filter((r) => r.brain_side === 'both');
    return { personal, network, both };
  }, [filteredResults]);

  const renderResultCard = (item: SearchResultItem) => {
    const meta = TYPE_LABELS[item.type] || TYPE_LABELS.note;
    const Icon = meta.icon;
    return (
      <motion.div
        key={item.id}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-bg-secondary/60 border border-white/[0.06] rounded-[2px] p-4 hover:border-white/[0.12] transition-all cursor-pointer group"
        onClick={() => {
          const pathMap: Record<string, string> = {
            note: `/ingest/notes/${item.id}`,
            capsule: `/capsules/${item.id}`,
            clip: `/ingest/clipper`,
            knowledge: `/knowledge/network`,
          };
          navigate(pathMap[item.type] || '/');
        }}
      >
        <div className="flex items-start gap-3">
          <div className={`w-9 h-9 rounded-[2px] ${meta.bg} flex items-center justify-center flex-shrink-0`}>
            <Icon className={`w-4 h-4 ${meta.color}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-sm font-medium text-text-primary group-hover:text-info transition-colors truncate">
                {item.title}
              </h3>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${meta.bg} ${meta.color} font-medium`}>
                {meta.label}
              </span>
              {item.brain_side === 'personal' && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-personal-primary/10 text-personal-primary">个人</span>
              )}
              {item.brain_side === 'network' && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-network-primary/10 text-network-primary">网络</span>
              )}
            </div>
            <p className="text-xs text-text-secondary leading-relaxed line-clamp-2">{item.content}</p>
            <div className="flex items-center gap-3 mt-2 text-[10px] text-text-muted">
              {item.source_url && (
                <span className="flex items-center gap-1 truncate max-w-[200px]">
                  <Globe className="w-3 h-3" />
                  {item.source_url}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                {item.created_at ? new Date(item.created_at).toLocaleDateString('zh-CN') : '未知'}
              </span>
              <span className="flex items-center gap-1">
                <ArrowUpDown className="w-3 h-3" />
                相关度 {item.relevance_score.toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      </motion.div>
    );
  };

  return (
    <div className="max-w-5xl mx-auto h-full flex flex-col">
      {/* Search Header */}
      <div className="flex-shrink-0 pt-6 pb-4">
        <form onSubmit={handleSubmit} className="relative">
          <div className="relative flex items-center">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => handleInputChange(e.target.value)}
              placeholder="融合搜索：跨脑查找笔记、知识、剪藏..."
              className="w-full pl-12 pr-24 py-4 bg-bg-secondary border border-white/[0.06] rounded-[2px] text-text-primary placeholder-text-muted focus:outline-none focus:border-info/50 transition-all text-base"
            />
            <div className="absolute right-4 flex items-center gap-2">
              {query && (
                <button
                  type="button"
                  onClick={() => { setQuery(''); setResults([]); setSearchParams({}); }}
                  className="p-1.5 rounded-[2px] hover:bg-white/[0.08] text-text-muted hover:text-text-primary transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
              <kbd className="hidden sm:inline-flex items-center px-2 py-1 text-[10px] bg-bg-tertiary border border-border-color rounded text-text-muted">
                Enter
              </kbd>
            </div>
          </div>

          {/* Suggestions Dropdown */}
          <AnimatePresence>
            {showSuggestions && suggestions.length > 0 && (
              <motion.div
                ref={suggestionRef}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="absolute top-full left-0 right-0 mt-2 bg-bg-secondary border border-white/[0.06] rounded-[2px] z-50 overflow-hidden"
              >
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => handleSuggestionClick(s)}
                    className="w-full text-left px-4 py-2.5 text-sm text-text-secondary hover:bg-white/[0.05] hover:text-text-primary transition-colors flex items-center gap-2"
                  >
                    <Search className="w-3.5 h-3.5 text-text-muted" />
                    {s}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </form>
      </div>

      {/* Filters */}
      <div className="flex-shrink-0 flex items-center gap-3 mb-4 overflow-x-auto pb-1">
        {/* Tabs */}
        <div className="flex items-center gap-1 bg-bg-tertiary rounded-[2px] p-1">
          {([
            { id: 'all', label: '全部', icon: Brain },
            { id: 'personal', label: '个人脑', icon: User },
            { id: 'network', label: '网络脑', icon: Globe },
          ] as const).map((tab) => {
            const isActive = activeTab === tab.id;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-bg-secondary text-text-primary shadow-sm'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Type Filters */}
        <div className="flex items-center gap-1">
          {Object.entries(filterTypes).map(([type, active]) => {
            const meta = TYPE_LABELS[type] || TYPE_LABELS.note;
            return (
              <button
                key={type}
                onClick={() => setFilterTypes((prev) => ({ ...prev, [type]: !prev[type] }))}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[10px] font-medium border transition-all ${
                  active ? 'border-white/[0.1] text-text-primary' : 'border-transparent text-text-muted opacity-50'
                }`}
                style={{
                  background: active ? `${meta.color.replace('text-', 'bg-')}/10` : undefined,
                }}
              >
                <meta.icon className={`w-3 h-3 ${active ? meta.color : ''}`} />
                {meta.label}
              </button>
            );
          })}
        </div>

        {/* Time Range */}
        <div className="relative group">
          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-[2px] text-xs text-text-muted hover:text-text-primary hover:bg-white/[0.05] transition-all border border-white/[0.06]">
            <Calendar className="w-3.5 h-3.5" />
            {TIME_RANGES.find((t) => t.value === timeRange)?.label}
            <ChevronDown className="w-3 h-3" />
          </button>
          <div className="absolute top-full left-0 mt-1 hidden group-hover:block bg-bg-secondary border border-white/[0.06] rounded-[2px] p-1 z-40 min-w-[100px]">
            {TIME_RANGES.map((t) => (
              <button
                key={t.value}
                onClick={() => setTimeRange(t.value)}
                className={`w-full text-left px-3 py-1.5 rounded-md text-xs transition-colors ${
                  timeRange === t.value ? 'text-info bg-info/10' : 'text-text-secondary hover:bg-white/[0.05]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Sort */}
        <button
          onClick={() => setSortBy((prev) => (prev === 'relevance' ? 'time' : 'relevance'))}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-[2px] text-xs text-text-muted hover:text-text-primary hover:bg-white/[0.05] transition-all border border-white/[0.06]"
        >
          <ArrowUpDown className="w-3.5 h-3.5" />
          {sortBy === 'relevance' ? '相关度' : '时间'}
        </button>
      </div>

      {/* Results Area */}
      <div className="flex-1 overflow-y-auto pb-6">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-text-muted">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            搜索中...
          </div>
        ) : filteredResults.length > 0 ? (
          <div className="space-y-3">
            {activeTab === 'all' ? (
              <>
                {grouped.personal.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2 px-1">
                      <User className="w-3.5 h-3.5 text-personal-primary" />
                      <span className="text-xs font-semibold text-personal-primary uppercase tracking-wider">个人脑</span>
                      <span className="text-[10px] text-text-muted">{grouped.personal.length} 条</span>
                    </div>
                    <div className="space-y-2">
                      {grouped.personal.map(renderResultCard)}
                    </div>
                  </div>
                )}
                {grouped.network.length > 0 && (
                  <div className="mt-4">
                    <div className="flex items-center gap-2 mb-2 px-1">
                      <Globe className="w-3.5 h-3.5 text-network-primary" />
                      <span className="text-xs font-semibold text-network-primary uppercase tracking-wider">网络脑</span>
                      <span className="text-[10px] text-text-muted">{grouped.network.length} 条</span>
                    </div>
                    <div className="space-y-2">
                      {grouped.network.map(renderResultCard)}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-3">
                {filteredResults.map(renderResultCard)}
              </div>
            )}
          </div>
        ) : query ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-[2px] bg-bg-tertiary border border-white/[0.06] flex items-center justify-center mx-auto mb-4">
              <Search className="w-7 h-7 text-text-muted" />
            </div>
            <div className="text-sm text-text-secondary mb-1">未找到相关内容</div>
            <div className="text-xs text-text-muted">尝试其他关键词或调整筛选条件</div>
          </div>
        ) : (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-[2px] bg-bg-tertiary border border-white/[0.06] flex items-center justify-center mx-auto mb-4">
              <Brain className="w-7 h-7 text-text-muted" />
            </div>
            <div className="text-sm text-text-secondary mb-1">输入关键词开始跨脑搜索</div>
            <div className="text-xs text-text-muted">支持笔记、胶囊、剪藏、知识单元</div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchPage;
