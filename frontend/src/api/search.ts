import api from './client';
import type { BrainSide } from './brain';

export interface FusionSearchResult {
  id: string;
  type: string;
  title: string;
  brain_side: BrainSide;
  content: string;
  relevance_score: number;
  source_url: string | null;
  created_at: string;
}

export interface SearchSuggestion {
  text: string;
  type: string;
  id: string;
}

export const searchApi = {
  fusionSearch: (query: string, brain_sides?: BrainSide[], limit?: number, offset?: number) =>
    api.post('/api/v1/brain/fusion-search', { query, brain_sides, limit: limit ?? 20, offset: offset ?? 0 }),
  suggestions: (q?: string, limit?: number) =>
    api.get('/api/v1/brain/search/suggestions', { params: { q, limit: limit ?? 10 } }),
};
