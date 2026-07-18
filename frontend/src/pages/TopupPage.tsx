import { FC, useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft, CreditCard, QrCode, Smartphone, Wallet, Loader2, CheckCircle, Tag,
} from 'lucide-react';
import apiClient from '@/api/client';
import { useLLMBalance } from '@/hooks/useLLMBalance';
import { useQueryClient } from '@tanstack/react-query';

interface PaymentOrder {
  order_id: string;
  amount: number;
  currency: string;
  description: string;
  provider: string;
  status: string;
  pay_url?: string;
  pay_qr_code?: string;
  pay_params?: Record<string, any>;
}

const PROVIDERS = [
  { id: 'alipay', name: '支付宝', icon: QrCode, color: 'text-network-primary' },
  { id: 'wechat', name: '微信支付', icon: Smartphone, color: 'text-success' },
  { id: 'stripe', name: '信用卡', icon: CreditCard, color: 'text-fusion-primary' },
  { id: 'xorpay', name: '虎皮椒', icon: Wallet, color: 'text-warning' },
  { id: 'xunhupay', name: '迅虎支付', icon: QrCode, color: 'text-personal-primary' },
];

const PRESETS = [1000, 3000, 5000, 10000]; // cents

const TopupPage: FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { balance, refresh: refreshBalance } = useLLMBalance();
  const [amount, setAmount] = useState<number>(1000);
  const [custom, setCustom] = useState<string>('');
  const [provider, setProvider] = useState<string>('alipay');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<PaymentOrder | null>(null);
  const [success, setSuccess] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const [couponSummary, setCouponSummary] = useState<{ final_amount: number; discount_amount: number } | null>(null);
  const [validatingCoupon, setValidatingCoupon] = useState(false);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const displayedBalance = balance?.balance ?? 0;

  useEffect(() => {
    return () => {
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setCouponCode('');
    setCouponSummary(null);
  }, [amount, custom]);

  useEffect(() => {
    if (!order) return;
    let attempts = 0;
    const maxAttempts = 60;
    const poll = async () => {
      attempts++;
      try {
        const { data } = await apiClient.get(`/api/v1/billing/payments/${order.order_id}`);
        if (data.status === 'success' || data.status === 'paid') {
          setSuccess(true);
          setOrder(null);
          queryClient.invalidateQueries({ queryKey: ['llmBalance'] });
          refreshBalance();
          return;
        }
        if (attempts >= maxAttempts) return;
        pollTimeoutRef.current = setTimeout(poll, 5000);
      } catch {
        if (attempts < maxAttempts) pollTimeoutRef.current = setTimeout(poll, 5000);
      }
    };
    poll();
    return () => {
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
        pollTimeoutRef.current = null;
      }
    };
  }, [order, queryClient, refreshBalance]);

  const validateCoupon = async () => {
    if (!couponCode.trim()) return;
    const originalAmount = custom ? parseInt(custom, 10) * 100 : amount;
    if (!originalAmount || originalAmount < 1000) {
      setError('充值金额不能少于 10 元');
      return;
    }
    setValidatingCoupon(true);
    setError(null);
    try {
      const { data } = await apiClient.post('/api/v1/billing/validate-coupon', {
        code: couponCode.trim(),
        payment_type: 'topup',
        original_amount: originalAmount,
      });
      setCouponSummary(data);
    } catch (err: any) {
      setCouponSummary(null);
      setError(err?.response?.data?.detail || '优惠码无效');
    } finally {
      setValidatingCoupon(false);
    }
  };

  const handleCreateOrder = async () => {
    const finalAmount = custom ? parseInt(custom, 10) * 100 : amount;
    if (!finalAmount || finalAmount < 1000) {
      setError('充值金额不能少于 10 元');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const payParams: Record<string, any> = {};
      if (provider === 'alipay' || provider === 'wechat' || provider === 'xorpay' || provider === 'xunhupay') {
        payParams.qr_code = true;
      }
      const payload: Record<string, any> = {
        amount: finalAmount,
        payment_method: provider,
        pay_params: payParams,
      };
      if (couponCode.trim()) {
        payload.coupon_code = couponCode.trim();
      }
      const { data } = await apiClient.post('/api/v1/billing/topup', payload);
      setOrder(data);
    } catch (err: any) {
      setError(err?.response?.data?.detail || '创建充值订单失败');
    } finally {
      setLoading(false);
    }
  };

  const baseAmountYuan = custom ? parseInt(custom || '0', 10) : amount / 100;
  const displayAmount = couponSummary ? couponSummary.final_amount / 100 : baseAmountYuan;

  return (
    <div className="max-w-2xl mx-auto pb-12 px-4">
      <div className="flex items-center gap-3 mb-8">
        <button
          onClick={() => navigate('/settings/account')}
          className="p-2 rounded-[2px] hover:bg-white/[0.05] text-text-secondary transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-text-primary">充值 LLM 余额</h1>
          <p className="text-sm text-text-muted">按实际调用量扣费，余额永不过期</p>
        </div>
      </div>

      <div className="mb-6 p-4 rounded-[2px] bg-white/[0.02] border border-white/[0.06] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wallet className="w-4 h-4 text-success" />
          <span className="text-sm text-text-secondary">当前余额</span>
        </div>
        <span className="text-lg font-bold text-success">¥{displayedBalance.toFixed(2)}</span>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-[2px] bg-danger/10 border border-danger/20 text-danger text-sm">
          {error}
        </div>
      )}

      {success ? (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-8 rounded-[2px] bg-white/[0.02] border border-white/[0.06] text-center"
        >
          <CheckCircle className="w-12 h-12 text-success mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">充值成功</h2>
          <p className="text-text-secondary mb-6">余额已到账，可立即使用</p>
          <button
            onClick={() => navigate('/settings/account')}
            className="px-6 py-2 rounded-[2px] bg-success/20 text-success hover:bg-success/30 transition-colors"
          >
            返回设置
          </button>
        </motion.div>
      ) : order ? (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-6 rounded-[2px] bg-white/[0.02] border border-white/[0.06] text-center"
        >
          <h2 className="text-lg font-bold text-white mb-2">等待支付</h2>
          <p className="text-text-secondary mb-4">订单金额 ¥{(order.amount / 100).toFixed(2)}</p>
          {order.pay_qr_code ? (
            <img
              src={order.pay_qr_code}
              alt="支付二维码"
              className="w-48 h-48 mx-auto rounded-[2px] border border-white/[0.06]"
            />
          ) : order.pay_url ? (
            <a
              href={order.pay_url}
              target="_blank"
              rel="noreferrer"
              className="inline-block px-6 py-2 rounded-[2px] bg-accent text-white hover:bg-[var(--accent-hover)] transition-colors"
            >
              前往支付
            </a>
          ) : (
            <div className="flex items-center justify-center gap-2 text-text-muted">
              <Loader2 className="w-4 h-4 animate-spin" />
              正在获取支付参数…
            </div>
          )}
          <p className="text-xs text-text-muted mt-4">支付完成后页面会自动刷新</p>
        </motion.div>
      ) : (
        <div className="space-y-6">
          <div>
            <label className="block text-sm text-text-secondary mb-3">选择金额（元）</label>
            <div className="grid grid-cols-4 gap-3">
              {PRESETS.map((preset) => (
                <button
                  key={preset}
                  onClick={() => { setAmount(preset); setCustom(''); }}
                  className={`py-3 rounded-[2px] border text-sm font-medium transition-all ${
                    !custom && amount === preset
                      ? 'border-success/50 bg-success/10 text-success'
                      : 'border-white/[0.06] bg-white/[0.02] text-text-secondary hover:bg-white/[0.05]'
                  }`}
                >
                  ¥{preset / 100}
                </button>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-3">
              <span className="text-sm text-text-secondary">自定义</span>
              <input
                type="number"
                min={10}
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="输入金额"
                className="flex-1 px-3 py-2 rounded-[2px] bg-white/[0.02] border border-white/[0.06] text-white text-sm focus:outline-none focus:border-success/50"
              />
              <span className="text-sm text-text-muted">元</span>
            </div>
          </div>

          {/* Coupon Code */}
          <div>
            <label className="block text-sm text-text-secondary mb-3">优惠码（可选）</label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                <input
                  type="text"
                  value={couponCode}
                  onChange={(e) => {
                    setCouponCode(e.target.value);
                    setCouponSummary(null);
                  }}
                  placeholder="输入优惠码"
                  className="w-full pl-9 pr-3 py-2.5 rounded-[2px] bg-white/[0.02] border border-white/[0.06] text-white text-sm focus:outline-none focus:border-success/50 uppercase placeholder:normal-case"
                />
              </div>
              <button
                onClick={validateCoupon}
                disabled={!couponCode.trim() || validatingCoupon}
                className="px-4 py-2.5 rounded-[2px] bg-white/[0.06] border border-white/[0.1] text-sm text-text-secondary hover:bg-white/[0.1] hover:text-text-primary transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {validatingCoupon && <Loader2 className="w-4 h-4 animate-spin" />}
                校验
              </button>
            </div>
            {couponSummary && (
              <div className="mt-2 flex items-center gap-2 text-sm">
                <span className="text-text-muted">已优惠</span>
                <span className="text-success font-bold">¥{(couponSummary.discount_amount / 100).toFixed(2)}</span>
                <span className="text-text-muted">，实付</span>
                <span className="text-success font-bold">¥{(couponSummary.final_amount / 100).toFixed(2)}</span>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm text-text-secondary mb-3">支付方式</label>
            <div className="grid grid-cols-3 gap-3">
              {PROVIDERS.map((p) => {
                const Icon = p.icon;
                return (
                  <button
                    key={p.id}
                    onClick={() => setProvider(p.id)}
                    className={`flex flex-col items-center gap-2 py-4 rounded-[2px] border transition-all ${
                      provider === p.id
                        ? 'border-success/50 bg-success/10'
                        : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05]'
                    }`}
                  >
                    <Icon className={`w-6 h-6 ${p.color}`} />
                    <span className="text-sm text-text-secondary">{p.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="pt-4">
            <button
              onClick={handleCreateOrder}
              disabled={loading}
              className="w-full py-3 rounded-[2px] bg-accent text-white font-medium hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              立即充值 ¥{displayAmount || 0}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default TopupPage;
