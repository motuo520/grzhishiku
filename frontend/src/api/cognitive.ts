import api from './client';
import type { BrainSide } from '@/types';

export type { BrainSide };

export interface RadarDimension {
  name: string;
  score: number;
}

export interface TrendPoint {
  date: string;
  analysis_depth: number;
  creativity: number;
  logic: number;
  emotional_expression: number;
  structure: number;
  critical_thinking: number;
}

export interface TopicPreference {
  topic: string;
  percentage: number;
}

export interface FingerprintResponse {
  radar_dimensions: RadarDimension[];
  trends: TrendPoint[];
  topics: TopicPreference[];
  decision_style: string;
  thinking_speed: string;
  vocabulary_diversity: number;
  logic_preference: string;
  emotional_tendency: Record<string, number>;
  suggestions: string[];
  analyzed_items_count: number;
  degraded?: boolean;
}

export interface BiasItem {
  bias_type: string;
  severity: number;
  text_snippet: string;
  suggestion: string;
  source_id: string;
  source_type: string;
}

export interface BiasDetectionResponse {
  detected_biases: BiasItem[];
  total_analyzed: number;
  bias_count: number;
}

export interface BiasSummaryItem {
  bias_type: string;
  count: number;
  average_severity: number;
  max_severity: number;
}

export interface BiasSummaryResponse {
  summaries: BiasSummaryItem[];
  total_detected: number;
}

export interface ContrastMetric {
  dimension: string;
  personal: number;
  network: number;
  gap: number;
  winner: BrainSide | 'balanced';
}

export interface BrainContrastResponse {
  metrics: ContrastMetric[];
  personal_summary: { tagline?: string; keywords?: string[] };
  network_summary: { tagline?: string; keywords?: string[] };
  dominant_brain: BrainSide | 'balanced' | 'unknown';
  synergy_score: number;
  conflict_count: number;
  insights: string[];
  degraded?: boolean;
}

export interface ConflictItem {
  id: string;
  title: string;
  personal_position: string;
  network_position: string;
  conflict_type: string;
  severity: number;
  suggested_resolution: string;
  source_ids: string[];
}

export interface CognitiveConflictResponse {
  conflicts: ConflictItem[];
  total: number;
  categories: { type: string; count: number }[];
}

export interface DecisionOption {
  id: string;
  text: string;
  pros?: string;
  cons?: string;
}

export interface DecisionAnalysisResult {
  confidence: number;
  biases: string[];
  risks: string[];
  suggestions: string[];
  verdict: string;
  option_scores?: Record<string, number>;
}

export interface DecisionAudit {
  id: string;
  title: string;
  context: string;
  options: DecisionOption[];
  expected_outcome?: string;
  actual_outcome?: string;
  decision_date?: string;
  status: 'pending' | 'reviewed' | 'closed';
  analysis_result: DecisionAnalysisResult;
  related_note_ids: string[];
  brain_side: string;
  created_at: string;
  updated_at: string;
}

export interface DecisionAuditListResponse {
  items: DecisionAudit[];
  total: number;
}

export interface DecisionAuditCreateRequest {
  title: string;
  context: string;
  options?: DecisionOption[];
  expected_outcome?: string;
  actual_outcome?: string;
  decision_date?: string;
  related_note_ids?: string[];
  brain_side?: string;
}

export interface SimulationScenario {
  name: string;
  assumptions: string[];
  probability: number;
}

export interface SimulationOutcome {
  scenario: string;
  probability: number;
  short_term: string;
  medium_term: string;
  long_term: string;
  key_indicators: string[];
  risks: string[];
  opportunities: string[];
}

export interface SimulationResult {
  summary: string;
  outcomes: SimulationOutcome[];
  recommendation: string;
  confidence: number;
}

export interface FutureSimulation {
  id: string;
  title: string;
  context: string;
  variables: string[];
  scenarios: SimulationScenario[];
  timeframes: string[];
  status: 'pending' | 'simulated';
  result: SimulationResult;
  related_audit_id?: string;
  brain_side: string;
  created_at: string;
  updated_at: string;
}

export interface FutureSimulationListResponse {
  items: FutureSimulation[];
  total: number;
}

export interface FutureSimulationCreateRequest {
  title: string;
  context: string;
  variables?: string[];
  scenarios?: SimulationScenario[];
  timeframes?: string[];
  related_audit_id?: string;
  brain_side?: string;
}

export interface Challenge {
  id: string;
  type: 'bias_quiz' | 'thought_experiment' | 'reflection';
  title: string;
  content: string;
  options: string[];
  status: 'pending' | 'completed' | 'skipped';
  points: number;
  explanation?: string;
  completed_at?: string;
  user_answer?: string;
  is_correct?: boolean;
}

export interface ChallengeStats {
  total_completed: number;
  total_points: number;
  current_streak: number;
  longest_streak: number;
  accuracy_rate: number;
  today_completed: boolean;
}

export interface ChallengeAnswerResponse {
  success: boolean;
  is_correct?: boolean;
  correct_answer?: string;
  explanation?: string;
  points_earned: number;
  streak: number;
  total_points: number;
}

export interface WeeklyDimension {
  name: string;
  score: number;
  trend: 'up' | 'down' | 'stable';
}

export interface WeeklyStats {
  notes_count: number;
  knowledge_count: number;
  challenges_completed: number;
  decisions_audited: number;
  biases_found: number;
  simulations_run: number;
}

export interface WeeklyReport {
  id: string;
  week_start: string;
  week_end: string;
  health_score: number;
  summary: string;
  dimensions: WeeklyDimension[];
  highlights: string[];
  risks: string[];
  suggestions: string[];
  stats: WeeklyStats;
  status: string;
  created_at: string;
}

export interface WeeklyReportListResponse {
  items: WeeklyReport[];
  total: number;
}

export const cognitiveApi = {
  fingerprint: (limit: number = 50, brainSide: BrainSide = 'both', preferred_model?: string) =>
    api.post<FingerprintResponse>(`/api/v1/cognitive/fingerprint?brain_side=${brainSide}${preferred_model ? `&preferred_model=${encodeURIComponent(preferred_model)}` : ''}`, { content_limit: limit }),
  detectBias: (limit: number = 50, brainSide: BrainSide = 'both', preferred_model?: string) =>
    api.post<BiasDetectionResponse>(`/api/v1/cognitive/bias-detection?brain_side=${brainSide}${preferred_model ? `&preferred_model=${encodeURIComponent(preferred_model)}` : ''}`, { content_limit: limit }),
  biasSummary: (brainSide: BrainSide = 'both', preferred_model?: string) =>
    api.get<BiasSummaryResponse>(`/api/v1/cognitive/bias-summary?brain_side=${brainSide}${preferred_model ? `&preferred_model=${encodeURIComponent(preferred_model)}` : ''}`),
  brainContrast: (brainSide: BrainSide = 'both', preferred_model?: string) =>
    api.get<BrainContrastResponse>('/api/v1/cognitive/brain-contrast', { params: { brain_side: brainSide, ...(preferred_model ? { preferred_model } : {}) } }),
  cognitiveConflict: (brainSide: BrainSide = 'both', preferred_model?: string) =>
    api.post<CognitiveConflictResponse>('/api/v1/cognitive/cognitive-conflict', null, { params: { brain_side: brainSide, ...(preferred_model ? { preferred_model } : {}) } }),
  listDecisionAudits: (params?: { status?: string; limit?: number; offset?: number }) =>
    api.get<DecisionAuditListResponse>('/api/v1/cognitive/decision-audits', { params }),
  getDecisionAudit: (id: string) =>
    api.get<DecisionAudit>(`/api/v1/cognitive/decision-audits/${id}`),
  createDecisionAudit: (data: DecisionAuditCreateRequest) =>
    api.post<DecisionAudit>('/api/v1/cognitive/decision-audits', data),
  updateDecisionAudit: (id: string, data: Partial<DecisionAuditCreateRequest>) =>
    api.put<DecisionAudit>(`/api/v1/cognitive/decision-audits/${id}`, data),
  deleteDecisionAudit: (id: string) =>
    api.delete(`/api/v1/cognitive/decision-audits/${id}`),
  analyzeDecisionAudit: (id: string, preferred_model?: string) =>
    api.post<DecisionAudit>(`/api/v1/cognitive/decision-audits/${id}/analyze${preferred_model ? `?preferred_model=${encodeURIComponent(preferred_model)}` : ''}`),
  listFutureSimulations: (params?: { status?: string; limit?: number; offset?: number }) =>
    api.get<FutureSimulationListResponse>('/api/v1/cognitive/future-simulations', { params }),
  getFutureSimulation: (id: string) =>
    api.get<FutureSimulation>(`/api/v1/cognitive/future-simulations/${id}`),
  createFutureSimulation: (data: FutureSimulationCreateRequest) =>
    api.post<FutureSimulation>('/api/v1/cognitive/future-simulations', data),
  updateFutureSimulation: (id: string, data: Partial<FutureSimulationCreateRequest>) =>
    api.put<FutureSimulation>(`/api/v1/cognitive/future-simulations/${id}`, data),
  deleteFutureSimulation: (id: string) =>
    api.delete(`/api/v1/cognitive/future-simulations/${id}`),
  runFutureSimulation: (id: string, preferred_model?: string) =>
    api.post<FutureSimulation>(`/api/v1/cognitive/future-simulations/${id}/run${preferred_model ? `?preferred_model=${encodeURIComponent(preferred_model)}` : ''}`),
  getDailyChallenge: () =>
    api.get<Challenge>('/api/v1/cognitive/challenge/daily'),
  submitChallengeAnswer: (id: string, answer: string) =>
    api.post<ChallengeAnswerResponse>(`/api/v1/cognitive/challenge/${id}/answer`, { answer }),
  skipChallenge: (id: string) =>
    api.post(`/api/v1/cognitive/challenge/${id}/skip`),
  getChallengeStats: () =>
    api.get<ChallengeStats>('/api/v1/cognitive/challenge/stats'),
  getChallengeHistory: () =>
    api.get<Challenge[]>('/api/v1/cognitive/challenge/history'),
  generateWeeklyReport: (force = false, preferred_model?: string) =>
    api.post<WeeklyReport>('/api/v1/cognitive/weekly-reports/generate', null, { params: { force, ...(preferred_model ? { preferred_model } : {}) } }),
  listWeeklyReports: (params?: { limit?: number; offset?: number }) =>
    api.get<WeeklyReportListResponse>('/api/v1/cognitive/weekly-reports', { params }),
  getLatestWeeklyReport: () =>
    api.get<WeeklyReport>('/api/v1/cognitive/weekly-reports/latest'),
};
