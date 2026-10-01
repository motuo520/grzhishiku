import { FC, ReactNode, useState } from 'react';
import { FileText, AlertTriangle, Loader2, ChevronDown, ChevronRight, ShieldCheck, History, Camera, RotateCcw, GitMerge } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useGraphifyStatus, useGraphifyReport } from '@/hooks/useGraphify';
import { graphifyApi, EntityDedupResult } from '@/api/graphify';

// 行内样式：**粗体**
const renderBold = (text: string, keyPrefix: string): ReactNode[] => {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={`${keyPrefix}-${i}`} className="text-text-primary font-semibold">{part.slice(2, -2)}</strong>
      : part
  );
};

// 行内渲染：[text](url) 链接（站内 / 开头走 SPA Link，外链新标签）+ **粗体**
const LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g;
const renderInline = (text: string): ReactNode[] => {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(text))) {
    if (m.index > last) out.push(...renderBold(text.slice(last, m.index), `t${last}`));
    const [raw, label, url] = m;
    if (url.startsWith('/')) {
      out.push(<Link key={`l${m.index}`} to={url} className="text-info hover:underline">{label}</Link>);
    } else {
      out.push(<a key={`l${m.index}`} href={url} target="_blank" rel="noreferrer" className="text-info hover:underline">{label}</a>);
    }
    last = m.index + raw.length;
  }
  if (last < text.length) out.push(...renderBold(text.slice(last), `t${last}`));
  return out;
};

// 极简 markdown 渲染：#/##/### 标题、- 与数字列表、**粗体**，其余按段落
const renderMarkdown = (md: string): ReactNode[] => {
  const blocks: ReactNode[] = [];
  let listItems: string[] = [];
  let listOrdered = false;

  const flushList = (key: string) => {
    if (listItems.length === 0) return;
    const items = listItems.map((item, i) => (
      <li key={i} className="text-sm text-text-secondary leading-relaxed">{renderInline(item)}</li>
    ));
    blocks.push(
      listOrdered
        ? <ol key={key} className="list-decimal list-inside space-y-1 my-2">{items}</ol>
        : <ul key={key} className="list-disc list-inside space-y-1 my-2">{items}</ul>
    );
    listItems = [];
  };

  md.split('\n').forEach((line, idx) => {
    const trimmed = line.trim();

    if (/^#{1,4}\s/.test(trimmed)) {
      flushList(`list-${idx}`);
      const level = trimmed.match(/^#+/)![0].length;
      const text = trimmed.replace(/^#+\s*/, '');
      const cls =
        level === 1 ? 'text-xl font-bold text-text-primary mt-6 mb-3' :
        level === 2 ? 'text-lg font-bold text-text-primary mt-5 mb-2' :
        'text-base font-semibold text-text-primary mt-4 mb-2';
      blocks.push(<div key={idx} className={cls}>{renderInline(text)}</div>);
      return;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      if (listItems.length > 0 && listOrdered) flushList(`list-${idx}`);
      listOrdered = false;
      listItems.push(trimmed.replace(/^[-*]\s+/, ''));
      return;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      if (listItems.length > 0 && !listOrdered) flushList(`list-${idx}`);
      listOrdered = true;
      listItems.push(trimmed.replace(/^\d+\.\s+/, ''));
      return;
    }

    flushList(`list-${idx}`);
    if (trimmed === '') return;
    if (/^-{3,}$/.test(trimmed)) {
      blocks.push(<hr key={idx} className="border-white/[0.08] my-4" />);
      return;
    }
    blocks.push(
      <p key={idx} className="text-sm text-text-secondary leading-relaxed my-2">{renderInline(trimmed)}</p>
    );
  });

  flushList('list-end');
  return blocks;
};

const GraphReportPage: FC = () => {
  const { data: status, isLoading: statusLoading } = useGraphifyStatus();
  const { data: report, isLoading: reportLoading } = useGraphifyReport(Boolean(status?.has_graph));

  // 实体消歧审计（09-17 P1①）：折叠区块，默认收起，展开才拉（诊断报表不挡主报告）
  const [auditOpen, setAuditOpen] = useState(false);
  const { data: audit, isLoading: auditLoading } = useQuery({
    queryKey: ['graphify-entity-audit'],
    queryFn: async () => (await graphifyApi.getEntityAudit()).data,
    enabled: auditOpen && Boolean(status?.has_graph),
  });

  // 版本快照（09-17 P2-2）：swap 前自动留底+手动留底；回滚后状态/图/报告全失效重拉
  const queryClient = useQueryClient();
  const [snapOpen, setSnapOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const { data: snapshots, isLoading: snapLoading } = useQuery({
    queryKey: ['graphify-snapshots'],
    queryFn: async () => (await graphifyApi.getSnapshots()).data.snapshots,
    enabled: snapOpen,
  });
  const invalidateGraph = () => {
    ['graphify-status', 'graphify-graph', 'graphify-report', 'graphify-snapshots', 'graphify-entity-audit']
      .forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
  };
  // 实体消歧执行（09-19）：dry_run 预览合并清单 → 确认后才真执行；执行后图/报告/审计全失效重拉
  const [dedupPreview, setDedupPreview] = useState<EntityDedupResult | null>(null);
  const [dedupApplied, setDedupApplied] = useState<EntityDedupResult | null>(null);
  const dedupPreviewMut = useMutation({
    mutationFn: () => graphifyApi.entityDedup(true),
    onSuccess: (d) => { setDedupPreview(d); setDedupApplied(null); },
  });
  const dedupApplyMut = useMutation({
    mutationFn: () => graphifyApi.entityDedup(false),
    onSuccess: (d) => { setDedupApplied(d); setDedupPreview(null); invalidateGraph(); },
  });
  const createMut = useMutation({
    mutationFn: () => graphifyApi.createSnapshot(),
    onSuccess: invalidateGraph,
  });
  const rollbackMut = useMutation({
    mutationFn: (id: string) => graphifyApi.rollbackSnapshot(id),
    onSuccess: () => { setConfirmId(null); invalidateGraph(); },
    onError: () => setConfirmId(null),
  });

  // 未构建图谱时的引导
  if (!statusLoading && !status?.has_graph) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-6">
        <FileText className="w-12 h-12 text-text-muted mb-4" />
        <div className="text-text-primary font-semibold mb-2">知识图谱尚未构建</div>
        <div className="text-sm text-text-secondary max-w-md">
          请先在「知识网络」页点击「重建图谱」，构建完成后即可查看图谱统计报告。
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">图谱报告</h1>
            <p className="text-sm text-text-secondary mt-1">知识网络的统计与结构概览</p>
          </div>
        </div>

        {status?.stale && (
          <div className="glass-card px-4 py-2.5 rounded-xl flex items-center gap-2 text-xs text-amber-300 border border-amber-400/30">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            内容已更新，报告将在重新构建后更新
          </div>
        )}

        {reportLoading ? (
          <div className="flex items-center gap-2 text-sm text-text-secondary py-8 justify-center">
            <Loader2 className="w-4 h-4 animate-spin text-info" />
            加载报告中...
          </div>
        ) : report ? (
          <div className="card">{renderMarkdown(report.content)}</div>
        ) : (
          <div className="card text-sm text-text-secondary text-center py-8">暂无报告内容</div>
        )}

        {/* 实体消歧审计（只读诊断）：dedup 漏网组 + 高相似未合并候选对 */}
        <div className="card">
          <button
            onClick={() => setAuditOpen(!auditOpen)}
            className="w-full flex items-center gap-2 text-sm font-semibold text-text-primary"
          >
            {auditOpen ? <ChevronDown className="w-4 h-4 text-info" /> : <ChevronRight className="w-4 h-4 text-info" />}
            <ShieldCheck className="w-4 h-4 text-info" />
            实体消歧审计
            {audit && (
              <span className="text-[10px] text-text-muted font-normal ml-1">
                疑似组 {audit.stats.dup_groups} · 候选对 {audit.stats.candidate_pairs}
              </span>
            )}
          </button>
          {auditOpen && (
            <div className="mt-3 space-y-3">
              {auditLoading || !audit ? (
                <div className="flex items-center gap-2 text-xs text-text-muted py-4 justify-center">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> 审计中…
                </div>
              ) : (
                <>
                  <p className="text-[10px] text-text-muted">
                    节点 {audit.stats.nodes} · 边 {audit.stats.edges} · 无来源文档的 hub 节点 {audit.stats.hub_without_source}
                    {' · '}疑似重复组 {audit.stats.dup_groups} · 高相似候选对 {audit.stats.candidate_pairs}
                  </p>
                  {/* 执行消歧（09-19）：dry_run 预览合并清单+被拒项，确认后才真执行（自动留底快照） */}
                  <div className="space-y-2 border-t border-border-color pt-2">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => dedupPreviewMut.mutate()}
                        disabled={dedupPreviewMut.isPending || dedupApplyMut.isPending}
                        className="flex items-center gap-1 text-xs text-info hover:underline disabled:opacity-50"
                      >
                        {dedupPreviewMut.isPending
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <GitMerge className="w-3.5 h-3.5" />}
                        执行消歧
                      </button>
                      <span className="text-[10px] text-text-muted">先预览 LLM 判定，确认后才动图</span>
                    </div>
                    {(dedupPreviewMut.isError || dedupApplyMut.isError) && (
                      <p className="text-[10px] text-amber-300">消歧失败：判定模型不可用或余额不足，未落任何合并结果。</p>
                    )}
                    {dedupPreview && (
                      <div className="space-y-1.5 text-xs border border-border-color rounded-[2px] px-2.5 py-2">
                        <div className="text-text-secondary">
                          预览（模型 {dedupPreview.model}）：候选对 {dedupPreview.candidate_pairs}
                          {' · '}建议合并 {dedupPreview.merges.length} · 被拒 {dedupPreview.rejected.length}
                        </div>
                        {dedupPreview.merges.map((m) => (
                          <div key={`${m.winner_id}|${m.loser_id}`} className="text-[10px] text-text-muted">
                            《{m.loser_label || m.loser_id}》并入《{m.winner_label || m.winner_id}》——{m.reason || '同一实体'}
                          </div>
                        ))}
                        {dedupPreview.rejected.map((r, i) => (
                          <div key={`rej-${i}`} className="text-[10px] text-amber-300">
                            已拒绝 {r.winner_id} ⇄ {r.loser_id}：{r.reason}
                          </div>
                        ))}
                        {dedupPreview.batch_errors.map((e, i) => (
                          <div key={`err-${i}`} className="text-[10px] text-amber-300">{e}</div>
                        ))}
                        <div className="flex items-center gap-3 pt-1">
                          <button
                            onClick={() => dedupApplyMut.mutate()}
                            disabled={dedupApplyMut.isPending || dedupPreview.merges.length === 0}
                            className="flex items-center gap-1 text-info font-medium hover:underline disabled:opacity-40"
                          >
                            {dedupApplyMut.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                            {dedupApplyMut.isPending ? '合并中…' : `确认合并 ${dedupPreview.merges.length} 项`}
                          </button>
                          <button onClick={() => setDedupPreview(null)} className="text-text-muted hover:underline">取消</button>
                        </div>
                      </div>
                    )}
                    {dedupApplied?.applied && (
                      <p className="text-[10px] text-emerald-300">
                        已合并 {dedupApplied.applied.merged} 个实体（边改指 {dedupApplied.applied.edges_remapped}
                        {' · '}去重 {dedupApplied.applied.edges_deduped} · 清理 {dedupApplied.applied.edges_dropped}），
                        已自动留底快照{dedupApplied.applied.snapshot_id ? ` ${dedupApplied.applied.snapshot_id}` : ''}，可在下方「版本快照」回滚。
                      </p>
                    )}
                  </div>
                  {audit.groups.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="text-xs text-text-secondary">疑似重复组（同名未合并）</div>
                      {audit.groups.map((g) => (
                        <div key={g.norm_label} className="text-xs border border-border-color rounded-[2px] px-2.5 py-2">
                          <span className="text-text-primary font-medium">{g.norm_label}</span>
                          <span className="text-text-muted ml-1.5">×{g.nodes.length}</span>
                          <div className="mt-1 space-y-0.5">
                            {g.nodes.map((n) => (
                              <div key={n.id} className="text-[10px] text-text-muted truncate">
                                《{n.label}》{n.source_file ? ` 来源：${n.source_file}` : ' 来源：无（hub 概念）'}
                                {n.community != null ? ` · 社区 ${n.community}` : ''}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {audit.candidates.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-xs text-text-secondary">高相似未合并候选对</div>
                      {audit.candidates.map((p) => (
                        <div key={`${p.a}|${p.b}`} className="text-[10px] text-text-muted">
                          《{p.a}》≈《{p.b}》（相似度 {p.ratio}）
                        </div>
                      ))}
                    </div>
                  )}
                  {audit.groups.length === 0 && audit.candidates.length === 0 && (
                    <p className="text-xs text-text-muted">未发现疑似重复实体，消歧状态良好。</p>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* 版本快照（09-17 P2-2）：每次重建自动留底最近 5 份，可一键回滚 */}
        <div className="card">
          <button
            onClick={() => setSnapOpen(!snapOpen)}
            className="w-full flex items-center gap-2 text-sm font-semibold text-text-primary"
          >
            {snapOpen ? <ChevronDown className="w-4 h-4 text-info" /> : <ChevronRight className="w-4 h-4 text-info" />}
            <History className="w-4 h-4 text-info" />
            版本快照
            {snapshots && snapshots.length > 0 && (
              <span className="text-[10px] text-text-muted font-normal ml-1">{snapshots.length} 份</span>
            )}
          </button>
          {snapOpen && (
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-text-muted">
                  每次重建图谱前自动留底旧图（保留最近 5 份），也可手动留底；回滚会恢复产物并重建关联数据。
                </p>
                <button
                  onClick={() => createMut.mutate()}
                  disabled={createMut.isPending}
                  className="shrink-0 ml-3 flex items-center gap-1 text-xs text-info hover:underline disabled:opacity-50"
                >
                  {createMut.isPending
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Camera className="w-3.5 h-3.5" />}
                  手动留底
                </button>
              </div>
              {snapLoading || !snapshots ? (
                <div className="flex items-center gap-2 text-xs text-text-muted py-4 justify-center">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> 读取快照…
                </div>
              ) : snapshots.length === 0 ? (
                <p className="text-xs text-text-muted">暂无快照。下次重建图谱时会自动留底第一份。</p>
              ) : (
                <div className="space-y-1.5">
                  {snapshots.map((s) => (
                    <div key={s.id} className="flex items-center gap-2 text-xs border border-border-color rounded-[2px] px-2.5 py-2">
                      <div className="flex-1 min-w-0">
                        <span className="text-text-primary font-medium">{s.created_at || s.id}</span>
                        <span className="text-text-muted ml-1.5">
                          {s.trigger === 'manual' ? '手动' : s.trigger === 'pre-rollback' ? '回滚前' : '自动'}留底
                          {s.nodes != null ? ` · ${s.nodes} 节点` : ''}
                          {s.edges != null ? ` · ${s.edges} 边` : ''}
                          {s.model ? ` · ${s.model}` : ''}
                        </span>
                      </div>
                      {confirmId === s.id ? (
                        <span className="flex items-center gap-2 shrink-0">
                          <span className="text-amber-300">确认回滚到此版？（当前图谱会自动留底一份「回滚前」快照）</span>
                          <button
                            onClick={() => rollbackMut.mutate(s.id)}
                            disabled={rollbackMut.isPending}
                            className="text-amber-300 font-medium hover:underline disabled:opacity-50"
                          >
                            {rollbackMut.isPending ? '回滚中…' : '确认'}
                          </button>
                          <button onClick={() => setConfirmId(null)} className="text-text-muted hover:underline">取消</button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmId(s.id)}
                          disabled={!s.has_graph}
                          className="shrink-0 flex items-center gap-1 text-info hover:underline disabled:opacity-40"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          回滚
                        </button>
                      )}
                    </div>
                  ))}
                  {rollbackMut.isError && (
                    <p className="text-[10px] text-amber-300">回滚失败：图谱可能正在构建中，稍后再试。</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default GraphReportPage;
