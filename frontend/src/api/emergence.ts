import api from './client';
import type { AxiosResponse } from 'axios';

export type BrainSide = 'personal' | 'network' | 'both';

export interface EmergenceToolBase {
  brain_side?: BrainSide;
  source_ids?: string[];
  source_types?: string[];
  preferred_model?: string;
}

export interface AssociateRequest extends EmergenceToolBase {
  topic_a: string;
  topic_b: string;
}

export interface AssociateResponse {
  id: string;
  concept: string;
  path: string[];
  applications: string[];
  innovation_score: number;
  feasibility_score: number;
  scores: {
    innovation_score: number;
    feasibility_score: number;
  };
  created_at: string;
}

export interface PerspectiveItem {
  role: string;
  stance: string;
  argument: string;
  counter: string;
}

export interface DialogueItem {
  speaker: string;
  content: string;
}

export interface CollisionRequest extends EmergenceToolBase {
  topic: string;
  perspectives?: string[];
}

export interface CollisionResponse {
  id: string;
  perspectives: PerspectiveItem[];
  dialogue: DialogueItem[];
  consensus: string[];
  divergence: string[];
  created_at: string;
}

export interface HybridRequest extends EmergenceToolBase {
  concept_a: string;
  concept_b: string;
}

export interface HybridResponse {
  id: string;
  name: string;
  definition: string;
  features: string[];
  applications: string[];
  risks: string[];
  maturity_score: number;
  scores: {
    maturity_score: number;
  };
  created_at: string;
}

export interface TimelineNode {
  time: string;
  event: string;
  consequence: string;
}

export interface BranchItem {
  stage: string;
  key_nodes: TimelineNode[];
  impact_scope: string;
  probability: number;
  reality_comparison: string;
}

export interface CounterfactualRequest extends EmergenceToolBase {
  premise: string;
  timeline_depth?: number;
}

export interface CounterfactualResponse {
  id: string;
  branches: BranchItem[];
  created_at: string;
}

export interface EmergenceSource {
  id: string;
  type: string;
  title: string;
  excerpt: string;
  brain_side: BrainSide | 'unknown';
  created_at: string;
}

export interface SelectedSource {
  id: string;
  type: string;
}

export interface EmergenceSourcesResponse {
  items: EmergenceSource[];
  total: number;
}

export interface EmergenceHistoryItem {
  id: string;
  type: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  scores: Record<string, number> | null;
  brain_side?: BrainSide | null;
  source_ids?: string[] | null;
  source_types?: string[] | null;
  model_used?: string | null;
  created_at: string;
}

export interface EmergenceHistoryResponse {
  items: EmergenceHistoryItem[];
  total: number;
  skip: number;
  limit: number;
}

export interface SaveIdeaRequest {
  title: string;
  summary: string;
  brain_side?: BrainSide;
  source_result_ids?: string[];
  tags?: string[];
  status?: string;
}

export interface Idea {
  id: string;
  title: string;
  summary: string;
  brain_side: BrainSide | 'unknown';
  source_result_ids: string[];
  tags: string[];
  status: string;
  target_type?: string | null;
  target_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface IdeasResponse {
  items: Idea[];
  total: number;
  skip: number;
  limit: number;
}

export interface PromoteIdeaRequest {
  target_type: 'note' | 'capsule' | 'knowledge';
}

export interface CanvasNode {
  id: string;
  type: 'idea' | 'text' | 'source';
  idea_id?: string | null;
  source_id?: string | null;
  label: string;
  content?: string | null;
  x: number;
  y: number;
  width?: number;
  height?: number;
  brain_side?: BrainSide | 'unknown';
  color?: string | null;
}

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  label?: string | null;
}

export interface CanvasCreateRequest {
  title: string;
  description?: string;
  brain_side?: BrainSide;
  nodes?: CanvasNode[];
  edges?: CanvasEdge[];
}

export interface CanvasUpdateRequest {
  title?: string;
  description?: string;
  brain_side?: BrainSide;
  nodes?: CanvasNode[];
  edges?: CanvasEdge[];
}

export interface CanvasItem {
  id: string;
  user_id: string;
  title: string;
  description?: string | null;
  brain_side: BrainSide | 'unknown';
  node_count: number;
  edge_count: number;
  created_at: string;
  updated_at: string;
}

export interface CanvasDetail extends CanvasItem {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export interface CanvasListResponse {
  items: CanvasItem[];
  total: number;
  skip: number;
  limit: number;
}

export interface CanvasCombineRequest {
  node_ids: string[];
  title: string;
  summary?: string;
  tags?: string[];
}

export interface CanvasReportRequest {
  title?: string;
  focus_node_ids?: string[];
  format?: 'proposal' | 'summary' | 'story' | 'mindmap';
  preferred_model?: string;
}

export interface CanvasReportResponse {
  title: string;
  content: string;
  model_used?: string | null;
}

export interface CanvasToNoteRequest {
  title?: string;
  content?: string;
}

export function associate(data: AssociateRequest): Promise<AxiosResponse<AssociateResponse>> {
  return api.post<AssociateResponse>('/api/v1/emergence/associate', data);
}

export function collision(data: CollisionRequest): Promise<AxiosResponse<CollisionResponse>> {
  return api.post<CollisionResponse>('/api/v1/emergence/collision', data);
}

export function hybrid(data: HybridRequest): Promise<AxiosResponse<HybridResponse>> {
  return api.post<HybridResponse>('/api/v1/emergence/hybrid', data);
}

export function counterfactual(data: CounterfactualRequest): Promise<AxiosResponse<CounterfactualResponse>> {
  return api.post<CounterfactualResponse>('/api/v1/emergence/counterfactual', data);
}

export function getSources(
  brain_side?: BrainSide | 'all',
  type_filter?: string,
  q?: string,
  limit: number = 50
): Promise<AxiosResponse<EmergenceSourcesResponse>> {
  return api.get<EmergenceSourcesResponse>('/api/v1/emergence/sources', {
    params: { brain_side, type_filter, q, limit },
  });
}

export function history(
  type_filter?: string,
  skip: number = 0,
  limit: number = 20
): Promise<AxiosResponse<EmergenceHistoryResponse>> {
  return api.get<EmergenceHistoryResponse>('/api/v1/emergence/history', {
    params: { type_filter, skip, limit },
  });
}

export function deleteEmergence(id: string): Promise<AxiosResponse<unknown>> {
  return api.delete(`/api/v1/emergence/${id}`);
}

export function saveIdea(data: SaveIdeaRequest): Promise<AxiosResponse<Idea>> {
  return api.post<Idea>('/api/v1/emergence/save-idea', data);
}

export function getIdeas(
  status?: string,
  brain_side?: BrainSide | 'all',
  skip: number = 0,
  limit: number = 50
): Promise<AxiosResponse<IdeasResponse>> {
  return api.get<IdeasResponse>('/api/v1/emergence/ideas', {
    params: { status, brain_side, skip, limit },
  });
}

export function promoteIdea(id: string, data: PromoteIdeaRequest): Promise<AxiosResponse<Idea>> {
  return api.post<Idea>(`/api/v1/emergence/ideas/${id}/promote`, data);
}

export function deleteIdea(id: string): Promise<AxiosResponse<unknown>> {
  return api.delete(`/api/v1/emergence/ideas/${id}`);
}

export function createCanvas(data: CanvasCreateRequest): Promise<AxiosResponse<CanvasDetail>> {
  return api.post<CanvasDetail>('/api/v1/emergence/canvases', data);
}

export function getCanvases(
  skip: number = 0,
  limit: number = 50
): Promise<AxiosResponse<CanvasListResponse>> {
  return api.get<CanvasListResponse>('/api/v1/emergence/canvases', {
    params: { skip, limit },
  });
}

export function getCanvas(id: string): Promise<AxiosResponse<CanvasDetail>> {
  return api.get<CanvasDetail>(`/api/v1/emergence/canvases/${id}`);
}

export function updateCanvas(
  id: string,
  data: CanvasUpdateRequest
): Promise<AxiosResponse<CanvasDetail>> {
  return api.put<CanvasDetail>(`/api/v1/emergence/canvases/${id}`, data);
}

export function deleteCanvas(id: string): Promise<AxiosResponse<unknown>> {
  return api.delete(`/api/v1/emergence/canvases/${id}`);
}

export function combineCanvasNodes(
  canvasId: string,
  data: CanvasCombineRequest
): Promise<AxiosResponse<Idea>> {
  return api.post<Idea>(`/api/v1/emergence/canvases/${canvasId}/combine`, data);
}

export function generateCanvasReport(
  canvasId: string,
  data: CanvasReportRequest
): Promise<AxiosResponse<CanvasReportResponse>> {
  return api.post<CanvasReportResponse>(`/api/v1/emergence/canvases/${canvasId}/report`, data);
}

export function convertCanvasToNote(
  canvasId: string,
  data: CanvasToNoteRequest
): Promise<AxiosResponse<{ note_id: string; title: string }>> {
  return api.post<{ note_id: string; title: string }>(`/api/v1/emergence/canvases/${canvasId}/to-note`, data);
}

export const emergenceApi = {
  associate,
  collision,
  hybrid,
  counterfactual,
  getSources,
  history,
  delete: deleteEmergence,
  saveIdea,
  getIdeas,
  promoteIdea,
  deleteIdea,
  createCanvas,
  getCanvases,
  getCanvas,
  updateCanvas,
  deleteCanvas,
  combineCanvasNodes,
  generateCanvasReport,
  convertCanvasToNote,
};
