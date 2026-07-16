import api from './client';

export interface GraphBridgeNode {
  id: string;
  label: string;
  brain_side: string;
}

export interface GraphBridge {
  edge_id: string;
  personal_node: GraphBridgeNode;
  network_node: GraphBridgeNode;
  type: string;
  strength: number;
  context?: string;
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

export const graphApi = {
  getBridges: (limit = 50) =>
    api.get<{ bridges: GraphBridge[]; total: number }>('/api/v1/graph/bridges', { params: { limit } }),
  getTagNetwork: (minCooccurrence = 1) =>
    api.get<GraphTagNetwork>('/api/v1/graph/tag-network', { params: { min_cooccurrence: minCooccurrence } }),
  getNodes: () =>
    api.get<{ nodes: GraphNodeItem[]; total: number }>('/api/v1/graph/nodes'),
};
