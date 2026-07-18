import api from './client';

export interface SyncDevice {
  id: string;
  name: string;
  fingerprint: string;
  last_seen_at: string;
  last_sync_at?: string;
  created_at: string;
}

export interface SyncOperation {
  id: string;
  device_id: string;
  entity_type: string;
  entity_id: string;
  op_type: 'create' | 'update' | 'delete';
  op_timestamp: string;
  checksum: string;
  created_at: string;
}

export interface SyncOperationInput {
  entity_type: string;
  entity_id: string;
  op_type: 'create' | 'update' | 'delete';
  op_timestamp: string;
  checksum: string;
}

export interface Snapshot {
  id: string;
  device_id: string;
  s3_key: string;
  size_bytes: number;
  salt: string;
  iv: string;
  entity_count: number;
  download_url: string;
  created_at: string;
}

export interface RegisterDeviceInput {
  name: string;
  fingerprint: string;
}

function getFingerprint(): string {
  const key = 'psb-sync-fingerprint';
  let fp = localStorage.getItem(key);
  if (!fp) {
    fp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(key, fp);
  }
  return fp;
}

export const syncApi = {
  registerDevice: (data: RegisterDeviceInput) =>
    api.post<SyncDevice>('/api/v1/sync/devices', data),

  listDevices: () => api.get<SyncDevice[]>('/api/v1/sync/devices'),

  removeDevice: (deviceId: string) =>
    api.delete(`/api/v1/sync/devices/${deviceId}`),

  pushOperations: (ops: SyncOperationInput[]) =>
    api.post<SyncOperation[]>('/api/v1/sync/operations', ops, {
      params: { fingerprint: getFingerprint() },
    }),

  getPendingOperations: (since?: string) =>
    api.get<SyncOperation[]>('/api/v1/sync/operations', {
      params: { fingerprint: getFingerprint(), since },
    }),

  uploadSnapshot: (formData: FormData) =>
    api.post<Snapshot>('/api/v1/sync/snapshots', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),

  getLatestSnapshot: () => api.get<Snapshot | null>('/api/v1/sync/snapshots/latest'),
};

export { getFingerprint };
