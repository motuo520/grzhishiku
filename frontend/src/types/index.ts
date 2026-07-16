export type BrainSide = 'personal' | 'network' | 'both' | 'unknown';

export interface User {
  id: string;
  email: string;
  name: string | null;
  display_name: string | null;
  username: string | null;
  avatar: string | null;
  subscription_tier: string;
  subscription_status: string;
  storage_used: number;
  storage_limit: number;
  created_at: string;
  updated_at: string;
}

export interface Capsule {
  id: string;
  user_id: string;
  brain_side: string;
  content_type: string;
  content_body: string;
  content_attachments: string | null;
  mood_emotion: string | null;
  mood_intensity: number | null;
  mood_energy_level: number | null;
  sealed_at: string | null;
  unlock_type: string;
  unlock_status: string;
  privacy_require_auth: boolean;
  privacy_allow_export: boolean;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeUnit {
  id: string;
  user_id: string;
  brain_side: string;
  content_raw: string;
  content_processed: string | null;
  content_type: string | null;
  source_url: string | null;
  source_title: string | null;
  source_type: string | null;
  source_author: string | null;
  source_publish_date: string | null;
  source_credibility_score: number | null;
  source_bias_indicator: string | null;
  verification_status: string;
  verification_consensus: number | null;
  verification_history: string | null;
  trust_level: string;
  last_verified: string | null;
  next_scheduled: string | null;
  timeliness_status: string | null;
  timeliness_half_life: number | null;
  timeliness_deprecation_warning: string | null;
  review_count: number;
  origin_type?: string;
  invoke_count?: number;
  last_invoked_at?: string | null;
  practice_depth?: number;
  personal_relevance_score?: number;
  evolution_stage?: string;
  attached_practice_ids?: string[];
  value_score?: number;
  pipeline_stage?: string;
  content_subtype?: string;
  source_id?: string;
  source_content_type?: string;
  tags?: Array<{ id: string; name: string; color?: string | null }>;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeSource {
  source_url: string | null;
  source_title: string | null;
  source_author: string | null;
  source_publish_date: string | null;
  source_credibility_score: number | null;
  source_bias_indicator: string | null;
  source_funding_source: string | null;
  domain_credibility_score: number | null;
  domain_reputation: string | null;
}

export interface VerificationHistoryEntry {
  timestamp: string;
  verdict: string;
  confidence: number;
  bias_indicators: string[];
  source_reliability: number;
  reasoning?: string;
  type?: string;
  evidence_text?: string;
  evidence_url?: string;
  source_authority?: string;
}

export interface DomainCredibility {
  domain: string;
  credibility_score: number;
  reputation: string;
  factors: string[];
}

export interface KnowledgeSourcesResponse {
  unit_id: string;
  sources: Array<{
    source_url: string | null;
    source_title: string | null;
    source_author: string | null;
    source_publish_date: string | null;
    source_credibility_score: number | null;
    source_bias_indicator: string[];
    source_funding_source: string | null;
    source_domain: string;
  }>;
  verification_history: Array<{
    timestamp: string;
    verdict: string;
    confidence: number;
    bias_indicators: string[];
    source_reliability: number;
    note?: string;
  }>;
}

export interface SourceCredibilityResponse {
  domain: string;
  credibility_score: number;
  reputation: string;
  factors: string[];
}

export interface KnowledgeStats {
  total: number;
  verified: number;
  disputed: number;
  debunked: number;
  unverified: number;
  average_confidence: number;
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

export interface KnowledgeSourceAggregate {
  domain: string;
  count: number;
  avg_verification_consensus: number;
  avg_source_credibility: number;
  reputation: string;
  factors: string[];
}

export interface AttentionActivity {
  id: string;
  user_id: string;
  category_id: string;
  brain_side: string | null;
  description: string | null;
  start_time: string;
  end_time: string | null;
  actual_duration: number | null;
  focus_score: number | null;
  created_at: string;
}

export interface DeepWorkSession {
  id: string;
  user_id: string;
  task: string;
  planned_duration: number;
  actual_duration: number | null;
  started_at: string | null;
  ended_at: string | null;
  focus_score_avg: number | null;
  interruptions: number;
  created_at: string;
}

export interface MenuItem {
  id: string;
  label: string;
  description: string;
  icon: string;
  path: string;
  brainSide?: BrainSide;
}

export interface ApiError {
  message: string;
  code: string;
  status: number;
}
