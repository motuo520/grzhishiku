import { FC, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  FileText, Globe, Package, BookOpen, Target, Tag, Brain, ChevronRight, Plus, Settings, User, Lock, Cpu,
  RefreshCw, Puzzle, Database, Palette, Crown, HardDrive, Menu, Home, List, BarChart2, Calendar,
  MessageCircle, CheckCircle, Rss, Upload, Share2, Search, Route, Link2, BarChart3, GitMerge, Clock,
  Fingerprint, AlertTriangle, Scale, ClipboardCheck, GitBranch, Gamepad2, Shuffle, Zap, Combine,
  HelpCircle, Network, PieChart, Timer, Wallet, Shield, Newspaper, TrendingUp, SquareStack, Filter,
  Pencil, BrainCircuit, FlaskConical, HeartPulse, Dumbbell, Activity, ShieldAlert, MapPin, MessageSquare,
  XCircle, Map, GitCommit,
} from 'lucide-react';
import { useBrain } from '@/hooks/useBrain';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import {
  QUICK_ACTIONS,
  SETTINGS_ITEMS,
  getVisibleItems,
  type BrainSide,
} from '@/store/navigation';

const ICON_MAP: Record<string, React.ElementType> = {
  FileText, Globe, Package, BookOpen, Target, Tag, Brain, Settings, User, Lock, Cpu,
  RefreshCw, Puzzle, Database, Palette, HardDrive, Crown, Menu, Home, List, BarChart2, Calendar,
  MessageCircle, CheckCircle, Rss, Upload, Share2, Search, Route, Link2, BarChart3, GitMerge, Clock,
  Fingerprint, AlertTriangle, Scale, ClipboardCheck, GitBranch, Gamepad2, Shuffle, Zap, Combine,
  HelpCircle, Network, PieChart, Timer, Wallet, Shield, Newspaper, TrendingUp, SquareStack, Filter,
  Pencil, BrainCircuit, FlaskConical, HeartPulse, Dumbbell, Activity, ShieldAlert, MapPin, MessageSquare,
  XCircle, Map, GitCommit,
};

const Sidebar: FC = () => {
  const { stats, activeBrain, switchBrain, isSwitching } = useBrain();
  const { user } = useAuth();
  const { tier, currentSubscription, isLoading: subLoading } = useSubscription();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [brainMenuOpen, setBrainMenuOpen] = useState(false);

  const effectiveBrain = activeBrain || 'both';
  const quickActions = getVisibleItems(QUICK_ACTIONS, effectiveBrain);

  const handleBrainSwitch = async (target: BrainSide) => {
    try {
      await switchBrain(target);
    } catch (err: any) {
      console.error('Brain switch failed:', err);
      if (err?.status !== 401) {
        alert('切换失败: ' + (err?.response?.data?.message || err?.message || '请登录后再试'));
      }
    }
    setBrainMenuOpen(false);
  };

  const brainOptions = [
    { id: 'personal', label: '个人脑', sublabel: 'Personal Brain', icon: Home, color: 'text-amber-400', bg: 'bg-amber-400/10', border: 'border-amber-400/20' },
    { id: 'network', label: '网络脑', sublabel: 'Network Brain', icon: Globe, color: 'text-blue-400', bg: 'bg-blue-400/10', border: 'border-blue-400/20' },
    { id: 'both', label: '整合脑', sublabel: 'Both Brains', icon: Brain, color: 'text-purple-400', bg: 'bg-purple-400/10', border: 'border-purple-400/20' },
  ];

  const brainColor = effectiveBrain === 'personal' ? 'text-amber-400' :
                     effectiveBrain === 'network' ? 'text-blue-400' : 'text-purple-400';
  const brainBg = effectiveBrain === 'personal' ? 'bg-amber-400/10' :
                  effectiveBrain === 'network' ? 'bg-blue-400/10' : 'bg-purple-400/10';
  const BrainIcon = effectiveBrain === 'personal' ? Home :
                    effectiveBrain === 'network' ? Globe : Brain;

  return (
    <div className="h-full flex flex-col p-3 min-h-0">
      {/* Brain Switcher */}
      <div className="relative mb-4">
        <button
          onClick={() => setBrainMenuOpen(!brainMenuOpen)}
          disabled={isSwitching}
          className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-border-color transition-all duration-300 ${brainBg} hover:border-current/30 disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {isSwitching ? (
            <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
          ) : (
            <BrainIcon className={`w-5 h-5 ${brainColor}`} />
          )}
          <div className="flex-1 text-left">
            <div className={`text-xs font-semibold ${brainColor}`}>
              {effectiveBrain === 'personal' ? '个人脑' :
               effectiveBrain === 'network' ? '网络脑' : '整合脑'}
            </div>
            <div className="text-[10px] text-text-muted">
              {effectiveBrain === 'personal' ? 'Personal Brain' :
               effectiveBrain === 'network' ? 'Network Brain' : 'Both Brains'}
            </div>
          </div>
          <div className={`w-2 h-2 rounded-full ${brainColor.replace('text-', 'bg-')} animate-pulse`} />
          <motion.svg
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            className="text-text-muted"
            animate={{ rotate: brainMenuOpen ? 180 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <polyline points="6 9 12 15 18 9" />
          </motion.svg>
        </button>

        <AnimatePresence>
          {brainMenuOpen && (
            <motion.div
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="absolute top-full left-0 right-0 mt-2 glass rounded-xl border border-border-color shadow-2xl p-2 z-50"
            >
              {brainOptions.map((opt) => {
                const Icon = opt.icon;
                const isActive = effectiveBrain === opt.id;
                return (
                  <button
                    key={opt.id}
                    onClick={() => handleBrainSwitch(opt.id as BrainSide)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all ${
                      isActive
                        ? `${opt.bg} ${opt.color} border ${opt.border}`
                        : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-lg ${opt.bg} flex items-center justify-center`}>
                      <Icon className={`w-4 h-4 ${opt.color}`} />
                    </div>
                    <div className="flex-1 text-left">
                      <div className={`text-sm font-medium ${isActive ? opt.color : 'text-text-primary'}`}>
                        {opt.label}
                      </div>
                      <div className="text-[10px] text-text-muted">{opt.sublabel}</div>
                    </div>
                    {isActive && (
                      <div className={`w-2 h-2 rounded-full ${opt.color.replace('text-', 'bg-')}`} />
                    )}
                  </button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Quick Actions */}
      <div className="mb-4">
        <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2 px-1">
          快速操作
        </div>
        <div className="space-y-1">
          {quickActions.map((action) => {
            const Icon = ICON_MAP[action.icon] || Brain;
            return (
              <button
                key={action.id}
                onClick={() => navigate(action.path)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-all group"
              >
                <Icon className="w-4 h-4" />
                <span className="flex-1 text-left">{action.label}</span>
                <Plus className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            );
          })}
        </div>
      </div>

      {/* Recent Items - placeholder until API ready */}
      <div className="flex-1 overflow-hidden min-h-0">
        <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2 px-1">
          最近内容
        </div>
        <div className="flex items-center justify-center h-24 text-xs text-text-muted rounded-xl border border-dashed border-border-color">
          暂无最近内容
        </div>
      </div>

      {/* Bottom Stats + Menu */}
      <div className="flex-shrink-0 border-t border-border-color pt-3 mt-2 relative">
        <div className="relative">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-300 ${
              menuOpen
                ? 'bg-info/10 text-info border border-info/20 shadow-[0_0_12px_rgba(200,149,108,0.2)]'
                : 'hover:bg-bg-hover text-text-secondary hover:text-text-primary border border-transparent'
            }`}
          >
            <Menu className="w-4 h-4" />
            <span className="flex-1 text-left">菜单</span>
            <motion.svg
              width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              animate={{ rotate: menuOpen ? 180 : 0 }}
              transition={{ duration: 0.2 }}
            >
              <polyline points="6 9 12 15 18 9" />
            </motion.svg>
          </button>

          <AnimatePresence>
            {menuOpen && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                className="absolute bottom-full left-0 right-0 mb-2 glass-popup rounded-xl border border-border-color shadow-2xl p-2 z-50"
                style={{ boxShadow: '0 -20px 40px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)' }}
              >
                {/* Settings Option */}
                <button
                  onClick={() => setSettingsOpen(!settingsOpen)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-all ${
                    settingsOpen
                      ? 'bg-info/10 text-info'
                      : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                  }`}
                >
                  <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-info/10 to-fusion-primary/10 flex items-center justify-center text-info">
                    <Settings className="w-3.5 h-3.5" />
                  </div>
                  <span className="flex-1 text-left">设置</span>
                  <motion.svg
                    width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    animate={{ rotate: settingsOpen ? 180 : 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </motion.svg>
                </button>

                <AnimatePresence>
                  {settingsOpen && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="pl-2 mt-1 space-y-0.5 border-l-2 border-border-color ml-4">
                        {SETTINGS_ITEMS.map((item) => {
                          const Icon = ICON_MAP[item.icon] || Settings;
                          return (
                            <button
                              key={item.id}
                              onClick={() => {
                                navigate(item.path);
                                setSettingsOpen(false);
                                setMenuOpen(false);
                              }}
                              className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-all"
                            >
                              <Icon className="w-3 h-3 text-text-muted" />
                              <span>{item.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="my-1.5 border-t border-border-color" />

                {/* Membership */}
                <button
                  onClick={() => {
                    navigate('/payment');
                    setMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-all"
                >
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                    tier === 'storage' ? 'bg-amber-400/10 text-amber-400' : 'bg-emerald-400/10 text-emerald-400'
                  }`}>
                    <Crown className="w-3.5 h-3.5" />
                  </div>
                  <span className="flex-1 text-left">
                    {subLoading ? '加载中...' : tier === 'free' ? '免费版' : '存储会员'}
                  </span>
                  <ChevronRight className="w-3 h-3 text-text-muted" />
                </button>

                {/* Storage mini bar */}
                {user && (
                  <div className="px-3 py-1">
                    <div className="flex items-center justify-between text-[10px] text-text-muted mb-1">
                      <span>存储用量</span>
                      <span>{((user.storage_used || 0) / 1024 / 1024).toFixed(0)} MB / {((user.storage_limit || 1073741824) / 1024 / 1024 / 1024).toFixed(1)} GB</span>
                    </div>
                    <div className="h-1 rounded-full bg-bg-tertiary overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-info to-fusion-primary"
                        style={{ width: `${Math.min(100, ((user.storage_used || 0) / (user.storage_limit || 1)) * 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
