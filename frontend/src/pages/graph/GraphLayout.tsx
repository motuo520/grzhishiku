import { FC } from 'react';
import { Outlet, NavLink, useLocation, Navigate } from 'react-router-dom';
import { Network, Sparkles, Route, FileText, GitMerge, Tag } from 'lucide-react';
import { useSettings } from '@/store/settings';

// 简化版的图谱页签与经典版同款（命名对齐简化版菜单：智能查询→AI 问答）。
// 历史遗留的 2 签版本曾导致「知识地图」桶里 6 个二级页签在页面内只剩 2 个。
const tabsSimple = [
  { id: 'network', label: '知识网络', icon: Network, path: '/graph/network' },
  { id: 'query', label: 'AI 问答', icon: Sparkles, path: '/graph/query' },
  { id: 'path', label: '路径探索', icon: Route, path: '/graph/path' },
  { id: 'report', label: '图谱报告', icon: FileText, path: '/graph/report' },
  { id: 'bridges', label: '跨脑桥梁', icon: GitMerge, path: '/graph/bridges' },
  { id: 'tags', label: '标签图谱', icon: Tag, path: '/graph/tags' },
  // 时间轴已搬到「存进来/采集」菜单（/ingest/timeline，旧路径重定向保留）
];

const tabsClassic = [
  { id: 'network', label: '知识网络', icon: Network, path: '/graph/network' },
  { id: 'query', label: '智能查询', icon: Sparkles, path: '/graph/query' },
  { id: 'path', label: '路径探索', icon: Route, path: '/graph/path' },
  { id: 'report', label: '图谱报告', icon: FileText, path: '/graph/report' },
  { id: 'bridges', label: '跨脑桥梁', icon: GitMerge, path: '/graph/bridges' },
  { id: 'tags', label: '标签图谱', icon: Tag, path: '/graph/tags' },
];

const GraphLayout: FC = () => {
  const location = useLocation();
  const isClassic = useSettings((s) => s.uiMode === 'classic');
  const tabs = isClassic ? tabsClassic : tabsSimple;

  if (location.pathname === '/graph') {
    return <Navigate to="/graph/network" replace />;
  }

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] bg-bg-primary">
      <div className="flex items-center gap-1 px-4 py-2 border-b border-white/[0.06] bg-bg-primary/80 backdrop-blur-sm shrink-0 overflow-x-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <NavLink
              key={tab.id}
              to={tab.path}
              end={tab.path === '/graph/network'}
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  isActive
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
