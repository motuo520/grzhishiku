import api from './client';

export type BrainSide = 'personal' | 'network' | 'both' | 'unknown';

export interface BrainStatus {
  active_brain: BrainSide; personal_count: number; network_count: number;
  both_count: number; total_items: number;
  /** 未归档条数（文件夹外内容），Dashboard 行动页「N 条待整理」用 */
  unfiled_count: number;
}

export interface FusionSearchResult {
  id: string; type: string; title: string; brain_side: BrainSide;
  content: string; relevance_score: number; source_url: string | null; created_at: string;
}

export interface BrainStats {
  notes?: number; capsules?: number; tags?: number; total_chars?: number;
  clips?: number; knowledge?: number; domains?: number; verified?: number;
  cross_brain_links?: number; fusion_ratio?: number; collaboration_count?: number;
}

export interface BrainStatsResponse {
  personal: BrainStats;
  network: BrainStats;
  fusion: BrainStats;
}

export interface FusionSearchResponse {
  results: FusionSearchResult[];
  total: number;
  query: string;
  brain_sides: BrainSide[];
}

export const brainApi = {
  status: () => api.get<BrainStatus>('/api/v1/brain/status'),
  switch: (target_brain: BrainSide) => api.post<BrainStatus>('/api/v1/brain/switch', { target_brain }),
  stats: () => api.get<BrainStatsResponse>('/api/v1/brain/stats'),
  fusionSearch: (query: string, brain_sides?: BrainSide[], origin?: 'user') =>
    api.post<FusionSearchResponse>('/api/v1/brain/fusion-search', { query, brain_sides, ...(origin ? { origin } : {}) }),
};
