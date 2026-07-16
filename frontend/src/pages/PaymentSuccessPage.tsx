import { FC, useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle, Loader2, XCircle, ArrowLeft } from 'lucide-react';
import apiClient from '@/api/client';

const PaymentSuccessPage: FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'pending' | 'error'>('loading');
  const [message, setMessage] = useState('正在确认支付结果...');

  const orderId = searchParams.get('order_id');
  const sessionId = searchParams.get('session_id');

  useEffect(() => {
    const checkPayment = async () => {
      try {
        // Stripe 返回 session_id，我们用它查询支付状态
        const id = orderId || sessionId;
        if (!id) {
          setStatus('error');
          setMessage('缺少订单信息，无法确认支付结果。');
          return;
        }

        const { data } = await apiClient.get(`/api/v1/billing/payments/${id}`);
        if (data.status === 'success' || data.status === 'paid') {
          setStatus('success');
          setMessage('支付成功，订单已生效。');
        } else if (data.status === 'pending' || data.status === 'processing') {
          setStatus('pending');
          setMessage('支付结果确认中，请稍候...');
        } else {
          setStatus('error');
          setMessage(`支付未成功（状态：${data.status}），请返回重试。`);
        }
      } catch (err: any) {
        setStatus('error');
        setMessage(err?.response?.data?.detail || '查询支付结果失败，请稍后查看账户。');
      }
    };

    checkPayment();
  }, [orderId, sessionId]);

  // 轮询 pending 状态
  useEffect(() => {
    if (status !== 'pending') return;
    const id = orderId || sessionId;
    if (!id) return;

    let attempts = 0;
    const maxAttempts = 12; // 1 分钟
    let timeoutRef: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const poll = async () => {
      attempts++;
      try {
        const { data } = await apiClient.get(`/api/v1/billing/payments/${id}`);
        if (cancelled) return;
        if (data.status === 'success' || data.status === 'paid') {
          setStatus('success');
          setMessage('支付成功，订单已生效。');
          return;
        } else if (data.status !== 'pending' && data.status !== 'processing') {
          setStatus('error');
          setMessage(`支付未成功（状态：${data.status}），请返回重试。`);
          return;
        }
        if (attempts >= maxAttempts) {
          setMessage('支付结果确认超时，请稍后到账户中查看。');
          return;
        }
        timeoutRef = setTimeout(poll, 5000);
      } catch {
        if (cancelled) return;
        if (attempts >= maxAttempts) {
          setMessage('支付结果确认超时，请稍后到账户中查看。');
          return;
        }
        timeoutRef = setTimeout(poll, 5000);
      }
    };

    poll();

    return () => {
      cancelled = true;
      if (timeoutRef) clearTimeout(timeoutRef);
    };
  }, [status, orderId, sessionId]);

  const icon = {
    loading: <Loader2 className="w-12 h-12 text-info animate-spin" />,
    success: <CheckCircle className="w-12 h-12 text-emerald-400" />,
    pending: <Loader2 className="w-12 h-12 text-amber-400 animate-spin" />,
    error: <XCircle className="w-12 h-12 text-danger" />,
  }[status];

  const title = {
    loading: '正在确认',
    success: '支付成功',
    pending: '等待确认',
    error: '支付异常',
  }[status];

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-primary p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full bg-bg-secondary border border-white/[0.06] rounded-2xl p-8 text-center"
      >
        <div className="flex justify-center mb-6">{icon}</div>
        <h1 className="text-2xl font-bold text-text-primary mb-3">{title}</h1>
        <p className="text-sm text-text-secondary mb-8">{message}</p>

        <div className="flex flex-col gap-3">
          <button
            onClick={() => navigate('/settings/account')}
            className="w-full px-4 py-2.5 rounded-xl bg-info/10 text-info text-sm font-medium hover:bg-info/20 transition-colors"
          >
            查看账户与订阅
          </button>
          <button
            onClick={() => navigate('/payment')}
            className="w-full px-4 py-2.5 rounded-xl bg-white/[0.05] text-text-secondary text-sm font-medium hover:bg-white/[0.1] hover:text-text-primary transition-colors flex items-center justify-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            返回支付中心
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default PaymentSuccessPage;
