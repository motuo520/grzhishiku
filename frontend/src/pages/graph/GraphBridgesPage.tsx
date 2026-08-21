import { FC, useMemo, useState } from 'react';
import { GitMerge, Brain, Globe, Loader2, AlertCircle } from 'lucide-react';
import { useGraphBridges } from '@/hooks/useGraph';

const BRIDGE_TYPE_LABELS: Record<string, string> = {
  graphify: '语义图谱',
  tag: '标签',
  similar: '相似',
  support: '支撑',
  semantic: '向量',
  collision: '碰撞',
  reference: '引用',
  source: '同源',
  contradict: '矛盾',
};

const bridgeTypeLabel = (type: string) => BRIDGE_TYPE_LABELS[type] || type;

const GraphBridgesPage: FC = () => {
  // 递增加载：后端无 offset，靠放大 limit 重取；上限与后端 le=1000 对齐
  const [limit, setLimit] = useState(50);
  const { data, isLoading, error } = useGraphBridges(limit);
  const bridges = useMemo(() => data?.bridges || [], [data]);

  // 顶部统计：总数、平均强度、graphify 语义边占比
  const stats = useMemo(() => {
    if (bridges.length === 0) return null;
    const avg = bridges.reduce((sum, b) => sum + (b.strength || 0), 0) / bridges.length;
    const graphifyCount = bridges.filter((b) => b.type === 'graphify').length;
    return {
      total: data?.total ?? bridges.length,
      avg,
      graphifyRatio: graphifyCount / bridges.length,
    };
  }, [bridges, data]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-info" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-6">
        <AlertCircle className="w-12 h-12 text-red-400 mb-4" />
        <div className="text-sm text-text-secondary">{(error as any)?.message || '加载失败'}</div>
      </div>
    );
  }

  if (bridges.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-6">
        <GitMerge className="w-12 h-12 text-text-muted mb-4" />
        <div className="text-text-primary font-semibold mb-2">还没有跨脑桥梁</div>
        <div className="text-sm text-text-secondary max-w-md">
          写笔记和剪藏后，系统会自动发现个人脑与网络脑之间的连接。
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">跨脑桥梁</h1>
          <p className="text-sm text-text-secondary mt-1">连接个人脑与网络脑的关键关联</p>
        </div>

        {stats && (
          <div className="glass-card px-4 py-3 rounded-xl flex flex-wrap items-center gap-6 text-xs text-text-secondary">
            <span>
              桥梁总数 <span className="text-text-primary font-semibold">{stats.total}</span>
            </span>
            <span>
              平均强度 <span className="text-text-primary font-semibold">{(stats.avg * 100).toFixed(0)}%</span>
            </span>
            <span>
              语义图谱边占比 <span className="text-text-primary font-semibold">{(stats.graphifyRatio * 100).toFixed(0)}%</span>
            </span>
          </div>
        )}

        <div className="space-y-3">
          {bridges.map((bridge) => (
            <div key={bridge.edge_id} className="card">
              <div className="flex items-center gap-3">
                {/* 个人脑节点 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Brain className="w-3 h-3 text-[#d29922] shrink-0" />
                    <span className="text-[10px] text-[#d29922] font-medium">个人脑</span>
                  </div>
                  <div className="text-sm text-text-primary truncate">{bridge.personal_node.label}</div>
                </div>

                {/* 中间：边类型 + 强度条 */}
                <div className="flex flex-col items-center gap-1.5 shrink-0 w-28">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-info/15 text-info border border-info/25">
                    {bridgeTypeLabel(bridge.type)}
                  </span>
                  <div className="w-full h-1 rounded-full bg-white/[0.06] overflow-hidden">
                    <div
                      className="h-full bg-info rounded-full"
                      style={{ width: `${Math.round(Math.max(0, Math.min(1, bridge.strength || 0)) * 100)}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-text-muted">{((bridge.strength || 0) * 100).toFixed(0)}%</span>
                </div>

                {/* 网络脑节点 */}
                <div className="flex-1 min-w-0 text-right">
                  <div className="flex items-center gap-1.5 mb-1 justify-end">
                    <span className="text-[10px] text-info font-medium">网络脑</span>
                    <Globe className="w-3 h-3 text-info shrink-0" />
                  </div>
                  <div className="text-sm text-text-primary truncate">{bridge.network_node.label}</div>
                </div>
              </div>

              {bridge.context && (
                <div className="mt-3 pt-3 border-t border-white/[0.06] text-xs text-text-secondary line-clamp-2">
                  {bridge.context}
                </div>
              )}
            </div>
          ))}
          {data && data.total > bridges.length && (
            limit < 1000 ? (
              <button
                onClick={() => setLimit((l) => Math.min(l + 200, 1000))}
                className="w-full py-2.5 rounded-xl border border-white/[0.08] text-xs text-text-secondary hover:text-text-primary hover:border-white/[0.15] transition-colors"
              >
                加载更多（已显示 {bridges.length} / 共 {data.total}）
              </button>
            ) : (
              <p className="text-center text-xs text-text-muted py-2">已达上限，仅显示强度最高的 1000 条</p>
            )
          )}
        </div>
      </div>
    </div>
  );
};

export default GraphBridgesPage;
