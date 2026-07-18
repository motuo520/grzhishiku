import { FC, useState } from 'react';
import { Trash2, Loader2 } from 'lucide-react';
import { useDeletePipelineItem } from '@/hooks/usePipeline';
import type { PipelineItem } from '@/api/pipeline';

const LABEL: Record<string, string> = {
  note: '笔记',
  knowledge: '内容',
  clip: '剪藏',
  rss: 'RSS',
  read_later: '稍后读',
  document: '文档',
};

const PipelineItemDeleteButton: FC<{ item: PipelineItem }> = ({ item }) => {
  const del = useDeletePipelineItem();
  const [busy, setBusy] = useState(false);

  const handle = async () => {
    const name = item.title || (item.content_raw || '').slice(0, 20) || '这条内容';
    if (!confirm(`删除${LABEL[item.content_type] || '内容'}「${name}」？\n（软删除，数据保留可恢复）`)) return;
    setBusy(true);
    try {
      await del.mutateAsync({ content_type: item.content_type, content_id: item.content_id });
    } catch (e) {
      console.error('删除失败', e);
      alert('删除失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={handle}
      disabled={busy}
      title="删除（可恢复）"
      className="flex items-center justify-center p-1.5 bg-white/[0.03] border border-white/[0.08] rounded-[2px] text-text-muted hover:bg-danger/10 hover:border-danger/30 hover:text-danger transition-all disabled:opacity-50 shrink-0"
    >
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
    </button>
  );
};

export default PipelineItemDeleteButton;
