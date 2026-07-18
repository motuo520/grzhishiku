import { FC, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, Save, Tag } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { emergenceApi, type BrainSide } from '@/api/emergence';

interface SaveIdeaModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTitle: string;
  summary: string;
  brainSide?: BrainSide;
  sourceResultIds?: string[];
  onSaved?: () => void;
}

const SaveIdeaModal: FC<SaveIdeaModalProps> = ({
  isOpen,
  onClose,
  defaultTitle,
  summary,
  brainSide = 'both',
  sourceResultIds = [],
  onSaved,
}) => {
  const [title, setTitle] = useState(defaultTitle);
  const [tags, setTags] = useState('');
  const queryClient = useQueryClient();

  const { mutate, isPending, error } = useMutation({
    mutationFn: emergenceApi.saveIdea,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emergence', 'ideas'] });
      onSaved?.();
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    mutate({
      title: title.trim(),
      summary: summary.trim(),
      brain_side: brainSide,
      source_result_ids: sourceResultIds,
      tags: tags
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean),
      status: 'saved',
    });
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg bg-bg-secondary border border-border-color rounded-2xl shadow-2xl overflow-hidden"
          >
            <form onSubmit={handleSubmit}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-border-color">
                <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
                  <Save className="w-4 h-4 text-info" />
                  保存到成果库
                </h3>
                <button
                  type="button"
                  onClick={onClose}
                  className="p-1 rounded-lg hover:bg-white/[0.05] text-text-muted"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                {error && (
                  <div className="px-3 py-2 rounded-lg bg-danger/10 border border-danger/30 text-danger text-xs">
                    保存失败，请重试
                  </div>
                )}

                <div>
                  <label className="block text-xs text-text-muted mb-1.5">标题</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="给这个创意起个名字..."
                    className="input"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-xs text-text-muted mb-1.5">标签</label>
                  <div className="relative">
                    <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                    <input
                      type="text"
                      value={tags}
                      onChange={(e) => setTags(e.target.value)}
                      placeholder="用逗号分隔多个标签..."
                      className="w-full pl-10 input"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-text-muted mb-1.5">摘要预览</label>
                  <div className="max-h-32 overflow-y-auto rounded-xl bg-bg-primary border border-border-color p-3 text-xs text-text-secondary leading-relaxed">
                    {summary || '无摘要'}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border-color">
                <button type="button" onClick={onClose} className="btn-secondary text-xs py-2 px-4">
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isPending || !title.trim()}
                  className="btn-primary flex items-center gap-2 text-xs py-2 px-4 disabled:opacity-60"
                >
                  {isPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  保存
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default SaveIdeaModal;
