import { FC, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Outlet } from 'react-router-dom';

import { useAuth } from '@/hooks/useAuth';
import TopNavigation from '@/components/navigation/TopNavigation';
import SubMenuPanel from '@/components/navigation/SubMenuPanel';
import Sidebar from '@/components/navigation/Sidebar';
import ChatInputBar from '@/components/navigation/ChatInputBar';

import AnnouncementBanner from '@/components/common/AnnouncementBanner';
import LoginModal from '@/components/auth/LoginModal';
import MascotWidget from '@/components/mascot/MascotWidget';

const AppLayout: FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [loginOpen, setLoginOpen] = useState(false);
  const { isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-primary">
        <div className="w-8 h-8 border-2 border-info border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-bg-primary relative">
      {/* System Announcement */}
      <AnnouncementBanner />

      {/* Top Navigation Bar */}
      <header className="flex-shrink-0 z-40 bg-bg-secondary border-b border-border-light overflow-visible">
        <TopNavigation onLoginClick={() => setLoginOpen(true)} />
      </header>

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
              className="flex-shrink-0 bg-bg-secondary border-r border-border-light overflow-y-auto"
            >
              <Sidebar />
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Sidebar Toggle */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-30 p-1.5 glass rounded-r-[2px] hover:bg-bg-hover transition-colors"
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

      {/* Login modal: triggered by nav button or protected actions */}
      <LoginModal isOpen={loginOpen} onClose={() => setLoginOpen(false)} />

      {/* Cute mascot assistant */}
      <MascotWidget />
    </div>
  );
};

export default AppLayout;
