import { FC, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft, Wallet, Receipt, Activity, TrendingDown, Plus,
  Loader2, AlertCircle
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import apiClient from '@/api/client';
import { useLLMBalance } from '@/hooks/useLLMBalance';

interface BalanceSummary {
  balance: number;
  frozen: number;
  total_deposited: number;
  total_used: number;
}

interface UsageRecord {
  id: string;
  model_id: string;
  task_type: string;
  input_tokens: number;
  output_tokens: number;
  cost: number;
  status: string;
  created_at: string;
}

interface PaymentRecord {
  id: string;
  amount: number;
  currency: string;
  status: string;
  payment_type?: string;
  description?: string;
  paid_at?: string;
  created_at?: string;
}

interface BalanceTransaction {
  id: string;
  amount: number;
  transaction_type: string;
  balance_after: number;
  reference_id?: string;
  description?: string;
  created_at: string;
}

const formatMoney = (yuan?: number) =>
  typeof yuan === 'number' ? `¥${yuan.toFixed(2)}` : '¥0.00';

const formatDate = (s?: string) =>
  s ? new Date(s).toLocaleString('zh-CN') : '-';

const BillingPage: FC = () => {
  const navigate = useNavigate();
  const { balance } = useLLMBalance();
  const [usage, setUsage] = useState<UsageRecord[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [transactions, setTransactions] = useState<BalanceTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'usage' | 'payments' | 'transactions'>('usage');

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      setError(null);
      try {
        const [usageRes, paymentsRes, transactionsRes] = await Promise.all([
          apiClient.get('/api/v1/billing/usage?limit=100'),
          apiClient.get('/api/v1/billing/payments'),
          apiClient.get('/api/v1/billing/balance/transactions?limit=100'),
        ]);
        setUsage(usageRes.data || []);
        setPayments(paymentsRes.data || []);
        setTransactions(transactionsRes.data || []);
      } catch (err: any) {
        setError(err?.response?.data?.detail || '加载账单数据失败');
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, []);

  const topupPayments = useMemo(
    () => payments.filter((p) => p.payment_type === 'topup' || p.description?.includes('充值')),
    [payments]
  );

  const usageChartData = useMemo(() => {
    const map = new Map<string, number>();
    usage.forEach((u) => {
      const date = u.created_at ? new Date(u.created_at).toLocaleDateString('zh-CN') : '未知';
      map.set(date, (map.get(date) || 0) + (u.cost || 0));
    });
    return Array.from(map.entries())
      .map(([date, cost]) => ({ date, cost: Number(cost.toFixed(4)) }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .slice(-30);
  }, [usage]);

  const statCards = [
    { label: '当前余额', value: formatMoney(balance?.balance), icon: Wallet, color: 'text-emerald-400' },
    { label: '累计充值', value: formatMoney(balance?.total_deposited), icon: Receipt, color: 'text-info' },
    { label: '累计消耗', value: formatMoney(balance?.total_used), icon: TrendingDown, color: 'text-amber-400' },
    { label: '调用次数', value: `${usage.length}`, icon: Activity, color: 'text-violet-400' },
  ];

  return (
    <div className="max-w-5xl mx-auto pb-12 px-4">
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/settings/account')}
          className="p-2 rounded-xl hover:bg-white/[0.05] text-text-secondary transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-text-primary">用量与账单</h1>
          <p className="text-sm text-text-muted">余额、调用消耗与充值记录</p>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-danger/10 border border-danger/20 text-danger text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-text-muted gap-2">
          <Loader2 className="w-5 h-5 animate-spin" />
          加载中…
        </div>
      ) : (
        <div className="space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {statCards.map((card, idx) => (
              <motion.div
                key={card.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
                className="glass-card p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-text-muted">{card.label}</span>
                  <card.icon className={`w-4 h-4 ${card.color}`} />
                </div>
                <div className="text-xl font-bold text-text-primary">{card.value}</div>
              </motion.div>
            ))}
          </div>

          {/* Actions */}
          <div className="flex justify-end">
            <button
              onClick={() => navigate('/topup')}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 transition-colors text-sm"
            >
              <Plus className="w-4 h-4" />
              充值余额
            </button>
          </div>

          {/* Usage Chart */}
          {usageChartData.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-card p-6"
            >
              <h3 className="text-sm font-semibold text-text-secondary mb-4">近 30 日消耗趋势</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={usageChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                    <XAxis dataKey="date" stroke="#8b949e" tick={{ fontSize: 11 }} />
                    <YAxis stroke="#8b949e" tick={{ fontSize: 11 }} tickFormatter={(v) => `¥${v}`} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: 8, color: '#c9d1d9' }}
                      formatter={(value: number) => [`¥${value.toFixed(4)}`, '消耗']}
                    />
                    <Line type="monotone" dataKey="cost" stroke="#58a6ff" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </motion.div>
          )}

          {/* Records Tabs */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card p-6"
          >
            <div className="flex items-center gap-4 mb-4 border-b border-white/[0.06]">
              {[
                { key: 'usage', label: `调用记录 (${usage.length})` },
                { key: 'payments', label: `充值记录 (${topupPayments.length})` },
                { key: 'transactions', label: `余额明细 (${transactions.length})` },
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key as typeof activeTab)}
                  className={`pb-2 text-sm font-medium transition-colors relative ${
                    activeTab === tab.key
                      ? 'text-emerald-400'
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {tab.label}
                  {activeTab === tab.key && (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-400 rounded-full" />
                  )}
                </button>
              ))}
            </div>

            {activeTab === 'usage' && (
              <div>
                {usage.length === 0 ? (
                  <p className="text-sm text-text-muted">暂无调用记录</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-white/[0.06] text-text-muted">
                          <th className="text-left py-2 font-medium">时间</th>
                          <th className="text-left py-2 font-medium">模型</th>
                          <th className="text-left py-2 font-medium">任务</th>
                          <th className="text-right py-2 font-medium">Tokens</th>
                          <th className="text-right py-2 font-medium">消耗</th>
                          <th className="text-left py-2 font-medium">状态</th>
                        </tr>
                      </thead>
                      <tbody>
                        {usage.map((u) => (
                          <tr key={u.id} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                            <td className="py-3 text-text-muted text-xs">{formatDate(u.created_at)}</td>
                            <td className="py-3 text-text-secondary">{u.model_id}</td>
                            <td className="py-3 text-text-secondary">{u.task_type}</td>
                            <td className="py-3 text-right text-text-secondary">
                              {u.input_tokens + u.output_tokens}
                            </td>
                            <td className="py-3 text-right text-amber-400">{formatMoney(u.cost)}</td>
                            <td className="py-3">
                              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs ${
                                u.status === 'success' ? 'bg-emerald-500/10 text-emerald-400' :
                                u.status === 'failed' ? 'bg-red-500/10 text-red-400' :
                                'bg-blue-500/10 text-blue-400'
                              }`}>
                                {u.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'payments' && (
              <div>
                {topupPayments.length === 0 ? (
                  <p className="text-sm text-text-muted">暂无充值记录</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-white/[0.06] text-text-muted">
                          <th className="text-left py-2 font-medium">订单号</th>
                          <th className="text-left py-2 font-medium">描述</th>
                          <th className="text-right py-2 font-medium">金额</th>
                          <th className="text-left py-2 font-medium">状态</th>
                          <th className="text-left py-2 font-medium">时间</th>
                        </tr>
                      </thead>
                      <tbody>
                        {topupPayments.map((p) => (
                          <tr key={p.id} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                            <td className="py-3 font-mono text-xs text-text-secondary">{p.id}</td>
                            <td className="py-3 text-text-secondary">{p.description || '-'}</td>
                            <td className="py-3 text-right text-text-primary">{formatMoney(p.amount / 100)}</td>
                            <td className="py-3">
                              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs ${
                                p.status === 'success' ? 'bg-emerald-500/10 text-emerald-400' :
                                p.status === 'refunded' ? 'bg-amber-500/10 text-amber-400' :
                                'bg-blue-500/10 text-blue-400'
                              }`}>
                                {p.status}
                              </span>
                            </td>
                            <td className="py-3 text-text-muted text-xs">{formatDate(p.paid_at || p.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'transactions' && (
              <div>
                {transactions.length === 0 ? (
                  <p className="text-sm text-text-muted">暂无余额明细</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-white/[0.06] text-text-muted">
                          <th className="text-left py-2 font-medium">时间</th>
                          <th className="text-left py-2 font-medium">类型</th>
                          <th className="text-right py-2 font-medium">金额</th>
                          <th className="text-right py-2 font-medium">余额后</th>
                          <th className="text-left py-2 font-medium">描述</th>
                        </tr>
                      </thead>
                      <tbody>
                        {transactions.map((t) => (
                          <tr key={t.id} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                            <td className="py-3 text-text-muted text-xs">{formatDate(t.created_at)}</td>
                            <td className="py-3 text-text-secondary">{t.transaction_type}</td>
                            <td className={`py-3 text-right font-medium ${
                              t.amount >= 0 ? 'text-emerald-400' : 'text-amber-400'
                            }`}>
                              {t.amount >= 0 ? '+' : ''}{formatMoney(t.amount)}
                            </td>
                            <td className="py-3 text-right text-text-primary">{formatMoney(t.balance_after)}</td>
                            <td className="py-3 text-text-secondary">{t.description || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default BillingPage;
