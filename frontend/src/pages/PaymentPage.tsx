import { FC, useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  CreditCard, QrCode, Smartphone, CheckCircle, ArrowLeft, Cloud, Shield, Clock, X,
  Loader2, Crown, Tag, Wallet
} from 'lucide-react';
import { useSubscription } from '@/hooks/useSubscription';
import apiClient from '@/api/client';

interface PaymentProvider {
  id: 'alipay' | 'wechat' | 'stripe' | 'xorpay';
  name: string;
  icon: React.ElementType;
  color: string;
  description: string;
}

const PROVIDERS: PaymentProvider[] = [
  { id: 'alipay', name: '支付宝', icon: QrCode, color: 'text-blue-400', description: '扫码或跳转支付' },
  { id: 'wechat', name: '微信支付', icon: Smartphone, color: 'text-emerald-400', description: '微信内或扫码' },
  { id: 'stripe', name: '信用卡', icon: CreditCard, color: 'text-violet-400', description: 'Visa / Mastercard' },
  { id: 'xorpay', name: '虎皮椒', icon: Wallet, color: 'text-amber-400', description: '个人聚合支付' },
];

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

const PaymentPage: FC = () => {
  const navigate = useNavigate();
  const { plans, currentSubscription, tier, refresh: refreshSubscription } = useSubscription();
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [selectedCycle, setSelectedCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [selectedProvider, setSelectedProvider] = useState<string>('alipay');
  const [paymentOrder, setPaymentOrder] = useState<PaymentOrder | null>(null);
  const [isPaying, setIsPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const [couponSummary, setCouponSummary] = useState<{ final_amount: number; discount_amount: number } | null>(null);
  const [validatingCoupon, setValidatingCoupon] = useState(false);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
        pollTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    setCouponCode('');
    setCouponSummary(null);
  }, [selectedPlan, selectedCycle]);

  const activePlan = plans.find(p => p.id === selectedPlan);
  const freePlan = plans.find(p => p.slug === 'free');
  const storagePlan = plans.find(p => p.slug === 'storage');

  const validateCoupon = async () => {
    if (!couponCode.trim() || !activePlan) return;
    setValidatingCoupon(true);
    setError(null);
    try {
      const originalAmount = selectedCycle === 'yearly' ? activePlan.price_yearly : activePlan.price_monthly;
      const { data } = await apiClient.post('/api/v1/billing/validate-coupon', {
        code: couponCode.trim(),
        payment_type: 'subscription',
        original_amount: originalAmount,
        plan_id: activePlan.id,
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
    if (!selectedPlan || !selectedProvider) return;
    setIsPaying(true);
    setError(null);

    try {
      const payParams: Record<string, any> = {};
      if (selectedProvider === 'alipay' || selectedProvider === 'wechat' || selectedProvider === 'xorpay') {
        payParams.qr_code = true; // 默认扫码
      }

      const payload: Record<string, any> = {
        plan_id: selectedPlan,
        billing_cycle: selectedCycle,
        payment_method: selectedProvider,
        pay_params: payParams,
      };
      if (couponCode.trim()) {
        payload.coupon_code = couponCode.trim();
      }

      const { data } = await apiClient.post('/api/v1/billing/subscribe', payload);

      setPaymentOrder(data);

      // 已支付成功（例如全额抵扣或 0 元订单）
      if (data.status === 'success' || data.status === 'paid') {
        setPaymentSuccess(true);
        await refreshSubscription();
        return;
      }

      // 根据返回类型处理
      if (data.pay_qr_code) {
        // 生成 QR 码（如果是 URL，前端用二维码库生成）
        setQrCodeUrl(data.pay_qr_code);
      } else if (data.pay_url) {
        // 跳转支付
        window.open(data.pay_url, '_blank');
      } else if (data.pay_params?.client_secret) {
        // Stripe Elements
        // 这里会触发 Stripe 支付流程
        console.log('Stripe client_secret:', data.pay_params.client_secret);
      }

      // 开始轮询支付状态
      startPolling(data.order_id);
    } catch (err: any) {
      setError(err?.response?.data?.detail || '创建订单失败');
    } finally {
      setIsPaying(false);
    }
  };

  const startPolling = useCallback((orderId: string) => {
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
    let attempts = 0;
    const maxAttempts = 60; // 5 分钟（5s * 60）

    const poll = async () => {
      attempts++;
      try {
        const { data } = await apiClient.get(`/api/v1/billing/payments/${orderId}`);
        if (data.status === 'success' || data.status === 'paid') {
          setPaymentSuccess(true);
          setQrCodeUrl(null);
          await refreshSubscription();
          return;
        }
        if (attempts >= maxAttempts) {
          return;
        }

        // 继续轮询
        pollTimeoutRef.current = setTimeout(poll, 5000);
      } catch {
        if (attempts < maxAttempts) {
          pollTimeoutRef.current = setTimeout(poll, 5000);
        }
      }
    };

    poll();
  }, [refreshSubscription]);

  const formatPrice = (cents: number) => (cents / 100).toFixed(2);

  return (
    <div className="max-w-4xl mx-auto pb-12">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <button
          onClick={() => navigate('/settings/account')}
          className="p-2 rounded-xl hover:bg-white/[0.05] text-text-secondary transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-text-primary">存储会员</h1>
          <p className="text-sm text-text-muted">云端存储与多端同步，与模型调用完全独立</p>
        </div>
      </div>

      {/* Current Status */}
      {currentSubscription && (
        <div className="mb-6 p-4 rounded-xl bg-white/[0.02] border border-white/[0.06]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Crown className="w-4 h-4 text-amber-400" />
              <span className="text-sm text-text-secondary">当前方案：</span>
              <span className={`text-sm font-bold ${tier === 'storage' ? 'text-amber-400' : 'text-emerald-400'}`}>
                {tier === 'storage' ? '存储会员' : 'Free'}
              </span>
            </div>
            {currentSubscription.status === 'trial' && (
              <span className="text-xs text-amber-400 bg-amber-400/10 px-2 py-1 rounded-full">
                试用中
              </span>
            )}
          </div>
        </div>
      )}

      {/* Billing Cycle Toggle */}
      <div className="flex justify-center mb-8">
        <div className="inline-flex p-1 bg-bg-tertiary rounded-xl">
          <button
            onClick={() => setSelectedCycle('monthly')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              selectedCycle === 'monthly'
                ? 'bg-bg-secondary text-text-primary shadow-sm'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            月付
          </button>
          <button
            onClick={() => setSelectedCycle('yearly')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
              selectedCycle === 'yearly'
                ? 'bg-bg-secondary text-text-primary shadow-sm'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            年付
            <span className="text-[10px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded-full">
              省20%
            </span>
          </button>
        </div>
      </div>

      {/* Plan Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">
        {/* Free */}
        <motion.div
          whileHover={{ scale: 1.02 }}
          onClick={() => setSelectedPlan(freePlan?.id || '')}
          className={`rounded-2xl border p-6 cursor-pointer transition-all ${
            selectedPlan === freePlan?.id
              ? 'border-emerald-500/30 bg-emerald-500/5'
              : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.1]'
          }`}
        >
          <div className="flex items-center gap-2 mb-4">
            <Shield className="w-5 h-5 text-emerald-400" />
            <h3 className="text-lg font-bold text-text-primary">Free</h3>
          </div>
          <div className="text-3xl font-black text-text-primary mb-1">¥0</div>
          <div className="text-xs text-text-muted mb-4">永久免费</div>
          <div className="space-y-2">
            {['无限本地笔记', '本地 Ollama AI', '本地时间胶囊', '模型调用按量充值'].map(f => (
              <div key={f} className="flex items-center gap-2 text-xs text-text-secondary">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                {f}
              </div>
            ))}
          </div>
        </motion.div>

        {/* Storage */}
        <motion.div
          whileHover={{ scale: 1.02 }}
          onClick={() => setSelectedPlan(storagePlan?.id || '')}
          className={`rounded-2xl border p-6 cursor-pointer transition-all relative ${
            selectedPlan === storagePlan?.id
              ? 'border-amber-500/30 bg-amber-500/5'
              : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.1]'
          }`}
        >
          <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-bold">
            推荐
          </div>
          <div className="flex items-center gap-2 mb-4">
            <Cloud className="w-5 h-5 text-amber-400" />
            <h3 className="text-lg font-bold text-text-primary">存储会员</h3>
          </div>
          <div className="text-3xl font-black text-text-primary mb-1">
            ¥{selectedCycle === 'yearly' ? formatPrice(storagePlan?.price_yearly || 0) : formatPrice(storagePlan?.price_monthly || 0)}
            <span className="text-sm font-normal text-text-muted">/{selectedCycle === 'yearly' ? '年' : '月'}</span>
          </div>
          <div className="text-xs text-text-muted mb-4">
            {selectedCycle === 'yearly' && storagePlan ? (
              <span className="text-emerald-400">省 ¥{formatPrice((storagePlan.price_monthly * 12) - storagePlan.price_yearly)}</span>
            ) : '按月订阅，随时取消'}
          </div>
          <div className="space-y-2">
            {['提供云端存储接口（百度/阿里云盘直传）', '多端同步', '时间胶囊云端封存', '优先客服支持', '不影响模型调用计费'].map(f => (
              <div key={f} className="flex items-center gap-2 text-xs text-text-secondary">
                <CheckCircle className="w-3.5 h-3.5 text-amber-400" />
                {f}
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Payment Provider Selection */}
      {selectedPlan && selectedPlan !== freePlan?.id && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider mb-4 text-center">
            选择支付方式
          </h3>
          <div className="flex justify-center gap-3">
            {PROVIDERS.map((provider) => (
              <button
                key={provider.id}
                onClick={() => setSelectedProvider(provider.id)}
                className={`flex items-center gap-3 px-5 py-3 rounded-xl border transition-all ${
                  selectedProvider === provider.id
                    ? 'border-info bg-info/5 text-info'
                    : 'border-white/[0.06] bg-white/[0.02] text-text-secondary hover:border-white/[0.1]'
                }`}
              >
                <provider.icon className={`w-5 h-5 ${provider.color}`} />
                <div className="text-left">
                  <div className="text-sm font-medium">{provider.name}</div>
                  <div className="text-[10px] text-text-muted">{provider.description}</div>
                </div>
              </button>
            ))}
          </div>
        </motion.div>
      )}

      {/* Coupon Code */}
      {selectedPlan && selectedPlan === storagePlan?.id && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider mb-4 text-center">
            优惠码
          </h3>
          <div className="flex items-center justify-center gap-2 max-w-md mx-auto">
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
                className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-white/[0.02] border border-white/[0.06] text-white text-sm focus:outline-none focus:border-info uppercase placeholder:normal-case"
              />
            </div>
            <button
              onClick={validateCoupon}
              disabled={!couponCode.trim() || validatingCoupon}
              className="px-4 py-2.5 rounded-xl bg-white/[0.06] border border-white/[0.1] text-sm text-text-secondary hover:bg-white/[0.1] hover:text-text-primary transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {validatingCoupon && <Loader2 className="w-4 h-4 animate-spin" />}
              校验
            </button>
          </div>
          {couponSummary && (
            <div className="mt-3 flex items-center justify-center gap-2 text-sm">
              <span className="text-text-muted">已优惠</span>
              <span className="text-emerald-400 font-bold">¥{formatPrice(couponSummary.discount_amount)}</span>
              <span className="text-text-muted">，实付</span>
              <span className="text-info font-bold">¥{formatPrice(couponSummary.final_amount)}</span>
            </div>
          )}
        </motion.div>
      )}

      {/* Pay Button */}
      {selectedPlan && (
        <div className="text-center">
          <button
            onClick={handleCreateOrder}
            disabled={isPaying || !selectedPlan}
            className={`px-8 py-3 rounded-xl font-bold text-sm transition-all ${
              selectedPlan === freePlan?.id
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30'
                : 'bg-gradient-to-r from-info to-network-secondary text-white hover:shadow-[0_0_25px_rgba(200,149,108,0.4)]'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {isPaying ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                处理中...
              </span>
            ) : selectedPlan === freePlan?.id ? (
              '使用 Free 方案'
            ) : (
              `立即支付 ¥${formatPrice(couponSummary ? couponSummary.final_amount : (selectedCycle === 'yearly' ? activePlan?.price_yearly || 0 : activePlan?.price_monthly || 0))} 订阅存储会员`
            )}
          </button>
        </div>
      )}

      {/* QR Code Modal */}
      <AnimatePresence>
        {qrCodeUrl && paymentOrder && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setQrCodeUrl(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-bg-secondary border border-white/[0.06] rounded-2xl p-6 max-w-sm w-full mx-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-text-primary">
                  {paymentOrder.provider === 'alipay' ? '支付宝' : paymentOrder.provider === 'wechat' ? '微信' : '支付'}扫码支付
                </h3>
                <button
                  onClick={() => setQrCodeUrl(null)}
                  className="p-1 rounded hover:bg-white/[0.05] text-text-muted"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="text-center mb-4">
                <div className="text-2xl font-black text-text-primary mb-1">
                  ¥{formatPrice(paymentOrder.amount)}
                </div>
                <div className="text-xs text-text-muted">{paymentOrder.description}</div>
              </div>

              {/* Payment URL fallback (no qrcode lib installed) */}
              <div className="mb-4 p-3 bg-bg-tertiary rounded-lg border border-white/[0.06]">
                <div className="text-xs text-text-muted mb-2">请使用{paymentOrder.provider === 'alipay' ? '支付宝' : paymentOrder.provider === 'wechat' ? '微信' : '对应应用'}完成支付：</div>
                <a
                  href={qrCodeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full text-center px-4 py-2 rounded-lg bg-info/10 text-info text-sm font-medium hover:bg-info/20 transition-colors break-all"
                >
                  打开支付页面
                </a>
              </div>

              <p className="text-xs text-text-muted text-center mb-4">
                支付完成后本页会自动刷新状态，请勿关闭窗口。
              </p>

              <div className="flex items-center justify-center gap-2 text-xs text-amber-400">
                <Clock className="w-3.5 h-3.5 animate-pulse" />
                等待支付结果...
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Success */}
      {paymentSuccess && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm text-center"
        >
          <div className="flex items-center justify-center gap-2 mb-2">
            <CheckCircle className="w-5 h-5" />
            <span className="font-semibold">支付成功！</span>
          </div>
          <p className="text-emerald-400/80 mb-3">你的订阅已生效，可以开始使用全部功能。</p>
          <button
            onClick={() => navigate('/settings/account')}
            className="px-4 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 text-xs font-medium hover:bg-emerald-500/30 transition-colors"
          >
            返回账户设置
          </button>
        </motion.div>
      )}

      {/* Error */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 p-3 rounded-xl bg-danger/10 border border-danger/20 text-danger text-sm text-center"
        >
          {error}
        </motion.div>
      )}
    </div>
  );
};

export default PaymentPage;
