import { FC } from 'react';
import { Outlet, NavLink, useLocation, Navigate } from 'react-router-dom';
import { Network, Sparkles, Route, FileText, GitMerge, Tag, BookOpen } from 'lucide-react';
import { useSettings } from '@/store/settings';

// 简化版的图谱页签与「知识地图」桶菜单项一一对应（AI 问答已归「问答」桶，
// 在简化版挂 ask 布局，见 App.tsx；经典版图谱模块仍含智能查询）。
const tabsSimple = [
  // 知识网络落点 = 3D 星系（默认物理图，用户拍板 3D 第一展示）；2D 在星系页工具栏「2D」返回
  { id: 'network', label: '知识网络', icon: Network, path: '/graph/galaxy' },
  { id: 'path', label: '路径探索', icon: Route, path: '/graph/path' },
  { id: 'report', label: '图谱报告', icon: FileText, path: '/graph/report' },
  { id: 'bridges', label: '跨脑桥梁', icon: GitMerge, path: '/graph/bridges' },
  { id: 'tags', label: '标签图谱', icon: Tag, path: '/graph/tags' },
  { id: 'wiki', label: '百科', icon: BookOpen, path: '/graph/wiki' },
  // 时间轴已搬到「采集」菜单（/ingest/timeline，旧路径重定向保留）
];

const tabsClassic = [
  { id: 'network', label: '知识网络', icon: Network, path: '/graph/galaxy' },
  { id: 'query', label: '智能查询', icon: Sparkles, path: '/graph/query' },
  { id: 'path', label: '路径探索', icon: Route, path: '/graph/path' },
  { id: 'report', label: '图谱报告', icon: FileText, path: '/graph/report' },
  { id: 'bridges', label: '跨脑桥梁', icon: GitMerge, path: '/graph/bridges' },
  { id: 'tags', label: '标签图谱', icon: Tag, path: '/graph/tags' },
  { id: 'wiki', label: '百科', icon: BookOpen, path: '/graph/wiki' },
];

const GraphLayout: FC = () => {
  const location = useLocation();
  const isClassic = useSettings((s) => s.uiMode === 'classic');
  const tabs = isClassic ? tabsClassic : tabsSimple;

  if (location.pathname === '/graph') {
    return <Navigate to="/graph/galaxy" replace />;
  }

  return (
    <div className="flex flex-col h-full bg-bg-primary">
      <div className="flex items-center gap-1 px-4 py-2 border-b border-white/[0.06] bg-bg-primary/80 backdrop-blur-sm shrink-0 overflow-x-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          // 「知识网络」落点是 3D 星系（/graph/galaxy），2D 显式地址 /graph/network 也算它高亮（双路径 active）
          const networkActive = tab.id === 'network'
            && (location.pathname === '/graph/galaxy' || location.pathname === '/graph/network');
          return (
            <NavLink
              key={tab.id}
              to={tab.path}
              className={() =>
                `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  networkActive || location.pathname === tab.path
                    ? 'bg-info/15 text-info'
                    : 'text-text-secondary hover:bg-white/[0.04] hover:text-text-primary'
                }`
              }
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </NavLink>
          );
        })}
      </div>
      <div className="flex-1 overflow-hidden relative">
        <Outlet />
      </div>
    </div>
  );
};

export default GraphLayout;
