import { FC, useState } from 'react';
import { Trash2, Loader2, Undo2 } from 'lucide-react';
import { useRevertPipelineItem, useDeletePipelineItem } from '@/hooks/usePipeline';
import type { PipelineItem } from '@/api/pipeline';

const LABEL: Record<string, string> = {
  note: '笔记',
  knowledge: '内容',
  clip: '剪藏',
  rss: 'RSS',
  read_later: '稍后读',
  document: '文档',
};

interface PipelineItemActionsProps {
  item: PipelineItem;
  hideRevert?: boolean;
}

const PipelineItemActions: FC<PipelineItemActionsProps> = ({ item, hideRevert }) => {
  const revert = useRevertPipelineItem();
  const del = useDeletePipelineItem();
  const [revertBusy, setRevertBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const name = item.title || (item.content_raw || '').slice(0, 20) || '这条内容';
  const canRevert = !hideRevert && item.pipeline_stage && item.pipeline_stage !== 'raw';

  const handleRevert = async () => {
    if (!canRevert) return;
    if (!confirm(`将「${name}」退回为原始素材？`)) return;
    setRevertBusy(true);
    try {
      await revert.mutateAsync({ content_type: item.content_type, content_id: item.content_id });
    } catch (e) {
      console.error('退回失败', e);
      alert('退回失败，请重试');
    } finally {
      setRevertBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`删除${LABEL[item.content_type] || '内容'}「${name}」？\n（软删除，数据保留可恢复）`)) return;
    setDeleteBusy(true);
    try {
      await del.mutateAsync({ content_type: item.content_type, content_id: item.content_id });
    } catch (e) {
      console.error('删除失败', e);
      alert('删除失败，请重试');
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {canRevert && (
        <button
          onClick={handleRevert}
          disabled={revertBusy}
          title="退回原始素材"
          className="flex items-center justify-center p-1.5 bg-white/[0.03] border border-white/[0.08] rounded-[2px] text-text-muted hover:bg-warning/10 hover:border-warning/30 hover:text-warning transition-all disabled:opacity-50"
        >
          {revertBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Undo2 className="w-3.5 h-3.5" />}
        </button>
      )}
      <button
        onClick={handleDelete}
        disabled={deleteBusy}
        title="删除（可恢复）"
        className="flex items-center justify-center p-1.5 bg-white/[0.03] border border-white/[0.08] rounded-[2px] text-text-muted hover:bg-danger/10 hover:border-danger/30 hover:text-danger transition-all disabled:opacity-50"
      >
        {deleteBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
};

export default PipelineItemActions;
