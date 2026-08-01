/**
 * 统一同步 API：直连本实例后端。
 */
import api from './client';
import type { SyncDevice, SyncOperation, Snapshot, SyncOperationInput } from './sync';
import { getFingerprint } from './sync';

const BASE = '/api/v1';

// ---------- 同步原语 ----------

export const unifiedSyncApi = {
  registerDevice: (name: string) =>
    api.post<SyncDevice>(`${BASE}/sync/devices`, { name, fingerprint: getFingerprint() }),

  listDevices: () => api.get<SyncDevice[]>(`${BASE}/sync/devices`),

  removeDevice: (deviceId: string) => api.delete(`${BASE}/sync/devices/${deviceId}`),

  pushOperations: (ops: SyncOperationInput[]) =>
    api.post<SyncOperation[]>(`${BASE}/sync/operations`, ops, {
      params: { fingerprint: getFingerprint() },
    }),

  uploadSnapshot: (formData: FormData) =>
    api.post<Snapshot>(`${BASE}/sync/snapshots`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),

  getLatestSnapshot: () => api.get<Snapshot | null>(`${BASE}/sync/snapshots/latest`),

  /** 经后端下载最新快照密文（返回 JSON 字符串，调用方自行 parse） */
  downloadLatestSnapshot: () =>
    api.get<string>(`${BASE}/sync/snapshots/latest/download`, { responseType: 'text' }),

  exportJson: () => api.post<{ total_records: number; data: Record<string, unknown[]> }>(`${BASE}/users/me/export`),

  importJson: (payload: unknown) =>
    api.post<{ success: boolean; inserted: number; updated: number; skipped: number }>(
      `${BASE}/users/me/import`,
      payload
    ),
};

export { getFingerprint };
