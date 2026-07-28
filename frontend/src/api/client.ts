import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { getToken, setToken, clearToken, TOKEN_KEY } from './auth';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

// Endpoints that should NOT send auth header (and should not trigger refresh on 401)
// 注意：refresh 自己必须在列，否则 refresh 返回 401 时会再次等待自己，死锁导致页面永远转圈
const PUBLIC_ENDPOINTS = ['/api/v1/auth/login', '/api/v1/auth/register', '/api/v1/auth/refresh'];

class ApiClient {
  private client: AxiosInstance;
  private refreshPromise: Promise<string> | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: 120000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.setupInterceptors();
  }

  private isPublicEndpoint(url?: string): boolean {
    if (!url) return false;
    return PUBLIC_ENDPOINTS.some((ep) => url.includes(ep));
  }

  private setupInterceptors() {
    // Request interceptor: attach Bearer token if present and not a public endpoint
    this.client.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        if (!this.isPublicEndpoint(config.url)) {
          const token = getToken();
          if (token && config.headers) {
            config.headers.Authorization = `Bearer ${token}`;
          }
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor: 401 -> refresh -> retry once
    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
        if (!originalRequest) return Promise.reject(error);

        // Skip public endpoints (don't loop on login/register 401)
        if (this.isPublicEndpoint(originalRequest.url)) {
          return Promise.reject(error);
        }

        // 402: LLM balance insufficient -> broadcast global event so UI can show top-up / local-model hint
        if (error.response?.status === 402) {
          const detail = (error.response?.data as { detail?: string })?.detail || '余额不足，无法完成 AI 调用';
          window.dispatchEvent(
            new CustomEvent('psb:llm:insufficient-balance', {
              detail: { message: detail, url: '/topup' },
            })
          );
          return Promise.reject({ message: detail, code: 'INSUFFICIENT_BALANCE', status: 402 });
        }

        // 403: subscription tier insufficient -> broadcast global event so UI can show upgrade prompt
        if (error.response?.status === 403) {
          const detail = (error.response?.data as { detail?: string })?.detail || '当前订阅方案无权使用该功能';
          window.dispatchEvent(
            new CustomEvent('psb:subscription:upgrade-required', {
              detail: { message: detail, url: '/payment' },
            })
          );
          return Promise.reject({ message: detail, code: 'UPGRADE_REQUIRED', status: 403 });
        }

        if (error.response?.status === 401 && !originalRequest._retry) {
          // 匿名（无 token）用户的 401：不刷新、不踢回欢迎页，交给调用方按空态处理
          if (!getToken()) {
            return Promise.reject({ message: '未登录或会话已过期', code: 'UNAUTHORIZED', status: 401 });
          }
          originalRequest._retry = true;
          try {
            const newToken = await this.refreshToken();
            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${newToken}`;
            }
            return this.client(originalRequest);
          } catch (refreshError) {
            clearToken();
            window.dispatchEvent(new CustomEvent('psb:auth:logout'));
            // Redirect to welcome after a tick so callers can finish cleanup
            setTimeout(() => {
              if (window.location.pathname !== '/welcome') {
                window.location.href = '/welcome';
              }
            }, 0);
            return Promise.reject(refreshError);
          }
        }

        // 404 on /me usually means the user no longer exists (e.g. deleted test account).
        // Treat it as an authentication failure and redirect to welcome.
        if (
          error.response?.status === 404 &&
          originalRequest.url?.includes('/api/v1/users/me')
        ) {
          const data = error.response?.data as { detail?: string; error?: { message?: string } };
          const detail = data?.detail || data?.error?.message || '';
          if (detail.toLowerCase().includes('user not found') || detail.includes('用户不存在') || detail.includes('Not Found')) {
            clearToken();
            window.dispatchEvent(new CustomEvent('psb:auth:logout'));
            setTimeout(() => {
              if (window.location.pathname !== '/welcome') {
                window.location.href = '/welcome';
              }
            }, 0);
            return Promise.reject({ message: detail, code: 'USER_NOT_FOUND', status: 404 });
          }
        }

        const errorData = error.response?.data as { error?: { message?: string; code?: string } };
        const message = errorData?.error?.message || error.message;
        const code = errorData?.error?.code || 'UNKNOWN_ERROR';
        console.error(`API Error [${code}]:`, message);
        return Promise.reject({ message, code, status: error.response?.status });
      }
    );
  }

  private async refreshToken(): Promise<string> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.client
      .post('/api/v1/auth/refresh', {}, {
        headers: { Authorization: `Bearer ${getToken() || ''}` },
      })
      .then((response) => {
        const { access_token } = response.data;
        setToken(access_token);
        return access_token;
      })
      .finally(() => { this.refreshPromise = null; });
    return this.refreshPromise;
  }

  get instance(): AxiosInstance { return this.client; }

  setToken(token: string) { localStorage.setItem(TOKEN_KEY, token); }
  clearToken() { localStorage.removeItem(TOKEN_KEY); }
  getToken(): string | null { return localStorage.getItem(TOKEN_KEY); }
}

export const apiClient = new ApiClient();
export default apiClient.instance;
