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
  Workflow, SquareStack, BrainCircuit, FlaskConical, Heart, ShieldAlert, MapPin, Pencil,
} from 'lucide-react';

import { useNavigation, MENU_DATA, getVisibleItems, type MenuId, type BrainSide } from '@/store/navigation';
import BrainSideToggle from '@/components/brain/BrainSideToggle';

import { useSystemFeatures } from '@/hooks/useSystemFeatures';

const ICON_MAP: Record<string, React.ElementType> = {
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
  const menu = MENU_DATA[menuId];
  const allItems = menu?.items || [];
  const { brainSide, setBrainSide } = useNavigation();
  const visibleItems = getVisibleItems(allItems, brainSide);
  const autoSwitchedRef = useRef<Set<string>>(new Set());
  const { data: features } = useSystemFeatures();

  // Respect backend module kill-switch. Pipeline can be disabled from admin.
  if (menuId === 'pipeline' && features?.modules?.pipeline === false) {
    return <Navigate to="/" replace />;
  }

  // Determine if we are at the module root (e.g. /ingest or /ingest/)
  const pathSegments = location.pathname.split('/').filter(Boolean);
  const isModuleRoot = pathSegments.length === 1 && pathSegments[0] === menuId;

  // Find current submenu item to apply preferred brain side (use unfiltered items)
  const currentItem = isModuleRoot
    ? allItems.find((item) => item.path === `/${menuId}`)
    : allItems.find((item) => location.pathname.startsWith(item.path) && item.path !== `/${menuId}`);

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
              to={`/${menuId}`}
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
