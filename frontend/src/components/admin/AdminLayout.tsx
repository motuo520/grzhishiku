import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import {
  Shield, LayoutDashboard, Users, FileText, LogOut, Menu, X,
  CreditCard, Settings, MessageSquare, Building2, ScrollText, Cpu
} from 'lucide-react';
import { useAdminStore } from '../../store/adminStore';
import { usePlatformBilling } from '@/hooks/useSystemFeatures';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

const sidebarItems = [
  { icon: LayoutDashboard, label: '仪表盘', path: '/admin', permission: null },
  { icon: Users, label: '用户管理', path: '/admin/users', permission: 'users:read' },
  { icon: Building2, label: '租户管理', path: '/admin/tenants', permission: 'tenants:manage' },
  { icon: FileText, label: '内容审核', path: '/admin/content', permission: 'content:moderate' },
  { icon: CreditCard, label: '订阅计费', path: '/admin/billing', permission: 'billing:read' },
  { icon: Cpu, label: '模型配置', path: '/admin/models', permission: 'models:manage' },
  { icon: Settings, label: '系统配置', path: '/admin/system', permission: 'system:config' },
  { icon: MessageSquare, label: '客服工单', path: '/admin/support', permission: 'support:manage' },
  { icon: ScrollText, label: '审计日志', path: '/admin/logs', permission: 'logs:read' },
];

export default function AdminLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { admin, logout, hasPermission } = useAdminStore();
  const platformBilling = usePlatformBilling();
  const visibleItems = sidebarItems.filter(
    (item) =>
      (!item.permission || hasPermission(item.permission)) &&
      // 平台计费关闭（开源/自托管）时不显示外部模型控制台
      (item.path !== '/admin/models' || platformBilling)
  );
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    navigate('/admin/login');
  };

  const isAdminLogin = location.pathname === '/admin/login';
  if (isAdminLogin) {
    return <Outlet />;
  }

  return (
    <div className="flex h-screen bg-admin-bg text-admin-text">
      {/* Mobile overlay */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-40 md:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <motion.aside
        className={`fixed md:static top-0 left-0 h-full z-50 bg-admin-sidebar border-r border-admin-border ${
          collapsed ? 'w-16' : 'w-64'
        }`}
        initial={false}
        animate={{ width: collapsed ? 64 : 256 }}
        transition={{ duration: 0.2 }}
      >
        <div className="flex items-center justify-between h-16 px-4 border-b border-admin-border">
          <div className="flex items-center gap-2 overflow-hidden">
            <Shield className="w-6 h-6 text-admin-primary flex-shrink-0" />
            {!collapsed && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="font-semibold text-white whitespace-nowrap"
              >
                管理后台
              </motion.span>
            )}
          </div>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="hidden md:flex p-1 rounded-lg hover:bg-admin-hover"
          >
            {collapsed ? <Menu className="w-4 h-4" /> : <X className="w-4 h-4" />}
          </button>
        </div>

        <nav className="p-2 space-y-1">
          {visibleItems.map((item) => {
            const isActive = location.pathname === item.path || (item.path !== '/admin' && location.pathname.startsWith(item.path));
            return (
              <button
                key={item.path}
                onClick={() => {
                  navigate(item.path);
                  setMobileOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-admin-primary text-white'
                    : 'text-admin-muted hover:bg-admin-hover hover:text-white'
                }`}
              >
                <item.icon className="w-5 h-5 flex-shrink-0" />
                {!collapsed && <span className="text-sm whitespace-nowrap">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        <div className="absolute bottom-0 left-0 right-0 p-2 border-t border-admin-border">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-admin-muted hover:bg-admin-hover hover:text-white transition-colors"
          >
            <LogOut className="w-5 h-5 flex-shrink-0" />
            {!collapsed && <span className="text-sm whitespace-nowrap">退出登录</span>}
          </button>
        </div>
      </motion.aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 bg-admin-sidebar border-b border-admin-border flex items-center justify-between px-4 md:px-6">
          <button
            onClick={() => setMobileOpen(true)}
            className="md:hidden p-2 rounded-lg hover:bg-admin-hover"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-3">
            <span className="text-sm text-admin-muted">管理员</span>
            <span className="text-sm font-medium text-white">{admin?.name || 'Unknown'}</span>
            <span className="px-2 py-0.5 text-xs bg-admin-primary/20 text-admin-primary rounded-full">
              {admin?.role || 'N/A'}
            </span>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
