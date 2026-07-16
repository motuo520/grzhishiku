import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ClipboardList, Search, Calendar, AlertTriangle, Check, Info,
  Download, X, Eye, ChevronLeft, ChevronRight, Filter, Clock
} from 'lucide-react';
import adminApi from '../../services/adminApi';

interface LogEntry {
  id: string;
  admin_id: string;
  admin_name: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'EXPORT';
  target_type: string;
  target_id: string;
  before_state?: Record<string, unknown>;
  after_state?: Record<string, unknown>;
  diff?: Record<string, { old: unknown; new: unknown }>;
  severity: 'low' | 'medium' | 'high' | 'critical';
  ip_address: string;
  created_at: string;
}

const ACTION_BADGES: Record<string, { label: string; class: string; icon: typeof Check }> = {
  CREATE: { label: '创建', class: 'bg-success/10 text-success border-success/20', icon: Check },
  UPDATE: { label: '更新', class: 'bg-admin-primary/10 text-admin-primary border-admin-primary/20', icon: Info },
  DELETE: { label: '删除', class: 'bg-danger/10 text-danger border-danger/20', icon: X },
  LOGIN: { label: '登录', class: 'bg-admin-muted/10 text-admin-muted border-admin-muted/20', icon: Clock },
  EXPORT: { label: '导出', class: 'bg-personal-primary/10 text-personal-primary border-personal-primary/20', icon: Download },
};

const SEVERITY_BADGES: Record<string, string> = {
  low: 'bg-admin-muted/10 text-admin-muted border-admin-muted/20',
  medium: 'bg-warning/10 text-warning border-warning/20',
  high: 'bg-personal-primary/10 text-personal-primary border-personal-primary/20',
  critical: 'bg-danger/10 text-danger border-danger/20',
};

function ShimmerTable() {
  return (
    <div className="p-6 bg-admin-sidebar rounded-xl border border-admin-border overflow-hidden animate-pulse">
      <div className="px-4 py-3 border-b border-admin-border h-12 bg-admin-hover" />
      {[...Array(8)].map((_, i) => (
        <div key={i} className="px-4 py-3 h-12 border-b border-admin-border bg-admin-hover/50" />
      ))}
    </div>
  );
}

export default function AdminLogs() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [timeFilter, setTimeFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [detailLog, setDetailLog] = useState<LogEntry | null>(null);
  const searchRef = useRef(search);
  searchRef.current = search;

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params: Record<string, string | number> = { skip: (page - 1) * pageSize, limit: pageSize };
      if (actionFilter !== 'all') params.actionType = actionFilter;
      if (severityFilter !== 'all') params.severity = severityFilter;
      if (timeFilter !== 'all') {
        const now = new Date();
        if (timeFilter === 'today') {
          params.startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        } else if (timeFilter === 'week') {
          const d = new Date(); d.setDate(d.getDate() - 7);
          params.startDate = d.toISOString();
        } else if (timeFilter === 'month') {
          const d = new Date(); d.setMonth(d.getMonth() - 1);
          params.startDate = d.toISOString();
        }
      }
      if (searchRef.current.trim()) params.search = searchRef.current.trim();
      const res = await adminApi.getLogs(params);
      setLogs(res.data);
    } catch (err: any) {
      setError(err.response?.data?.detail || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [page, actionFilter, severityFilter, timeFilter, pageSize]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleSearch = () => {
    setPage(1);
    fetchLogs();
  };

  const exportLogs = async (format: 'json' | 'csv') => {
    try {
      const blob = await adminApi.exportLogs(format);
      const url = window.URL.createObjectURL(new Blob([blob.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `audit-logs.${format}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.response?.data?.detail || '导出失败');
    }
  };

  const filteredLogs = useMemo(() => logs, [logs]);
  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / pageSize));

  const renderDiff = (diff?: Record<string, { old: unknown; new: unknown }>) => {
    if (!diff || Object.keys(diff).length === 0) return <p className="text-xs text-admin-muted">无变更</p>;
    return (
      <div className="space-y-2">
        {Object.entries(diff).map(([key, change]) => (
          <div key={key} className="grid grid-cols-3 gap-2 text-xs">
            <span className="text-admin-muted font-medium">{key}</span>
            <span className="text-danger bg-danger/5 px-1.5 py-0.5 rounded truncate">{JSON.stringify(change.old)}</span>
            <span className="text-success bg-success/5 px-1.5 py-0.5 rounded truncate">{JSON.stringify(change.new)}</span>
          </div>
        ))}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white mb-2">审计日志</h1>
          <p className="text-admin-muted">管理员操作记录</p>
        </div>
        <div className="flex flex-col md:flex-row gap-4">
          <div className="h-10 bg-admin-hover rounded-lg flex-1 animate-pulse" />
          <div className="h-10 bg-admin-hover rounded-lg w-32 animate-pulse" />
        </div>
        <ShimmerTable />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white mb-2">审计日志</h1>
        <p className="text-admin-muted">管理员操作记录</p>
      </div>

      {error && (
        <div className="px-4 py-3 bg-danger/10 border border-danger/20 rounded-lg text-danger text-sm">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col lg:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-admin-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="搜索操作人或资源 ID..."
            className="w-full pl-10 pr-4 py-2.5 bg-admin-sidebar border border-admin-border rounded-lg text-white placeholder-admin-muted focus:outline-none focus:border-admin-primary"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={actionFilter}
            onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
            className="px-3 py-2.5 bg-admin-sidebar border border-admin-border rounded-lg text-sm text-white focus:outline-none focus:border-admin-primary"
          >
            <option value="all">全部操作</option>
            <option value="CREATE">创建</option>
            <option value="UPDATE">更新</option>
            <option value="DELETE">删除</option>
            <option value="LOGIN">登录</option>
            <option value="EXPORT">导出</option>
          </select>
          <select
            value={severityFilter}
            onChange={(e) => { setSeverityFilter(e.target.value); setPage(1); }}
            className="px-3 py-2.5 bg-admin-sidebar border border-admin-border rounded-lg text-sm text-white focus:outline-none focus:border-admin-primary"
          >
            <option value="all">全部风险</option>
            <option value="low">低</option>
            <option value="medium">中</option>
            <option value="high">高</option>
            <option value="critical">严重</option>
          </select>
          <select
            value={timeFilter}
            onChange={(e) => { setTimeFilter(e.target.value); setPage(1); }}
            className="px-3 py-2.5 bg-admin-sidebar border border-admin-border rounded-lg text-sm text-white focus:outline-none focus:border-admin-primary"
          >
            <option value="all">全部时间</option>
            <option value="today">今天</option>
            <option value="week">本周</option>
            <option value="month">本月</option>
          </select>
          <button
            onClick={handleSearch}
            className="px-3 py-2.5 bg-admin-primary text-white rounded-lg text-sm hover:bg-admin-primary/90 transition-colors"
          >
            <Filter className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-1">
            <button
              onClick={() => exportLogs('json')}
              className="px-3 py-2.5 bg-admin-sidebar border border-admin-border rounded-lg text-sm text-admin-muted hover:text-white hover:bg-admin-hover transition-colors"
            >
              <Download className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-admin-sidebar rounded-xl border border-admin-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-admin-border bg-admin-bg/50">
                <th className="px-4 py-3 text-left text-sm font-medium text-admin-muted">ID</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-admin-muted">操作</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-admin-muted">操作人</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-admin-muted">资源</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-admin-muted">风险</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-admin-muted">时间</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-admin-muted">操作</th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence>
                {filteredLogs.map((log, index) => {
                  const actionBadge = ACTION_BADGES[log.action] || ACTION_BADGES.UPDATE;
                  return (
                    <motion.tr
                      key={log.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ delay: index * 0.02 }}
                      className="border-b border-admin-border hover:bg-admin-hover transition-colors"
                    >
                      <td className="px-4 py-3 text-xs text-admin-muted font-mono">{log.id.slice(0, 8)}</td>
                      <td className="px-4 py-3">
                        <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border text-xs font-medium ${actionBadge.class}`}>
                          <actionBadge.icon className="w-3 h-3" />
                          {actionBadge.label}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-white">{log.admin_name}</td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-admin-muted">
                          <span className="text-white">{log.target_type}</span>
                          <span className="text-xs text-admin-muted ml-2 font-mono">{log.target_id.slice(0, 8)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-xs font-medium ${SEVERITY_BADGES[log.severity] || SEVERITY_BADGES.low}`}>
                          {log.severity === 'critical' && <AlertTriangle className="w-3 h-3" />}
                          {log.severity}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 text-sm text-admin-muted">
                          <Calendar className="w-3.5 h-3.5" />
                          {new Date(log.created_at).toLocaleString('zh-CN')}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setDetailLog(log)}
                          className="p-1.5 rounded-lg hover:bg-admin-hover text-admin-muted hover:text-white transition-colors"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      </td>
                    </motion.tr>
                  );
                })}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
        {filteredLogs.length === 0 && (
          <div className="p-8 text-center text-admin-muted">
            <ClipboardList className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>未找到日志</p>
          </div>
        )}

        {/* Pagination */}
        <div className="px-4 py-3 border-t border-admin-border flex items-center justify-between">
          <span className="text-sm text-admin-muted">
            第 {page} 页，共 {totalPages} 页
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-1.5 rounded-lg border border-admin-border text-admin-muted hover:text-white hover:bg-admin-hover disabled:opacity-30 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="p-1.5 rounded-lg border border-admin-border text-admin-muted hover:text-white hover:bg-admin-hover disabled:opacity-30 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Detail Modal */}
      <AnimatePresence>
        {detailLog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
            onClick={() => setDetailLog(null)}
          >
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              className="bg-admin-sidebar rounded-xl border border-admin-border w-full max-w-2xl max-h-[80vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-6 py-4 border-b border-admin-border flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">日志详情</h3>
                <button
                  onClick={() => setDetailLog(null)}
                  className="p-1 rounded-lg hover:bg-admin-hover text-admin-muted hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="px-6 py-4 space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-admin-muted">操作人</span>
                    <p className="text-white mt-1">{detailLog.admin_name}</p>
                  </div>
                  <div>
                    <span className="text-admin-muted">操作类型</span>
                    <p className="text-white mt-1">{detailLog.action}</p>
                  </div>
                  <div>
                    <span className="text-admin-muted">资源类型</span>
                    <p className="text-white mt-1">{detailLog.target_type}</p>
                  </div>
                  <div>
                    <span className="text-admin-muted">资源 ID</span>
                    <p className="text-white mt-1 font-mono">{detailLog.target_id}</p>
                  </div>
                  <div>
                    <span className="text-admin-muted">IP 地址</span>
                    <p className="text-white mt-1 font-mono">{detailLog.ip_address}</p>
                  </div>
                  <div>
                    <span className="text-admin-muted">时间</span>
                    <p className="text-white mt-1">{new Date(detailLog.created_at).toLocaleString('zh-CN')}</p>
                  </div>
                </div>

                <div className="border-t border-admin-border pt-4">
                  <h4 className="text-sm font-medium text-white mb-2">变更内容</h4>
                  {renderDiff(detailLog.diff)}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-admin-border pt-4">
                  <div>
                    <h4 className="text-sm font-medium text-admin-muted mb-2">操作前状态</h4>
                    <pre className="bg-admin-bg rounded-lg p-3 text-xs text-white overflow-x-auto border border-admin-border">
                      {JSON.stringify(detailLog.before_state || {}, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <h4 className="text-sm font-medium text-admin-muted mb-2">操作后状态</h4>
                    <pre className="bg-admin-bg rounded-lg p-3 text-xs text-white overflow-x-auto border border-admin-border">
                      {JSON.stringify(detailLog.after_state || {}, null, 2)}
                    </pre>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
