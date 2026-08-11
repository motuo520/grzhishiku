import api from './client';

export interface LoginData { email: string; password: string; }
export interface RegisterData { email: string; password: string; }
export interface TokenResponse { access_token: string; token_type: string; expires_in: number; refresh_token?: string; refresh_expires_in?: number; }
export interface User {
  id: string; email: string; name: string | null; avatar: string | null;
  display_name: string | null; username: string | null;
  storage_used: number; storage_limit: number; created_at: string;
}

export const TOKEN_KEY = 'access_token';
export const REFRESH_KEY = 'refresh_token';

export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);
export const setToken = (token: string): void => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = (): void => localStorage.removeItem(TOKEN_KEY);
export const getRefreshToken = (): string | null => localStorage.getItem(REFRESH_KEY);
export const setRefreshToken = (token: string): void => localStorage.setItem(REFRESH_KEY, token);
export const clearRefreshToken = (): void => localStorage.removeItem(REFRESH_KEY);
export const isAuthenticated = (): boolean => !!getToken();

export const getTokenExpiry = (): number | null => {
  const token = getToken();
  if (!token) return null;
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    // Base64URL → Base64（处理 -/_ 与 padding）
    let base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const pad = base64.length % 4;
    if (pad) {
      base64 += new Array(5 - pad).join('=');
    }
    const decoded = JSON.parse(atob(base64));
    return decoded.exp ? decoded.exp * 1000 : null;
  } catch {
    return null;
  }
};

export const isTokenExpiringSoon = (thresholdMinutes = 30): boolean => {
  const exp = getTokenExpiry();
  if (!exp) return false;
  return exp - Date.now() < thresholdMinutes * 60 * 1000;
};

export const authApi = {
  login: (data: LoginData) => api.post<TokenResponse>('/api/v1/auth/login', data),
  register: (data: RegisterData) => api.post<TokenResponse>('/api/v1/auth/register', data),
  refresh: () => api.post<TokenResponse>('/api/v1/auth/refresh', null, {
    headers: { Authorization: `Bearer ${getRefreshToken() || getToken()}` },
  }),
  logout: () => api.post('/api/v1/auth/logout'),
  me: () => api.get<User>('/api/v1/users/me'),
  updateMe: (data: { name?: string; avatar?: string; display_name?: string; username?: string }) => api.patch<User>('/api/v1/users/me', data),
  seedSamples: () => api.post<{ seeded: Record<string, number> }>('/api/v1/users/me/seed-samples'),
};
