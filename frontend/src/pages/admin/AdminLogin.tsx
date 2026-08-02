import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Eye, EyeOff, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAdminStore } from '../../store/adminStore';
import adminApi from '../../services/adminApi';

export default function AdminLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { login } = useAdminStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const response = await adminApi.login({ email, password });
      const data = response.data;
      let admin = data.admin;
      const accessToken = data.access_token;
      if (!admin && accessToken) {
        const meResponse = await adminApi.me();
        admin = meResponse.data;
      }
      login(admin, accessToken);
      navigate('/admin');
    } catch (err: any) {
      const data = err.response?.data;
      const message = data?.error?.message || data?.detail || '登录失败';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-admin-bg flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-admin-sidebar rounded-xl border border-admin-border p-8"
      >
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-admin-primary/10 rounded-xl flex items-center justify-center mx-auto mb-4">
            <Shield className="w-8 h-8 text-admin-primary" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">管理员登录</h1>
          <p className="text-admin-muted">钤记管理后台</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-admin-muted mb-2">邮箱</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2.5 bg-admin-bg border border-admin-border rounded-lg text-white placeholder-admin-muted focus:outline-none focus:border-admin-primary"
              placeholder="admin@example.com"
              required
            />
          </div>

          <div>
            <label className="block text-sm text-admin-muted mb-2">密码</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 bg-admin-bg border border-admin-border rounded-lg text-white placeholder-admin-muted focus:outline-none focus:border-admin-primary pr-10"
                placeholder="输入密码"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-admin-muted hover:text-white"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-danger/10 border border-danger/20 rounded-lg text-danger text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-admin-primary text-white rounded-lg font-medium hover:bg-admin-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : '登录'}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
