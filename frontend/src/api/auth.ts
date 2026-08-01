import api, { apiClient } from './client';

export interface LoginData { email: string; password: string; }
export interface RegisterData { email: string; password: string; }
export interface TokenResponse { access_token: string; token_type: string; expires_in: number; }
export interface User {
  id: string; email: string; name: string | null; avatar: string | null;
  display_name: string | null; username: string | null;
  storage_used: number; storage_limit: number; created_at: string;
}

export const TOKEN_KEY = 'access_token';

export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);
export const setToken = (token: string): void => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = (): void => localStorage.removeItem(TOKEN_KEY);
export const isAuthenticated = (): boolean => !!getToken();

export const getTokenExpiry = (): number | null => {
  const token = getToken();
  if (!token) return null;
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const decoded = JSON.parse(atob(payload));
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
  refresh: () => api.post<TokenResponse>('/api/v1/auth/refresh'),
  logout: () => api.post('/api/v1/auth/logout'),
  me: () => api.get<User>('/api/v1/users/me'),
  updateMe: (data: { name?: string; avatar?: string; display_name?: string; username?: string }) => api.patch<User>('/api/v1/users/me', data),
};

// Backward compat: also expose on apiClient
export const initAuthToken = () => {
  const token = getToken();
  if (token) {
    apiClient.setToken(token);
  }
};
