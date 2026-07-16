import { FC, useMemo, useState } from 'react';
import { Route, ArrowLeftRight, Loader2, AlertCircle } from 'lucide-react';
import { useGraphifyStatus, useGraphifyGraph, useGraphifyPath } from '@/hooks/useGraphify';
import type { GraphifyTextResult, GraphifyNode } from '@/api/graphify';

const GraphPathPage: FC = () => {
  const { data: status, isLoading: statusLoading } = useGraphifyStatus();
  const { data: graphData } = useGraphifyGraph(Boolean(status?.has_graph));
  const pathQuery = useGraphifyPath();

  // 输入框显示文本（label）与真正提交的节点 ID 分离，避免同名节点歧义
  const [aInput, setAInput] = useState('');
  const [bInput, setBInput] = useState('');
  const [aId, setAId] = useState('');
  const [bId, setBId] = useState('');
  const [result, setResult] = useState<GraphifyTextResult | null>(null);

  const nodes = useMemo(() => graphData?.nodes || [], [graphData]);

  const nodeById = useMemo(() => {
    const map = new Map<string, GraphifyNode>();
    nodes.forEach((n) => map.set(n.id, n));
    return map;
  }, [nodes]);

  const handleAChange = (value: string) => {
    setResult(null);
    const trimmed = value.trim();
    const byId = nodeById.get(trimmed);
    if (byId) {
      // 从 datalist 选中的是 node id，输入框回显为 label
      setAInput(byId.label);
      setAId(byId.id);
      return;
    }
    setAInput(value);
    const byLabel = nodes.find((n) => n.label === trimmed);
    setAId(byLabel?.id || '');
  };

  const handleBChange = (value: string) => {
    setResult(null);
    const trimmed = value.trim();
    const byId = nodeById.get(trimmed);
    if (byId) {
      setBInput(byId.label);
      setBId(byId.id);
      return;
    }
    setBInput(value);
    const byLabel = nodes.find((n) => n.label === trimmed);
    setBId(byLabel?.id || '');
  };

  const swap = () => {
    setAInput(bInput);
    setBInput(aInput);
    setAId(bId);
    setBId(aId);
    setResult(null);
  };

  const search = () => {
    if (!aId || !bId || aId === bId || pathQuery.isPending) return;
    pathQuery.mutate(
      { a: aId, b: bId },
      {
        onSuccess: (data) => setResult(data),
        onError: (err: any) => setResult({ ok: false, error: err?.message || '查询失败' }),
      }
    );
  };

  // 未构建图谱时的引导
  if (!statusLoading && !status?.has_graph) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-6">
        <Route className="w-12 h-12 text-text-muted mb-4" />
        <div className="text-text-primary font-semibold mb-2">知识图谱尚未构建</div>
        <div className="text-sm text-text-secondary max-w-md">
          请先在「知识网络」页点击「重建图谱」，构建完成后即可探索两个知识点之间的连接路径。
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">路径探索</h1>
          <p className="text-sm text-text-secondary mt-1">发现两个知识点之间的最短连接路径</p>
        </div>

        <div className="card flex flex-wrap items-center gap-3">
          <input
            type="text"
            list="graphify-node-options"
            value={aInput}
            onChange={(e) => handleAChange(e.target.value)}
            placeholder="起点节点..."
            className="flex-1 min-w-[180px] bg-bg-tertiary border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-text-primary outline-none focus:border-info/50"
          />
          <button
            onClick={swap}
            className="p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-white/[0.06] transition-colors"
            title="交换起点和终点"
          >
            <ArrowLeftRight className="w-4 h-4" />
          </button>
          <input
            type="text"
            list="graphify-node-options"
            value={bInput}
            onChange={(e) => handleBChange(e.target.value)}
            placeholder="终点节点..."
            className="flex-1 min-w-[180px] bg-bg-tertiary border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-text-primary outline-none focus:border-info/50"
          />
          <datalist id="graphify-node-options">
            {nodes.map((n) => (
              <option key={n.id} value={n.id} label={`${n.label}${n.file_type ? ` (${n.file_type})` : ''}`} />
            ))}
          </datalist>
          <button
            onClick={search}
            disabled={!aId || !bId || aId === bId || pathQuery.isPending}
            className="btn-primary flex items-center gap-2 disabled:opacity-50"
          >
            {pathQuery.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Route className="w-4 h-4" />}
            探索路径
          </button>
        </div>

        {result && (
          <div className={`card ${result.ok ? '' : 'border border-red-400/25 bg-red-400/5'}`}>
            {result.ok ? (
              <div className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">
                {result.result}
              </div>
            ) : (
              <div className="text-sm text-red-400 flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {result.error || '查询失败'}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default GraphPathPage;
