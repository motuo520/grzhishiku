import { FC, useEffect, useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Download, Network, Sparkles, Target, Package, Shield, Settings, Brain,
  LogOut, User, Search, Sun, Moon, Monitor, MessageSquare, Users, Workflow,
  Layers, LayoutGrid, Map, Calendar,
} from 'lucide-react';
import {
  useNavigation,
  useMenuData,
  type MenuId,
  getMenuIdByPath,
  getBucketByMenuId,
} from '@/store/navigation';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useSystemFeatures } from '@/hooks/useSystemFeatures';
import { useSettings } from '@/store/settings';
import BrandLogo from '@/components/common/BrandLogo';

const ICON_MAP: Record<string, React.ElementType> = {
  Monitor,
  Download, Network, Sparkles, Target, Package, Shield, Settings, Brain,
  Users, Workflow, User, MessageSquare, Map, Calendar,
};

const MENU_MODULE_MAP: Record<MenuId, string | null> = {
  ingest: null,
  pipeline: 'pipeline',
  ask: null,
  daily: null,
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

interface TopNavigationProps {
  onLoginClick?: () => void;
}

const TopNavigation: FC<TopNavigationProps> = ({ onLoginClick }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { activeMenu, setActiveMenu, toggleSubMenu, subMenuOpen } = useNavigation();
  const { user, isLoggedIn, logout } = useAuth();
  const { data: systemFeatures } = useSystemFeatures();
  const theme = useSettings((state) => state.theme);
  const setTheme = useSettings((state) => state.setTheme);
  const uiMode = useSettings((state) => state.uiMode);
  const setUiMode = useSettings((state) => state.setUiMode);
  const { menuData, topNavBuckets } = useMenuData();
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const cycleTheme = () => {
    const order: Array<'dark' | 'light' | 'system'> = ['dark', 'light', 'system'];
    const next = order[(order.indexOf(theme) + 1) % order.length];
    setTheme(next);
  };

  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;

  const moduleEnabled = useCallback((menuId: MenuId) => {
    const key = MENU_MODULE_MAP[menuId];
    if (!key) return true;
    return systemFeatures?.modules?.[key] !== false;
  }, [systemFeatures]);

  // 根据当前路径推导所在模块和一级桶，保证直接访问 URL 时顶部高亮正确
  const currentMenuId = getMenuIdByPath(location.pathname, menuData);
  const currentBucket = getBucketByMenuId(currentMenuId, topNavBuckets);

  const handleBucketClick = useCallback((bucketId: string) => {
    const bucket = topNavBuckets.find((b) => b.id === bucketId);
    if (!bucket) return;
    // 如果桶内主模块被关闭，则使用第一个仍开启的模块
    const enabledIds = bucket.moduleIds.filter(moduleEnabled);
    const targetMenuId = enabledIds[0] || bucket.primaryModuleId;

    if (activeMenu === targetMenuId) {
      toggleSubMenu();
    } else {
      setActiveMenu(targetMenuId);
    }
  }, [activeMenu, setActiveMenu, toggleSubMenu, topNavBuckets, moduleEnabled]);

  // Keyboard shortcuts: Ctrl+1~3 for top buckets
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
        const index = parseInt(e.key, 10) - 1;
        const bucket = topNavBuckets[index];
        if (bucket) {
          handleBucketClick(bucket.id);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleBucketClick, topNavBuckets]);

  return (
    <>
      <nav className="px-4 py-2 relative z-10">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          {/* Logo */}
          <BrandLogo size={32} />

          {/* Main Menu: 3 buckets */}
          <div className="flex items-center gap-1">
            {topNavBuckets.map((bucket, index) => {
              const Icon = ICON_MAP[bucket.icon] || Brain;
              const isActive = currentBucket?.id === bucket.id;

              return (
                <button
                  key={bucket.id}
                  onClick={() => handleBucketClick(bucket.id)}
                  className={`
                    relative flex items-center gap-2 px-3 py-2 rounded-[2px] text-sm font-medium transition-colors duration-200
                    ${isActive
                      ? 'text-text-primary bg-bg-tertiary border border-border-color'
                      : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover border border-transparent'
                    }
                  `}
                  title={`${bucket.label} (Ctrl+${index + 1})`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="hidden md:inline">{bucket.label}</span>
                  {isActive && subMenuOpen && (
                    <motion.div
                      layoutId="activeMenuIndicator"
                      className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-accent"
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* Right Actions: Search + Theme + User */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => navigate('/search')}
              className="p-2 rounded-[2px] hover:bg-bg-tertiary text-text-secondary hover:text-accent transition-colors duration-200"
              title="全局搜索 /search"
            >
              <Search className="w-4 h-4" />
            </button>

            <button
              onClick={() => setUiMode(uiMode === 'classic' ? 'simple' : 'classic')}
              className="p-2 rounded-[2px] hover:bg-bg-tertiary text-text-secondary hover:text-accent transition-colors duration-200"
              title={`界面版本：${uiMode === 'classic' ? '经典版（完整功能）' : '简化版（三个动作）'} (点击切换)`}
            >
              {uiMode === 'classic' ? <LayoutGrid className="w-4 h-4" /> : <Layers className="w-4 h-4" />}
            </button>

            <button
              onClick={cycleTheme}
              className="p-2 rounded-[2px] hover:bg-bg-tertiary text-text-secondary hover:text-accent transition-colors duration-200"
              title={`主题：${theme === 'light' ? '浅色' : theme === 'dark' ? '深色' : '跟随系统'} (点击切换)`}
            >
              <ThemeIcon className="w-4 h-4" />
            </button>

            {isLoggedIn && user ? (
              <div className="relative">
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-[2px] hover:bg-bg-hover transition-colors"
                >
                  <div className="w-7 h-7 rounded-[2px] bg-accent text-[#f6ece6] flex items-center justify-center text-xs font-bold">
                    {user.name?.charAt(0).toUpperCase() || user.email?.charAt(0).toUpperCase() || 'U'}
                  </div>
                  <span className="text-sm text-text-secondary hidden sm:inline">{user.name || user.email}</span>
                  <motion.svg
                    width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    className="text-text-muted"
                    animate={{ rotate: userMenuOpen ? 180 : 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </motion.svg>
                </button>

                <AnimatePresence>
                  {userMenuOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -5, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -5, scale: 0.95 }}
                      transition={{ duration: 0.15 }}
                      className="absolute right-0 top-full mt-2 w-48 glass-popup rounded-[2px] border border-border-color py-1 z-50"
                    >
                      <button
                        onClick={() => { navigate('/settings/account'); setUserMenuOpen(false); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-text-primary hover:bg-bg-hover transition-colors"
                      >
                        <User className="w-4 h-4 text-text-secondary" />
                        个人资料
                      </button>
                      <button
                        onClick={() => { navigate('/settings/account'); setUserMenuOpen(false); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-text-primary hover:bg-bg-hover transition-colors"
                      >
                        <Settings className="w-4 h-4 text-text-secondary" />
                        设置
                      </button>
                      <div className="border-t border-border-color my-1" />
                      <button
                        onClick={() => {
                          logout();
                          navigate('/welcome');
                          setUserMenuOpen(false);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-danger hover:bg-danger/10 transition-colors"
                      >
                        <LogOut className="w-4 h-4" />
                        退出登录
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ) : (
              <button
                onClick={() => onLoginClick ? onLoginClick() : navigate('/welcome')}
                className="px-3 py-1.5 rounded-[2px] border border-accent/40 text-accent hover:bg-accent/10 text-xs font-medium transition-colors"
              >
                登录 / 注册
              </button>
            )}
          </div>
        </div>
      </nav>

      {/* Click outside to close user menu */}
      {userMenuOpen && (
        <div
          className="fixed inset-0 z-0"
          onClick={() => setUserMenuOpen(false)}
        />
      )}
    </>
  );
};

export default TopNavigation;
