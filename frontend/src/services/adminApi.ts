import axios from 'axios';
import { useAdminStore } from '../store/adminStore';

const adminApiClient = axios.create({
  baseURL: import.meta.env.VITE_ADMIN_API_URL || '/api/admin',
  headers: {
    'Content-Type': 'application/json',
  },
});

adminApiClient.interceptors.request.use((config: any) => {
  const token = useAdminStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

adminApiClient.interceptors.response.use(
  (response: any) => response,
  (error: any) => {
    if (error.response?.status === 401) {
      useAdminStore.getState().logout();
      window.location.href = '/admin/login';
    }
    return Promise.reject(error);
  }
);

export const adminApi = {
  login: (data: { email: string; password: string }) => adminApiClient.post('/auth/login', data),
  me: () => adminApiClient.get('/auth/me'),

  // Dashboard
  getStats: () => adminApiClient.get('/dashboard/stats'),

  // Users
  getUsers: (params?: { status?: string; role?: string; search?: string; page?: number; page_size?: number }) =>
    adminApiClient.get('/users/', { params }),
  getUser: (id: string) => adminApiClient.get(`/users/${id}`),
  updateUserStatus: (id: string, status: string) => adminApiClient.patch(`/users/${id}/status`, { status }),
  updateUserTier: (id: string, tier: string) => adminApiClient.patch(`/users/${id}/tier`, { tier }),
  deleteUser: (id: string) => adminApiClient.delete(`/users/${id}`),
  resetPassword: (id: string) => adminApiClient.post(`/users/${id}/reset-password`, {}),

  // Content
  getContent: (params?: { type?: string; status?: string; reported?: boolean; skip?: number; limit?: number }) =>
    adminApiClient.get('/content/', { params }),
  moderateContent: (id: string, action: string, reason?: string) => adminApiClient.post(`/content/${id}/moderate`, { action, reason }),

  // Billing
  getSubscriptions: () => adminApiClient.get('/billing/subscriptions'),
  getSubscriptionStats: () => adminApiClient.get('/billing/stats'),
  updateTier: (id: string, tier: string) => adminApiClient.patch(`/billing/users/${id}/tier`, { tier }),
  getPayments: (params?: { status?: string; payment_type?: string }) => adminApiClient.get('/billing/payments', { params }),
  refundPayment: (id: string, data?: { amount?: number; reason?: string }) => adminApiClient.post(`/billing/payments/${id}/refund`, data || {}),
  getUserBalance: (userId: string) => adminApiClient.get(`/billing/users/${userId}/balance`),
  adjustUserBalance: (userId: string, data: { amount_yuan: number; reason: string }) => adminApiClient.post(`/billing/users/${userId}/balance/adjust`, data),
  getUserBalanceTransactions: (userId: string) => adminApiClient.get(`/billing/users/${userId}/balance/transactions`),
  getCoupons: (active_only?: boolean) => adminApiClient.get('/billing/coupons', { params: active_only !== undefined ? { active_only } : undefined }),
  createCoupon: (data: any) => adminApiClient.post('/billing/coupons', data),
  toggleCoupon: (id: string, is_active: boolean) => adminApiClient.patch(`/billing/coupons/${id}/toggle`, null, { params: { is_active } }),
  getCouponUsages: (coupon_id?: string) => adminApiClient.get('/billing/coupon-usages', { params: coupon_id ? { coupon_id } : undefined }),

  // Plans
  getPlans: () => adminApiClient.get('/billing/plans'),
  createPlan: (data: any) => adminApiClient.post('/billing/plans', data),
  updatePlan: (id: string, data: any) => adminApiClient.patch(`/billing/plans/${id}`, data),
  deletePlan: (id: string) => adminApiClient.delete(`/billing/plans/${id}`),

  // LLM Models / Provider Accounts
  getLLMModels: (params?: { active_only?: boolean; provider?: string }) =>
    adminApiClient.get('/llm/models', { params }),
  createLLMModel: (data: any) => adminApiClient.post('/llm/models', data),
  updateLLMModel: (id: string, data: any) => adminApiClient.patch(`/llm/models/${id}`, data),
  deleteLLMModel: (id: string) => adminApiClient.delete(`/llm/models/${id}`),
  getLLMProviderAccounts: (provider?: string) => adminApiClient.get('/llm/provider-accounts', { params: provider ? { provider } : undefined }),
  createLLMProviderAccount: (data: any) => adminApiClient.post('/llm/provider-accounts', data),
  updateLLMProviderAccount: (accountId: string, data: any) =>
    adminApiClient.patch(`/llm/provider-accounts/${accountId}`, data),

  // Logs
  getLogs: async (params?: { actionType?: string; severity?: string; startDate?: string; endDate?: string; search?: string; skip?: number; limit?: number }) => {
    const mapped: Record<string, any> = { ...(params || {}) };
    if (mapped.actionType) {
      mapped.action = mapped.actionType;
      delete mapped.actionType;
    }
    if (mapped.severity) {
      mapped.risk_level = mapped.severity;
      delete mapped.severity;
    }
    const res = await adminApiClient.get('/logs/', { params: mapped });
    return { data: res.data.items || [] };
  },
  exportLogs: (format: 'json' | 'csv') => adminApiClient.get(`/logs/export?format=${format}`, { responseType: 'blob' }),

  // System
  getSystemConfig: () => adminApiClient.get('/system/config'),
  updateSystemConfig: (config: any) => adminApiClient.put('/system/config', config),
  getSystemHealth: () => adminApiClient.get('/system/health'),

  // Support
  getTickets: async (params?: { status?: string; type?: string; priority?: string; assignedTo?: string; skip?: number; limit?: number }) => {
    const mapped: Record<string, any> = { ...(params || {}) };
    if (mapped.type) {
      mapped.category = mapped.type;
      delete mapped.type;
    }
    if (mapped.assignedTo) {
      mapped.assigned_to = mapped.assignedTo;
      delete mapped.assignedTo;
    }
    const res = await adminApiClient.get('/support/tickets', { params: mapped });
    return { data: res.data.items || [] };
  },
  getTicket: (id: string) => adminApiClient.get(`/support/tickets/${id}`),
  assignTicket: (id: string, adminId: string) => adminApiClient.put(`/support/tickets/${id}/assign`, { assigned_to: adminId }),
  updateTicketStatus: (id: string, status: string) => adminApiClient.put(`/support/tickets/${id}/status`, { status }),
  replyTicket: (id: string, content: string) => adminApiClient.post(`/support/tickets/${id}/replies`, { content }),
  getSupportStats: () => adminApiClient.get('/support/stats'),

  // Tenants
  getTenants: () => adminApiClient.get('/tenants/'),
  getTenantStats: (id: string) => adminApiClient.get(`/tenants/${id}/stats`),
  createTenant: (data: any) => adminApiClient.post('/tenants', data),
  updateTenant: (id: string, data: any) => adminApiClient.patch(`/tenants/${id}`, data),
  deleteTenant: (id: string) => adminApiClient.delete(`/tenants/${id}`),
};

export default adminApi;
