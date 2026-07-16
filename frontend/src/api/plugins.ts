import api from './client';

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  type: 'builtin' | 'local';
  enabled: boolean;
  config: Record<string, any>;
  config_schema?: Record<string, any> | null;
}

export interface AutoSyncConfig {
  enabled: boolean;
  interval_minutes: number;
  last_sync_at?: string;
  last_sync_error?: string;
}

export interface AutoSyncStatus {
  plugin_id: string;
  auto_sync: AutoSyncConfig;
  last_sync_at: string | null;
  next_run_at: string | null;
  has_credentials: boolean;
}

export const pluginsApi = {
  list: () => api.get<PluginInfo[]>('/api/v1/plugins'),

  enable: (id: string, enabled: boolean) =>
    api.post(`/api/v1/plugins/${id}/enable`, { enabled }),

  configure: (id: string, config: Record<string, any>) =>
    api.put(`/api/v1/plugins/${id}/config`, { config }),

  getAutoSync: (id: string) =>
    api.get<AutoSyncStatus>(`/api/v1/plugins/${id}/sync/config`),

  setAutoSync: (id: string, autoSync: AutoSyncConfig) =>
    api.post<AutoSyncStatus>(`/api/v1/plugins/${id}/sync/config`, autoSync),

  triggerSync: (id: string) =>
    api.post<{ plugin_id: string; created: number; skipped: number; last_sync_at?: string }>(
      `/api/v1/plugins/${id}/sync/trigger`
    ),
};
