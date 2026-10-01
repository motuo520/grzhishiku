import api from './client';

export interface Folder {
  id: string;
  user_id: string;
  tenant_id?: string | null;
  brain_side: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
  // 自动归档规则：{"tags": [...], "subtypes": [...], "verification": [...]}；null=用户领地
  auto_rules?: { tags?: string[]; subtypes?: string[]; verification?: string[] } | null;
  // 目录级权限（10-01）：inherit/private/restricted；缺省=inherit（后端旧版不透出时前端等同继承）
  visibility?: FolderVisibility;
  note_count: number;
  knowledge_count: number;
  clip_count: number;
  document_count: number;
  created_at: string;
  updated_at: string;
}

export interface FolderCreateData {
  name: string;
  brain_side: string;
  parent_id?: string | null;
  sort_order?: number;
}

export interface FolderUpdateData {
  name?: string;
  parent_id?: string | null;
  sort_order?: number;
  auto_rules?: { tags?: string[]; subtypes?: string[]; verification?: string[] } | null;
}

// 目录级权限（10-01 立项批 D）：visibility + 授权清单。仅团队空间有意义
// （个人空间调用后端 400，前端入口只在 activeTenant 非空时露出）
export type FolderVisibility = 'inherit' | 'private' | 'restricted';

export interface FolderShare {
  grantee_type: 'user' | 'group';
  grantee_id: string;
  // 透出解析字段（以 get_folder_shares 现码为准）：user→email+name，group→name；对象已删为 null
  email?: string | null;
  name?: string | null;
}

export interface FolderSharesData {
  id: string;
  visibility: FolderVisibility;
  shares: FolderShare[];
}

export interface FolderVisibilityUpdateData {
  visibility: FolderVisibility;
  // 全量替换语义：restricted 时为本夹新授权清单；非 restricted 忽略并清空授权行
  shares: { grantee_type: 'user' | 'group'; grantee_id: string }[];
}

export const foldersApi = {
  list: (brainSide: string) => api.get<Folder[]>('/api/v1/folders/', { params: { brain_side: brainSide } }),
  create: (data: FolderCreateData) => api.post<Folder>('/api/v1/folders/', data),
  update: (id: string, data: FolderUpdateData) => api.put<Folder>(`/api/v1/folders/${id}`, data),
  remove: (id: string) => api.delete<{ success: boolean }>(`/api/v1/folders/${id}`),
  // 建默认目录树（两脑各一套，幂等）
  seedDefaults: () => api.post<{ ok: boolean; created: number }>('/api/v1/folders/seed-defaults'),
  // 目录级权限：设置可见性并全量替换授权清单（夹创建者或租户 owner/admin）
  setVisibility: (id: string, data: FolderVisibilityUpdateData) =>
    api.put<FolderSharesData>(`/api/v1/folders/${id}/visibility`, data),
  getShares: (id: string) => api.get<FolderSharesData>(`/api/v1/folders/${id}/shares`),
};
