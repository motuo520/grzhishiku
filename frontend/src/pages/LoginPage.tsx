import { FC, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Brain, Mail, Lock, Eye, EyeOff, Loader2, ArrowRight,
} from 'lucide-react';
import { setToken } from '@/api/auth';
import { useAuth } from '@/hooks/useAuth';

type Tab = 'login' | 'register';

const LoginPage: FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, register, sendCode, isLoggingIn, isRegistering, isSendingCode, loginError, registerError, sendCodeError } = useAuth();

  const [tab, setTab] = useState<Tab>((location.state as any)?.tab === 'register' ? 'register' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const resetForm = () => {
    setFormError(null);
    setPassword('');
    setVerificationCode('');
    setCountdown(0);
  };

  const switchTab = (t: Tab) => {
    setTab(t);
    resetForm();
  };

  const validateLogin = (): boolean => {
    if (!email.trim()) { setFormError('请输入邮箱'); return false; }
    if (!password) { setFormError('请输入密码'); return false; }
    return true;
  };

  const validateRegister = (): boolean => {
    if (!email.trim()) { setFormError('请输入邮箱'); return false; }
    if (!verificationCode.trim()) { setFormError('请输入邮箱验证码'); return false; }
    if (!password) { setFormError('请输入密码'); return false; }
    if (password.length < 8) { setFormError('密码长度至少 8 位'); return false; }
    return true;
  };

  const formatError = (err: any): string => {
    const status = err?.response?.status;
    const detail = err?.response?.data?.detail || err?.response?.data?.message;
    const msg = err?.message || '';

    if (status === 401) return '邮箱或密码错误，请检查输入';
    if (status === 400 && detail) return detail;
    if (status === 404) return '服务未找到，请检查后端是否启动';
    if (status >= 500) return '服务器错误，请稍后再试';
    if (msg.includes('Network Error') || msg.includes('ECONNREFUSED')) return '无法连接后端服务，请确认 localhost:8000 已启动';
    if (msg.includes('timeout')) return '请求超时，请检查网络连接';
    return detail || msg || '登录失败，请稍后重试';
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!validateLogin()) return;
    console.log('[Login] email:', email, 'password:', password);
    try {
      await login({ email, password });
      navigate('/');
    } catch (err: any) {
      console.log('[Login] axios error:', err);
      // Fallback: try direct fetch to bypass axios interceptors
      try {
        const resp = await fetch('http://localhost:8000/api/v1/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const data = await resp.json();
        console.log('[Login] fetch response:', resp.status, data);
        if (resp.ok) {
          setToken(data.access_token);
          window.location.href = '/';
          return;
        }
      } catch (fetchErr: any) {
        console.log('[Login] fetch error:', fetchErr);
      }
      setFormError(formatError(err));
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!validateRegister()) return;
    try {
      await register({ email, password, verification_code: verificationCode });
      await login({ email, password });
      navigate('/');
    } catch (err: any) {
      setFormError(formatError(err));
    }
  };

  const handleSendCode = async () => {
    setFormError(null);
    if (!email.trim()) {
      setFormError('请先输入邮箱');
      return;
    }
    try {
      await sendCode({ email });
      setCountdown(60);
      const timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (err: any) {
      setFormError(formatError(err));
    }
  };

  const isLoading = isLoggingIn || isRegistering;
  const errorMessage = formError || (loginError as any)?.message || (registerError as any)?.message || (sendCodeError as any)?.message || null;

  const inputClass =
    'w-full pl-10 pr-4 py-2.5 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-[2px] text-text-primary placeholder-text-muted focus:border-accent/50 outline-none transition-colors text-sm';

  return (
    <div className="min-h-screen w-full flex items-center justify-center relative overflow-hidden bg-bg-primary">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
        className="relative z-10 w-full max-w-[400px] mx-4"
      >
        <div className="liquid-glass-strong rounded-[2px] p-8">
          {/* Brand */}
          <div className="relative z-10 flex flex-col items-center mb-8">
            <div className="w-12 h-12 rounded-[2px] bg-accent flex items-center justify-center mb-3">
              <Brain className="w-7 h-7 text-[#f6ece6]" />
            </div>
            <h1 className="text-xl font-bold text-text-primary tracking-tight">问墨</h1>
            <p className="text-sm text-text-secondary mt-1">欢迎回来</p>
          </div>

          {/* Tabs */}
          <div className="relative z-10 flex gap-1 p-1 bg-bg-secondary rounded-[2px] border border-border-light mb-6">
            <button
              onClick={() => switchTab('login')}
              className={`flex-1 py-2 text-sm font-medium rounded-[2px] transition-colors ${
                tab === 'login'
                  ? 'bg-bg-tertiary text-text-primary border border-border-color'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover border border-transparent'
              }`}
            >
              登录
            </button>
            <button
              onClick={() => switchTab('register')}
              className={`flex-1 py-2 text-sm font-medium rounded-[2px] transition-colors ${
                tab === 'register'
                  ? 'bg-bg-tertiary text-text-primary border border-border-color'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover border border-transparent'
              }`}
            >
              注册
            </button>
          </div>

          {/* Error alert */}
          <AnimatePresence>
            {errorMessage && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="relative z-10 mb-4 bg-danger/10 border border-danger/20 text-danger rounded-[2px] px-4 py-3 text-sm"
              >
                {errorMessage}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Login Form */}
          <AnimatePresence mode="wait">
            {tab === 'login' && (
              <motion.form
                key="login"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                transition={{ duration: 0.2 }}
                onSubmit={handleLogin}
                className="relative z-10 space-y-4"
              >
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">邮箱</label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="your@email.com"
                      className={inputClass}
                      disabled={isLoading}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">密码</label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="输入密码"
                      className={`${inputClass} pr-10`}
                      disabled={isLoading}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors"
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full btn-primary flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isLoggingIn ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      登录中...
                    </>
                  ) : (
                    <>
                      登录
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </motion.form>
            )}

            {/* Register Form */}
            {tab === 'register' && (
              <motion.form
                key="register"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.2 }}
                onSubmit={handleRegister}
                className="relative z-10 space-y-4"
              >
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">邮箱</label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="your@email.com"
                      className={inputClass}
                      disabled={isLoading}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">邮箱验证码</label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                      <input
                        type="text"
                        inputMode="numeric"
                        value={verificationCode}
                        onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="6 位验证码"
                        className={inputClass}
                        disabled={isLoading}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleSendCode}
                      disabled={isSendingCode || countdown > 0 || !email.trim()}
                      className="shrink-0 px-3 py-2.5 bg-bg-tertiary hover:bg-bg-hover border border-border-color rounded-[2px] text-xs text-text-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                    >
                      {isSendingCode ? '发送中...' : countdown > 0 ? `${countdown}s` : '获取验证码'}
                    </button>
                  </div>
                  <p className="text-[10px] text-text-muted mt-1.5">验证码将发送至您的邮箱，请查收</p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">密码</label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="至少 8 位"
                      className={`${inputClass} pr-10`}
                      disabled={isLoading}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors"
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full btn-primary flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isRegistering ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      注册中...
                    </>
                  ) : (
                    <>
                      创建账户
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </motion.form>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
};

export default LoginPage;
