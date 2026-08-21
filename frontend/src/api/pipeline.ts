import api from './client';

export interface PipelineStats {
  raw: number;
  card: number;
  extracted: number;
  collided: number;
  approved: number;
  today: {
    new_cards: number;
    new_concepts: number;
    new_collisions: number;
  };
  by_brain_side: Record<string, Record<'personal' | 'network' | 'both', number>>;
}

export interface PipelineItem {
  id: string;
  content_type: 'note' | 'knowledge' | 'clip' | 'rss' | 'read_later' | 'document';
  content_id: string;
  content_subtype?: string | null;
  title?: string | null;
  content_raw: string;
  content_processed?: string | null;
  brain_side: 'personal' | 'network' | 'both';
  pipeline_stage: string;
  source_url?: string | null;
  source_title?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface ExtractConcept {
  id: string;
  concept: string;
  definition: string;
  existing: boolean;
}

export interface ExtractResponse {
  source_id: string;
  source_content_type: string;
  concepts: ExtractConcept[];
}

export interface CollisionResponse {
  collision_id: string;
  concept_a: string;
  concept_b: string;
  similarity: number;
  insight: string;
  derivation: string;
}

export interface ReviewResponse {
  collision_id: string;
  action: 'approve' | 'reject';
  new_stage: string;
}

export interface PipelineTransition {
  id: string;
  content_type: string;
  content_id: string;
  from_stage: string;
  to_stage: string;
  brain_side_before?: string | null;
  brain_side_after?: string | null;
  action: string;
  created_at: string;
}

export interface ConvertBrainSideResponse {
  content_type: string;
  content_id: string;
  brain_side: string;
  previous_brain_side: string;
}

export const pipelineApi = {
  stats: (brain_side?: 'personal' | 'network' | 'both') =>
    api.get<PipelineStats>('/api/v1/pipeline/stats', { params: brain_side ? { brain_side } : undefined }),

  items: (stage: string, brain_side?: 'personal' | 'network' | 'both', limit?: number) =>
    api.get<PipelineItem[]>('/api/v1/pipeline/items', {
      params: { stage, ...(brain_side ? { brain_side } : {}), ...(limit ? { limit } : {}) },
    }),

  transitionStage: (content_type: string, content_id: string, stage: string) =>
    api.post(`/api/v1/pipeline/${content_type}/${content_id}/stage`, { stage }),

  extract: (content_type: string, content_id: string, preferred_model?: string) =>
    // Extraction runs an LLM call that can take well over the default 30s
    // (plus a provider fallback), so allow a longer per-request timeout.
    api.post<ExtractResponse>(`/api/v1/pipeline/${content_type}/${content_id}/extract`, { preferred_model }, { timeout: 120000 }),

  collide: (concept_id: string, preferred_model?: string) =>
    api.post<CollisionResponse>('/api/v1/pipeline/concepts/collide', { concept_id, preferred_model }, { timeout: 120000 }),

  reviewCollision: (collision_id: string, action: 'approve' | 'reject', feedback?: string) =>
    api.post<ReviewResponse>(`/api/v1/pipeline/collisions/${collision_id}/review`, { action, feedback }),

  history: (content_type: string, content_id: string) =>
    api.get<PipelineTransition[]>(`/api/v1/pipeline/${content_type}/${content_id}/history`),

  convertBrainSide: (content_type: string, content_id: string, target_brain_side: 'personal' | 'network', reason?: string) =>
    api.post<ConvertBrainSideResponse>(`/api/v1/pipeline/${content_type}/${content_id}/convert-brain-side`, {
      target_brain_side,
      reason,
    }),

  revert: (content_type: string, content_id: string) =>
    api.post(`/api/v1/pipeline/${content_type}/${content_id}/revert`),

  // Delete a pipeline item via the pipeline endpoint so external source items are restored.
  remove: (content_type: string, content_id: string) =>
    api.delete(`/api/v1/pipeline/${content_type}/${content_id}`),
};
