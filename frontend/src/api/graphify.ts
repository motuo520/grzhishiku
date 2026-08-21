import api from './client';

export type GraphifyState = 'idle' | 'exporting' | 'building' | 'done' | 'failed';

export interface GraphifyStatus {
  state: GraphifyState;
  has_graph: boolean;
  progress: string | null;
  error: string | null;
  last_built_at: string | null;
  stale: boolean;
  node_count: number;
  edge_count: number;
  doc_count?: number;
  warning?: string;
  finished_at?: string;
}

export type GraphifySourceType = 'note' | 'clip' | 'knowledge';

export interface GraphifyNodeSource {
  type: GraphifySourceType;
  title?: string;
  brain_side?: string;
  url?: string;
  id?: string;
}

export interface GraphifyNode {
  id: string;
  label: string;
  file_type: string;
  community: number | null;
  source_url?: string | null;
  captured_at?: string | null;
  source?: GraphifyNodeSource | null;
  /** hub 概念节点的 grounding 原文（最多 3 篇），供「相关内容」直达 */
  grounded?: { type: GraphifySourceType; id: string; title?: string }[];
}

export type GraphifyConfidence = 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';

export interface GraphifyLink {
  source: string;
  target: string;
  relation: string;
  confidence: GraphifyConfidence;
}

export interface GraphifyGraph {
  nodes: GraphifyNode[];
  links: GraphifyLink[];
  community_labels: Record<string, string>;
}

export interface GraphifySource {
  content_type: 'note' | 'knowledge' | 'clip';
  id: string;
  title: string;
}

export interface GraphifyTextResult {
  ok: boolean;
  result?: string;
  error?: string;
  sources?: GraphifySource[];
}

export interface AutoEvolveConfig {
  enabled: boolean;
  model: string | null;
  last_built_at?: string | null;
}

export const graphifyApi = {
  getStatus: () => api.get<GraphifyStatus>('/api/v1/graphify/status'),
  build: (preferred_model?: string) =>
    api.post<{ ok: boolean; status: GraphifyStatus }>('/api/v1/graphify/build', { preferred_model }),
  getGraph: () => api.get<GraphifyGraph>('/api/v1/graphify/graph'),
  query: (question: string, preferred_model?: string) =>
    api.post<GraphifyTextResult>('/api/v1/graphify/query', { question, preferred_model }),
  path: (a: string, b: string) => api.post<GraphifyTextResult>('/api/v1/graphify/path', { a, b }),
  explain: (node: string) => api.post<GraphifyTextResult>('/api/v1/graphify/explain', { node }),
  getReport: () => api.get<{ content: string }>('/api/v1/graphify/report'),
  getAutoEvolve: () => api.get<AutoEvolveConfig>('/api/v1/graphify/auto-evolve'),
  setAutoEvolve: (data: { enabled: boolean; model?: string | null }) =>
    api.put<AutoEvolveConfig>('/api/v1/graphify/auto-evolve', data),
};
