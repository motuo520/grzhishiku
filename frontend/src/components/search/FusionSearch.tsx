import { FC, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Search, FileText, Globe, Package, BookOpen, Target, User, Link, Brain } from 'lucide-react';

import type { BrainSide } from '@/types';

interface FusionSearchResult {
  id: string;
  title: string;
  type: string;
  brainSide: BrainSide;
  path: string;
  snippet: string;
  relevanceScore: number;
}

const MOCK_FUSION_RESULTS: FusionSearchResult[] = [
  { id: '1', title: 'React 19 新特性', type: '知识', brainSide: 'network', path: '/knowledge/network', snippet: 'React 19 引入了新的编译器...', relevanceScore: 0.95 },
  { id: '2', title: '2025年目标', type: '胶囊', brainSide: 'personal', path: '/capsules/my', snippet: '封存于 2025-01-01...', relevanceScore: 0.88 },
  { id: '3', title: 'AI 发展趋势', type: '知识', brainSide: 'network', path: '/knowledge/network', snippet: '2025年AI发展的关键趋势...', relevanceScore: 0.82 },
  { id: '4', title: '项目复盘', type: '笔记', brainSide: 'personal', path: '/ingest/notes', snippet: '本周项目进展总结...', relevanceScore: 0.75 },
  { id: '5', title: '深度工作记录', type: '注意力', brainSide: 'personal', path: '/attention/dashboard', snippet: '今日专注 3.5 小时...', relevanceScore: 0.70 },
  { id: '6', title: '跨脑关联测试', type: '关联', brainSide: 'both', path: '/graph/network', snippet: '个人笔记与网络知识的关联...', relevanceScore: 0.65 },
];

interface FusionSearchProps {
  isOpen: boolean;
  onClose: () => void;
}

const FusionSearch: FC<FusionSearchProps> = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState('');
  const [brainFilter, setBrainFilter] = useState<BrainSide | 'all'>('all');
  const navigate = useNavigate();

  const getFilteredResults = () => {
    let filtered = MOCK_FUSION_RESULTS;
    if (brainFilter !== 'all') {
      filtered = filtered.filter((r) => r.brainSide === brainFilter || r.brainSide === 'both');
    }
    if (query) {
      filtered = filtered.filter((r) => 
        r.title.toLowerCase().includes(query.toLowerCase()) ||
        r.snippet.toLowerCase().includes(query.toLowerCase())
      );
    }
    return filtered;
  };

  const filteredResults = getFilteredResults();
  const groupedResults = {
    personal: filteredResults.filter((r) => r.brainSide === 'personal'),
    network: filteredResults.filter((r) => r.brainSide === 'network'),
    both: filteredResults.filter((r) => r.brainSide === 'both'),
  };

  const getIcon = (type: string) => {
    switch (type) {
      case '笔记': return FileText;
      case '知识': return BookOpen;
      case '胶囊': return Package;
      case '注意力': return Target;
      case '关联': return Link;
      default: return Globe;
    }
  };

  const getBrainBorder = (side: BrainSide) => {
    switch (side) {
      case 'personal': return 'border-l-2 border-l-personal-primary';
      case 'network': return 'border-l-2 border-l-network-primary';
      case 'both': return 'border-l-2 border-l-fusion-primary';
      default: return '';
    }
  };

  const getBrainBadge = (side: BrainSide) => {
    switch (side) {
      case 'personal': return 'bg-personal-primary/10 text-personal-primary';
      case 'network': return 'bg-network-primary/10 text-network-primary';
      case 'both': return 'bg-fusion-primary/10 text-fusion-primary';
      default: return 'bg-bg-tertiary text-text-muted';
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-black/60" />
          
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="relative w-full max-w-2xl mx-4 glass-strong border border-border-color rounded-[2px] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Search Input */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border-color">
              <Search className="w-5 h-5 text-text-muted" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="融合搜索：跨脑查找笔记、知识、胶囊..."
                className="flex-1 bg-transparent border-none text-text-primary placeholder-text-muted focus:outline-none text-base"
                autoFocus
              />
              <div className="flex items-center gap-1">
                {(['all', 'personal', 'network'] as const).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setBrainFilter(filter)}
                    className={`px-2 py-1 rounded text-xs font-medium transition-all ${
                      brainFilter === filter
                        ? filter === 'personal' ? 'bg-personal-primary/20 text-personal-primary' :
                          filter === 'network' ? 'bg-network-primary/20 text-network-primary' :
                          'bg-info/20 text-info'
                        : 'text-text-muted hover:text-text-secondary'
                    }`}
                  >
                    {filter === 'all' ? '全部' : filter === 'personal' ? '个人' : '网络'}
                  </button>
                ))}
              </div>
              <kbd className="px-2 py-1 text-xs bg-bg-secondary border border-border-color rounded text-text-secondary">ESC</kbd>
            </div>

            {/* Results - Grouped by Brain */}
            <div className="max-h-96 overflow-y-auto">
              {filteredResults.length > 0 ? (
                <div className="py-2">
                  {/* Personal Brain Results */}
                  {groupedResults.personal.length > 0 && (
                    <div className="mb-2">
                      <div className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-personal-primary uppercase tracking-wider">
                        <User className="w-3 h-3" />
                        个人脑 ({groupedResults.personal.length})
                      </div>
                      {groupedResults.personal.map((result) => {
                        const Icon = getIcon(result.type);
                        return (
                          <button
                            key={result.id}
                            onClick={() => { navigate(result.path); onClose(); }}
                            className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-bg-hover transition-all ${getBrainBorder(result.brainSide)}`}
                          >
                            <div className="w-8 h-8 rounded-[2px] bg-personal-primary/10 flex items-center justify-center text-personal-primary">
                              <Icon className="w-4 h-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm text-text-primary truncate">{result.title}</div>
                              <div className="text-xs text-text-muted truncate">{result.snippet}</div>
                            </div>
                            <span className={`text-xs px-2 py-0.5 rounded-full ${getBrainBadge(result.brainSide)}`}>
                              {result.type}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Network Brain Results */}
                  {groupedResults.network.length > 0 && (
                    <div className="mb-2">
                      <div className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-network-primary uppercase tracking-wider">
                        <Globe className="w-3 h-3" />
                        网络脑 ({groupedResults.network.length})
                      </div>
                      {groupedResults.network.map((result) => {
                        const Icon = getIcon(result.type);
                        return (
                          <button
                            key={result.id}
                            onClick={() => { navigate(result.path); onClose(); }}
                            className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-bg-hover transition-all ${getBrainBorder(result.brainSide)}`}
                          >
                            <div className="w-8 h-8 rounded-[2px] bg-network-primary/10 flex items-center justify-center text-network-primary">
                              <Icon className="w-4 h-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm text-text-primary truncate">{result.title}</div>
                              <div className="text-xs text-text-muted truncate">{result.snippet}</div>
                            </div>
                            <span className={`text-xs px-2 py-0.5 rounded-full ${getBrainBadge(result.brainSide)}`}>
                              {result.type}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Cross-Brain Results */}
                  {groupedResults.both.length > 0 && (
                    <div className="mb-2">
                      <div className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-fusion-primary uppercase tracking-wider">
                        <Brain className="w-3 h-3" />
                        跨脑关联 ({groupedResults.both.length})
                      </div>
                      {groupedResults.both.map((result) => {
                        const Icon = getIcon(result.type);
                        return (
                          <button
                            key={result.id}
                            onClick={() => { navigate(result.path); onClose(); }}
                            className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-bg-hover transition-all ${getBrainBorder(result.brainSide)}`}
                          >
                            <div className="w-8 h-8 rounded-[2px] bg-fusion-primary/10 flex items-center justify-center text-fusion-primary">
                              <Icon className="w-4 h-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm text-text-primary truncate">{result.title}</div>
                              <div className="text-xs text-text-muted truncate">{result.snippet}</div>
                            </div>
                            <span className={`text-xs px-2 py-0.5 rounded-full ${getBrainBadge(result.brainSide)}`}>
                              {result.type}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : query.length > 0 ? (
                <div className="py-8 text-center">
                  <div className="text-text-muted text-sm">未找到相关结果</div>
                </div>
              ) : (
                <div className="py-4 px-4">
                  <div className="text-xs text-text-muted mb-2">最近搜索</div>
                  <div className="flex flex-wrap gap-2">
                    {['React 19', 'AI 趋势', '时间管理', '目标设定'].map((tag) => (
                      <button
                        key={tag}
                        onClick={() => setQuery(tag)}
                        className="px-3 py-1 text-xs bg-bg-secondary border border-border-color rounded-full text-text-secondary hover:text-text-primary hover:border-border-color transition-all"
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-4 py-2 border-t border-border-color bg-bg-secondary/80">
              <div className="flex items-center gap-3 text-xs text-text-muted">
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 bg-bg-secondary border border-border-color rounded text-[10px]">↑↓</kbd>
                  导航
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 bg-bg-secondary border border-border-color rounded text-[10px]">↵</kbd>
                  选择
                </span>
              </div>
              <span className="text-xs text-text-muted">
                {filteredResults.length} 个结果
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default FusionSearch;
