import { FC, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Link2, X, Loader2 } from 'lucide-react';
import { graphApi, type ManualEdgeListItem } from '@/api/graph';

interface ManualLinksPanelProps {
  contentId: string;
  // 建边成功后父组件递增此值触发刷新
  refreshKey?: number;
}

const TYPE_LABELS: Record<string, string> = {
  note: '笔记',
  capsule: '胶囊',
  clip: '剪藏',
  knowledge: '知识',
};

// 跳转口径同 GraphNetworkPage.getSourceRoute（graph 页 125-136 行）
const getPeerRoute = (type: string, id: string): string | undefined => {
  switch (type) {
    case 'note':
      return `/ingest/notes/${encodeURIComponent(id)}`;
    case 'clip':
      return `/ingest/clipper?highlight=${encodeURIComponent(id)}`;
    case 'knowledge':
      return `/knowledge/${encodeURIComponent(id)}`;
    default:
      return undefined;
  }
};

const ManualLinksPanel: FC<ManualLinksPanelProps> = ({ contentId, refreshKey = 0 }) => {
  const navigate = useNavigate();
  const [edges, setEdges] = useState<ManualEdgeListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await graphApi.listEdges(contentId);
      setEdges(res.data.edges || []);
      setError(null);
    } catch (err: any) {
      setError(err.message || '关联加载失败');
    }
  }, [contentId]);

  useEffect(() => {
    if (contentId) load();
  }, [contentId, refreshKey, load]);

  const handleRemove = async (edgeId: string) => {
    if (removingId) return;
    setRemovingId(edgeId);
    try {
      await graphApi.deleteEdge(edgeId);
      setEdges((prev) => prev.filter((e) => e.id !== edgeId));
    } catch (err: any) {
      setError(err.message || '解除关联失败');
    } finally {
      setRemovingId(null);
    }
  };

  if (edges.length === 0 && !error) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium text-text-muted flex items-center gap-1.5">
        <Link2 className="w-3.5 h-3.5" />
        手动关联
      </h3>
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="space-y-1.5">
        {edges.map((e) => {
          const peer = e.peer;
          const route = peer ? getPeerRoute(peer.type, peer.id) : undefined;
          return (
            <div
              key={e.id}
              className="flex items-center gap-2 px-3 py-2 rounded-[2px] bg-white/[0.03] border border-white/[0.08]"
            >
              <button
                type="button"
                disabled={!route}
                onClick={() => route && navigate(route)}
                className={`flex-1 min-w-0 text-left text-xs truncate ${route ? 'text-info hover:underline' : 'text-text-secondary cursor-default'}`}
              >
                {peer?.title || '(内容已删除)'}
              </button>
              {peer && (
                <span className="px-1.5 py-0.5 rounded-md text-[10px] border shrink-0 bg-white/[0.03] text-text-secondary border-white/[0.08]">
                  {TYPE_LABELS[peer.type] || peer.type}
                </span>
              )}
              <button
                type="button"
                onClick={() => handleRemove(e.id)}
                disabled={removingId === e.id}
                title="解除关联"
                className="p-1 rounded-[2px] text-text-muted hover:text-danger hover:bg-white/[0.05] transition-colors shrink-0 disabled:opacity-50"
              >
                {removingId === e.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ManualLinksPanel;
