import { FC, useState, useEffect, Suspense, lazy, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Outlet, useLocation } from 'react-router-dom';

import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/store/settings';
import TopNavigation from '@/components/navigation/TopNavigation';
import SubMenuPanel from '@/components/navigation/SubMenuPanel';
import Sidebar from '@/components/navigation/Sidebar';
import FusionSearch from '@/components/search/FusionSearch';
import ChatInputBar from '@/components/navigation/ChatInputBar';

import AnnouncementBanner from '@/components/common/AnnouncementBanner';
import LoginModal from '@/components/auth/LoginModal';
import MascotWidget from '@/components/mascot/MascotWidget';

const MoonlitRipple = lazy(() => import('@/components/backgrounds/MoonlitRipple'));

const AppLayout: FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const { isLoggedIn, isLoading } = useAuth();
  const theme = useSettings((state) => state.theme);
  const location = useLocation();

  const isDark = useMemo(() => {
    if (theme === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return theme === 'dark';
  }, [theme]);

  // Only run the expensive WebGL shader on the dashboard/welcome; use static
  // gradients on data-heavy module pages to avoid constant GPU load.
  const showWebGLBackground = useMemo(() => {
    const path = location.pathname;
    return path === '/' || path === '/welcome' || path === '/app';
  }, [location.pathname]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-primary">
        <div className="w-8 h-8 border-2 border-info border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-bg-primary relative">
      {/* 湖光 WebGL 背景 — 仅深色主题且仅在首页/仪表盘显示，避免数据页持续 GPU 占用 */}
      {isDark && showWebGLBackground && (
        <div className="fixed inset-0 z-0 pointer-events-none">
          <Suspense fallback={null}>
            <MoonlitRipple />
          </Suspense>
        </div>
      )}

      {/* 暗角遮罩，突出内容 — 仅深色主题显示 */}
      {isDark && (
        <div
          className="fixed inset-0 z-[1] pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse at 50% 45%, transparent 25%, rgba(0,0,0,0.45) 100%)',
          }}
        />
      )}

      {/* 模块页深色静态渐变背景（替代 WebGL）— 暖黑色调，与全局令牌统一 */}
      {isDark && !showWebGLBackground && (
        <div
          className="fixed inset-0 z-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse at 50% 0%, rgba(200,149,108,0.03) 0%, transparent 50%), ' +
              'linear-gradient(180deg, #121110 0%, #0f0e0d 100%)',
          }}
        />
      )}

      {/* 浅色背景 — 暖白纸面，与全局令牌统一 */}
      {!isDark && (
        <div
          className="fixed inset-0 z-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse at 50% 0%, rgba(200,149,108,0.05) 0%, transparent 50%), ' +
              'linear-gradient(180deg, #f7f4f0 0%, #fbf9f6 100%)',
          }}
        />
      )}

      {/* Fusion Search Modal (Cmd+K quick search) */}
      <FusionSearch isOpen={searchOpen} onClose={() => setSearchOpen(false)} />

      {/* System Announcement */}
      <AnnouncementBanner />

      {/* Top Navigation Bar */}
      <header className="flex-shrink-0 z-40 liquid-glass overflow-visible">
        <TopNavigation onLoginClick={() => setLoginOpen(true)} />
      </header>

      {/* Guest notice */}
      {!isLoggedIn && (
        <div className="flex-shrink-0 z-30 glass border-b border-white/[0.06] px-4 py-2 flex items-center justify-between gap-4">
          <p className="text-xs text-warning">
            你当前以游客身份浏览，登录后可使用全部功能。
          </p>
          <button
            onClick={() => setLoginOpen(true)}
            className="px-3 py-1 rounded-lg bg-warning/15 hover:bg-warning/25 text-warning text-xs font-medium transition-colors shrink-0"
          >
            登录 / 注册
          </button>
        </div>
      )}

      {/* Sub Menu Panel (slides down when active) */}
      <SubMenuPanel />

      {/* Main Layout: Sidebar + Content */}
      <div className="flex flex-1 overflow-hidden relative z-10">
        {/* Left Sidebar */}
        <AnimatePresence>
          {sidebarOpen && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 280, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
              className="flex-shrink-0 liquid-glass overflow-y-auto"
            >
              <Sidebar />
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Sidebar Toggle */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-30 p-1.5 glass rounded-r-lg hover:bg-white/[0.08] transition-colors"
          style={{ marginLeft: sidebarOpen ? 280 : 0 }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={`text-info transition-transform ${sidebarOpen ? 'rotate-180' : ''}`}
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        {/* Main Content Area */}
        <main className="flex-1 overflow-hidden relative flex flex-col">
          <div className="flex-1 overflow-auto">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Bottom Chat Input Bar */}
      <ChatInputBar sidebarOpen={sidebarOpen} onLoginClick={() => setLoginOpen(true)} />

      {/* Login modal: triggered by guest notice or protected actions */}
      <LoginModal isOpen={loginOpen} onClose={() => setLoginOpen(false)} />

      {/* Cute mascot assistant */}
      <MascotWidget />
    </div>
  );
};

export default AppLayout;
