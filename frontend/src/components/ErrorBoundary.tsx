import { Component, ReactNode, ErrorInfo } from 'react';
import { AlertTriangle, RefreshCw, ArrowLeft, Home, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  showDetails: boolean;
  copied: boolean;
}

interface ClientErrorReport {
  message: string;
  stack?: string;
  componentStack?: string;
  url: string;
  userAgent: string;
  timestamp: string;
}

// 动态分包加载失败（发版后旧会话引用已删除的旧哈希 chunk，真机实捕：
// Failed to fetch dynamically imported module …/XxxPage-老哈希.js）——
// 新版本已在服务器上，自动刷新一次拿到新 index.html 即自愈；
// 30s 内只刷一次防循环（刷新后仍失败说明不是陈旧缓存，落到错误页）
const CHUNK_ERROR_RE = /Failed to fetch dynamically imported module|Loading chunk \S+ failed|Importing a module script failed|error loading dynamically imported module/i;
const CHUNK_RELOAD_KEY = 'psb:chunk-reload-at';
const CHUNK_RELOAD_WINDOW_MS = 30000;

function isChunkLoadError(error: Error | null): boolean {
  return !!error?.message && CHUNK_ERROR_RE.test(error.message);
}

function tryChunkErrorRecovery(error: Error | null): boolean {
  if (!isChunkLoadError(error)) return false;
  try {
    const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0);
    if (Date.now() - last < CHUNK_RELOAD_WINDOW_MS) return false;
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
    window.location.reload();
    return true;
  } catch {
    return false;
  }
}

function reportError(report: ClientErrorReport) {
  try {
    fetch('/api/v1/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
    }).catch(() => {
      // ignore network failures
    });
  } catch {
    // ignore
  }
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, showDetails: false, copied: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null, showDetails: false, copied: false };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught error:', error, errorInfo);
    // 发版后旧会话的 chunk 404：自动刷新一次自愈（30s 窗口防循环），不进错误页
    if (tryChunkErrorRecovery(error)) return;
    this.setState({ error, errorInfo });

    reportError({
      message: error?.message || 'Unknown error',
      stack: error?.stack,
      componentStack: errorInfo?.componentStack || undefined,
      url: typeof window !== 'undefined' ? window.location.href : '',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      timestamp: new Date().toISOString(),
    });
  }

  handleGoBack = () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = '/';
    }
  };

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.href = '/';
  };

  toggleDetails = () => {
    this.setState((prev) => ({ showDetails: !prev.showDetails }));
  };

  handleCopy = async () => {
    const { error, errorInfo } = this.state;
    const text = [
      `Message: ${error?.message || 'Unknown error'}`,
      `URL: ${window.location.href}`,
      `Stack:\n${error?.stack || '(no stack)'}`,
      `Component Stack:\n${errorInfo?.componentStack || '(no component stack)'}`,
    ].join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    } catch {
      // ignore
    }
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const { error, errorInfo, showDetails, copied } = this.state;

      return (
        <div className="min-h-screen flex items-center justify-center bg-bg-primary p-6">
          <div className="max-w-2xl w-full glass-card p-8 text-center">
            <div className="w-16 h-16 rounded-[2px] bg-danger/10 flex items-center justify-center mx-auto mb-5">
              <AlertTriangle className="w-8 h-8 text-danger" />
            </div>
            <h1 className="text-xl font-bold text-text-primary mb-2">页面出现错误</h1>
            <p className="text-sm text-text-secondary mb-6">
              抱歉，页面渲染时发生了意外错误。请尝试返回或刷新页面。如果问题持续，请复制下方错误信息联系支持。
            </p>
            {error && (
              <div className="mb-4 p-3 rounded-[2px] bg-danger/5 border border-danger/10 text-left">
                <div className="text-xs text-danger font-medium mb-1">错误信息：</div>
                <div className="text-xs text-text-secondary break-words whitespace-pre-wrap">
                  {error.message || 'Unknown error'}
                </div>
                {isChunkLoadError(error) && (
                  <div className="text-xs text-text-muted mt-2">
                    通常是应用发布新版本后，旧页面引用的资源已更新——刷新页面即可恢复。
                  </div>
                )}
              </div>
            )}

            <button
              onClick={this.toggleDetails}
              className="mb-4 text-xs text-text-muted hover:text-info transition-colors flex items-center justify-center gap-1 mx-auto"
            >
              {showDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {showDetails ? '隐藏技术详情' : '查看技术详情（用于排查）'}
            </button>

            {showDetails && (
              <div className="mb-6 text-left">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-text-muted">完整诊断信息</span>
                  <button
                    onClick={this.handleCopy}
                    className="text-xs flex items-center gap-1 text-info hover:text-network-secondary transition-colors"
                  >
                    {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copied ? '已复制' : '复制错误信息'}
                  </button>
                </div>
                <div className="p-3 rounded-[2px] bg-bg-tertiary border border-white/[0.08] max-h-64 overflow-auto">
                  <pre className="text-[10px] text-text-secondary whitespace-pre-wrap break-words font-mono">
{`URL: ${window.location.href}

Message:
${error?.message || 'Unknown error'}

Stack:
${error?.stack || '(no stack)'}

Component Stack:
${errorInfo?.componentStack || '(no component stack)'}`}
                  </pre>
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={this.handleGoBack}
                className="btn-secondary flex items-center justify-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                返回上一页
              </button>
              <button
                onClick={this.handleReload}
                className="btn-primary flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                刷新页面
              </button>
            </div>
            <button
              onClick={this.handleGoHome}
              className="mt-4 text-sm text-text-muted hover:text-info transition-colors flex items-center justify-center gap-1 mx-auto"
            >
              <Home className="w-4 h-4" />
              返回首页
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
