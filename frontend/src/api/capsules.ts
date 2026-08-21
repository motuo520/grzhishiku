import api from './client';

export interface Capsule {
  id: string; user_id: string; brain_side: string; content_type: string;
  content_body: string; content_attachments: string | null; mood_emotion: string | null;
  mood_intensity: number | null; mood_energy_level: number | null; mood_tags: string | null;
  sealed_at: string | null; sealed_fingerprint: string | null;
  unlock_type: string; unlock_config: string; unlock_status: string; is_unlocked: boolean;
  privacy_level: string; privacy_require_auth: boolean; privacy_allow_export: boolean;
  created_at: string; updated_at: string;
}

export interface CapsuleCreateData {
  content_type: string; content_body: string; content_attachments?: any[]; brain_side?: string;
  mood_emotion?: string; mood_intensity?: number; mood_energy_level?: number;
  mood_tags?: string[]; unlock_type: string; unlock_config: Record<string, any>;
  privacy_level?: string; privacy_require_auth?: boolean; privacy_allow_export?: boolean;
}

export interface CapsuleStats {
  personal: { total: number; locked: number; unlocked: number; opened: number; unlock_rate: number };
  network: { total: number; locked: number; unlocked: number; opened: number; unlock_rate: number };
  both: { total: number; locked: number; unlocked: number; opened: number; unlock_rate: number };
}

export interface CapsuleDialogueMessage {
  role: string; content: string; timestamp: string; is_cross_time?: boolean;
}

export interface CapsuleDialogueResponse {
  id: string; capsule_id: string; opened_at: string | null; opened_by: string;
  present_context: string | null; present_mood: string | null; present_reflection: string | null;
  conversation: string | null; messages?: CapsuleDialogueMessage[];
  insights_pattern: string | null; insights_growth: string | null;
  insights_warning: string | null; insights_suggestion: string | null;
  closed_at: string | null; closure: string | null;
}

export const capsulesApi = {
  list: (brainSide?: string) =>
    api.get<Capsule[]>('/api/v1/capsules/', { params: brainSide && brainSide !== 'both' ? { brain_side: brainSide } : undefined }),
  create: (data: CapsuleCreateData) => api.post<Capsule>('/api/v1/capsules/', data),
  get: (id: string) => api.get<Capsule>(`/api/v1/capsules/${id}`),
  delete: (id: string) => api.delete(`/api/v1/capsules/${id}`),
  batchDelete: (ids: string[]) => api.request({ method: 'DELETE', url: '/api/v1/capsules/batch', data: { ids } }),
  unlock: (id: string) => api.post(`/api/v1/capsules/${id}/unlock`),
  collect: (id: string) => api.post<Capsule>(`/api/v1/capsules/${id}/collect`),
  dialogue: (id: string, data: { message: string; present_context?: any; present_mood?: any; preferred_model?: string }) =>
    api.post<CapsuleDialogueResponse>(`/api/v1/capsules/${id}/dialogue`, data),
  getDialogue: (id: string) =>
    api.get<CapsuleDialogueResponse>(`/api/v1/capsules/${id}/dialogue`),
  stats: () => api.get<CapsuleStats>('/api/v1/capsules/stats'),
  plaza: () => api.get<Capsule[]>('/api/v1/capsules/plaza'),
  schedule: (brainSide?: string) =>
    api.get<Capsule[]>('/api/v1/capsules/schedule', { params: brainSide && brainSide !== 'both' ? { brain_side: brainSide } : undefined }),
};
