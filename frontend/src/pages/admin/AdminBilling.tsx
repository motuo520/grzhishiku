import { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CreditCard, Users, Crown, TrendingUp, TrendingDown,
  ArrowRight, RefreshCw, Loader2
} from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import adminApi from '../../services/adminApi';

interface SubStats {
  revenueTrend: { month: string; revenue: number }[];
  funnel: { stage: string; count: number; rate: number }[];
  churnRate: number;
  churnTrend: number;
  planDistribution: { name: string; value: number; color: string }[];
  refundRate: number;
  refundTrend: number;
  monthlyRevenue: number;
  paidUsers: number;
  arpu: number;
  totalFree: number;
  totalStorage: number;
  llmRevenue: number;
  llmCost: number;
  llmProfit: number;
  llmRevenueByModel: { model_id: string; revenue: number; cost: number; profit: number; calls: number }[];
  llmRevenueTrend: { month: string; revenue: number }[];
}

interface Subscription {
  id: string;
  user_id: string;
  user_email: string;
  tier: string;
  status: string;
  started_at: string;
  expires_at: string;
}

interface AdminPayment {
  id: string;
  user_id: string;
  user_email?: string;
  amount: number;
  currency: string;
  status: string;
  payment_type?: string;
  description?: string;
  paid_at?: string;
  created_at?: string;
}

const COLORS = {
  free: '#8b949e',
  storage: '#d29922',
};

interface Coupon {
  id: string;
  code: string;
  type: 'fixed' | 'percent';
  value: number;
  currency: string;
  min_amount: number;
  max_discount?: number;
  valid_from?: string;
  valid_until?: string;
  max_uses?: number;
  used_count: number;
  is_active: boolean;
  applies_to: 'subscription' | 'topup' | 'all';
  plan_ids?: string[];
  description?: string;
  created_at: string;
}

interface CouponUsage {
  id: string;
  user_id: string;
  coupon_id: string;
  payment_id: string;
  used_at?: string;
}

function CouponsPanel() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [usages, setUsages] = useState<CouponUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [selectedCoupon, setSelectedCoupon] = useState<string | null>(null);
  const [form, setForm] = useState({
    code: '',
    type: 'percent' as 'percent' | 'fixed',
    value_yuan: '',
    value_percent: '',
    applies_to: 'all' as 'subscription' | 'topup' | 'all',
    min_amount_yuan: '',
    max_discount_yuan: '',
    max_uses: '',
    valid_from: '',
    valid_until: '',
    description: '',
  });

  const fetchCoupons = async () => {
    try {
      const res = await adminApi.getCoupons();
      setCoupons(res.data);
    } catch (err: any) {
      setError(err.response?.data?.detail || '加载优惠券失败');
    }
  };

  useEffect(() => {
    setLoading(true);
    fetchCoupons().finally(() => setLoading(false));
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const value =
      form.type === 'fixed'
        ? Math.round(parseFloat(form.value_yuan || '0') * 100)
        : parseInt(form.value_percent || '0', 10);
    if (value <= 0) {
      setError('请输入有效的优惠数值');
      return;
    }
    const payload: Record<string, any> = {
      code: form.code.trim(),
      type: form.type,
      value,
      applies_to: form.applies_to,
      min_amount: Math.round(parseFloat(form.min_amount_yuan || '0') * 100),
      max_uses: form.max_uses ? parseInt(form.max_uses, 10) : null,
      valid_from: form.valid_from || null,
      valid_until: form.valid_until || null,
      description: form.description.trim() || null,
    };
    if (form.type === 'percent' && form.max_discount_yuan) {
      payload.max_discount = Math.round(parseFloat(form.max_discount_yuan) * 100);
    }
    setCreating(true);
    try {
      await adminApi.createCoupon(payload);
      setForm({
        code: '',
        type: 'percent',
        value_yuan: '',
        value_percent: '',
        applies_to: 'all',
        min_amount_yuan: '',
        max_discount_yuan: '',
        max_uses: '',
        valid_from: '',
        valid_until: '',
        description: '',
      });
      await fetchCoupons();
    } catch (err: any) {
      setError(err.response?.data?.detail || '创建优惠券失败');
    } finally {
      setCreating(false);
    }
  };

  const toggleCoupon = async (coupon: Coupon) => {
    try {
      await adminApi.toggleCoupon(coupon.id, !coupon.is_active);
      setCoupons((prev) =>
        prev.map((c) => (c.id === coupon.id ? { ...c, is_active: !coupon.is_active } : c))
      );
    } catch (err: any) {
      setError(err.response?.data?.detail || '状态更新失败');
    }
  };

  const viewUsages = async (couponId: string) => {
    setSelectedCoupon(couponId);
    try {
      const res = await adminApi.getCouponUsages(couponId);
      setUsages(res.data);
    } catch (err: any) {
      setError(err.response?.data?.detail || '加载使用记录失败');
    }
  };

  const formatDate = (s?: string) => (s ? new Date(s).toLocaleString('zh-CN') : '无');
  const formatMoney = (cents?: number) =>
    typeof cents === 'number' ? `¥${(cents / 100).toFixed(2)}` : '-';

  return (
    <div className="p-6 space-y-6">
      {error && (
        <div className="px-4 py-3 bg-danger/10 border border-danger/20 rounded-lg text-danger text-sm">
          {error}
        </div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-admin-sidebar rounded-xl border border-admin-border p-6"
      >
        <h3 className="text-lg font-semibold text-white mb-4">新建优惠券</h3>
        <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-admin-muted mb-1">优惠码</label>
            <input
              type="text"
              required
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              className="w-full px-3 py-2 bg-admin-bg border border-admin-border rounded-lg text-sm text-white focus:outline-none focus:border-admin-primary uppercase"
              placeholder="SUMMER2026"
            />
          </div>
          <div>
            <label className="block text-xs text-admin-muted mb-1">类型</label>
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as 'percent' | 'fixed' })}
              className="w-full px-3 py-2 bg-admin-bg border border-admin-border rounded-lg text-sm text-white focus:outline-none focus:border-admin-primary"
            >
              <option value="percent">百分比折扣</option>
              <option value="fixed">固定金额</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-admin-muted mb-1">
              {form.type === 'fixed' ? '优惠金额（元）' : '折扣百分比'}
            </label>
            <input
              type="number"
              required
              min={1}
              value={form.type === 'fixed' ? form.value_yuan : form.value_percent}
              onChange={(e) =>
                form.type === 'fixed'
                  ? setForm({ ...form, value_yuan: e.target.value })
                  : setForm({ ...form, value_percent: e.target.value })
              }
              className="w-full px-3 py-2 bg-admin-bg border border-admin-border rounded-lg text-sm text-white focus:outline-none focus:border-admin-primary"
              placeholder={form.type === 'fixed' ? '10.00' : '20'}
            />
          </div>
          <div>
            <label className="block text-xs text-admin-muted mb-1">适用范围</label>
            <select
              value={form.applies_to}
              onChange={(e) => setForm({ ...form, applies_to: e.target.value as any })}
              className="w-full px-3 py-2 bg-admin-bg border border-admin-border rounded-lg text-sm text-white focus:outline-none focus:border-admin-primary"
            >
              <option value="all">全部</option>
              <option value="subscription">订阅</option>
              <option value="topup">充值</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-admin-muted mb-1">最低订单金额（元）</label>
            <input
              type="number"
              min={0}
              value={form.min_amount_yuan}
              onChange={(e) => setForm({ ...form, min_amount_yuan: e.target.value })}
              className="w-full px-3 py-2 bg-admin-bg border border-admin-border rounded-lg text-sm text-white focus:outline-none focus:border-admin-primary"
              placeholder="0"
            />
          </div>
          {form.type === 'percent' && (
            <div>
              <label className="block text-xs text-admin-muted mb-1">折扣上限（元）</label>
              <input
                type="number"
                min={0}
                value={form.max_discount_yuan}
                onChange={(e) => setForm({ ...form, max_discount_yuan: e.target.value })}
                className="w-full px-3 py-2 bg-admin-bg border border-admin-border rounded-lg text-sm text-white focus:outline-none focus:border-admin-primary"
                placeholder="可选"
              />
            </div>
          )}
          <div>
            <label className="block text-xs text-admin-muted mb-1">最大使用次数</label>
            <input
              type="number"
              min={1}
              value={form.max_uses}
              onChange={(e) => setForm({ ...form, max_uses: e.target.value })}
              className="w-full px-3 py-2 bg-admin-bg border border-admin-border rounded-lg text-sm text-white focus:outline-none focus:border-admin-primary"
              placeholder="留空表示不限"
            />
          </div>
          <div>
            <label className="block text-xs text-admin-muted mb-1">生效时间</label>
            <input
              type="datetime-local"
              value={form.valid_from}
              onChange={(e) => setForm({ ...form, valid_from: e.target.value })}
              className="w-full px-3 py-2 bg-admin-bg border border-admin-border rounded-lg text-sm text-white focus:outline-none focus:border-admin-primary"
            />
          </div>
          <div>
            <label className="block text-xs text-admin-muted mb-1">过期时间</label>
            <input
              type="datetime-local"
              value={form.valid_until}
              onChange={(e) => setForm({ ...form, valid_until: e.target.value })}
              className="w-full px-3 py-2 bg-admin-bg border border-admin-border rounded-lg text-sm text-white focus:outline-none focus:border-admin-primary"
            />
          </div>
          <div className="md:col-span-2 lg:col-span-3">
            <label className="block text-xs text-admin-muted mb-1">描述</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full px-3 py-2 bg-admin-bg border border-admin-border rounded-lg text-sm text-white focus:outline-none focus:border-admin-primary"
              placeholder="例如：新用户首月八折"
            />
          </div>
          <div className="md:col-span-2 lg:col-span-3">
            <button
              type="submit"
              disabled={creating}
              className="px-4 py-2 rounded-lg bg-admin-primary text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
            >
              {creating && <Loader2 className="w-4 h-4 animate-spin" />}
              创建优惠券
            </button>
          </div>
        </form>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-admin-sidebar rounded-xl border border-admin-border overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-admin-border">
          <h3 className="text-lg font-semibold text-white">优惠券列表</h3>
        </div>
        {loading ? (
          <ShimmerTable />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-admin-border bg-admin-bg/50 text-admin-muted">
                  <th className="px-4 py-3 text-left">优惠码</th>
                  <th className="px-4 py-3 text-left">类型</th>
                  <th className="px-4 py-3 text-left">面值</th>
                  <th className="px-4 py-3 text-left">适用范围</th>
                  <th className="px-4 py-3 text-left">最低金额</th>
                  <th className="px-4 py-3 text-left">已用/上限</th>
                  <th className="px-4 py-3 text-left">有效期</th>
                  <th className="px-4 py-3 text-left">状态</th>
                  <th className="px-4 py-3 text-left">操作</th>
                </tr>
              </thead>
              <tbody>
                {coupons.map((c) => (
                  <tr key={c.id} className="border-b border-admin-border hover:bg-admin-hover transition-colors">
                    <td className="px-4 py-3 text-white font-medium">{c.code}</td>
                    <td className="px-4 py-3 text-admin-muted">
                      {c.type === 'fixed' ? '固定金额' : '百分比'}
                    </td>
                    <td className="px-4 py-3 text-white">
                      {c.type === 'fixed' ? formatMoney(c.value) : `${c.value}%`}
                      {c.max_discount ? <span className="text-xs text-admin-muted ml-1">上限 {formatMoney(c.max_discount)}</span> : null}
                    </td>
                    <td className="px-4 py-3 text-admin-muted">
                      {c.applies_to === 'subscription' ? '订阅' : c.applies_to === 'topup' ? '充值' : '全部'}
                    </td>
                    <td className="px-4 py-3 text-admin-muted">{formatMoney(c.min_amount)}</td>
                    <td className="px-4 py-3 text-admin-muted">
                      {c.used_count || 0} / {c.max_uses ?? '∞'}
                    </td>
                    <td className="px-4 py-3 text-admin-muted">
                      <div className="text-xs">{formatDate(c.valid_from)}</div>
                      <div className="text-xs">至 {formatDate(c.valid_until)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                          c.is_active ? 'bg-success/10 text-success' : 'bg-admin-muted/10 text-admin-muted'
                        }`}
                      >
                        {c.is_active ? '启用' : '停用'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleCoupon(c)}
                          className="text-xs px-2 py-1 rounded bg-admin-bg border border-admin-border text-admin-muted hover:text-white transition-colors"
                        >
                          {c.is_active ? '停用' : '启用'}
                        </button>
                        <button
                          onClick={() => viewUsages(c.id)}
                          className="text-xs px-2 py-1 rounded bg-admin-bg border border-admin-border text-admin-muted hover:text-white transition-colors"
                        >
                          使用记录
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && coupons.length === 0 && (
          <div className="p-8 text-center text-admin-muted text-sm">暂无优惠券</div>
        )}
      </motion.div>

      {selectedCoupon && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-admin-sidebar rounded-xl border border-admin-border overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-admin-border flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">
              使用记录：{coupons.find((c) => c.id === selectedCoupon)?.code}
            </h3>
            <button
              onClick={() => { setSelectedCoupon(null); setUsages([]); }}
              className="text-xs text-admin-muted hover:text-white"
            >
              收起
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-admin-border bg-admin-bg/50 text-admin-muted">
                  <th className="px-4 py-3 text-left">用户 ID</th>
                  <th className="px-4 py-3 text-left">支付 ID</th>
                  <th className="px-4 py-3 text-left">使用时间</th>
                </tr>
              </thead>
              <tbody>
                {usages.map((u) => (
                  <tr key={u.id} className="border-b border-admin-border hover:bg-admin-hover transition-colors">
                    <td className="px-4 py-3 text-admin-muted font-mono text-xs">{u.user_id}</td>
                    <td className="px-4 py-3 text-admin-muted font-mono text-xs">{u.payment_id}</td>
                    <td className="px-4 py-3 text-white">{formatDate(u.used_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {usages.length === 0 && (
            <div className="p-6 text-center text-admin-muted text-sm">暂无使用记录</div>
          )}
        </motion.div>
      )}
    </div>
  );
}

function PaymentsPanel() {
  const [payments, setPayments] = useState<AdminPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [refundingId, setRefundingId] = useState<string | null>(null);

  const fetchPayments = async () => {
    setLoading(true);
    setError('');
    try {
      const params: Record<string, string> = {};
      if (statusFilter !== 'all') params.status = statusFilter;
      const res = await adminApi.getPayments(params);
      setPayments(res.data || []);
    } catch (err: any) {
      setError(err.response?.data?.detail || '加载交易记录失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPayments();
  }, [statusFilter]);

  const handleRefund = async (payment: AdminPayment) => {
    if (!window.confirm(`确认退款 ${payment.user_email || payment.user_id} 的 ${formatMoney(payment.amount)}？`)) return;
    setRefundingId(payment.id);
    try {
      await adminApi.refundPayment(payment.id, { reason: '管理员退款' });
      await fetchPayments();
    } catch (err: any) {
      setError(err.response?.data?.detail || '退款失败');
    } finally {
      setRefundingId(null);
    }
  };

  const formatMoney = (cents?: number) =>
    typeof cents === 'number' ? `¥${(cents / 100).toFixed(2)}` : '-';
  const formatDate = (s?: string) => (s ? new Date(s).toLocaleString('zh-CN') : '-');

  return (
    <div className="space-y-6">
      {error && (
        <div className="px-4 py-3 bg-danger/10 border border-danger/20 rounded-lg text-danger text-sm">
          {error}
        </div>
      )}
      <div className="flex items-center gap-2">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-1.5 bg-admin-bg border border-admin-border rounded-lg text-sm text-white focus:outline-none focus:border-admin-primary"
        >
          <option value="all">全部状态</option>
          <option value="success">成功</option>
          <option value="refunded">已退款</option>
          <option value="pending">待支付</option>
          <option value="failed">失败</option>
        </select>
        <button
          onClick={fetchPayments}
          className="px-3 py-1.5 bg-admin-bg border border-admin-border rounded-lg text-sm text-admin-muted hover:text-white transition-colors"
        >
          刷新
        </button>
      </div>
      {loading ? (
        <ShimmerTable />
      ) : (
        <div className="bg-admin-sidebar rounded-xl border border-admin-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-admin-border bg-admin-bg/50 text-admin-muted">
                  <th className="px-4 py-3 text-left">订单号</th>
                  <th className="px-4 py-3 text-left">用户</th>
                  <th className="px-4 py-3 text-left">类型</th>
                  <th className="px-4 py-3 text-left">描述</th>
                  <th className="px-4 py-3 text-left">金额</th>
                  <th className="px-4 py-3 text-left">状态</th>
                  <th className="px-4 py-3 text-left">时间</th>
                  <th className="px-4 py-3 text-left">操作</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-b border-admin-border hover:bg-admin-hover transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-admin-muted">{p.id}</td>
                    <td className="px-4 py-3 text-white">{p.user_email || p.user_id}</td>
                    <td className="px-4 py-3 text-admin-muted">{p.payment_type || '-'}</td>
                    <td className="px-4 py-3 text-admin-muted">{p.description || '-'}</td>
                    <td className="px-4 py-3 text-white">{formatMoney(p.amount)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-1 rounded-full text-xs ${
                        p.status === 'success' ? 'bg-success/10 text-success' :
                        p.status === 'refunded' ? 'bg-warning/10 text-warning' :
                        p.status === 'pending' ? 'bg-admin-primary/10 text-admin-primary' :
                        'bg-danger/10 text-danger'
                      }`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-admin-muted text-xs">{formatDate(p.paid_at || p.created_at)}</td>
                    <td className="px-4 py-3">
                      {p.status === 'success' && (
                        <button
                          onClick={() => handleRefund(p)}
                          disabled={refundingId === p.id}
                          className="text-xs px-2 py-1 rounded bg-admin-bg border border-admin-border text-admin-muted hover:text-white transition-colors disabled:opacity-50"
                        >
                          {refundingId === p.id ? '处理中…' : '退款'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {payments.length === 0 && (
            <div className="p-8 text-center text-admin-muted text-sm">暂无交易记录</div>
          )}
        </div>
      )}
    </div>
  );
}

interface AdminPlan {
  id: string;
  name: string;
  slug: string;
  description?: string;
  price_monthly: number;
  price_yearly: number;
  currency: string;
  billing_cycle: string;
  is_active: boolean;
  sort_order: number;
  features: Record<string, any>;
  limits: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

interface AdminBalanceTransaction {
  id: string;
  amount: number;
  transaction_type: string;
  balance_after: number;
  reference_id?: string;
  description?: string;
  created_at?: string;
}

function PlansPanel() {
  const [plans, setPlans] = useState<AdminPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    slug: '',
    description: '',
    price_monthly_yuan: '',
    price_yearly_yuan: '',
    currency: 'CNY',
    billing_cycle: 'monthly',
    is_active: true,
    sort_order: '0',
    features: '{}',
    limits: '{}',
  });

  const fetchPlans = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await adminApi.getPlans();
      setPlans(res.data || []);
    } catch (err: any) {
      setError(err.response?.data?.detail || '加载套餐失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlans();
  }, []);

  const resetForm = () => {
    setEditingId(null);
    setForm({
      name: '',
      slug: '',
      description: '',
      price_monthly_yuan: '',
      price_yearly_yuan: '',
      currency: 'CNY',
      billing_cycle: 'monthly',
      is_active: true,
      sort_order: '0',
      features: '{}',
      limits: '{}',
    });
  };

  const startEdit = (plan: AdminPlan) => {
    setEditingId(plan.id);
    setForm({
      name: plan.name,
      slug: plan.slug,
      description: plan.description || '',
      price_monthly_yuan: (plan.price_monthly / 100).toFixed(2),
      price_yearly_yuan: (plan.price_yearly / 100).toFixed(2),
      currency: plan.currency,
      billing_cycle: plan.billing_cycle,
      is_active: plan.is_active,
      sort_order: String(plan.sort_order || 0),
      features: JSON.stringify(plan.features || {}, null, 2),
      limits: JSON.stringify(plan.limits || {}, null, 2),
    });
  };

  const parseJson = (s: string) => {
    try {
      return JSON.parse(s || '{}');
    } catch {
      throw new Error('JSON 格式错误');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const payload = {
        name: form.name.trim(),
        slug: form.slug.trim(),
        description: form.description.trim() || null,
        price_monthly: Math.round(parseFloat(form.price_monthly_yuan || '0') * 100),
        price_yearly: Math.round(parseFloat(form.price_yearly_yuan || '0') * 100),
        currency: form.currency,
        billing_cycle: form.billing_cycle,
        is_active: form.is_active,
        sort_order: parseInt(form.sort_order || '0', 10),
        features: parseJson(form.features),
        limits: parseJson(form.limits),
      };
      if (editingId) {
        await adminApi.updatePlan(editingId, payload);
      } else {
        await adminApi.createPlan(payload);
      }
      resetForm();
      await fetchPlans();
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || '保存套餐失败');
    }
  };

  const handleDelete = async (plan: AdminPlan) => {
    if (!window.confirm(`确认删除套餐「${plan.name}」？`)) return;
    try {
      await adminApi.deletePlan(plan.id);
      await fetchPlans();
    } catch (err: any) {
      setError(err.response?.data?.detail || '删除套餐失败');
    }
  };

  const formatMoney = (cents?: number) =>
    typeof cents === 'number' ? `¥${(cents / 100).toFixed(2)}` : '-';

  return (
    <div className="space-y-6">
      {error && (
        <div className="px-4 py-3 bg-danger/10 border border-danger/20 rounded-lg text-danger text-sm">
          {error}
        </div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-admin-sidebar rounded-xl border border-admin-border p-6"
      >
        <h3 className="text-lg font-semibold text-white mb-4">
          {editingId ? '编辑套餐' : '新建套餐'}
        </h3>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-admin-muted mb-1">名称</label>
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2 bg-admin-bg border border-admin-border rounded-lg text-sm text-white focus:outline-none focus:border-admin-primary"
              placeholder="存储会员"
            />
          </div>
          <div>
            <label className="block text-xs text-admin-muted mb-1">Slug</label>
            <input
              type="text"
              required
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
              className="w-full px-3 py-2 bg-admin-bg border border-admin-border rounded-lg text-sm text-white focus:outline-none focus:border-admin-primary"
              placeholder="storage"
            />
          </div>
          <div>
            <label className="block text-xs text-admin-muted mb-1">月价格（元）</label>
            <input
              type="number"
              min={0}
              step={0.01}
              required
              value={form.price_monthly_yuan}
              onChange={(e) => setForm({ ...form, price_monthly_yuan: e.target.value })}
              className="w-full px-3 py-2 bg-admin-bg border border-admin-border rounded-lg text-sm text-white focus:outline-none focus:border-admin-primary"
              placeholder="9.90"
            />
          </div>
          <div>
            <label className="block text-xs text-admin-muted mb-1">年价格（元）</label>
            <input
              type="number"
              min={0}
              step={0.01}
              value={form.price_yearly_yuan}
              onChange={(e) => setForm({ ...form, price_yearly_yuan: e.target.value })}
              className="w-full px-3 py-2 bg-admin-bg border border-admin-border rounded-lg text-sm text-white focus:outline-none focus:border-admin-primary"
              placeholder="99.00"
            />
          </div>
          <div>
            <label className="block text-xs text-admin-muted mb-1">计费周期</label>
            <select
              value={form.billing_cycle}
              onChange={(e) => setForm({ ...form, billing_cycle: e.target.value })}
              className="w-full px-3 py-2 bg-admin-bg border border-admin-border rounded-lg text-sm text-white focus:outline-none focus:border-admin-primary"
            >
              <option value="monthly">月付</option>
              <option value="yearly">年付</option>
              <option value="both">均可</option>
              <option value="none">无</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-admin-muted mb-1">排序</label>
            <input
              type="number"
              value={form.sort_order}
              onChange={(e) => setForm({ ...form, sort_order: e.target.value })}
              className="w-full px-3 py-2 bg-admin-bg border border-admin-border rounded-lg text-sm text-white focus:outline-none focus:border-admin-primary"
            />
          </div>
          <div className="md:col-span-2 lg:col-span-3">
            <label className="block text-xs text-admin-muted mb-1">描述</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full px-3 py-2 bg-admin-bg border border-admin-border rounded-lg text-sm text-white focus:outline-none focus:border-admin-primary"
              placeholder="套餐简介"
            />
          </div>
          <div className="md:col-span-1 lg:col-span-1">
            <label className="block text-xs text-admin-muted mb-1">Features（JSON）</label>
            <textarea
              value={form.features}
              onChange={(e) => setForm({ ...form, features: e.target.value })}
              rows={4}
              className="w-full px-3 py-2 bg-admin-bg border border-admin-border rounded-lg text-sm text-white focus:outline-none focus:border-admin-primary font-mono"
              placeholder='{"storage": true}'
            />
          </div>
          <div className="md:col-span-1 lg:col-span-1">
            <label className="block text-xs text-admin-muted mb-1">Limits（JSON）</label>
            <textarea
              value={form.limits}
              onChange={(e) => setForm({ ...form, limits: e.target.value })}
              rows={4}
              className="w-full px-3 py-2 bg-admin-bg border border-admin-border rounded-lg text-sm text-white focus:outline-none focus:border-admin-primary font-mono"
              placeholder='{"notes": 100}'
            />
          </div>
          <div className="flex items-end gap-3 md:col-span-1 lg:col-span-1">
            <label className="flex items-center gap-2 text-sm text-white cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                className="rounded border-admin-border bg-admin-bg text-admin-primary"
              />
              启用
            </label>
          </div>
          <div className="md:col-span-2 lg:col-span-3 flex items-center gap-2">
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-admin-primary text-white text-sm font-medium hover:opacity-90 flex items-center gap-2"
            >
              {editingId ? '更新套餐' : '创建套餐'}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="px-4 py-2 rounded-lg bg-admin-bg border border-admin-border text-admin-muted text-sm hover:text-white"
              >
                取消
              </button>
            )}
          </div>
        </form>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-admin-sidebar rounded-xl border border-admin-border overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-admin-border">
          <h3 className="text-lg font-semibold text-white">套餐列表</h3>
        </div>
        {loading ? (
          <ShimmerTable />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-admin-border bg-admin-bg/50 text-admin-muted">
                  <th className="px-4 py-3 text-left">名称</th>
                  <th className="px-4 py-3 text-left">Slug</th>
                  <th className="px-4 py-3 text-left">月价格</th>
                  <th className="px-4 py-3 text-left">年价格</th>
                  <th className="px-4 py-3 text-left">周期</th>
                  <th className="px-4 py-3 text-left">排序</th>
                  <th className="px-4 py-3 text-left">状态</th>
                  <th className="px-4 py-3 text-left">操作</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id} className="border-b border-admin-border hover:bg-admin-hover transition-colors">
                    <td className="px-4 py-3 text-white font-medium">{p.name}</td>
                    <td className="px-4 py-3 text-admin-muted font-mono text-xs">{p.slug}</td>
                    <td className="px-4 py-3 text-white">{formatMoney(p.price_monthly)}</td>
                    <td className="px-4 py-3 text-white">{formatMoney(p.price_yearly)}</td>
                    <td className="px-4 py-3 text-admin-muted">{p.billing_cycle}</td>
                    <td className="px-4 py-3 text-admin-muted">{p.sort_order}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-1 rounded-full text-xs ${
                        p.is_active ? 'bg-success/10 text-success' : 'bg-admin-muted/10 text-admin-muted'
                      }`}>
                        {p.is_active ? '启用' : '停用'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => startEdit(p)}
                          className="text-xs px-2 py-1 rounded bg-admin-bg border border-admin-border text-admin-muted hover:text-white transition-colors"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => handleDelete(p)}
                          className="text-xs px-2 py-1 rounded bg-admin-bg border border-admin-border text-danger hover:bg-danger/10 transition-colors"
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && plans.length === 0 && (
          <div className="p-8 text-center text-admin-muted text-sm">暂无套餐</div>
        )}
      </motion.div>
    </div>
  );
}

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

export default function AdminBilling() {
  const [stats, setStats] = useState<SubStats | null>(null);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tierFilter, setTierFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [editingTier, setEditingTier] = useState<string | null>(null);
  const [tierUpdating, setTierUpdating] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'payments' | 'coupons' | 'plans'>('overview');
  const [balanceUserId, setBalanceUserId] = useState<string | null>(null);
  const [balanceAmount, setBalanceAmount] = useState('');
  const [balanceReason, setBalanceReason] = useState('');
  const [balanceUpdating, setBalanceUpdating] = useState(false);
  const [transactionUserId, setTransactionUserId] = useState<string | null>(null);
  const [userTransactions, setUserTransactions] = useState<AdminBalanceTransaction[]>([]);
  const [transactionsLoading, setTransactionsLoading] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const [statsRes, subsRes] = await Promise.all([
        adminApi.getSubscriptionStats(),
        adminApi.getSubscriptions(),
      ]);
      const raw = statsRes.data;
      const planDist = raw.planDistribution || [];
      setStats({
        revenueTrend: raw.revenueTrend || [],
        funnel: (raw.subscriptionFunnel || []).map((item: any) => ({
          stage: item.name,
          count: item.value,
          rate: item.conversionRate,
        })),
        churnRate: (raw.churnRate || 0) / 100,
        churnTrend: 0,
        planDistribution: planDist.map((item: any) => ({
          name: item.plan,
          value: item.count,
          color: COLORS[item.plan.toLowerCase() as keyof typeof COLORS] || '#8b949e',
        })),
        refundRate: (raw.refundRate || 0) / 100,
        refundTrend: 0,
        monthlyRevenue: raw.revenueThisMonth || 0,
        paidUsers: raw.paidUsers || 0,
        arpu: raw.averageRevenuePerUser || 0,
        totalFree: planDist.find((p: any) => p.plan === 'Free')?.count || 0,
        totalStorage: planDist.find((p: any) => p.plan === 'Storage')?.count || 0,
        llmRevenue: raw.llmRevenue || 0,
        llmCost: raw.llmCost || 0,
        llmProfit: raw.llmProfit || 0,
        llmRevenueByModel: raw.llmRevenueByModel || [],
        llmRevenueTrend: raw.llmRevenueTrend || [],
      });
      setSubscriptions(subsRes.data);
    } catch (err: any) {
      setError(err.response?.data?.detail || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleTierChange = async (sub: Subscription, newTier: string) => {
    if (newTier === sub.tier) {
      setEditingTier(null);
      return;
    }
    setTierUpdating(sub.id);
    try {
      await adminApi.updateTier(sub.user_id, newTier);
      setSubscriptions((prev) =>
        prev.map((s) => (s.id === sub.id ? { ...s, tier: newTier } : s))
      );
      setEditingTier(null);
    } catch (err: any) {
      setError(err.response?.data?.detail || '调整套餐失败');
    } finally {
      setTierUpdating(null);
    }
  };

  const handleBalanceAdjust = async (userId: string) => {
    const amount = parseFloat(balanceAmount);
    if (Number.isNaN(amount) || balanceReason.trim() === '') {
      setError('请输入有效的金额和原因');
      return;
    }
    setBalanceUpdating(true);
    try {
      await adminApi.adjustUserBalance(userId, { amount_yuan: amount, reason: balanceReason.trim() });
      setBalanceUserId(null);
      setBalanceAmount('');
      setBalanceReason('');
    } catch (err: any) {
      setError(err.response?.data?.detail || '调整余额失败');
    } finally {
      setBalanceUpdating(false);
    }
  };

  const loadUserTransactions = async (userId: string) => {
    setTransactionUserId(userId);
    setTransactionsLoading(true);
    try {
      const res = await adminApi.getUserBalanceTransactions(userId);
      setUserTransactions(res.data || []);
    } catch (err: any) {
      setError(err.response?.data?.detail || '加载余额明细失败');
      setUserTransactions([]);
    } finally {
      setTransactionsLoading(false);
    }
  };

  const filteredSubs = useMemo(() => {
    return subscriptions.filter((sub) => {
      const matchTier = tierFilter === 'all' || sub.tier === tierFilter;
      const matchStatus = statusFilter === 'all' || sub.status === statusFilter;
      return matchTier && matchStatus;
    });
  }, [subscriptions, tierFilter, statusFilter]);

  const statCards = useMemo(() => {
    if (!stats) return [];
    return [
      {
        label: '本月收入',
        value: `¥${stats.monthlyRevenue?.toLocaleString() || 0}`,
        icon: CreditCard,
        color: 'text-admin-primary',
        trend: stats.revenueTrend && stats.revenueTrend.length >= 2
          ? ((stats.revenueTrend[stats.revenueTrend.length - 1].revenue - stats.revenueTrend[stats.revenueTrend.length - 2].revenue) /
             (stats.revenueTrend[stats.revenueTrend.length - 2].revenue || 1) * 100)
          : 0,
      },
      {
        label: '付费用户',
        value: stats.paidUsers?.toLocaleString() || '0',
        icon: Users,
        color: 'text-success',
        trend: 0,
      },
      {
        label: '平均客单价',
        value: `¥${stats.arpu?.toLocaleString() || 0}`,
        icon: Crown,
        color: 'text-personal-primary',
        trend: 0,
      },
      {
        label: '流失率',
        value: `${(stats.churnRate * 100).toFixed(1)}%`,
        icon: TrendingDown,
        color: 'text-danger',
        trend: stats.churnTrend,
        isBad: true,
      },
      {
        label: '退款率',
        value: `${(stats.refundRate * 100).toFixed(1)}%`,
        icon: RefreshCw,
        color: 'text-warning',
        trend: stats.refundTrend,
        isBad: true,
      },
    ];
  }, [stats]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white mb-2">订阅计费</h1>
          <p className="text-admin-muted">管理用户订阅与计费</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {[...Array(5)].map((_, i) => <ShimmerCard key={i} />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ShimmerCard />
          <ShimmerCard />
        </div>
        <ShimmerTable />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white mb-2">订阅计费</h1>
          <p className="text-admin-muted">管理用户订阅与计费</p>
        </div>
        <button
          onClick={fetchData}
          className="flex items-center gap-2 px-3 py-2 bg-admin-sidebar border border-admin-border rounded-lg text-sm text-admin-muted hover:text-white hover:bg-admin-hover transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          刷新
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 bg-danger/10 border border-danger/20 rounded-lg text-danger text-sm">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-admin-border">
        {[
          { key: 'overview', label: '概览' },
          { key: 'plans', label: '套餐管理' },
          { key: 'payments', label: '交易记录' },
          { key: 'coupons', label: '优惠券' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as 'overview' | 'payments' | 'coupons' | 'plans')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-admin-primary text-admin-primary'
                : 'border-transparent text-admin-muted hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <>
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
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-admin-muted">{card.label}</span>
              <card.icon className={`w-5 h-5 ${card.color}`} />
            </div>
            <div className="text-2xl font-bold text-white">{card.value}</div>
            {card.trend !== 0 && (
              <div className={`flex items-center gap-1 mt-1 text-xs ${
                (card.isBad ? card.trend > 0 : card.trend > 0) ? 'text-danger' : 'text-success'
              }`}>
                {card.trend > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                <span>{Math.abs(card.trend).toFixed(1)}%</span>
              </div>
            )}
          </motion.div>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Revenue Trend */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-admin-sidebar rounded-xl border border-admin-border p-6"
        >
          <h3 className="text-lg font-semibold text-white mb-4">收入趋势（最近12个月）</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={stats?.revenueTrend || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
                <XAxis dataKey="month" stroke="#8b949e" tick={{ fontSize: 12 }} />
                <YAxis stroke="#8b949e" tick={{ fontSize: 12 }} tickFormatter={(v) => `¥${v}`} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: 8, color: '#c9d1d9' }}
                  formatter={(value: number) => [`¥${value.toLocaleString()}`, '收入']}
                />
                <Line type="monotone" dataKey="revenue" stroke="#58a6ff" strokeWidth={2} dot={{ fill: '#58a6ff', r: 4 }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* Plan Distribution */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="bg-admin-sidebar rounded-xl border border-admin-border p-6"
        >
          <h3 className="text-lg font-semibold text-white mb-4">套餐分布</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={stats?.planDistribution || []}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={4}
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
                  {(stats?.planDistribution || []).map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: 8, color: '#c9d1d9' }}
                />
                <Legend wrapperStyle={{ color: '#8b949e' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      </div>

      {/* Conversion Funnel */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="bg-admin-sidebar rounded-xl border border-admin-border p-6"
      >
        <h3 className="text-lg font-semibold text-white mb-4">订阅转化漏斗</h3>
        <div className="flex flex-col md:flex-row items-stretch gap-2 md:gap-0">
          {(stats?.funnel || []).map((stage, index) => (
            <div key={stage.stage} className="flex-1 flex items-center gap-2">
              <div className="flex-1">
                <div className="bg-admin-bg rounded-lg p-4 text-center border border-admin-border">
                  <div className="text-2xl font-bold text-white">{stage.count.toLocaleString()}</div>
                  <div className="text-xs text-admin-muted mt-1">{stage.stage}</div>
                  {index > 0 && (
                    <div className="text-xs text-admin-primary mt-1">转化率 {stage.rate.toFixed(1)}%</div>
                  )}
                </div>
              </div>
              {index < (stats?.funnel || []).length - 1 && (
                <div className="hidden md:flex items-center text-admin-muted">
                  <ArrowRight className="w-5 h-5" />
                </div>
              )}
            </div>
          ))}
        </div>
      </motion.div>

      {/* LLM Revenue / Cost / Profit */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'LLM 收入', value: `¥${(stats?.llmRevenue || 0).toFixed(2)}`, color: 'text-admin-primary' },
          { label: 'LLM 成本', value: `¥${(stats?.llmCost || 0).toFixed(2)}`, color: 'text-danger' },
          { label: 'LLM 毛利', value: `¥${(stats?.llmProfit || 0).toFixed(2)}`, color: 'text-success' },
        ].map((card, index) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 + index * 0.05 }}
            className="bg-admin-sidebar rounded-xl border border-admin-border p-6"
          >
            <div className="text-sm text-admin-muted mb-2">{card.label}</div>
            <div className={`text-2xl font-bold ${card.color}`}>{card.value}</div>
          </motion.div>
        ))}
      </div>

      {/* LLM Revenue by Model */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="bg-admin-sidebar rounded-xl border border-admin-border overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-admin-border">
          <h3 className="text-lg font-semibold text-white">按模型收入/成本</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-admin-border bg-admin-bg/50 text-admin-muted">
                <th className="px-4 py-3 text-left">模型</th>
                <th className="px-4 py-3 text-right">调用次数</th>
                <th className="px-4 py-3 text-right">收入</th>
                <th className="px-4 py-3 text-right">成本</th>
                <th className="px-4 py-3 text-right">毛利</th>
              </tr>
            </thead>
            <tbody>
              {(stats?.llmRevenueByModel || []).map((m) => (
                <tr key={m.model_id} className="border-b border-admin-border hover:bg-admin-hover transition-colors">
                  <td className="px-4 py-3 text-white font-medium">{m.model_id}</td>
                  <td className="px-4 py-3 text-right text-admin-muted">{m.calls}</td>
                  <td className="px-4 py-3 text-right text-admin-primary">¥{m.revenue.toFixed(4)}</td>
                  <td className="px-4 py-3 text-right text-danger">¥{m.cost.toFixed(4)}</td>
                  <td className={`px-4 py-3 text-right font-medium ${m.profit >= 0 ? 'text-success' : 'text-warning'}`}>
                    ¥{m.profit.toFixed(4)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(stats?.llmRevenueByModel || []).length === 0 && (
          <div className="p-8 text-center text-admin-muted text-sm">暂无 LLM 用量数据</div>
        )}
      </motion.div>

      {/* Subscription Bar Chart */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
        className="bg-admin-sidebar rounded-xl border border-admin-border p-6"
      >
        <h3 className="text-lg font-semibold text-white mb-4">各套餐订阅数量</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={[
                { name: 'Free', count: stats?.totalFree || 0, fill: COLORS.free },
                { name: 'Storage', count: stats?.totalStorage || 0, fill: COLORS.storage },
              ]}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
              <XAxis dataKey="name" stroke="#8b949e" tick={{ fontSize: 12 }} />
              <YAxis stroke="#8b949e" tick={{ fontSize: 12 }} />
              <Tooltip
                contentStyle={{ backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: 8, color: '#c9d1d9' }}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </motion.div>

      {/* Subscription List */}
      <div className="bg-admin-sidebar rounded-xl border border-admin-border overflow-hidden">
        <div className="px-4 py-3 border-b border-admin-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-white">订阅列表</h2>
          <div className="flex items-center gap-2">
            <select
              value={tierFilter}
              onChange={(e) => setTierFilter(e.target.value)}
              className="px-3 py-1.5 bg-admin-bg border border-admin-border rounded-lg text-sm text-white focus:outline-none focus:border-admin-primary"
            >
              <option value="all">全部套餐</option>
              <option value="free">Free</option>
              <option value="storage">Storage</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-1.5 bg-admin-bg border border-admin-border rounded-lg text-sm text-white focus:outline-none focus:border-admin-primary"
            >
              <option value="all">全部状态</option>
              <option value="active">活跃</option>
              <option value="cancelled">已取消</option>
              <option value="expired">已过期</option>
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-admin-border bg-admin-bg/50">
                <th className="px-4 py-3 text-left text-sm font-medium text-admin-muted">用户</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-admin-muted">套餐</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-admin-muted">状态</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-admin-muted">开始时间</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-admin-muted">到期时间</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-admin-muted">操作</th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence>
                {filteredSubs.map((sub, index) => (
                  <motion.tr
                    key={sub.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ delay: index * 0.02 }}
                    className="border-b border-admin-border hover:bg-admin-hover transition-colors"
                  >
                    <td className="px-4 py-3 text-sm text-white">{sub.user_email}</td>
                    <td className="px-4 py-3">
                      {editingTier === sub.id ? (
                        <select
                          value={sub.tier}
                          disabled={tierUpdating === sub.id}
                          onChange={(e) => handleTierChange(sub, e.target.value)}
                          onBlur={() => setEditingTier(null)}
                          autoFocus
                          className="px-2 py-1 bg-admin-bg border border-admin-border rounded text-xs text-white focus:outline-none focus:border-admin-primary"
                        >
                          <option value="free">Free</option>
                          <option value="storage">Storage</option>
                        </select>
                      ) : (
                        <button
                          onClick={() => setEditingTier(sub.id)}
                          className={`inline-flex px-2 py-1 rounded-full text-xs font-medium cursor-pointer hover:opacity-80 ${
                            sub.tier === 'storage' ? 'bg-personal-primary/10 text-personal-primary' :
                            'bg-admin-muted/10 text-admin-muted'
                          }`}
                          title="点击调整套餐"
                        >
                          {sub.tier}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                        sub.status === 'active' ? 'bg-success/10 text-success' :
                        sub.status === 'cancelled' ? 'bg-danger/10 text-danger' :
                        'bg-warning/10 text-warning'
                      }`}>
                        {sub.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-admin-muted">
                      {new Date(sub.started_at).toLocaleDateString('zh-CN')}
                    </td>
                    <td className="px-4 py-3 text-sm text-admin-muted">
                      {sub.expires_at ? new Date(sub.expires_at).toLocaleDateString('zh-CN') : '永久'}
                    </td>
                    <td className="px-4 py-3">
                      {balanceUserId === sub.user_id ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            step="0.01"
                            value={balanceAmount}
                            onChange={(e) => setBalanceAmount(e.target.value)}
                            placeholder="金额"
                            disabled={balanceUpdating}
                            className="w-20 px-2 py-1 bg-admin-bg border border-admin-border rounded text-xs text-white focus:outline-none focus:border-admin-primary"
                          />
                          <input
                            type="text"
                            value={balanceReason}
                            onChange={(e) => setBalanceReason(e.target.value)}
                            placeholder="原因"
                            disabled={balanceUpdating}
                            className="w-28 px-2 py-1 bg-admin-bg border border-admin-border rounded text-xs text-white focus:outline-none focus:border-admin-primary"
                          />
                          <button
                            onClick={() => handleBalanceAdjust(sub.user_id)}
                            disabled={balanceUpdating}
                            className="text-xs px-2 py-1 rounded bg-admin-primary text-white hover:opacity-90 disabled:opacity-50"
                          >
                            {balanceUpdating ? '…' : '保存'}
                          </button>
                          <button
                            onClick={() => { setBalanceUserId(null); setBalanceAmount(''); setBalanceReason(''); }}
                            disabled={balanceUpdating}
                            className="text-xs px-2 py-1 rounded bg-admin-bg border border-admin-border text-admin-muted hover:text-white"
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setBalanceUserId(sub.user_id)}
                            className="text-xs px-2 py-1 rounded bg-admin-bg border border-admin-border text-admin-muted hover:text-white transition-colors"
                          >
                            调整余额
                          </button>
                          <button
                            onClick={() => loadUserTransactions(sub.user_id)}
                            className={`text-xs px-2 py-1 rounded bg-admin-bg border border-admin-border transition-colors ${
                              transactionUserId === sub.user_id ? 'text-admin-primary border-admin-primary' : 'text-admin-muted hover:text-white'
                            }`}
                          >
                            余额明细
                          </button>
                        </div>
                      )}
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
        {filteredSubs.length === 0 && (
          <div className="p-8 text-center text-admin-muted">
            <CreditCard className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>暂无付费订阅</p>
          </div>
        )}
      </div>

      {transactionUserId && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-admin-sidebar rounded-xl border border-admin-border overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-admin-border flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">
              余额明细：{subscriptions.find((s) => s.user_id === transactionUserId)?.user_email || transactionUserId}
            </h3>
            <button
              onClick={() => { setTransactionUserId(null); setUserTransactions([]); }}
              className="text-xs text-admin-muted hover:text-white"
            >
              收起
            </button>
          </div>
          {transactionsLoading ? (
            <ShimmerTable />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-admin-border bg-admin-bg/50 text-admin-muted">
                    <th className="px-4 py-3 text-left">时间</th>
                    <th className="px-4 py-3 text-left">类型</th>
                    <th className="px-4 py-3 text-right">金额</th>
                    <th className="px-4 py-3 text-right">余额后</th>
                    <th className="px-4 py-3 text-left">描述</th>
                  </tr>
                </thead>
                <tbody>
                  {userTransactions.map((t) => (
                    <tr key={t.id} className="border-b border-admin-border hover:bg-admin-hover transition-colors">
                      <td className="px-4 py-3 text-admin-muted text-xs">{t.created_at ? new Date(t.created_at).toLocaleString('zh-CN') : '-'}</td>
                      <td className="px-4 py-3 text-white">{t.transaction_type}</td>
                      <td className={`px-4 py-3 text-right font-medium ${t.amount >= 0 ? 'text-success' : 'text-warning'}`}>
                        {t.amount >= 0 ? '+' : ''}¥{t.amount.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right text-white">¥{t.balance_after.toFixed(2)}</td>
                      <td className="px-4 py-3 text-admin-muted">{t.description || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!transactionsLoading && userTransactions.length === 0 && (
            <div className="p-6 text-center text-admin-muted text-sm">暂无余额明细</div>
          )}
        </motion.div>
      )}
      </>)}

      {activeTab === 'payments' && <PaymentsPanel />}

      {activeTab === 'coupons' && <CouponsPanel />}

      {activeTab === 'plans' && <PlansPanel />}
    </div>
  );
}
