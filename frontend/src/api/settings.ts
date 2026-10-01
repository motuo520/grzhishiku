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
    byok_enabled?: boolean;
    byok_keys?: Record<string, string>;
    byok_models?: Record<string, string[]>;
    byok_custom_url?: string;
    disabled_models?: string[];
    auto_tag?: boolean;
    // 自动打标模型：ollama 原始模型名（本机已安装的本地模型），空/缺省 = 默认 qwen3.5:0.8b
    auto_tag_model?: string;
    ollama_url?: string;
    ollama_model?: string;
    kimi_api_key?: string;
    deepseek_api_key?: string;
    opencode_api_key?: string;
    glm_api_key?: string;
    dashscope_api_key?: string;
    openai_api_key?: string;
    anthropic_api_key?: string;
    google_api_key?: string;
  };
  privacy?: {
    localEncryption?: boolean;
    defaultPrivacyLevel?: 'public' | 'shared' | 'private';
  };
  sync?: {
    auto_sync?: boolean;
    // 云端下拉（明文单向通道：云端主库 → 本机），默认开
    down_sync_enabled?: boolean;
    // 历史遗留键（已不再有 UI 消费，保留仅作数据兼容，不删用户数据）
    frequency?: 'realtime' | 'hourly' | 'daily' | 'manual';
    conflictStrategy?: 'local' | 'cloud' | 'latest' | 'manual';
    offlineMode?: boolean;
  };
  appearance?: {
    theme?: 'dark' | 'light' | 'system';
    fontSize?: 'small' | 'medium' | 'large';
  };
  // 来源追溯页：用户手动信誉档覆盖 {域名: 'trusted'|'normal'|'review'}
  source_tiers?: Record<string, string>;
  // 百科页「不看重」标记（09-16）：{topics: ['tag:{id}'...], entries: ['{entry_id}'...]}
  // 后端 dict 浅合并——每次发某个子键的全量列表（整单替换，非增量）
  wiki_dismissed?: { topics?: string[]; entries?: string[] };
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
  // 全量数据包合并导入（/me/export 产物）：按 id 合并、新者胜、不删本地数据
  importData: (payload: any) =>
    api.post<{ success: boolean; inserted: number; updated: number; skipped: number }>('/api/v1/users/me/import', payload),
  clearData: () => api.delete('/api/v1/users/me/data'),
};
