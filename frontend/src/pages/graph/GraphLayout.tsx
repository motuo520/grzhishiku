import { FC } from 'react';
import { Outlet, NavLink, useLocation, Navigate } from 'react-router-dom';
import { Network, Sparkles } from 'lucide-react';

const tabs = [
  { id: 'network', label: '知识网络', icon: Network, path: '/graph/network' },
  { id: 'query', label: 'AI 问答', icon: Sparkles, path: '/graph/query' },
];

const GraphLayout: FC = () => {
  const location = useLocation();

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
