import api from './client';

export interface DataPackage {
  id: string;
  filename: string;
  file_size: number;
  status: 'pending' | 'ready' | 'failed' | 'uploaded';
  provider?: string;
  remote_path?: string;
  error_message?: string;
  created_at?: string;
  updated_at?: string;
}

export interface CloudDrive {
  id: string;
  provider: 'baidu' | 'aliyun';
  account_name?: string;
  scope?: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface AuthUrlResponse {
  url: string;
}

export interface UploadResult {
  success: boolean;
  package: DataPackage;
}

export const storageApi = {
  listPackages: () => api.get<DataPackage[]>('/api/v1/storage/packages'),
  createPackage: () => api.post<DataPackage>('/api/v1/storage/packages'),
  downloadPackage: (packageId: string) =>
    api.get(`/api/v1/storage/packages/${packageId}/download`, { responseType: 'blob' }),
  deletePackage: (packageId: string) =>
    api.delete(`/api/v1/storage/packages/${packageId}`),

  listDrives: () => api.get<CloudDrive[]>('/api/v1/storage/drives'),
  getAuthUrl: (provider: string) =>
    api.get<AuthUrlResponse>(`/api/v1/storage/drives/${provider}/auth-url`),
  disconnectDrive: (provider: string) =>
    api.delete(`/api/v1/storage/drives/${provider}`),
  uploadToDrive: (provider: string, packageId: string) =>
    api.post<UploadResult>(`/api/v1/storage/drives/${provider}/upload/${packageId}`),
};
