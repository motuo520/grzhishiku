import { FC, useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Search, FileText, Globe, Package, BookOpen, Target } from 'lucide-react';

interface SearchResult {
  id: string;
  title: string;
  type: string;
  brainSide: 'personal' | 'network' | 'both';
  path: string;
  snippet: string;
}

const MOCK_RESULTS: SearchResult[] = [
  { id: '1', title: 'React 19 新特性', type: '知识', brainSide: 'network', path: '/knowledge/network', snippet: 'React 19 引入了新的编译器...' },
  { id: '2', title: '2025年目标', type: '胶囊', brainSide: 'personal', path: '/capsules/my', snippet: '封存于 2025-01-01...' },
  { id: '3', title: 'AI 发展趋势', type: '知识', brainSide: 'network', path: '/knowledge/network', snippet: '2025年AI发展的关键趋势...' },
  { id: '4', title: '项目复盘', type: '笔记', brainSide: 'personal', path: '/ingest/notes', snippet: '本周项目进展总结...' },
  { id: '5', title: '深度工作记录', type: '注意力', brainSide: 'personal', path: '/attention/dashboard', snippet: '今日专注 3.5 小时...' },
];

interface GlobalSearchProps {
  isOpen: boolean;
  onClose: () => void;
}

const GlobalSearch: FC<GlobalSearchProps> = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [results, setResults] = useState<SearchResult[]>([]);
  const navigate = useNavigate();

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (isOpen) {
        onClose();
      } else {
        // Open search - handled by parent
      }
    }

    if (!isOpen) return;

    if (e.key === 'Escape') {
      onClose();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[selectedIndex]) {
        navigate(results[selectedIndex].path);
        onClose();
      }
    }
  }, [isOpen, onClose, results, selectedIndex, navigate]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (query.length > 0) {
      const filtered = MOCK_RESULTS.filter(
        (r) => r.title.toLowerCase().includes(query.toLowerCase()) ||
               r.snippet.toLowerCase().includes(query.toLowerCase())
      );
      setResults(filtered);
      setSelectedIndex(0);
    } else {
      setResults([]);
    }
  }, [query]);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
    }
  }, [isOpen]);

  const getIcon = (type: string) => {
    switch (type) {
      case '笔记': return FileText;
      case '知识': return BookOpen;
      case '胶囊': return Package;
      case '注意力': return Target;
      default: return Globe;
    }
  };

  const getBrainColor = (side: string) => {
    switch (side) {
      case 'personal': return 'border-personal-primary text-personal-primary';
      case 'network': return 'border-network-primary text-network-primary';
      default: return 'border-fusion-primary text-fusion-primary';
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
          onClick={onClose}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

          {/* Search Modal */}
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="relative w-full max-w-xl mx-4 bg-bg-secondary border border-border-color rounded-xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Search Input */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border-color">
              <Search className="w-5 h-5 text-text-muted" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索笔记、知识、胶囊..."
                className="flex-1 bg-transparent border-none text-text-primary placeholder-text-muted focus:outline-none text-base"
                autoFocus
              />
              <kbd className="px-2 py-1 text-xs bg-bg-tertiary border border-border-color rounded text-text-muted">
                ESC
              </kbd>
            </div>

            {/* Results */}
            <div className="max-h-80 overflow-y-auto">
              {results.length > 0 ? (
                <div className="py-2">
                  {results.map((result, index) => {
                    const Icon = getIcon(result.type);
                    const isSelected = index === selectedIndex;
                    return (
                      <button
                        key={result.id}
                        onClick={() => {
                          navigate(result.path);
                          onClose();
                        }}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-all ${
                          isSelected ? 'bg-info/10' : 'hover:bg-bg-tertiary'
                        }`}
                      >
                        <div className={`w-8 h-8 rounded-lg border flex items-center justify-center ${getBrainColor(result.brainSide)}`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-text-primary truncate">{result.title}</div>
                          <div className="text-xs text-text-muted truncate">{result.snippet}</div>
                        </div>
                        <span className="text-xs text-text-muted px-2 py-0.5 rounded-full bg-bg-tertiary">
                          {result.type}
                        </span>
                      </button>
                    );
                  })}
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
                        className="px-3 py-1 text-xs bg-bg-tertiary border border-border-color rounded-full text-text-secondary hover:text-text-primary hover:border-info/50 transition-all"
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-4 py-2 border-t border-border-color bg-bg-tertiary/50">
              <div className="flex items-center gap-3 text-xs text-text-muted">
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 bg-bg-tertiary border border-border-color rounded text-[10px]">↑↓</kbd>
                  导航
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 bg-bg-tertiary border border-border-color rounded text-[10px]">↵</kbd>
                  选择
                </span>
              </div>
              <span className="text-xs text-text-muted">
                {results.length} 个结果
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default GlobalSearch;
