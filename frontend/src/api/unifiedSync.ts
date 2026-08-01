/**
 * 统一同步 API：网页端直连本实例；桌面端（Electron）经本地后端的
 * cloud-proxy 转发到绑定的云端服务器（只搬密文，E2E 语义不破）。
 */
import api from './client';
import type { SyncDevice, SyncOperation, Snapshot, SyncOperationInput } from './sync';
import { getFingerprint } from './sync';

export const isDesktop = (): boolean => Boolean((window as any).psbDesktop?.isDesktop);

/** 桌面端走本地代理转发到云端，网页端直连 */
const base = () => (isDesktop() ? '/api/v1/cloud-proxy/forward' : '/api/v1');

// ---------- 云端绑定状态（localStorage 标记，供同步读取） ----------

const CLOUD_BOUND_KEY = 'psb-cloud-bound';

export const markCloudBound = (bound: boolean) => {
  if (bound) localStorage.setItem(CLOUD_BOUND_KEY, '1');
  else localStorage.removeItem(CLOUD_BOUND_KEY);
};

export const cloudBound = (): boolean =>
  isDesktop() && localStorage.getItem(CLOUD_BOUND_KEY) === '1';

/** LLM 调用的 base：桌面端已绑定云端时走云端（用云端账号的模型），否则走本地 */
export const llmBase = () =>
  cloudBound() ? '/api/v1/cloud-proxy/forward' : '/api/v1';

// ---------- 云账号绑定（仅桌面端使用；存于本地后端数据目录） ----------

export interface CloudAccount {
  server_url: string;
  email: string;
  tier?: string;
}

export const cloudAccountApi = {
  login: (serverUrl: string, email: string, password: string) =>
    api.post<{ success: boolean; email: string }>('/api/v1/cloud-proxy/login', {
      server_url: serverUrl,
      email,
      password,
    }),
  status: () => api.get<{ bound: boolean; account?: CloudAccount }>('/api/v1/cloud-proxy/status'),
  logout: () => api.post('/api/v1/cloud-proxy/logout'),
};

// ---------- 同步原语（自动选路） ----------

export const unifiedSyncApi = {
  registerDevice: (name: string) =>
    api.post<SyncDevice>(`${base()}/sync/devices`, { name, fingerprint: getFingerprint() }),

  listDevices: () => api.get<SyncDevice[]>(`${base()}/sync/devices`),

  removeDevice: (deviceId: string) => api.delete(`${base()}/sync/devices/${deviceId}`),

  pushOperations: (ops: SyncOperationInput[]) =>
    api.post<SyncOperation[]>(`${base()}/sync/operations`, ops, {
      params: { fingerprint: getFingerprint() },
    }),

  uploadSnapshot: (formData: FormData) =>
    api.post<Snapshot>(`${base()}/sync/snapshots`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),

  getLatestSnapshot: () => api.get<Snapshot | null>(`${base()}/sync/snapshots/latest`),

  /** 经后端下载最新快照密文（返回 JSON 字符串，调用方自行 parse） */
  downloadLatestSnapshot: () =>
    api.get<string>(`${base()}/sync/snapshots/latest/download`, { responseType: 'text' }),

  exportJson: () => api.post<{ total_records: number; data: Record<string, unknown[]> }>(`${base()}/users/me/export`),

  importJson: (payload: unknown) =>
    api.post<{ success: boolean; inserted: number; updated: number; skipped: number }>(
      `${base()}/users/me/import`,
      payload
    ),
};

export { getFingerprint };
