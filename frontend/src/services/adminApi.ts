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
  deleteUser: (id: string) => adminApiClient.delete(`/users/${id}`),
  resetPassword: (id: string) => adminApiClient.post(`/users/${id}/reset-password`, {}),

  // Content
  getContent: (params?: { type?: string; status?: string; reported?: boolean; skip?: number; limit?: number }) =>
    adminApiClient.get('/content/', { params }),
  moderateContent: (id: string, action: string, reason?: string) => adminApiClient.post(`/content/${id}/moderate`, { action, reason }),

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
};

export default adminApi;
