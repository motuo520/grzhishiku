import { FC, useEffect, useRef } from 'react';
import { NavLink, Outlet, useLocation, Navigate } from 'react-router-dom';
import {
  Download, Network, Sparkles, Target, Package, Shield, Settings, Brain,
  Globe, FileText, Upload, Rss, Tags, Mail, MessageCircle, BookOpen, FolderOpen, StickyNote,
  Share2, Search, Route, Tag, Clock, Calendar, Link2, BarChart3, GitMerge,
  Fingerprint, AlertTriangle, ClipboardCheck, GitBranch,
  Shuffle, Zap, Combine, HelpCircle,
  PieChart, Timer, TrendingUp,
  List, Plus, BarChart2,
  CheckCircle, GitCommit, Activity, XCircle, Map,
  User, Lock, Cpu, RefreshCw, Puzzle, Database, Palette, Bookmark,
  Scale, Gamepad2, Wallet, Newspaper, Dumbbell, HeartPulse, Filter, Users,
  Workflow, SquareStack, BrainCircuit, FlaskConical, Heart, ShieldAlert, MapPin, Pencil, type LucideIcon } from 'lucide-react';

import { useNavigation, useMenuData, getMenuIdByPath, getVisibleItems, type MenuId, type BrainSide } from '@/store/navigation';
import BrainSideToggle from '@/components/brain/BrainSideToggle';

import { useSystemFeatures } from '@/hooks/useSystemFeatures';

const ICON_MAP: Record<string, LucideIcon> = {
  Download, Network, Sparkles, Target, Package, Shield, Settings, Brain,
  Globe, FileText, Upload, Rss, Tag, Tags, Mail, MessageCircle, BookOpen, FolderOpen, StickyNote,
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

interface ModuleLayoutProps {
  menuId: MenuId;
  showOverview?: boolean;
}

const ModuleLayout: FC<ModuleLayoutProps> = ({ menuId, showOverview = true }) => {
  const location = useLocation();
  const { menuData } = useMenuData();
  // 二级菜单归属按当前路径反查菜单配置，路由上写死的 menuId 只作兜底：
  // 菜单允许跨路径前缀调动（简化版 /knowledge/verify 属「知识进化」、
  // /knowledge/network 属「问答」），否则顶部高亮桶与页面二级菜单会对不上
  const effectiveMenuId = getMenuIdByPath(location.pathname, menuData) ?? menuId;
  const menu = menuData[effectiveMenuId];
  const allItems = menu?.items || [];
  const { brainSide, setBrainSide } = useNavigation();
  // 显示全部二级项——否则进入某页自动切脑侧后，顶部菜单会缺项
  const showBrainToggle = effectiveMenuId === 'social-brain' || effectiveMenuId === 'embodied-cognition';
  const visibleItems = showBrainToggle ? getVisibleItems(allItems, brainSide) : allItems;
  const autoSwitchedRef = useRef<Set<string>>(new Set());
  const { data: features } = useSystemFeatures();

  // Determine if we are at the module root (e.g. /ingest or /ingest/)
  const pathSegments = location.pathname.split('/').filter(Boolean);
  const isModuleRoot = pathSegments.length === 1 && pathSegments[0] === effectiveMenuId;

  // Find current submenu item to apply preferred brain side (use unfiltered items)
  const currentItem = isModuleRoot
    ? allItems.find((item) => item.path === `/${effectiveMenuId}`)
    : allItems.find((item) => location.pathname.startsWith(item.path) && item.path !== `/${effectiveMenuId}`);

  // Auto-switch brain side to stage-preferred value when user is on default "both".
  // Only auto-switch once per path to avoid fighting manual user selection.
  useEffect(() => {
    const preferred = currentItem?.preferredBrainSide as BrainSide | undefined;
    if (!preferred) return;
    if (brainSide === 'both' && !autoSwitchedRef.current.has(location.pathname)) {
      setBrainSide(preferred);
      autoSwitchedRef.current.add(location.pathname);
    }
  }, [currentItem, brainSide, setBrainSide, location.pathname]);

  // Respect backend module kill-switch. Pipeline can be disabled from admin.
  if (effectiveMenuId === 'pipeline' && features?.modules?.pipeline === false) {
    return <Navigate to="/" replace />;
  }

  if (!menu) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="flex flex-col h-full bg-transparent">
      {/* Top Secondary Menu Bar */}
      <div className="flex-shrink-0 px-4 py-2 border-b border-border-color bg-bg-secondary/80 z-20">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1 overflow-x-auto">
          {showOverview && (
            <NavLink
              to={`/${effectiveMenuId}`}
              end
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-3 py-1.5 rounded-[2px] text-xs font-medium whitespace-nowrap transition-colors ${
                  isActive || isModuleRoot
                    ? 'bg-bg-secondary text-info border border-border-color'
                    : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                }`
              }
            >
              <Brain className="w-3.5 h-3.5" />
              概览
            </NavLink>
          )}
          {visibleItems.map((item) => {
            const Icon = ICON_MAP[item.icon] || Brain;
            return (
              <NavLink
                key={item.id}
                to={item.path}
                title={item.label}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 px-3 py-1.5 rounded-[2px] text-xs font-medium whitespace-nowrap transition-colors max-w-[140px] ${
                    isActive
                      ? 'bg-bg-secondary text-info border border-border-color'
                      : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                  }`
                }
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate min-w-0">{item.label}</span>
              </NavLink>
            );
          })}
        </div>
        {(showBrainToggle) && (
          <div className="flex-shrink-0">
            <BrainSideToggle value={brainSide} onChange={setBrainSide} />
          </div>
        )}
      </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-auto relative">
        <Outlet />
      </div>
    </div>
  );
};

export default ModuleLayout;
