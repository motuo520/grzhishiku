import api from './client';

export type BrainSide = 'personal' | 'network' | 'both';

export interface DepthCheckRequest {
  content: string;
  content_type?: string;
  content_id?: string;
  preferred_model?: string;
  use_ai?: boolean;
}

export interface DepthCheckResponse {
  depth_score: number;
  is_passed: boolean;
  feedback: string;
  suggestions: string[];
}

export interface DepthCheckLog {
  id: string;
  user_id: string;
  content_type: string;
  content_id?: string;
  content_preview?: string;
  depth_score: number;
  is_passed: boolean;
  feedback: string;
  suggestions: string[];
  model_used?: string;
  created_at: string;
}

export interface EvolutionReflection {
  id: string;
  user_id: string;
  title: string;
  discomfort_level: number;
  pain_description?: string;
  joy_description?: string;
  learning?: string;
  is_true_evolution: boolean;
  related_content_type?: 'note' | 'knowledge_unit' | 'experiment_log';
  related_content_id?: string;
  brain_side: string;
  created_at: string;
  updated_at: string;
}

export interface EvolutionReflectionCreate {
  title: string;
  discomfort_level?: number;
  pain_description?: string;
  joy_description?: string;
  learning?: string;
  is_true_evolution?: boolean;
  related_content_type?: 'note' | 'knowledge_unit' | 'experiment_log' | null;
  related_content_id?: string | null;
  brain_side?: string;
}

export interface EvolutionReflectionUpdate extends Partial<EvolutionReflectionCreate> {}

export interface EvolutionAnalysisRequest {
  brain_side?: BrainSide;
  preferred_model?: string;
}

export interface EvolutionAnalysisResponse {
  summary: string;
  true_evolution_ratio: number;
  patterns: string[];
  warnings: string[];
  next_steps: string[];
}

export interface MoodLocationItem {
  id: string;
  capsule_id: string;
  brain_side: string;
  sealed_at?: string;
  mood_emotion?: string;
  mood_intensity?: number;
  mood_energy_level?: number;
  mood_tags: string[];
  mood_trigger?: string;
  mood_weather?: string;
  mood_location?: string;
  content_preview?: string;
  created_at: string;
}

export interface MoodLocationStats {
  mood_distribution: Record<string, number>;
  location_distribution: Record<string, number>;
  total: number;
}

export interface MoodLocationResponse {
  items: MoodLocationItem[];
  stats: MoodLocationStats;
}

export const embodiedApi = {
  // Depth check
  depthCheck: (data: DepthCheckRequest) =>
    api.post<DepthCheckResponse>('/api/v1/embodied/depth-check', data),
  listDepthCheckLogs: (limit = 50) =>
    api.get<DepthCheckLog[]>('/api/v1/embodied/depth-check/logs', { params: { limit } }),

  // Evolution reflection
  listEvolutionReflections: (brainSide?: BrainSide) =>
    api.get<EvolutionReflection[]>('/api/v1/embodied/evolution-reflections', {
      params: brainSide && brainSide !== 'both' ? { brain_side: brainSide } : undefined,
    }),
  getEvolutionReflection: (id: string) =>
    api.get<EvolutionReflection>(`/api/v1/embodied/evolution-reflections/${id}`),
  createEvolutionReflection: (data: EvolutionReflectionCreate) =>
    api.post<EvolutionReflection>('/api/v1/embodied/evolution-reflections', data),
  updateEvolutionReflection: (id: string, data: EvolutionReflectionUpdate) =>
    api.put<EvolutionReflection>(`/api/v1/embodied/evolution-reflections/${id}`, data),
  deleteEvolutionReflection: (id: string) =>
    api.delete(`/api/v1/embodied/evolution-reflections/${id}`),
  analyzeEvolutionReflections: (brainSide?: BrainSide, preferred_model?: string) =>
    api.post<EvolutionAnalysisResponse>('/api/v1/embodied/evolution-reflections/analyze', {
      brain_side: brainSide,
      preferred_model,
    }),

  // Mood & location
  getMoodLocation: (brainSide?: BrainSide, limit = 50) =>
    api.get<MoodLocationResponse>('/api/v1/embodied/mood-location', {
      params: { ...(brainSide && brainSide !== 'both' ? { brain_side: brainSide } : {}), limit },
    }),
};
