import { useEffect, useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageSquare, Clock, CheckCircle, AlertTriangle, TrendingUp,
  Star, Search, Filter, Eye, X, Send, User, Shield
} from 'lucide-react';
import adminApi from '../../services/adminApi';

interface Ticket {
  id: string;
  user_id: string;
  user_email: string;
  subject: string;
  description: string;
  status: 'open' | 'closed' | 'pending';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  category: 'bug' | 'feature' | 'feedback' | 'billing' | 'account';
  assigned_to?: string;
  assigned_name?: string;
  satisfaction?: number;
  created_at: string;
  updated_at: string;
  last_reply_at?: string;
  replies?: Reply[];
}

interface Reply {
  id: string;
  author_type: 'user' | 'admin';
  author_name: string;
  content: string;
  created_at: string;
}

interface SupportStats {
  newToday: number;
  pending: number;
  resolved: number;
  avgResponseTime: number;
  satisfaction: number;
}

const STATUS_BADGES: Record<string, { label: string; class: string }> = {
  open: { label: '待处理', class: 'bg-success/10 text-success' },
  closed: { label: '已关闭', class: 'bg-admin-muted/10 text-admin-muted' },
  pending: { label: '处理中', class: 'bg-warning/10 text-warning' },
};

const PRIORITY_BADGES: Record<string, string> = {
  urgent: 'bg-danger/10 text-danger',
  high: 'bg-personal-primary/10 text-personal-primary',
  medium: 'bg-warning/10 text-warning',
  low: 'bg-admin-muted/10 text-admin-muted',
};

const CATEGORY_BADGES: Record<string, { label: string; class: string }> = {
  bug: { label: 'Bug', class: 'bg-danger/10 text-danger' },
  feature: { label: '功能', class: 'bg-admin-primary/10 text-admin-primary' },
  feedback: { label: '反馈', class: 'bg-success/10 text-success' },
  billing: { label: '计费', class: 'bg-personal-primary/10 text-personal-primary' },
  account: { label: '账号', class: 'bg-network-primary/10 text-network-primary' },
};

function ShimmerCard() {
  return (
    <div className="bg-admin-sidebar rounded-xl border border-admin-border p-6 animate-pulse">
      <div className="h-4 bg-admin-hover rounded w-24 mb-4" />
      <div className="h-8 bg-admin-hover rounded w-16" />
    </div>
  );
}

function ShimmerTable() {
  return (
    <div className="bg-admin-sidebar rounded-xl border border-admin-border overflow-hidden animate-pulse">
      <div className="px-4 py-3 border-b border-admin-border h-12 bg-admin-hover" />
      {[...Array(5)].map((_, i) => (
        <div key={i} className="px-4 py-3 h-12 border-b border-admin-border bg-admin-hover/50" />
      ))}
    </div>
  );
}

export default function AdminSupport() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [stats, setStats] = useState<SupportStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [assignedFilter, setAssignedFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [detailTicket, setDetailTicket] = useState<Ticket | null>(null);
  const [replyContent, setReplyContent] = useState('');
  const [replying, setReplying] = useState(false);
  const [admins] = useState<{ id: string; name: string }[]>([
    { id: 'admin1', name: 'Admin One' },
    { id: 'admin2', name: 'Admin Two' },
  ]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params: Record<string, string> = {};
      if (statusFilter !== 'all') params.status = statusFilter;
      if (typeFilter !== 'all') params.type = typeFilter;
      if (priorityFilter !== 'all') params.priority = priorityFilter;
      if (assignedFilter !== 'all') params.assignedTo = assignedFilter;
      const [ticketsRes, statsRes] = await Promise.all([
        adminApi.getTickets(params),
        adminApi.getSupportStats(),
      ]);
      setTickets(ticketsRes.data);
      setStats(statsRes.data);
    } catch (err: any) {
      setError(err.response?.data?.detail || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, typeFilter, priorityFilter, assignedFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filteredTickets = useMemo(() => {
    return tickets.filter((t) => {
      if (!search.trim()) return true;
      const s = search.toLowerCase();
      return t.subject.toLowerCase().includes(s) || t.user_email.toLowerCase().includes(s);
    });
  }, [tickets, search]);

  const handleAssign = async (ticketId: string, adminId: string) => {
    try {
      await adminApi.assignTicket(ticketId, adminId);
      setTickets((prev) => prev.map((t) =>
        t.id === ticketId ? { ...t, assigned_to: adminId, assigned_name: admins.find((a) => a.id === adminId)?.name } : t
      ));
      if (detailTicket?.id === ticketId) {
        setDetailTicket((prev) => prev ? { ...prev, assigned_to: adminId, assigned_name: admins.find((a) => a.id === adminId)?.name } : null);
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || '分配失败');
    }
  };

  const handleStatusUpdate = async (ticketId: string, status: string) => {
    try {
      await adminApi.updateTicketStatus(ticketId, status);
      setTickets((prev) => prev.map((t) => t.id === ticketId ? { ...t, status: status as Ticket['status'] } : t));
      if (detailTicket?.id === ticketId) {
        setDetailTicket((prev) => prev ? { ...prev, status: status as Ticket['status'] } : null);
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || '更新失败');
    }
  };

  const handleReply = async () => {
    if (!detailTicket || !replyContent.trim()) return;
    setReplying(true);
    try {
      await adminApi.replyTicket(detailTicket.id, replyContent.trim());
      const updated = await adminApi.getTicket(detailTicket.id);
      setDetailTicket(updated.data);
      setTickets((prev) => prev.map((t) => t.id === detailTicket.id ? updated.data : t));
      setReplyContent('');
    } catch (err: any) {
      setError(err.response?.data?.detail || '回复失败');
    } finally {
      setReplying(false);
    }
  };

  const openDetail = async (ticket: Ticket) => {
    try {
      const res = await adminApi.getTicket(ticket.id);
      setDetailTicket(res.data);
    } catch {
      setDetailTicket(ticket);
    }
  };

  const statCards = useMemo(() => {
    if (!stats) return [];
    return [
      { label: '今日新增', value: stats.newToday || 0, icon: MessageSquare, color: 'text-admin-primary' },
      { label: '待处理', value: stats.pending || 0, icon: AlertTriangle, color: 'text-warning' },
      { label: '已解决', value: stats.resolved || 0, icon: CheckCircle, color: 'text-success' },
      { label: '平均响应', value: `${stats.avgResponseTime || 0}h`, icon: Clock, color: 'text-info' },
      { label: '满意度', value: (
        <div className="flex items-center gap-1">
          <span className="text-2xl font-bold text-white">{stats.satisfaction?.toFixed(1) || '0.0'}</span>
          <div className="flex">
            {[...Array(5)].map((_, i) => (
              <Star key={i} className={`w-3.5 h-3.5 ${i < Math.round(stats.satisfaction || 0) ? 'text-warning fill-warning' : 'text-admin-muted'}`} />
            ))}
          </div>
        </div>
      ), icon: Star, color: 'text-warning', isCustom: true },
    ];
  }, [stats]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white mb-2">客服工单</h1>
          <p className="text-admin-muted">处理用户支持请求</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {[...Array(5)].map((_, i) => <ShimmerCard key={i} />)}
        </div>
        <ShimmerTable />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white mb-2">客服工单</h1>
        <p className="text-admin-muted">处理用户支持请求</p>
      </div>

      {error && (
        <div className="px-4 py-3 bg-danger/10 border border-danger/20 rounded-lg text-danger text-sm">
          {error}
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {statCards.map((card, index) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            className="bg-admin-sidebar rounded-xl border border-admin-border p-6"
          >
            <div className="flex items-center gap-3 mb-2">
              <card.icon className={`w-5 h-5 ${card.color}`} />
              <span className="text-sm text-admin-muted">{card.label}</span>
            </div>
            {card.isCustom ? card.value : <div className="text-2xl font-bold text-white">{card.value}</div>}
          </motion.div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col lg:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-admin-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索标题或用户..."
            className="w-full pl-10 pr-4 py-2.5 bg-admin-sidebar border border-admin-border rounded-lg text-white placeholder-admin-muted focus:outline-none focus:border-admin-primary"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2.5 bg-admin-sidebar border border-admin-border rounded-lg text-sm text-white focus:outline-none focus:border-admin-primary"
          >
            <option value="all">全部状态</option>
            <option value="open">待处理</option>
            <option value="pending">处理中</option>
            <option value="closed">已关闭</option>
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-2.5 bg-admin-sidebar border border-admin-border rounded-lg text-sm text-white focus:outline-none focus:border-admin-primary"
          >
            <option value="all">全部类型</option>
            <option value="bug">Bug</option>
            <option value="feature">功能</option>
            <option value="feedback">反馈</option>
            <option value="billing">计费</option>
            <option value="account">账号</option>
          </select>
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="px-3 py-2.5 bg-admin-sidebar border border-admin-border rounded-lg text-sm text-white focus:outline-none focus:border-admin-primary"
          >
            <option value="all">全部优先级</option>
            <option value="urgent">紧急</option>
            <option value="high">高</option>
            <option value="medium">中</option>
            <option value="low">低</option>
          </select>
          <select
            value={assignedFilter}
            onChange={(e) => setAssignedFilter(e.target.value)}
            className="px-3 py-2.5 bg-admin-sidebar border border-admin-border rounded-lg text-sm text-white focus:outline-none focus:border-admin-primary"
          >
            <option value="all">全部分配</option>
            <option value="unassigned">未分配</option>
            <option value="admin1">Admin One</option>
            <option value="admin2">Admin Two</option>
          </select>
          <button
            onClick={fetchData}
            className="px-3 py-2.5 bg-admin-primary text-white rounded-lg text-sm hover:bg-admin-primary/90 transition-colors"
          >
            <Filter className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Ticket Table */}
      <div className="bg-admin-sidebar rounded-xl border border-admin-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-admin-border bg-admin-bg/50">
                <th className="px-4 py-3 text-left text-sm font-medium text-admin-muted">ID</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-admin-muted">标题</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-admin-muted">用户</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-admin-muted">类型</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-admin-muted">优先级</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-admin-muted">状态</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-admin-muted">分配人</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-admin-muted">创建时间</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-admin-muted">最后回复</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-admin-muted">操作</th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence>
                {filteredTickets.map((ticket, index) => {
                  const cat = CATEGORY_BADGES[ticket.category] || CATEGORY_BADGES.feedback;
                  const st = STATUS_BADGES[ticket.status] || STATUS_BADGES.open;
                  return (
                    <motion.tr
                      key={ticket.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ delay: index * 0.02 }}
                      className="border-b border-admin-border hover:bg-admin-hover transition-colors"
                    >
                      <td className="px-4 py-3 text-xs text-admin-muted font-mono">{ticket.id.slice(0, 8)}</td>
                      <td className="px-4 py-3 text-sm text-white max-w-xs truncate">{ticket.subject}</td>
                      <td className="px-4 py-3 text-sm text-admin-muted">{ticket.user_email}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${cat.class}`}>
                          {cat.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${PRIORITY_BADGES[ticket.priority] || PRIORITY_BADGES.medium}`}>
                          {ticket.priority}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${st.class}`}>
                          {st.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-admin-muted">
                        {ticket.assigned_name || (
                          <select
                            className="px-2 py-1 bg-admin-bg border border-admin-border rounded text-xs text-white"
                            onChange={(e) => handleAssign(ticket.id, e.target.value)}
                          >
                            <option value="">未分配</option>
                            {admins.map((a) => (
                              <option key={a.id} value={a.id}>{a.name}</option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-admin-muted">
                        {new Date(ticket.created_at).toLocaleDateString('zh-CN')}
                      </td>
                      <td className="px-4 py-3 text-sm text-admin-muted">
                        {ticket.last_reply_at ? new Date(ticket.last_reply_at).toLocaleDateString('zh-CN') : '-'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => openDetail(ticket)}
                            className="p-1.5 rounded-lg hover:bg-admin-hover text-admin-muted hover:text-white transition-colors"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <select
                            className="px-2 py-1 bg-admin-bg border border-admin-border rounded text-xs text-white"
                            value={ticket.status}
                            onChange={(e) => handleStatusUpdate(ticket.id, e.target.value)}
                          >
                            <option value="open">待处理</option>
                            <option value="pending">处理中</option>
                            <option value="closed">已关闭</option>
                          </select>
                        </div>
                      </td>
                    </motion.tr>
                  );
                })}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
        {filteredTickets.length === 0 && (
          <div className="p-8 text-center text-admin-muted">
            <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>暂无工单</p>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      <AnimatePresence>
        {detailTicket && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
            onClick={() => setDetailTicket(null)}
          >
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              className="bg-admin-sidebar rounded-xl border border-admin-border w-full max-w-3xl max-h-[85vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-6 py-4 border-b border-admin-border flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-white">{detailTicket.subject}</h3>
                  <p className="text-sm text-admin-muted mt-0.5">{detailTicket.user_email}</p>
                </div>
                <button
                  onClick={() => setDetailTicket(null)}
                  className="p-1 rounded-lg hover:bg-admin-hover text-admin-muted hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="px-6 py-4 space-y-6">
                {/* Meta */}
                <div className="flex flex-wrap items-center gap-3">
                  <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${CATEGORY_BADGES[detailTicket.category]?.class || ''}`}>
                    {CATEGORY_BADGES[detailTicket.category]?.label || detailTicket.category}
                  </span>
                  <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${PRIORITY_BADGES[detailTicket.priority] || ''}`}>
                    {detailTicket.priority}
                  </span>
                  <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${STATUS_BADGES[detailTicket.status]?.class || ''}`}>
                    {STATUS_BADGES[detailTicket.status]?.label || detailTicket.status}
                  </span>
                  <select
                    className="px-2 py-1 bg-admin-bg border border-admin-border rounded text-xs text-white"
                    value={detailTicket.assigned_to || ''}
                    onChange={(e) => handleAssign(detailTicket.id, e.target.value)}
                  >
                    <option value="">未分配</option>
                    {admins.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                  <select
                    className="px-2 py-1 bg-admin-bg border border-admin-border rounded text-xs text-white"
                    value={detailTicket.status}
                    onChange={(e) => handleStatusUpdate(detailTicket.id, e.target.value)}
                  >
                    <option value="open">待处理</option>
                    <option value="pending">处理中</option>
                    <option value="closed">已关闭</option>
                  </select>
                </div>

                {/* Original description */}
                <div className="bg-admin-bg rounded-lg p-4 border border-admin-border">
                  <div className="flex items-center gap-2 mb-2">
                    <User className="w-4 h-4 text-admin-primary" />
                    <span className="text-sm font-medium text-white">用户描述</span>
                    <span className="text-xs text-admin-muted ml-auto">{new Date(detailTicket.created_at).toLocaleString('zh-CN')}</span>
                  </div>
                  <p className="text-sm text-white whitespace-pre-wrap">{detailTicket.description}</p>
                </div>

                {/* Replies */}
                <div className="space-y-3">
                  {(detailTicket.replies || []).map((reply) => (
                    <div
                      key={reply.id}
                      className={`flex ${reply.author_type === 'admin' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={`max-w-[80%] rounded-lg p-3 border ${
                        reply.author_type === 'admin'
                          ? 'bg-admin-primary/10 border-admin-primary/20'
                          : 'bg-admin-bg border-admin-border'
                      }`}>
                        <div className="flex items-center gap-2 mb-1">
                          {reply.author_type === 'admin' ? <Shield className="w-3.5 h-3.5 text-admin-primary" /> : <User className="w-3.5 h-3.5 text-admin-muted" />}
                          <span className="text-xs font-medium text-white">{reply.author_name}</span>
                          <span className="text-xs text-admin-muted">{new Date(reply.created_at).toLocaleString('zh-CN')}</span>
                        </div>
                        <p className="text-sm text-white whitespace-pre-wrap">{reply.content}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Reply input */}
                <div className="border-t border-admin-border pt-4">
                  <div className="flex gap-2">
                    <textarea
                      value={replyContent}
                      onChange={(e) => setReplyContent(e.target.value)}
                      placeholder="输入回复内容..."
                      rows={3}
                      className="flex-1 px-4 py-2.5 bg-admin-bg border border-admin-border rounded-lg text-white placeholder-admin-muted focus:outline-none focus:border-admin-primary resize-none text-sm"
                    />
                    <button
                      onClick={handleReply}
                      disabled={replying || !replyContent.trim()}
                      className="px-4 py-2 bg-admin-primary text-white rounded-lg text-sm font-medium hover:bg-admin-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2 self-end"
                    >
                      {replying ? <TrendingUp className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      发送
                    </button>
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
