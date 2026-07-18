import { FC } from 'react';
import { motion } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { XCircle, ArrowLeft, RotateCcw } from 'lucide-react';

const PaymentCancelPage: FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const orderId = searchParams.get('order_id');

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-primary p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full bg-bg-secondary border border-white/[0.06] rounded-2xl p-8 text-center"
      >
        <div className="flex justify-center mb-6">
          <XCircle className="w-12 h-12 text-warning" />
        </div>
        <h1 className="text-2xl font-bold text-text-primary mb-3">支付未完成</h1>
        <p className="text-sm text-text-secondary mb-2">
          你取消了支付或支付过程中断，没有扣款。
        </p>
        {orderId && (
          <p className="text-xs text-text-muted mb-8">订单号：{orderId}</p>
        )}

        <div className="flex flex-col gap-3">
          <button
            onClick={() => navigate('/payment')}
            className="w-full px-4 py-2.5 rounded-xl bg-info/10 text-info text-sm font-medium hover:bg-info/20 transition-colors flex items-center justify-center gap-2"
          >
            <RotateCcw className="w-4 h-4" />
            重新支付
          </button>
          <button
            onClick={() => navigate('/settings/account')}
            className="w-full px-4 py-2.5 rounded-xl bg-white/[0.05] text-text-secondary text-sm font-medium hover:bg-white/[0.1] hover:text-text-primary transition-colors flex items-center justify-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            返回账户设置
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default PaymentCancelPage;
