import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Eye, Edit, Trash, Lock, RefreshCw, ChevronLeft, ChevronRight,
  User, Mail, Calendar, Shield, Check, X, AlertTriangle, Loader2
} from 'lucide-react';
import adminApi from '../../services/adminApi';

interface UserItem {
  id: string;
  email: string;
  username: string;
  display_name: string;
  status: string;
  role?: string;
  created_at: string;
  last_login_at: string | null;
  notes_count?: number;
  capsules_count?: number;
  sync_devices_count?: number;
  last_sync_at?: string | null;
}

interface UsersResponse {
  total: number;
  page: number;
  page_size: number;
  items: UserItem[];
}

const STATUS_BADGE: Record<string, { label: string; color: string; icon: typeof Check }> = {
  active: { label: '活跃', color: 'bg-[#3fb950]/10 text-[#3fb950]', icon: Check },
  inactive: { label: '非活跃', color: 'bg-[#8b949e]/10 text-text-secondary', icon: X },
  banned: { label: '已封禁', color: 'bg-[#f85149]/10 text-[#f85149]', icon: AlertTriangle },
};

const PAGE_SIZE = 20;

export default function AdminUsers() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const [page, setPage] = useState(1);

  const [detailUser, setDetailUser] = useState<UserItem | null>(null);
  const [editStatusUser, setEditStatusUser] = useState<UserItem | null>(null);
  const [newStatus, setNewStatus] = useState('active');
  const [resetPwUser, setResetPwUser] = useState<UserItem | null>(null);
  const [deleteUser, setDeleteUser] = useState<UserItem | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  const loadUsers = useCallback(() => {
    setLoading(true);
    adminApi
      .getUsers({
        page,
        page_size: PAGE_SIZE,
        search: search || undefined,
        status: statusFilter === 'all' ? undefined : statusFilter,
      })
      .then((res: any) => {
        const data: UsersResponse = res.data;
        setUsers(data.items || []);
        setTotal(data.total || 0);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [page, search, statusFilter]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleStatusChange = async (userId: string, status: string) => {
    setActionLoading(userId);
    setActionError('');
    try {
      await adminApi.updateUserStatus(userId, status);
      setUsers((prev: UserItem[]) =>
        prev.map((u: UserItem) => (u.id === userId ? { ...u, status } : u))
      );
      setEditStatusUser(null);
    } catch (err: any) {
      setActionError(err.response?.data?.detail || '操作失败');
    } finally {
      setActionLoading(null);
    }
  };

  const handleResetPassword = async (userId: string) => {
    setActionLoading(userId);
    setActionError('');
    try {
      // Backend may not have this endpoint; gracefully degrade
      await adminApi.resetPassword?.(userId);
      setResetPwUser(null);
    } catch (err: any) {
      if (err.response?.status === 404) {
        setActionError('重置密码 API 尚未实现');
      } else {
        setActionError(err.response?.data?.detail || '操作失败');
      }
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (userId: string) => {
    setActionLoading(userId);
    setActionError('');
    try {
      await adminApi.deleteUser?.(userId);
      setUsers((prev: UserItem[]) => prev.filter((u: UserItem) => u.id !== userId));
      setDeleteUser(null);
    } catch (err: any) {
      if (err.response?.status === 404) {
        setActionError('删除用户 API 尚未实现');
      } else {
        setActionError(err.response?.data?.detail || '操作失败');
      }
    } finally {
      setActionLoading(null);
    }
  };

  const statusBadge = (status: string) => {
    const cfg = STATUS_BADGE[status] || STATUS_BADGE.inactive;
    const Icon = cfg.icon;
    return (
      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${cfg.color}`}>
        <Icon className="w-3 h-3" />
        {cfg.label}
      </span>
    );
  };

  const formatDate = (d: string | null) => {
    if (!d) return '—';
    return new Date(d).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  const ShimmerRow = () => (
    <tr className="border-b border-border-color">
      {Array.from({ length: 7 }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 bg-bg-tertiary rounded animate-pulse w-full" />
        </td>
      ))}
    </tr>
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary mb-2">用户管理</h1>
          <p className="text-text-secondary">管理系统用户账户</p>
        </div>
        <button
          onClick={loadUsers}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 text-sm bg-bg-tertiary border border-border-color rounded-lg text-text-primary hover:bg-bg-tertiary transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
          <input
            type="text"
            value={search}
            onChange={(e: any) => setSearch(e.target.value)}
            onKeyDown={(e: any) => { if (e.key === 'Enter') { setPage(1); loadUsers(); }}}
            placeholder="搜索用户名、邮箱或 ID..."
            className="w-full pl-10 pr-4 py-2.5 bg-bg-tertiary border border-border-color rounded-lg text-text-primary placeholder-text-secondary focus:outline-none focus:border-[#58a6ff] text-sm"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e: any) => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-3 py-2.5 bg-bg-tertiary border border-border-color rounded-lg text-text-primary focus:outline-none focus:border-[#58a6ff] text-sm"
        >
          <option value="all">全部状态</option>
          <option value="active">活跃</option>
          <option value="inactive">非活跃</option>
          <option value="banned">已封禁</option>
        </select>
        <button
          onClick={() => { setPage(1); loadUsers(); }}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 text-sm bg-bg-tertiary border border-border-color rounded-lg text-text-primary hover:bg-bg-tertiary transition-colors"
        >
          <Search className="w-4 h-4" />
          查询
        </button>
      </div>

      {/* Error Banner */}
      {actionError && (
        <div className="p-3 bg-[#f85149]/10 border border-[#f85149]/20 rounded-lg text-[#f85149] text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          {actionError}
          <button onClick={() => setActionError('')} className="ml-auto text-[#f85149] hover:underline">
            关闭
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-bg-tertiary rounded-xl border border-border-color overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-color bg-bg-tertiary">
                <th className="px-4 py-3 text-left font-medium text-text-secondary">ID</th>
                <th className="px-4 py-3 text-left font-medium text-text-secondary">用户</th>
                <th className="px-4 py-3 text-left font-medium text-text-secondary">邮箱</th>
                <th className="px-4 py-3 text-left font-medium text-text-secondary">状态</th>
                <th className="px-4 py-3 text-left font-medium text-text-secondary">注册时间</th>
                <th className="px-4 py-3 text-left font-medium text-text-secondary">同步设备</th>
                <th className="px-4 py-3 text-left font-medium text-text-secondary">最后同步</th>
                <th className="px-4 py-3 text-left font-medium text-text-secondary">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => <ShimmerRow key={i} />)
              ) : (
                users.map((user: UserItem, index: number) => (
                  <motion.tr
                    key={user.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: index * 0.02 }}
                    className="border-b border-border-color hover:bg-[#1f2937] transition-colors"
                  >
                    <td className="px-4 py-3 text-text-secondary font-mono text-xs">{user.id.slice(0, 8)}...</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 bg-[#58a6ff]/10 rounded-full flex items-center justify-center">
                          <User className="w-3.5 h-3.5 text-info" />
                        </div>
                        <div>
                          <div className="text-text-primary font-medium">{user.display_name || user.username || '未命名'}</div>
                          <div className="text-text-secondary text-xs">@{user.username}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 text-text-secondary">
                        <Mail className="w-3.5 h-3.5" />
                        {user.email}
                      </div>
                    </td>
                    <td className="px-4 py-3">{statusBadge(user.status)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 text-text-secondary">
                        <Calendar className="w-3.5 h-3.5" />
                        {formatDate(user.created_at)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{formatDate(user.last_login_at)}</td>
                    <td className="px-4 py-3 text-text-secondary">{user.sync_devices_count ?? 0}</td>
                    <td className="px-4 py-3 text-text-secondary">{formatDate(user.last_sync_at ?? null)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setDetailUser(user)}
                          className="p-1.5 rounded hover:bg-[#58a6ff]/10 text-info transition-colors"
                          title="查看详情"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => { setEditStatusUser(user); setNewStatus(user.status); }}
                          className="p-1.5 rounded hover:bg-[#d29922]/10 text-[#d29922] transition-colors"
                          title="编辑状态"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setResetPwUser(user)}
                          className="p-1.5 rounded hover:bg-[#a371f7]/10 text-[#a371f7] transition-colors"
                          title="重置密码"
                        >
                          <Lock className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeleteUser(user)}
                          className="p-1.5 rounded hover:bg-[#f85149]/10 text-[#f85149] transition-colors"
                          title="删除"
                        >
                          <Trash className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {users.length === 0 && !loading && (
          <div className="p-8 text-center text-text-secondary">
            <Shield className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>未找到用户</p>
          </div>
        )}

        {/* Pagination */}
        {!loading && users.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border-color">
            <div className="text-xs text-text-secondary">
              共 {total} 条，第 {page} / {totalPages} 页
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p: number) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 rounded border border-border-color text-text-primary hover:bg-bg-tertiary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const p = i + 1;
                return (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`min-w-[32px] px-2 py-1 rounded text-sm font-medium transition-colors ${
                      page === p
                        ? 'bg-[#58a6ff] text-white'
                        : 'border border-border-color text-text-primary hover:bg-bg-tertiary'
                    }`}
                  >
                    {p}
                  </button>
                );
              })}
              {totalPages > 5 && <span className="text-text-secondary">...</span>}
              <button
                onClick={() => setPage((p: number) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="p-1.5 rounded border border-border-color text-text-primary hover:bg-bg-tertiary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      <AnimatePresence>
        {detailUser && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
            onClick={() => setDetailUser(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e: any) => e.stopPropagation()}
              className="bg-bg-secondary border border-border-color rounded-xl shadow-2xl w-full max-w-lg overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-border-color flex items-center justify-between">
                <h3 className="text-lg font-semibold text-text-primary">用户详情</h3>
                <button onClick={() => setDetailUser(null)} className="text-text-secondary hover:text-text-primary">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs text-text-secondary mb-1">ID</div>
                    <div className="text-sm text-text-primary font-mono break-all">{detailUser.id}</div>
                  </div>
                  <div>
                    <div className="text-xs text-text-secondary mb-1">用户名</div>
                    <div className="text-sm text-text-primary">@{detailUser.username}</div>
                  </div>
                  <div>
                    <div className="text-xs text-text-secondary mb-1">邮箱</div>
                    <div className="text-sm text-text-primary">{detailUser.email}</div>
                  </div>
                  <div>
                    <div className="text-xs text-text-secondary mb-1">状态</div>
                    <div className="text-sm">{statusBadge(detailUser.status)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-text-secondary mb-1">显示名称</div>
                    <div className="text-sm text-text-primary">{detailUser.display_name || '—'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-text-secondary mb-1">注册时间</div>
                    <div className="text-sm text-text-primary">{formatDate(detailUser.created_at)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-text-secondary mb-1">最后登录</div>
                    <div className="text-sm text-text-primary">{formatDate(detailUser.last_login_at)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-text-secondary mb-1">笔记数</div>
                    <div className="text-sm text-text-primary">{detailUser.notes_count ?? '—'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-text-secondary mb-1">胶囊数</div>
                    <div className="text-sm text-text-primary">{detailUser.capsules_count ?? '—'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-text-secondary mb-1">同步设备数</div>
                    <div className="text-sm text-text-primary">{detailUser.sync_devices_count ?? 0}</div>
                  </div>
                  <div>
                    <div className="text-xs text-text-secondary mb-1">最后同步</div>
                    <div className="text-sm text-text-primary">{formatDate(detailUser.last_sync_at ?? null)}</div>
                  </div>
                </div>

                {actionError && (
                  <div className="text-xs text-[#f85149]">{actionError}</div>
                )}
              </div>
              <div className="px-6 py-4 border-t border-border-color flex justify-end gap-2">
                <button
                  onClick={() => setDetailUser(null)}
                  className="px-4 py-2 rounded-lg border border-border-color text-text-primary hover:bg-bg-tertiary text-sm transition-colors"
                >
                  关闭
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit Status Modal */}
      <AnimatePresence>
        {editStatusUser && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
            onClick={() => setEditStatusUser(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e: any) => e.stopPropagation()}
              className="bg-bg-secondary border border-border-color rounded-xl shadow-2xl w-full max-w-md"
            >
              <div className="px-6 py-4 border-b border-border-color">
                <h3 className="text-lg font-semibold text-text-primary">修改用户状态</h3>
                <p className="text-sm text-text-secondary mt-1">
                  用户：{editStatusUser.display_name || editStatusUser.username}（{editStatusUser.email}）
                </p>
              </div>
              <div className="p-6">
                <label className="block text-sm text-text-secondary mb-2">选择新状态</label>
                <select
                  value={newStatus}
                  onChange={(e: any) => setNewStatus(e.target.value)}
                  className="w-full px-3 py-2.5 bg-bg-tertiary border border-border-color rounded-lg text-text-primary focus:outline-none focus:border-[#58a6ff] text-sm"
                >
                  <option value="active">活跃</option>
                  <option value="inactive">非活跃</option>
                  <option value="banned">已封禁</option>
                </select>
              </div>
              <div className="px-6 py-4 border-t border-border-color flex justify-end gap-2">
                <button
                  onClick={() => setEditStatusUser(null)}
                  className="px-4 py-2 rounded-lg border border-border-color text-text-primary hover:bg-bg-tertiary text-sm transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={() => handleStatusChange(editStatusUser.id, newStatus)}
                  disabled={actionLoading === editStatusUser.id}
                  className="px-4 py-2 rounded-lg bg-[#58a6ff] text-white hover:bg-[#58a6ff]/90 text-sm transition-colors flex items-center gap-2 disabled:opacity-60"
                >
                  {actionLoading === editStatusUser.id && <Loader2 className="w-4 h-4 animate-spin" />}
                  保存
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reset Password Modal */}
      <AnimatePresence>
        {resetPwUser && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
            onClick={() => setResetPwUser(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e: any) => e.stopPropagation()}
              className="bg-bg-secondary border border-border-color rounded-xl shadow-2xl w-full max-w-md"
            >
              <div className="px-6 py-4 border-b border-border-color">
                <h3 className="text-lg font-semibold text-text-primary">重置密码</h3>
                <p className="text-sm text-text-secondary mt-1">
                  用户：{resetPwUser.display_name || resetPwUser.username}（{resetPwUser.email}）
                </p>
              </div>
              <div className="p-6">
                <div className="p-3 bg-[#d29922]/10 border border-[#d29922]/20 rounded-lg text-sm text-[#d29922]">
                  <AlertTriangle className="w-4 h-4 inline mr-2" />
                  此操作将为用户生成随机密码并发送通知邮件。请确认后再执行。
                </div>
              </div>
              <div className="px-6 py-4 border-t border-border-color flex justify-end gap-2">
                <button
                  onClick={() => setResetPwUser(null)}
                  className="px-4 py-2 rounded-lg border border-border-color text-text-primary hover:bg-bg-tertiary text-sm transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={() => handleResetPassword(resetPwUser.id)}
                  disabled={actionLoading === resetPwUser.id}
                  className="px-4 py-2 rounded-lg bg-[#d29922] text-white hover:bg-[#d29922]/90 text-sm transition-colors flex items-center gap-2 disabled:opacity-60"
                >
                  {actionLoading === resetPwUser.id && <Loader2 className="w-4 h-4 animate-spin" />}
                  确认重置
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Modal */}
      <AnimatePresence>
        {deleteUser && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
            onClick={() => setDeleteUser(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e: any) => e.stopPropagation()}
              className="bg-bg-secondary border border-[#f85149]/30 rounded-xl shadow-2xl w-full max-w-md"
            >
              <div className="px-6 py-4 border-b border-[#f85149]/20">
                <h3 className="text-lg font-semibold text-[#f85149]">删除用户</h3>
                <p className="text-sm text-text-secondary mt-1">
                  用户：{deleteUser.display_name || deleteUser.username}（{deleteUser.email}）
                </p>
              </div>
              <div className="p-6">
                <div className="p-3 bg-[#f85149]/10 border border-[#f85149]/20 rounded-lg text-sm text-[#f85149]">
                  <AlertTriangle className="w-4 h-4 inline mr-2" />
                  此操作不可逆。删除后该用户的所有数据（笔记、剪藏、胶囊等）将一并清除。请确认后再执行。
                </div>
              </div>
              <div className="px-6 py-4 border-t border-border-color flex justify-end gap-2">
                <button
                  onClick={() => setDeleteUser(null)}
                  className="px-4 py-2 rounded-lg border border-border-color text-text-primary hover:bg-bg-tertiary text-sm transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={() => handleDelete(deleteUser.id)}
                  disabled={actionLoading === deleteUser.id}
                  className="px-4 py-2 rounded-lg bg-[#f85149] text-white hover:bg-[#f85149]/90 text-sm transition-colors flex items-center gap-2 disabled:opacity-60"
                >
                  {actionLoading === deleteUser.id && <Loader2 className="w-4 h-4 animate-spin" />}
                  确认删除
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
