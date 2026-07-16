import api from './client';

export interface AttentionActivity {
  id: string; user_id: string; category_id: string; category: string;
  activity_source: string; brain_side: string | null; description: string | null;
  start_time: string; end_time: string | null; actual_duration: number | null; source: string;
  metadata_url: string | null; metadata_app: string | null; metadata_title: string | null;
  completion_status: string; focus_score: number | null; focus_duration: number | null;
  focus_intensity: number | null; created_at: string;
}

export interface AttentionCategory {
  id: string; user_id: string; name: string; icon: string | null; color: string | null;
  brain_side: 'personal' | 'network' | 'both';
  allocated_minutes: number; min_required: number | null; max_allowed: number | null;
  priority: string; notify_at: number | null; used_minutes: number;
  created_at: string; updated_at: string;
}

export interface DeepWorkSession {
  id: string; user_id: string; brain_side: string; task: string; planned_duration: number;
  actual_duration: number | null; started_at: string | null; ended_at: string | null;
  focus_score_avg: number | null; interruptions: number; blocked_attempts: number;
  completion_status: string | null; end_reason: string | null;
}

export interface DeepWorkConfig {
  task: string; planned_duration: number; brain_side?: string; rules_block_notifications?: boolean;
  rules_blocked_websites?: string[]; rules_blocked_apps?: string[];
  rules_allowed_websites?: string[]; rules_ambient_sound?: string;
}

export interface AttentionStats {
  daily: {
    total_activities: number;
    total_focus_minutes: number;
    deep_work_sessions: number;
    interruptions: number;
  };
  weekly: Array<{ date: string; day: string; focus_minutes: number }>;
  categories: Array<{ key: string; name: string; color: string; minutes: number; count: number }>;
}

export interface AttentionScore {
  score: number;
  breakdown: {
    focus_duration_score: number;
    interruption_penalty: number;
    deep_work_score: number;
  };
  trend: Array<{ date: string; day: string; score: number }>;
}

export interface AttentionWeeklyReport {
  week_start: string;
  week_end: string;
  brain_side: string;
  total_focus_minutes: number;
  total_activities: number;
  deep_work_sessions: number;
  interruptions: number;
  average_focus_score: number;
  daily_trend: Array<{ date: string; day: string; focus_minutes: number }>;
  category_distribution: Array<{ key: string; name: string; color: string; minutes: number; count: number }>;
}

export interface AttentionGuardianRule {
  id: string; user_id: string; type: 'website' | 'app' | 'notification';
  target: string; mode: 'block' | 'limit'; limit_minutes: number | null;
  active: boolean; schedule_days: string | null; schedule_start: string | null;
  schedule_end: string | null; created_at: string; updated_at: string;
}

export interface AttentionRation {
  id: string; user_id: string; source_type: 'rss' | 'social' | 'email' | 'clip';
  source_id: string | null; name: string; daily_limit_minutes: number;
  used_minutes: number; active: boolean; created_at: string; updated_at: string;
}

export const attentionApi = {
  listActivities: (params?: { start?: string; end?: string }) =>
    api.get<AttentionActivity[]>('/api/v1/attention/activities', { params }),
  createActivity: (data: Partial<AttentionActivity>) =>
    api.post<AttentionActivity>('/api/v1/attention/activities', data),
  dashboard: (brainSide?: string) =>
    api.get('/api/v1/attention/dashboard', { params: brainSide && brainSide !== 'both' ? { brain_side: brainSide } : undefined }),
  stats: (brainSide?: string) =>
    api.get<AttentionStats>('/api/v1/attention/stats', { params: brainSide && brainSide !== 'both' ? { brain_side: brainSide } : undefined }),
  score: (brainSide?: string) =>
    api.get<AttentionScore>('/api/v1/attention/score', { params: brainSide && brainSide !== 'both' ? { brain_side: brainSide } : undefined }),
  weeklyReport: (brainSide?: string) =>
    api.get<AttentionWeeklyReport>('/api/v1/attention/weekly-report', { params: brainSide && brainSide !== 'both' ? { brain_side: brainSide } : undefined }),
  startDeepWork: (data: DeepWorkConfig) => api.post<DeepWorkSession>('/api/v1/attention/deep-work', data),
  pauseDeepWork: (id: string) => api.put(`/api/v1/attention/deep-work/${id}/pause`),
  resumeDeepWork: (id: string) => api.put(`/api/v1/attention/deep-work/${id}/resume`),
  endDeepWork: (id: string) => api.post(`/api/v1/attention/deep-work/${id}/end`),
  recordInterruption: (id: string, data: { reason: string }) =>
    api.post(`/api/v1/attention/deep-work/${id}/interruption`, data),
  listDeepWork: (brainSide?: string) =>
    api.get<DeepWorkSession[]>('/api/v1/attention/deep-work', { params: brainSide && brainSide !== 'both' ? { brain_side: brainSide } : undefined }),
  categories: () => api.get<AttentionCategory[]>('/api/v1/attention/categories'),
  createCategory: (data: Partial<AttentionCategory>) => api.post<AttentionCategory>('/api/v1/attention/categories', data),
  updateCategory: (id: string, data: Partial<AttentionCategory>) =>
    api.put<AttentionCategory>(`/api/v1/attention/categories/${id}`, data),
  deleteCategory: (id: string) => api.delete(`/api/v1/attention/categories/${id}`),
  listGuardianRules: () => api.get<AttentionGuardianRule[]>('/api/v1/attention/guardian-rules'),
  createGuardianRule: (data: Partial<AttentionGuardianRule>) =>
    api.post<AttentionGuardianRule>('/api/v1/attention/guardian-rules', data),
  updateGuardianRule: (id: string, data: Partial<AttentionGuardianRule>) =>
    api.put<AttentionGuardianRule>(`/api/v1/attention/guardian-rules/${id}`, data),
  deleteGuardianRule: (id: string) => api.delete(`/api/v1/attention/guardian-rules/${id}`),
  listRations: () => api.get<AttentionRation[]>('/api/v1/attention/rations'),
  createRation: (data: Partial<AttentionRation>) =>
    api.post<AttentionRation>('/api/v1/attention/rations', data),
  updateRation: (id: string, data: Partial<AttentionRation>) =>
    api.put<AttentionRation>(`/api/v1/attention/rations/${id}`, data),
  deleteRation: (id: string) => api.delete(`/api/v1/attention/rations/${id}`),
};
