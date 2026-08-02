import { FC } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  Download, Network, Sparkles, Target, Package, Shield, Settings, Brain,
  Globe, FileText, Upload, Rss, Tags, Mail, MessageCircle, BookOpen, FolderOpen,
  Share2, Search, Route, Tag, Clock, Calendar, Link2, BarChart3, GitMerge,
  Fingerprint, AlertTriangle, ClipboardCheck, GitBranch,
  Shuffle, Zap, Combine, HelpCircle,
  PieChart, Timer, TrendingUp,
  List, Plus, BarChart2,
  CheckCircle, GitCommit, Activity, XCircle, Map,
  User, Lock, Cpu, RefreshCw, Puzzle, Database, Palette, Bookmark,
  Scale, Gamepad2, Wallet, Newspaper, Dumbbell, HeartPulse, Filter, Users,
  Workflow, SquareStack, BrainCircuit, FlaskConical, Heart, ShieldAlert, MapPin, Pencil, Monitor
} from 'lucide-react';
import {
  useNavigation,
  useMenuData,
  getBucketByMenuId,
  type MenuId,
} from '@/store/navigation';
import { useSystemFeatures } from '@/hooks/useSystemFeatures';

const ICON_MAP: Record<string, React.ElementType> = {
  Monitor,
  Download, Network, Sparkles, Target, Package, Shield, Settings, Brain,
  Globe, FileText, Upload, Rss, Tag, Tags, Mail, MessageCircle, BookOpen, FolderOpen,
  Share2, Search, Route, Clock, Calendar, Link2, BarChart3, GitMerge,
  Fingerprint, AlertTriangle, ClipboardCheck, GitBranch,
  Shuffle, Zap, Combine, HelpCircle,
  PieChart, Timer, TrendingUp,
  List, Plus, BarChart2,
  CheckCircle, GitCommit, Activity, XCircle, Map,
  User, Lock, Cpu, RefreshCw, Puzzle, Database, Palette, Bookmark,
  Scale, Gamepad2, Wallet, Newspaper, Dumbbell, HeartPulse, Filter, Users,
  Workflow, SquareStack, BrainCircuit, FlaskConical, Heart, ShieldAlert, MapPin, Pencil,
};

const MENU_MODULE_MAP: Record<MenuId, string | null> = {
  ingest: null,
  pipeline: 'pipeline',
  ask: null,
  community: null,
  settings: null,
  graph: null,
  cognitive: 'cognitive',
  emergence: 'emergence',
  attention: null,
  capsules: null,
  knowledge: null,
  'social-brain': 'social_brain',
  'embodied-cognition': 'embodied_cognition',
};

const SubMenuPanel: FC = () => {
  const { activeMenu, subMenuOpen, closeSubMenu } = useNavigation();
  const navigate = useNavigate();
  const { data: systemFeatures } = useSystemFeatures();
  const { menuData, topNavBuckets } = useMenuData();

  const moduleEnabled = (menuId: MenuId) => {
    const key = MENU_MODULE_MAP[menuId];
    if (!key) return true;
    return systemFeatures?.modules?.[key] !== false;
  };

  const handleItemClick = (path: string) => {
    closeSubMenu();
    setTimeout(() => navigate(path), 50);
  };

  const bucket = activeMenu ? getBucketByMenuId(activeMenu, topNavBuckets) : undefined;
  if (!bucket) return null;

  // 过滤被关闭的模块；下拉索引展示全部子项，不按脑侧过滤
  const visibleModules = bucket.moduleIds
    .filter(moduleEnabled)
    .map((menuId) => menuData[menuId])
    .filter(Boolean);

  return (
    <AnimatePresence mode="wait">
      {subMenuOpen && (
        <motion.div
          key={bucket.id}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
          className="overflow-hidden bg-bg-secondary border-b border-border-color z-30 relative"
        >
          <div className="w-full px-6 py-3 max-h-[calc(100vh-10rem)] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-lg font-bold text-text-primary">{bucket.label}</h2>
                <p className="text-xs text-text-secondary mt-0.5">{bucket.description}</p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); closeSubMenu(); }}
                className="p-1.5 rounded-[2px] hover:bg-bg-tertiary text-text-secondary hover:text-text-primary transition-colors pointer-events-auto"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            {visibleModules.length === 0 ? (
              <div className="py-6 text-center text-xs text-text-muted">
                当前桶内没有可用的功能模块
              </div>
            ) : (
              <div className="space-y-4">
                {visibleModules.map((module) => (
                  <div key={module.id}>
                    <div className="flex items-center gap-2 mb-1.5">
                      {(() => {
                        const Icon = ICON_MAP[module.icon] || Brain;
                        return <Icon className="w-3 h-3 text-text-secondary" />;
                      })()}
                      <span className="text-sm font-semibold text-text-secondary">{module.label}</span>
                      <div className="flex-1 h-px bg-border-color/60" />
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2">
                      {module.items.map((item, index) => (
                        <motion.button
                          key={item.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: index * 0.04 }}
                          onClick={() => handleItemClick(item.path)}
                          type="button"
                          className="flex flex-col items-center gap-1.5 p-2 rounded-[2px] liquid-glass bg-bg-secondary transition-all duration-300 group overflow-hidden min-h-[66px]"
                        >
                          <div className="relative z-10 w-6 h-6 rounded-[2px] bg-bg-tertiary flex items-center justify-center text-info group-hover:bg-bg-hover transition-all duration-300 shrink-0">
                            {(() => {
                              const Icon = ICON_MAP[item.icon] || Brain;
                              return <Icon className="w-3.5 h-3.5" />;
                            })()}
                          </div>
                          <div className="relative z-10 text-center w-full min-w-0">
                            <div className="text-xs font-medium text-text-primary group-hover:text-info transition-colors truncate">{item.label}</div>
                            <div className="text-[10px] text-text-muted mt-0.5 line-clamp-1 leading-tight break-all max-w-full">{item.description}</div>
                          </div>
                        </motion.button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default SubMenuPanel;
