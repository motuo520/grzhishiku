import api from './client';

export interface PracticeRecord {
  id: string;
  user_id: string;
  target_type: 'note' | 'knowledge_unit';
  target_id: string;
  practice_type: 'applied' | 'taught' | 'iterated' | 'failed' | 'observed';
  description: string;
  result?: string;
  learned_lesson?: string;
  context_snapshot?: string;
  created_at: string;
  updated_at: string;
}

export interface PracticeRecordCreateData {
  target_type: 'note' | 'knowledge_unit';
  target_id: string;
  practice_type: 'applied' | 'taught' | 'iterated' | 'failed' | 'observed';
  description: string;
  result?: string;
  learned_lesson?: string;
  context_snapshot?: string;
}

export interface DailyReview {
  id: string;
  user_id: string;
  review_date: string;
  content_summary?: string;
  ai_reflection?: string;
  gaps_found: string[];
  action_items: string[];
  praise_items: string[];
  status: 'pending' | 'generated' | 'reviewed' | 'archived';
  created_at: string;
  updated_at: string;
}

export interface RelevanceCheckRequest {
  content: string;
  content_type?: string;
  user_context_summary?: string;
  brain_side?: string;
}

export interface RelevanceCheckResponse {
  personal_relevance_score: number;
  reason: string;
  connection_evidence?: string;
  first_action?: string;
  suggested_action: 'import' | 'import_with_practice' | 'read_later' | 'ignore';
}

export interface EvolutionDistribution {
  collected: number;
  understood: number;
  practiced: number;
  validated: number;
  internalized: number;
}

export interface KnowledgeHealthResponse {
  total_items: number;
  evolution_distribution: EvolutionDistribution;
  avg_practice_depth: number;
  avg_invoke_count: number;
  high_value_items: number;
  zombie_items: number;
  daily_active_rate: number;
  value_score_total: number;
  health_score: number;
}

export interface ContextGuide {
  id: string;
  user_id: string;
  title: string;
  content: string;
  scope: 'personal' | 'network' | 'both';
  is_active: boolean;
  version_tag?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContextGuideCreateData {
  title: string;
  content: string;
  scope?: 'personal' | 'network' | 'both';
  is_active?: boolean;
  version_tag?: string;
}

export interface ContextGuideUpdateData {
  title?: string;
  content?: string;
  scope?: 'personal' | 'network' | 'both';
  is_active?: boolean;
  version_tag?: string;
}

export interface CognitivePotentialItem {
  content_id: string;
  content_type: 'note' | 'knowledge_unit';
  title: string;
  score: number;
  reason: string;
  suggested_action: string;
}

export interface CognitivePotentialResponse {
  summary: string;
  sinkable: CognitivePotentialItem[];
  outputable: CognitivePotentialItem[];
  monetizable: CognitivePotentialItem[];
  analyzed_at?: string | null;
  model_used?: string | null;
}

export interface ExperimentLog {
  id: string;
  user_id: string;
  title: string;
  hypothesis: string;
  controlled_variable?: string | null;
  expected_result?: string | null;
  actual_result?: string | null;
  conclusion?: string | null;
  status: 'planned' | 'running' | 'completed' | 'abandoned';
  related_content_type?: 'note' | 'knowledge_unit' | null;
  related_content_id?: string | null;
  brain_side: string;
  created_at: string;
  updated_at: string;
}

export interface ExperimentLogCreateData {
  title: string;
  hypothesis: string;
  controlled_variable?: string;
  expected_result?: string;
  actual_result?: string;
  conclusion?: string;
  status?: 'planned' | 'running' | 'completed' | 'abandoned';
  related_content_type?: 'note' | 'knowledge_unit' | null;
  related_content_id?: string | null;
  brain_side?: string;
}

export interface ExperimentLogUpdateData {
  title?: string;
  hypothesis?: string;
  controlled_variable?: string;
  expected_result?: string;
  actual_result?: string;
  conclusion?: string;
  status?: 'planned' | 'running' | 'completed' | 'abandoned';
  related_content_type?: 'note' | 'knowledge_unit' | null;
  related_content_id?: string | null;
  brain_side?: string;
}

export interface EvolutionTransition {
  id: string;
  content_type: 'note' | 'knowledge_unit';
  content_id: string;
  // 内容已删除时后端返回 null
  title: string | null;
  from_stage: string;
  to_stage: string;
  trigger: 'practice' | 'manual';
  created_at: string;
}

export const jianghuApi = {
  // Practice records
  listPracticeRecords: (params?: { target_type?: string; target_id?: string; practice_type?: string; brain_side?: string; limit?: number; offset?: number }) =>
    api.get<PracticeRecord[]>('/api/v1/jianghu/practice-records', { params }),
  createPracticeRecord: (data: PracticeRecordCreateData) =>
    api.post<PracticeRecord>('/api/v1/jianghu/practice-records', data),
  getPracticeRecord: (id: string) => api.get<PracticeRecord>(`/api/v1/jianghu/practice-records/${id}`),
  updatePracticeRecord: (id: string, data: PracticeRecordCreateData) =>
    api.put<PracticeRecord>(`/api/v1/jianghu/practice-records/${id}`, data),
  deletePracticeRecord: (id: string) => api.delete(`/api/v1/jianghu/practice-records/${id}`),

  // Daily reviews
  generateDailyReview: (
    data?: { review_date?: string; include_attention?: boolean; include_notes?: boolean; include_knowledge?: boolean; brain_side?: string },
    preferred_model?: string
  ) =>
    api.post<DailyReview>('/api/v1/jianghu/daily-reviews/generate', { ...(data || {}), preferred_model }),
  listDailyReviews: (params?: { status?: string; limit?: number; offset?: number }) =>
    api.get<DailyReview[]>('/api/v1/jianghu/daily-reviews', { params }),
  getDailyReview: (id: string) => api.get<DailyReview>(`/api/v1/jianghu/daily-reviews/${id}`),
  updateDailyReview: (id: string, data: Partial<DailyReview>) =>
    api.put<DailyReview>(`/api/v1/jianghu/daily-reviews/${id}`, data),

  // Relevance & health
  checkRelevance: (data: RelevanceCheckRequest, preferred_model?: string) =>
    api.post<RelevanceCheckResponse>('/api/v1/jianghu/relevance-check', { ...data, preferred_model }),
  getKnowledgeHealth: (brain_side?: string) => api.get<KnowledgeHealthResponse>('/api/v1/jianghu/knowledge-health', { params: { brain_side } }),
  // 最近的进化阶段跃迁记录（知识自进化线）
  listEvolutionTransitions: (limit = 50) =>
    api.get<EvolutionTransition[]>('/api/v1/jianghu/evolution-transitions', { params: { limit } }),

  // Context guides
  listContextGuides: (is_active?: boolean) =>
    api.get<ContextGuide[]>('/api/v1/jianghu/context-guides', { params: is_active !== undefined ? { is_active } : undefined }),
  createContextGuide: (data: ContextGuideCreateData) =>
    api.post<ContextGuide>('/api/v1/jianghu/context-guides', data),
  getContextGuide: (id: string) => api.get<ContextGuide>(`/api/v1/jianghu/context-guides/${id}`),
  updateContextGuide: (id: string, data: ContextGuideUpdateData) =>
    api.put<ContextGuide>(`/api/v1/jianghu/context-guides/${id}`, data),
  deleteContextGuide: (id: string) => api.delete(`/api/v1/jianghu/context-guides/${id}`),
  generateContextGuide: (data?: { brain_side?: string; preferred_model?: string; title?: string }) =>
    api.post<ContextGuide>('/api/v1/jianghu/context-guides/generate', data || {}),
  analyzeCognitivePotential: (data?: { brain_side?: string; preferred_model?: string }) =>
    api.post<CognitivePotentialResponse>('/api/v1/jianghu/cognitive-potential', data || {}),
  // 最近一次已保存的分析（免费读；404=还没有结果，由调用方归一为 null）
  getCognitivePotentialLatest: (brainSide: string) =>
    api.get<CognitivePotentialResponse>('/api/v1/jianghu/cognitive-potential/latest', { params: { brain_side: brainSide } })
      .then((r) => r.data)
      .catch((err: any) => {
        if (err?.status === 404) return null;
        throw err;
      }),

  // Experiment logs
  listExperimentLogs: (params?: { status?: string; brain_side?: string }) =>
    api.get<ExperimentLog[]>('/api/v1/jianghu/experiment-logs', { params }),
  createExperimentLog: (data: ExperimentLogCreateData) =>
    api.post<ExperimentLog>('/api/v1/jianghu/experiment-logs', data),
  getExperimentLog: (id: string) => api.get<ExperimentLog>(`/api/v1/jianghu/experiment-logs/${id}`),
  updateExperimentLog: (id: string, data: ExperimentLogUpdateData) =>
    api.put<ExperimentLog>(`/api/v1/jianghu/experiment-logs/${id}`, data),
  deleteExperimentLog: (id: string) => api.delete(`/api/v1/jianghu/experiment-logs/${id}`),
};
