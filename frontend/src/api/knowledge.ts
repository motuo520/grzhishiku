import api from './client';
import type { KnowledgeUnit, CounterEvidenceItem, KnowledgeSourcesResponse, SourceCredibilityResponse } from '@/types';

export interface KnowledgeCreateData {
  content_raw: string;
  brain_side?: 'personal' | 'network';
  content_type?: string;
  source_url?: string;
  source_title?: string;
  source_type?: string;
  source_author?: string;
  source_publish_date?: string;
  source_credibility_score?: number;
  source_bias_indicator?: string;
  source_funding_source?: string;
}

export interface KnowledgeUpdateData {
  content_raw?: string;
  content_processed?: string;
  brain_side?: 'personal' | 'network' | 'both';
  content_type?: string;
  source_url?: string;
  source_title?: string;
  source_type?: string;
  source_author?: string;
  source_publish_date?: string;
  source_credibility_score?: number;
  source_bias_indicator?: string;
  source_funding_source?: string;
  tags?: string[];
  origin_type?: string;
  practice_depth?: number;
  personal_relevance_score?: number;
  evolution_stage?: string;
  pipeline_stage?: string;
  content_subtype?: string;
  // 显式传 null = 移出文件夹（未归档）
  folder_id?: string | null;
}

export interface KnowledgeSourceAggregate {
  domain: string;
  count: number;
  avg_verification_consensus: number;
  avg_source_credibility: number;
  reputation: string;
  factors: string[];
}

export interface SideStats {
  total: number;
  verified: number;
  disputed: number;
  debunked: number;
  unverified: number;
  checking: number;
  outdated: number;
  average_confidence: number;
}

export interface KnowledgeStatsResponse {
  personal: SideStats;
  network: SideStats;
  both: SideStats;
}

export interface VerifyResponse {
  unit_id: string;
  status: string;
  consensus: number;
  confidence: number;
  bias_indicators: string[];
  source_reliability: number;
  verdict: string;
  verification_history: Array<{
    timestamp: string;
    verdict: string;
    confidence: number;
    bias_indicators: string[];
    source_reliability: number;
    note?: string;
  }>;
}

export const knowledgeApi = {
  list: (params?: {
    status?: string;
    brain_side?: string;
    q?: string;
    evolution_stage?: string;
    origin_type?: string;
    min_relevance?: number;
    folder_id?: string;
    content_subtype?: string;
    tag_ids?: string;
    sort_by?: string;
    sort_order?: string;
  }) => api.get<KnowledgeUnit[]>('/api/v1/knowledge/', { params }),
  create: (data: KnowledgeCreateData) => api.post<KnowledgeUnit>('/api/v1/knowledge/', data),
  get: (id: string) => api.get<KnowledgeUnit>(`/api/v1/knowledge/${id}`),
  delete: (id: string) => api.delete(`/api/v1/knowledge/${id}`),
  update: (id: string, data: KnowledgeUpdateData) =>
    api.patch<KnowledgeUnit>(`/api/v1/knowledge/${id}`, data),
  verify: (id: string, preferred_model?: string) =>
    api.post<VerifyResponse>(`/api/v1/knowledge/${id}/verify`, { preferred_model }),
  sources: (id: string) => api.get<KnowledgeSourcesResponse>(`/api/v1/knowledge/${id}/sources`),
  sourceCredibility: (domain: string) => api.get<SourceCredibilityResponse>(`/api/v1/knowledge/domain-credibility/${domain}`),
  counterEvidence: (id: string, data: { evidence_text: string; evidence_url?: string }) =>
    api.post(`/api/v1/knowledge/${id}/counter-evidence`, data),
  stats: () => api.get<KnowledgeStatsResponse>('/api/v1/knowledge/stats'),
  counterEvidenceList: (brain_side?: string, include_resolved?: boolean) =>
    api.get<CounterEvidenceItem[]>('/api/v1/knowledge/counter-evidence', {
      params: {
        ...(brain_side ? { brain_side } : {}),
        ...(include_resolved ? { include_resolved: true } : {}),
      },
    }),
  disputeResolution: (id: string, data: { resolution: 'kept' | 'rejected' }) =>
    api.post<KnowledgeUnit>(`/api/v1/knowledge/${id}/dispute-resolution`, data),
  timelinessList: (brain_side?: string) =>
    api.get<KnowledgeUnit[]>('/api/v1/knowledge/timeliness', { params: brain_side ? { brain_side } : undefined }),
  sourceAggregates: () => api.get<KnowledgeSourceAggregate[]>('/api/v1/knowledge/sources'),
  domainCredibility: (domain: string) =>
    api.get(`/api/v1/knowledge/domain-credibility/${domain}`),
};
