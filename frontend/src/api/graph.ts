import api from './client';

export interface GraphBridgeNode {
  id: string;
  label: string;
  brain_side: string;
  /** 内容类型（note/clip/knowledge/document/capsule）：直达原文路由用 */
  type?: string;
  /** clip 的原始网页链接：直达原文=打开原页 */
  url?: string | null;
}

export interface GraphBridge {
  edge_id: string;
  personal_node: GraphBridgeNode;
  network_node: GraphBridgeNode;
  type: string;
  strength: number;
  context?: string;
  /** 共同点：graphify 边=经概念枢纽概念；tag 边=两端共享标签名 */
  shared_points?: string[];
}

export interface GraphTagNode {
  id: string;
  name: string;
  color: string;
  usage_count: number;
}

export interface GraphTagEdge {
  source: string;
  target: string;
  source_name: string;
  target_name: string;
  weight: number;
}

export interface GraphTagNetwork {
  nodes: GraphTagNode[];
  edges: GraphTagEdge[];
  node_count: number;
  edge_count: number;
}

export interface GraphNodeItem {
  id: string;
  label: string;
  type: string;
  brain_side: string;
  source_type?: string;
  created_at?: string;
}

// ── 手动双链（edge_type="manual"）──

export interface LinkedNodeInfo {
  id: string;
  title: string;
  type: string;
  brain_side: string;
}

export interface ManualEdge {
  id: string;
  source_id: string;
  target_id: string;
  edge_type: string;
  weight: number;
  context?: string | null;
  // created=false：已存在同对关联（幂等返回既有边）
  created: boolean;
  peer?: LinkedNodeInfo | null;
}

export interface ManualEdgeListItem {
  id: string;
  source_id: string;
  target_id: string;
  context?: string | null;
  weight: number;
  peer?: LinkedNodeInfo | null;
}

export interface LinkSuggestionCandidate {
  content_id: string;
  title: string;
  type: string;
  similarity: number;
}

export const graphApi = {
  getBridges: (limit = 50) =>
    api.get<{ bridges: GraphBridge[]; total: number }>('/api/v1/graph/bridges', { params: { limit } }),
  getTagNetwork: (minCooccurrence = 1) =>
    api.get<GraphTagNetwork>('/api/v1/graph/tag-network', { params: { min_cooccurrence: minCooccurrence } }),
  createEdge: (data: { source_id: string; target_id: string; context?: string }) =>
    api.post<ManualEdge>('/api/v1/graph/edges', data),
  listEdges: (contentId: string) =>
    api.get<{ edges: ManualEdgeListItem[]; total: number }>('/api/v1/graph/edges', { params: { content_id: contentId } }),
  deleteEdge: (edgeId: string) =>
    api.delete<{ deleted: boolean; id: string }>(`/api/v1/graph/edges/${edgeId}`),
  linkSuggestions: (contentId: string) =>
    api.get<{ candidates: LinkSuggestionCandidate[]; pairing: string }>('/api/v1/graph/edges/suggestions', { params: { content_id: contentId } }),
  // 路径探索（09-02 重写）：双源结构化 BFS；crossOnly=只看跨脑路径（仅相似度图有意义）
  pathExplore: (a: string, b: string, src: 'physical' | 'semantic', crossOnly = false) =>
    api.post<PathExploreResult>('/api/v1/graph/path-explore', { a, b, src, cross_only: crossOnly }),
};

export interface PathHop {
  id: string;
  label: string;
  type?: string | null;
  /** 脑侧（personal/network；仅相似度图源有，语义图概念不分脑） */
  brain_side?: string | null;
  url?: string | null;
  /** 直达原文路由（站内 / 开头；http 开头=剪藏原网页） */
  route?: string | null;
  /** 进入本跳的关系（首跳为 null）；cross_brain=跨脑边 */
  via?: { relation: string; confidence?: string | null; weight?: number | null; cross_brain?: boolean } | null;
}

export interface PathExploreResult {
  ok: boolean;
  found?: boolean;
  hops?: PathHop[];
  length?: number;
  src?: string;
  error?: string;
  error_hint?: string;
}
