import api from './client';

export interface UserSettings {
  ai?: {
    active_provider?: string;
    active_model?: string;
    model?: string;
    api_key?: string;
    temperature?: number;
    max_tokens?: number;
    local_enabled?: boolean;
    model_routing_enabled?: boolean;
    ollama_url?: string;
    ollama_model?: string;
    kimi_api_key?: string;
    deepseek_api_key?: string;
    opencode_api_key?: string;
  };
  privacy?: {
    localEncryption?: boolean;
    defaultPrivacyLevel?: 'public' | 'shared' | 'private';
  };
  sync?: {
    frequency?: 'realtime' | 'hourly' | 'daily' | 'manual';
    conflictStrategy?: 'local' | 'cloud' | 'latest' | 'manual';
    offlineMode?: boolean;
  };
  appearance?: {
    theme?: 'dark' | 'light' | 'system';
    fontSize?: 'small' | 'medium' | 'large';
  };
  plugins?: {
    enabled?: string[];
    disabled?: string[];
    registry?: PluginInfo[];
  };
}

export interface PluginInfo {
  id: string;
  name: string;
  description?: string;
  version?: string;
  enabled: boolean;
}

export interface ChangePasswordData {
  current_password: string;
  new_password: string;
}

export interface DeleteAccountData {
  password: string;
  confirmation: string;
}

export const settingsApi = {
  getSettings: () => api.get<UserSettings>('/api/v1/users/me/settings'),
  updateSettings: (data: Partial<UserSettings>) => api.put<UserSettings>('/api/v1/users/me/settings', data),
  updateProfile: (data: { name?: string; display_name?: string; username?: string }) =>
    api.patch('/api/v1/users/me', data),
  uploadAvatar: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post<{ avatar_url: string; filename: string }>('/api/v1/users/me/avatar', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  changePassword: (data: ChangePasswordData) => api.post('/api/v1/auth/change-password', data),
  deleteAccount: (data: DeleteAccountData) => api.delete('/api/v1/users/me/account', { data }),
  exportData: () => api.post<Blob>('/api/v1/users/me/export', null, { responseType: 'blob' }),
  clearData: () => api.delete('/api/v1/users/me/data'),
};
