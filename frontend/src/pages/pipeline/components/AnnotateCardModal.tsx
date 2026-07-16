import { FC, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, Save, Pencil } from 'lucide-react';
import type { PipelineItem } from '@/api/pipeline';
import type { KnowledgeUpdateData } from '@/api/knowledge';

interface AnnotateCardModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: PipelineItem | null;
  onSave: (id: string, data: KnowledgeUpdateData) => Promise<void>;
  isSaving?: boolean;
}

const EVOLUTION_STAGES = [
  { value: 'collected', label: '已收集' },
  { value: 'understood', label: '已理解' },
  { value: 'practiced', label: '已实践' },
  { value: 'validated', label: '已验证' },
  { value: 'internalized', label: '已内化' },
];

const AnnotateCardModal: FC<AnnotateCardModalProps> = ({
  isOpen,
  onClose,
  item,
  onSave,
  isSaving = false,
}) => {
  const [contentRaw, setContentRaw] = useState('');
  const [contentProcessed, setContentProcessed] = useState('');
  const [relevance, setRelevance] = useState<number>(0.5);
  const [practiceDepth, setPracticeDepth] = useState<number>(0);
  const [evolutionStage, setEvolutionStage] = useState<string>('collected');

  useEffect(() => {
    if (item) {
      setContentRaw(item.content_raw || '');
      setContentProcessed(item.content_processed || '');
      // Defaults are mid-values; callers may extend the schema to return these fields.
      setRelevance(0.5);
      setPracticeDepth(0);
      setEvolutionStage('collected');
    }
  }, [item]);

  if (!item) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSave(item.content_id, {
      content_raw: contentRaw.trim() || undefined,
      content_processed: contentProcessed.trim() || undefined,
      personal_relevance_score: relevance,
      practice_depth: practiceDepth,
      evolution_stage: evolutionStage,
    });
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl bg-bg-secondary border border-border-color rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
          >
            <form onSubmit={handleSubmit} className="flex flex-col h-full">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border-color shrink-0">
                <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
                  <Pencil className="w-4 h-4 text-personal-primary" />
                  注卡编辑
                </h3>
                <button
                  type="button"
                  onClick={onClose}
                  className="p-1 rounded-lg hover:bg-white/[0.05] text-text-muted"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-4 overflow-y-auto">
                <div>
                  <label className="block text-xs text-text-muted mb-1.5">卡片内容</label>
                  <textarea
                    value={contentRaw}
                    onChange={(e) => setContentRaw(e.target.value)}
                    rows={4}
                    className="w-full bg-bg-primary border border-border-color rounded-xl p-3 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-info/40 transition-colors resize-none"
                    placeholder="记录这个洞见的核心内容..."
                  />
                </div>

                <div>
                  <label className="block text-xs text-text-muted mb-1.5">个人注记 / 语境</label>
                  <textarea
                    value={contentProcessed}
                    onChange={(e) => setContentProcessed(e.target.value)}
                    rows={4}
                    className="w-full bg-bg-primary border border-border-color rounded-xl p-3 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-info/40 transition-colors resize-none"
                    placeholder="它让我想到什么？当时的情绪、身体状态、下一步行动..."
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-text-muted mb-1.5">
                      个人相关度: <span className="text-text-primary">{relevance.toFixed(1)}</span>
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.1}
                      value={relevance}
                      onChange={(e) => setRelevance(parseFloat(e.target.value))}
                      className="w-full accent-personal-primary"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-text-muted mb-1.5">实践深度</label>
                    <select
                      value={practiceDepth}
                      onChange={(e) => setPracticeDepth(parseInt(e.target.value, 10))}
                      className="w-full bg-bg-primary border border-border-color rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-info/40"
                    >
                      {[0, 1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>
                          {n} - {n === 0 ? '未实践' : n === 5 ? '已内化' : `Level ${n}`}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-text-muted mb-1.5">进化阶段</label>
                  <select
                    value={evolutionStage}
                    onChange={(e) => setEvolutionStage(e.target.value)}
                    className="w-full bg-bg-primary border border-border-color rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-info/40"
                  >
                    {EVOLUTION_STAGES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border-color shrink-0">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl text-xs text-text-secondary hover:bg-white/[0.05] transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex items-center gap-2 px-4 py-2 bg-personal-primary text-white rounded-xl text-xs font-medium hover:bg-personal-primary/90 transition-colors disabled:opacity-60"
                >
                  {isSaving ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  保存注卡
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default AnnotateCardModal;
