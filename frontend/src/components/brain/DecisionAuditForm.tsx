import { FC, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, X, Calendar, Brain, Save, Loader2 } from 'lucide-react';
import { DecisionOption, DecisionAuditCreateRequest, BrainSide } from '@/api/cognitive';

interface Props {
  initial?: Partial<DecisionAuditCreateRequest>;
  onSubmit: (data: DecisionAuditCreateRequest) => void;
  onCancel: () => void;
  loading?: boolean;
}

export const DecisionAuditForm: FC<Props> = ({ initial, onSubmit, onCancel, loading }) => {
  const [title, setTitle] = useState(initial?.title || '');
  const [context, setContext] = useState(initial?.context || '');
  const [options, setOptions] = useState<DecisionOption[]>(
    initial?.options?.length ? initial.options : [{ id: '1', text: '', pros: '', cons: '' }]
  );
  const [expectedOutcome, setExpectedOutcome] = useState(initial?.expected_outcome || '');
  const [actualOutcome, setActualOutcome] = useState(initial?.actual_outcome || '');
  const [decisionDate, setDecisionDate] = useState(initial?.decision_date ? initial.decision_date.slice(0, 10) : '');
  const [brainSide, setBrainSide] = useState<BrainSide>((initial?.brain_side as BrainSide) || 'personal');

  const addOption = () => {
    setOptions([...options, { id: String(Date.now()), text: '', pros: '', cons: '' }]);
  };

  const removeOption = (id: string) => {
    if (options.length <= 1) return;
    setOptions(options.filter((o) => o.id !== id));
  };

  const updateOption = (id: string, field: keyof DecisionOption, value: string) => {
    setOptions(options.map((o) => (o.id === id ? { ...o, [field]: value } : o)));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      title: title.trim(),
      context: context.trim(),
      options: options.filter((o) => o.text.trim()),
      expected_outcome: expectedOutcome.trim() || undefined,
      actual_outcome: actualOutcome.trim() || undefined,
      decision_date: decisionDate ? new Date(decisionDate).toISOString() : undefined,
      brain_side: brainSide,
    });
  };

  return (
    <motion.form
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      onSubmit={handleSubmit}
      className="glass-card p-6 space-y-5"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-fusion-primary" />
          <h3 className="text-lg font-bold text-text-primary">{initial?.title ? '编辑审计' : '新建决策审计'}</h3>
        </div>
        <button type="button" onClick={onCancel} className="text-text-muted hover:text-danger transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm text-text-secondary">决策标题</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例如：是否接受这份工作"
            className="w-full px-4 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-fusion-primary/50"
            required
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm text-text-secondary flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5" /> 决策日期
          </label>
          <input
            type="date"
            value={decisionDate}
            onChange={(e) => setDecisionDate(e.target.value)}
            className="w-full px-4 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-text-primary focus:outline-none focus:border-fusion-primary/50"
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm text-text-secondary">决策背景</label>
        <textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder="描述你面临的选择、限制条件、关键信息等..."
          rows={4}
          className="w-full px-4 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-fusion-primary/50 resize-none"
          required
        />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm text-text-secondary">可选方案</label>
          <button
            type="button"
            onClick={addOption}
            className="text-xs flex items-center gap-1 text-fusion-primary hover:text-fusion-primary/80 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> 添加方案
          </button>
        </div>
        <AnimatePresence>
          {options.map((opt, idx) => (
            <motion.div
              key={opt.id}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.05] space-y-3"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-fusion-primary">方案 {idx + 1}</span>
                {options.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeOption(opt.id)}
                    className="ml-auto text-text-muted hover:text-danger transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              <input
                value={opt.text}
                onChange={(e) => updateOption(opt.id, 'text', e.target.value)}
                placeholder="方案描述"
                className="w-full px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-fusion-primary/50 text-sm"
              />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  value={opt.pros || ''}
                  onChange={(e) => updateOption(opt.id, 'pros', e.target.value)}
                  placeholder="优点 / 支持理由"
                  className="w-full px-3 py-2 rounded-lg bg-success/5 border border-success/10 text-text-primary placeholder:text-text-muted focus:outline-none focus:border-success/30 text-sm"
                />
                <input
                  value={opt.cons || ''}
                  onChange={(e) => updateOption(opt.id, 'cons', e.target.value)}
                  placeholder="缺点 / 风险"
                  className="w-full px-3 py-2 rounded-lg bg-danger/5 border border-danger/10 text-text-primary placeholder:text-text-muted focus:outline-none focus:border-danger/30 text-sm"
                />
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm text-text-secondary">预期结果</label>
          <textarea
            value={expectedOutcome}
            onChange={(e) => setExpectedOutcome(e.target.value)}
            placeholder="你当时希望发生什么？"
            rows={3}
            className="w-full px-4 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-fusion-primary/50 resize-none text-sm"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm text-text-secondary">实际结果（可选）</label>
          <textarea
            value={actualOutcome}
            onChange={(e) => setActualOutcome(e.target.value)}
            placeholder="实际发生了什么？"
            rows={3}
            className="w-full px-4 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-fusion-primary/50 resize-none text-sm"
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm text-text-secondary">所属脑侧</label>
        <div className="flex gap-3">
          {(['personal', 'network', 'both'] as BrainSide[]).map((side) => (
            <button
              key={side}
              type="button"
              onClick={() => setBrainSide(side)}
              className={`px-4 py-2 rounded-lg text-sm border transition-colors ${
                brainSide === side
                  ? 'bg-fusion-primary/10 border-fusion-primary/30 text-fusion-primary'
                  : 'bg-white/[0.03] border-white/[0.08] text-text-secondary hover:text-text-primary'
              }`}
            >
              {side === 'personal' ? '个人脑' : side === 'network' ? '网络脑' : '双脑'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancel} className="btn-secondary">
          取消
        </button>
        <button
          type="submit"
          disabled={loading || !title.trim() || !context.trim()}
          className="btn-primary flex items-center gap-2 disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          <span>{loading ? '保存中...' : '保存'}</span>
        </button>
      </div>
    </motion.form>
  );
};

export default DecisionAuditForm;
