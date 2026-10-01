import api from './client';
import { getConsolePreferredModel } from './consoleModel';

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
  /** 待自进化内容条数（写入事件累计，构建成功清零） */
  evolve_pending?: number;
}

export type GraphifySourceType = 'note' | 'clip' | 'knowledge' | 'wiki' | 'document';

export interface GraphifyNodeSource {
  type: GraphifySourceType;
  title?: string;
  brain_side?: string;
  url?: string;
  id?: string;
  /** 图片文档的直出路径（09-17 P2-4，/uploads 静态挂载），节点详情出缩略图 */
  image_url?: string;
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
  /** 进化阶段（3D 视图 z 轴海拔），语义图/物理图同契约 */
  evolution_stage?: string;
  /** UMAP 预计算 2D 坐标（仅物理图节点有；语义图无 → 前端 fallback 力导向） */
  x?: number;
  y?: number;
  /** 3D V2：落库布局 z 坐标（进化阶段地层）；三轴齐全时 3D 视图直接用落库坐标 */
  z?: number;
}

/** 3D V2：社区超节点（LOD 缩放态），坐标=成员质心，size=成员数 */
export interface GraphifySuperNode {
  /** 社区 id 字符串（历史版本可能带 "community:" 前缀，消费方需兼容剥离） */
  id: string;
  x: number;
  y: number;
  z: number;
  size: number;
  label?: string | null;
}

export type GraphifyConfidence = 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';

export interface GraphifyLink {
  source: string;
  target: string;
  relation: string;
  /** 语义边置信度；手动双链（edge_type="manual"）为 null */
  confidence: GraphifyConfidence | null;
  /** 物理图边权重：相似度（相似边）或共标签强度（标签边）；手动边恒 1.0 */
  weight?: number;
  /** 共标签边的共享标签名（最多 6 个） */
  tags?: string[];
  /** 「manual」= 用户手动双链（仅物理图带出），渲染给独立样式 */
  edge_type?: string;
}

export interface GraphifyGraph {
  nodes: GraphifyNode[];
  links: GraphifyLink[];
  community_labels: Record<string, string>;
  /** 3D V2：社区超节点（可选，无则前端按节点质心自算） */
  supernodes?: GraphifySuperNode[];
}

/** 物理图（相似度图）：与语义图同契约，额外带层序供 3D z 轴分层 */
export interface GraphifyPhysicalGraph extends GraphifyGraph {
  graph_source: 'physical';
  stage_layers: string[];
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
  /** 'rag' = 图谱未构建时的全文检索回落（10-01 首次体验）；缺省=图谱关系推理 */
  mode?: string;
  notice?: string;
}

export interface AutoEvolveConfig {
  enabled: boolean;
  model: string | null;
  last_built_at?: string | null;
}

export interface BuildEstimate {
  model: string;
  docs: number;
  input_tokens: number;
  output_tokens: number;
  cost: number | null;
  balance?: number | null;
  cost_note?: string;
}

export const graphifyApi = {
  getStatus: () => api.get<GraphifyStatus>('/api/v1/graphify/status'),
  build: (preferred_model?: string) =>
    api.post<{ ok: boolean; status: GraphifyStatus }>('/api/v1/graphify/build', { preferred_model: preferred_model || getConsolePreferredModel() }),
  buildEstimate: (model: string) =>
    api.get<BuildEstimate>('/api/v1/graphify/build-estimate', { params: { model } }).then(r => r.data),
  getGraph: (includeQuarantined = false) =>
    api.get<GraphifyGraph>('/api/v1/graphify/graph',
      includeQuarantined ? { params: { include_quarantined: 1 } } : undefined),
  getPhysicalGraph: () => api.get<GraphifyPhysicalGraph>('/api/v1/graphify/physical-graph'),
  query: (question: string, preferred_model?: string) =>
    api.post<GraphifyTextResult>('/api/v1/graphify/query', { question, preferred_model: preferred_model || getConsolePreferredModel() }),
  path: (a: string, b: string) => api.post<GraphifyTextResult>('/api/v1/graphify/path', { a, b }),
  explain: (node: string) => api.post<GraphifyTextResult>('/api/v1/graphify/explain', { node }),
  getReport: () => api.get<{ content: string }>('/api/v1/graphify/report'),
  getAutoEvolve: () => api.get<AutoEvolveConfig>('/api/v1/graphify/auto-evolve'),
  setAutoEvolve: (data: { enabled: boolean; model?: string | null }) =>
    api.put<AutoEvolveConfig>('/api/v1/graphify/auto-evolve', data),
  /** 实体消歧审计（09-17 GraphRAG P1①，只读诊断报表） */
  getEntityAudit: () => api.get<EntityAuditReport>('/api/v1/graphify/entity-audit'),
  /** 实体消歧执行链（09-19）：dry_run=true 预览 LLM 判定+校验，false 才真合并 */
  entityDedup: (dryRun: boolean) =>
    api.post<EntityDedupResult>('/api/v1/graphify/entity-dedup', { dry_run: dryRun }).then(r => r.data),
  /** 版本快照（09-17 GraphRAG P2-2）：列表/手动留底/一键回滚 */
  getSnapshots: () => api.get<{ snapshots: GraphSnapshot[] }>('/api/v1/graphify/snapshots'),
  createSnapshot: () => api.post<{ ok: boolean; snapshot_id: string }>('/api/v1/graphify/snapshots'),
  rollbackSnapshot: (snapshotId: string) =>
    api.post<{ ok: boolean; snapshot_id: string; synced_edges?: number | null; warning?: string | null }>(
      `/api/v1/graphify/snapshots/${snapshotId}/rollback`),
};

export interface GraphSnapshot {
  id: string;
  created_at?: string;
  trigger?: string;
  model?: string | null;
  nodes?: number;
  edges?: number;
  has_graph: boolean;
}

export interface EntityAuditGroup {
  norm_label: string;
  nodes: { id: string; label: string; source_file?: string | null; community?: number | null }[];
}

export interface EntityAuditCandidate {
  a: string;
  b: string;
  ratio: number;
}

export interface EntityAuditReport {
  groups: EntityAuditGroup[];
  candidates: EntityAuditCandidate[];
  stats: {
    nodes: number;
    edges: number;
    hub_without_source: number;
    dup_groups: number;
    candidate_pairs: number;
  };
}

/** 消歧合并提案（LLM 判定过写前校验后的采信项） */
export interface EntityDedupMerge {
  winner_id: string;
  loser_id: string;
  winner_label?: string;
  loser_label?: string;
  reason: string;
}

/** 写前校验被拒项（幻觉 id / 自合并等，程序闸拦截） */
export interface EntityDedupRejected {
  winner_id: string;
  loser_id: string;
  reason: string;
}

export interface EntityDedupResult {
  dry_run: boolean;
  ok: boolean;
  model: string;
  candidate_pairs: number;
  merges: EntityDedupMerge[];
  rejected: EntityDedupRejected[];
  batch_errors: string[];
  /** 仅 dry_run=false 时有：真合并的执行结果 */
  applied?: {
    merged: number;
    snapshot_id: string | null;
    edges_remapped: number;
    edges_dropped: number;
    edges_deduped: number;
    warning?: string | null;
  };
}
