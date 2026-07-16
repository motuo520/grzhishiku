import { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Building2, Users, CheckCircle, XCircle, Plus, Search,
  Eye, X, Edit, Trash, BarChart3, HardDrive, FileText, Activity, AlertTriangle
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line
} from 'recharts';
import adminApi from '../../services/adminApi';

interface Tenant {
  id: string;
  name: string;
  slug: string;
  domain?: string;
  description: string;
  status: 'active' | 'inactive' | 'suspended';
  plan: string;
  max_users: number;
  max_storage: number;
  user_count: number;
  storage_used: number;
  created_at: string;
}

interface TenantStats {
  user_count: number;
  content_count: number;
  storage_used: number;
  active_users: number;
  activity_trend: { date: string; active: number }[];
  content_distribution: { type: string; count: number }[];
}

const STATUS_BADGES: Record<string, { label: string; class: string; icon: typeof CheckCircle }> = {
  active: { label: '活跃', class: 'bg-success/10 text-success', icon: CheckCircle },
  inactive: { label: '未激活', class: 'bg-admin-muted/10 text-admin-muted', icon: XCircle },
  suspended: { label: '已禁用', class: 'bg-danger/10 text-danger', icon: XCircle },
};

function ShimmerTable() {
  return (
    <div className="p-6 bg-admin-sidebar rounded-xl border border-admin-border overflow-hidden animate-pulse">
      <div className="px-4 py-3 border-b border-admin-border h-12 bg-admin-hover" />
      {[...Array(5)].map((_, i) => (
        <div key={i} className="px-4 py-3 h-12 border-b border-admin-border bg-admin-hover/50" />
      ))}
    </div>
  );
}

export default function AdminTenants() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showStats, setShowStats] = useState<Tenant | null>(null);
  const [showEdit, setShowEdit] = useState<Tenant | null>(null);
  const [showDelete, setShowDelete] = useState<Tenant | null>(null);
  const [statsData, setStatsData] = useState<TenantStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [newTenant, setNewTenant] = useState({ name: '', slug: '', domain: '', admin_email: '', plan: 'free', max_users: 10, max_storage: 1024 });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchTenants = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await adminApi.getTenants();
      setTenants(res.data);
    } catch (err: any) {
      setError(err.response?.data?.detail || '加载租户失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTenants();
  }, []);

  const filtered = useMemo(() => {
    return tenants.filter((t) =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.slug.toLowerCase().includes(search.toLowerCase()) ||
      (t.domain || '').toLowerCase().includes(search.toLowerCase())
    );
  }, [tenants, search]);

  const handleCreate = async () => {
    if (!newTenant.name || !newTenant.slug) return;
    setCreating(true);
    try {
      await adminApi.createTenant(newTenant);
      setShowCreate(false);
      setNewTenant({ name: '', slug: '', domain: '', admin_email: '', plan: 'free', max_users: 10, max_storage: 1024 });
      fetchTenants();
    } catch (err: any) {
      setError(err.response?.data?.detail || '创建失败');
    } finally {
      setCreating(false);
    }
  };

  const handleEdit = async () => {
    if (!showEdit) return;
    setEditing(true);
    try {
      await adminApi.updateTenant(showEdit.id, {
        max_users: showEdit.max_users,
        max_storage: showEdit.max_storage,
        status: showEdit.status,
      });
      setShowEdit(null);
      fetchTenants();
    } catch (err: any) {
      setError(err.response?.data?.detail || '更新失败');
    } finally {
      setEditing(false);
    }
  };

  const handleDelete = async () => {
    if (!showDelete) return;
    setDeleting(true);
    try {
      await adminApi.deleteTenant(showDelete.id);
      setShowDelete(null);
      fetchTenants();
    } catch (err: any) {
      setError(err.response?.data?.detail || '禁用失败');
    } finally {
      setDeleting(false);
    }
  };

  const openStats = async (tenant: Tenant) => {
    setShowStats(tenant);
    setStatsLoading(true);
    setStatsData(null);
    try {
      const res = await adminApi.getTenantStats(tenant.id);
      setStatsData(res.data);
    } catch (err: any) {
      setError(err.response?.data?.detail || '加载统计失败');
    } finally {
      setStatsLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white mb-2">租户管理</h1>
            <p className="text-admin-muted">管理多租户组织</p>
          </div>
          <div className="h-10 w-24 bg-admin-hover rounded-lg animate-pulse" />
        </div>
        <div className="h-10 bg-admin-hover rounded-lg animate-pulse" />
        <ShimmerTable />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white mb-2">租户管理</h1>
          <p className="text-admin-muted">管理多租户组织</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-admin-primary text-white rounded-lg text-sm font-medium hover:bg-admin-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          创建租户
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 bg-danger/10 border border-danger/20 rounded-lg text-danger text-sm">
          {error}
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-admin-muted" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索租户名称、标识或域名..."
          className="w-full pl-10 pr-4 py-2.5 bg-admin-sidebar border border-admin-border rounded-lg text-white placeholder-admin-muted focus:outline-none focus:border-admin-primary"
        />
      </div>

      {/* Create Tenant Form */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-admin-sidebar rounded-xl border border-admin-border p-6 space-y-4"
          >
            <h3 className="text-lg font-semibold text-white">创建新租户</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <input
                type="text"
                placeholder="租户名称 *"
                value={newTenant.name}
                onChange={(e) => setNewTenant({ ...newTenant, name: e.target.value })}
                className="px-4 py-2.5 bg-admin-bg border border-admin-border rounded-lg text-white placeholder-admin-muted focus:outline-none focus:border-admin-primary"
              />
              <input
                type="text"
                placeholder="唯一标识 (slug) *"
                value={newTenant.slug}
                onChange={(e) => setNewTenant({ ...newTenant, slug: e.target.value })}
                className="px-4 py-2.5 bg-admin-bg border border-admin-border rounded-lg text-white placeholder-admin-muted focus:outline-none focus:border-admin-primary"
              />
              <input
                type="text"
                placeholder="域名 (可选)"
                value={newTenant.domain}
                onChange={(e) => setNewTenant({ ...newTenant, domain: e.target.value })}
                className="px-4 py-2.5 bg-admin-bg border border-admin-border rounded-lg text-white placeholder-admin-muted focus:outline-none focus:border-admin-primary"
              />
              <input
                type="email"
                placeholder="管理员邮箱 *"
                value={newTenant.admin_email}
                onChange={(e) => setNewTenant({ ...newTenant, admin_email: e.target.value })}
                className="px-4 py-2.5 bg-admin-bg border border-admin-border rounded-lg text-white placeholder-admin-muted focus:outline-none focus:border-admin-primary"
              />
              <select
                value={newTenant.plan}
                onChange={(e) => setNewTenant({ ...newTenant, plan: e.target.value })}
                className="px-4 py-2.5 bg-admin-bg border border-admin-border rounded-lg text-white focus:outline-none focus:border-admin-primary"
              >
                <option value="free">Free</option>
                <option value="storage">Storage</option>
              </select>
              <input
                type="number"
                placeholder="用户上限"
                value={newTenant.max_users}
                onChange={(e) => setNewTenant({ ...newTenant, max_users: parseInt(e.target.value) || 10 })}
                className="px-4 py-2.5 bg-admin-bg border border-admin-border rounded-lg text-white placeholder-admin-muted focus:outline-none focus:border-admin-primary"
              />
              <input
                type="number"
                placeholder="存储配额 (MB)"
                value={newTenant.max_storage}
                onChange={(e) => setNewTenant({ ...newTenant, max_storage: parseInt(e.target.value) || 1024 })}
                className="px-4 py-2.5 bg-admin-bg border border-admin-border rounded-lg text-white placeholder-admin-muted focus:outline-none focus:border-admin-primary"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCreate}
                disabled={creating || !newTenant.name || !newTenant.slug}
                className="px-4 py-2 bg-admin-primary text-white rounded-lg text-sm font-medium hover:bg-admin-primary/90 disabled:opacity-50 transition-colors"
              >
                {creating ? '创建中...' : '创建'}
              </button>
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 text-admin-muted hover:text-white text-sm transition-colors"
              >
                取消
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tenant Table */}
      <div className="bg-admin-sidebar rounded-xl border border-admin-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-admin-border bg-admin-bg/50">
                <th className="px-4 py-3 text-left text-sm font-medium text-admin-muted">ID</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-admin-muted">租户</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-admin-muted">标识/域名</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-admin-muted">套餐</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-admin-muted">用户上限</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-admin-muted">存储配额</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-admin-muted">状态</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-admin-muted">创建时间</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-admin-muted">操作</th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence>
                {filtered.map((tenant, index) => {
                  const status = STATUS_BADGES[tenant.status] || STATUS_BADGES.inactive;
                  return (
                    <motion.tr
                      key={tenant.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ delay: index * 0.02 }}
                      className="border-b border-admin-border hover:bg-admin-hover transition-colors"
                    >
                      <td className="px-4 py-3 text-xs text-admin-muted font-mono">{tenant.id.slice(0, 8)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-admin-primary/10 rounded-lg flex items-center justify-center">
                            <Building2 className="w-4 h-4 text-admin-primary" />
                          </div>
                          <div>
                            <div className="text-sm font-medium text-white">{tenant.name}</div>
                            <div className="text-xs text-admin-muted">{tenant.description}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-admin-muted">
                        <div>{tenant.slug}</div>
                        {tenant.domain && <div className="text-xs text-admin-primary">{tenant.domain}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                          tenant.plan === 'storage' ? 'bg-personal-primary/10 text-personal-primary' :
                          'bg-admin-muted/10 text-admin-muted'
                        }`}>
                          {tenant.plan}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-admin-muted">
                        <div className="flex items-center gap-2">
                          <Users className="w-3.5 h-3.5" />
                          {tenant.user_count} / {tenant.max_users}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-admin-muted">
                        <div className="flex items-center gap-2">
                          <HardDrive className="w-3.5 h-3.5" />
                          {(tenant.storage_used / 1024).toFixed(1)} / {(tenant.max_storage / 1024).toFixed(0)} GB
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${status.class}`}>
                          <status.icon className="w-3 h-3" />
                          {status.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-admin-muted">
                        {new Date(tenant.created_at).toLocaleDateString('zh-CN')}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => openStats(tenant)}
                            className="p-1.5 rounded-lg hover:bg-admin-hover text-admin-muted hover:text-white transition-colors"
                            title="查看统计"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setShowEdit(tenant)}
                            className="p-1.5 rounded-lg hover:bg-admin-hover text-admin-muted hover:text-white transition-colors"
                            title="编辑配额"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setShowDelete(tenant)}
                            className="p-1.5 rounded-lg hover:bg-admin-hover text-admin-muted hover:text-danger transition-colors"
                            title="禁用"
                          >
                            <Trash className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </motion.tr>
                  );
                })}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="p-8 text-center text-admin-muted">
            <Building2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>未找到租户</p>
          </div>
        )}
      </div>

      {/* Stats Modal */}
      <AnimatePresence>
        {showStats && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
            onClick={() => setShowStats(null)}
          >
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              className="bg-admin-sidebar rounded-xl border border-admin-border w-full max-w-3xl max-h-[80vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-6 py-4 border-b border-admin-border flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <BarChart3 className="w-5 h-5 text-admin-primary" />
                  <h3 className="text-lg font-semibold text-white">{showStats.name} - 统计</h3>
                </div>
                <button
                  onClick={() => setShowStats(null)}
                  className="p-1 rounded-lg hover:bg-admin-hover text-admin-muted hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="px-6 py-4 space-y-6">
                {statsLoading ? (
                  <div className="flex items-center justify-center h-48">
                    <div className="w-8 h-8 border-2 border-admin-primary border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : statsData ? (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="bg-admin-bg rounded-lg p-4 border border-admin-border">
                        <div className="flex items-center gap-2 mb-2">
                          <Users className="w-4 h-4 text-admin-primary" />
                          <span className="text-xs text-admin-muted">用户数</span>
                        </div>
                        <div className="text-2xl font-bold text-white">{statsData.user_count}</div>
                      </div>
                      <div className="bg-admin-bg rounded-lg p-4 border border-admin-border">
                        <div className="flex items-center gap-2 mb-2">
                          <FileText className="w-4 h-4 text-success" />
                          <span className="text-xs text-admin-muted">内容数</span>
                        </div>
                        <div className="text-2xl font-bold text-white">{statsData.content_count}</div>
                      </div>
                      <div className="bg-admin-bg rounded-lg p-4 border border-admin-border">
                        <div className="flex items-center gap-2 mb-2">
                          <HardDrive className="w-4 h-4 text-warning" />
                          <span className="text-xs text-admin-muted">存储使用</span>
                        </div>
                        <div className="text-2xl font-bold text-white">{(statsData.storage_used / 1024).toFixed(1)} GB</div>
                      </div>
                      <div className="bg-admin-bg rounded-lg p-4 border border-admin-border">
                        <div className="flex items-center gap-2 mb-2">
                          <Activity className="w-4 h-4 text-network-primary" />
                          <span className="text-xs text-admin-muted">活跃用户</span>
                        </div>
                        <div className="text-2xl font-bold text-white">{statsData.active_users}</div>
                      </div>
                    </div>

                    <div className="bg-admin-bg rounded-lg p-4 border border-admin-border">
                      <h4 className="text-sm font-medium text-white mb-3">活跃度趋势</h4>
                      <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={statsData.activity_trend || []}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
                            <XAxis dataKey="date" stroke="#8b949e" tick={{ fontSize: 12 }} />
                            <YAxis stroke="#8b949e" tick={{ fontSize: 12 }} />
                            <Tooltip contentStyle={{ backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: 8, color: '#c9d1d9' }} />
                            <Line type="monotone" dataKey="active" stroke="#58a6ff" strokeWidth={2} dot={{ fill: '#58a6ff', r: 3 }} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div className="bg-admin-bg rounded-lg p-4 border border-admin-border">
                      <h4 className="text-sm font-medium text-white mb-3">内容分布</h4>
                      <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={statsData.content_distribution || []}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
                            <XAxis dataKey="type" stroke="#8b949e" tick={{ fontSize: 12 }} />
                            <YAxis stroke="#8b949e" tick={{ fontSize: 12 }} />
                            <Tooltip contentStyle={{ backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: 8, color: '#c9d1d9' }} />
                            <Bar dataKey="count" radius={[4, 4, 0, 0]} fill="#58a6ff" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-admin-muted text-center py-8">暂无统计数据</p>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit Modal */}
      <AnimatePresence>
        {showEdit && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
            onClick={() => setShowEdit(null)}
          >
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              className="bg-admin-sidebar rounded-xl border border-admin-border w-full max-w-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-6 py-4 border-b border-admin-border flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">编辑配额</h3>
                <button onClick={() => setShowEdit(null)} className="p-1 rounded-lg hover:bg-admin-hover text-admin-muted hover:text-white transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="px-6 py-4 space-y-4">
                <div>
                  <label className="block text-sm text-admin-muted mb-1.5">用户上限</label>
                  <input
                    type="number"
                    value={showEdit.max_users}
                    onChange={(e) => setShowEdit({ ...showEdit, max_users: parseInt(e.target.value) || 0 })}
                    className="w-full px-4 py-2.5 bg-admin-bg border border-admin-border rounded-lg text-white focus:outline-none focus:border-admin-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm text-admin-muted mb-1.5">存储配额 (MB)</label>
                  <input
                    type="number"
                    value={showEdit.max_storage}
                    onChange={(e) => setShowEdit({ ...showEdit, max_storage: parseInt(e.target.value) || 0 })}
                    className="w-full px-4 py-2.5 bg-admin-bg border border-admin-border rounded-lg text-white focus:outline-none focus:border-admin-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm text-admin-muted mb-1.5">状态</label>
                  <select
                    value={showEdit.status}
                    onChange={(e) => setShowEdit({ ...showEdit, status: e.target.value as Tenant['status'] })}
                    className="w-full px-4 py-2.5 bg-admin-bg border border-admin-border rounded-lg text-white focus:outline-none focus:border-admin-primary"
                  >
                    <option value="active">活跃</option>
                    <option value="inactive">未激活</option>
                    <option value="suspended">已禁用</option>
                  </select>
                </div>
                <div className="flex items-center gap-2 pt-2">
                  <button
                    onClick={handleEdit}
                    disabled={editing}
                    className="px-4 py-2 bg-admin-primary text-white rounded-lg text-sm font-medium hover:bg-admin-primary/90 disabled:opacity-50 transition-colors"
                  >
                    {editing ? '保存中...' : '保存'}
                  </button>
                  <button onClick={() => setShowEdit(null)} className="px-4 py-2 text-admin-muted hover:text-white text-sm transition-colors">取消</button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Confirm Modal */}
      <AnimatePresence>
        {showDelete && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
            onClick={() => setShowDelete(null)}
          >
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              className="bg-admin-sidebar rounded-xl border border-danger/30 w-full max-w-md p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-4">
                <AlertTriangle className="w-6 h-6 text-danger" />
                <h3 className="text-lg font-semibold text-white">确认禁用租户</h3>
              </div>
              <p className="text-sm text-admin-muted mb-6">
                确定要禁用租户 <span className="text-white font-medium">{showDelete.name}</span> 吗？禁用后该租户下的用户将无法访问系统，但数据不会删除。
              </p>
              <div className="flex items-center gap-2 justify-end">
                <button onClick={() => setShowDelete(null)} className="px-4 py-2 text-admin-muted hover:text-white text-sm transition-colors">取消</button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="px-4 py-2 bg-danger text-white rounded-lg text-sm font-medium hover:bg-danger/90 disabled:opacity-50 transition-colors"
                >
                  {deleting ? '处理中...' : '确认禁用'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
