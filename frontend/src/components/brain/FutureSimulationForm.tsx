import { FC, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, X, GitBranch, Save, Loader2, Brain, Globe, Layers, Link2 } from 'lucide-react';
import { SimulationScenario, FutureSimulationCreateRequest, DecisionAudit } from '@/api/cognitive';

interface Props {
  initial?: Partial<FutureSimulationCreateRequest>;
  audits?: DecisionAudit[];
  onSubmit: (data: FutureSimulationCreateRequest) => void;
  onCancel: () => void;
  loading?: boolean;
}

export const FutureSimulationForm: FC<Props> = ({ initial, audits = [], onSubmit, onCancel, loading }) => {
  const [title, setTitle] = useState(initial?.title || '');
  const [context, setContext] = useState(initial?.context || '');
  const [variables, setVariables] = useState<string[]>(initial?.variables?.length ? initial.variables : ['']);
  const [scenarios, setScenarios] = useState<SimulationScenario[]>(
    initial?.scenarios?.length
      ? initial.scenarios
      : [{ name: '乐观情景', assumptions: ['市场持续增长', '资源充足'], probability: 30 }]
  );
  const [timeframes, setTimeframes] = useState<string[]>(
    initial?.timeframes?.length ? initial.timeframes : ['1周', '1个月', '1年']
  );
  const [brainSide, setBrainSide] = useState<string>(initial?.brain_side || 'both');
  const [relatedAuditId, setRelatedAuditId] = useState<string>(initial?.related_audit_id || '');

  const addVariable = () => setVariables([...variables, '']);
  const updateVariable = (idx: number, value: string) => {
    const next = [...variables];
    next[idx] = value;
    setVariables(next);
  };
  const removeVariable = (idx: number) => {
    if (variables.length <= 1) return;
    setVariables(variables.filter((_, i) => i !== idx));
  };

  const addScenario = () => {
    setScenarios([...scenarios, { name: '', assumptions: [''], probability: 50 }]);
  };
  const updateScenario = (idx: number, field: keyof SimulationScenario, value: any) => {
    const next = [...scenarios];
    next[idx] = { ...next[idx], [field]: value };
    setScenarios(next);
  };
  const updateScenarioAssumption = (sIdx: number, aIdx: number, value: string) => {
    const next = [...scenarios];
    next[sIdx].assumptions[aIdx] = value;
    setScenarios(next);
  };
  const addAssumption = (sIdx: number) => {
    const next = [...scenarios];
    next[sIdx].assumptions.push('');
    setScenarios(next);
  };
  const removeAssumption = (sIdx: number, aIdx: number) => {
    const next = [...scenarios];
    if (next[sIdx].assumptions.length <= 1) return;
    next[sIdx].assumptions = next[sIdx].assumptions.filter((_, i) => i !== aIdx);
    setScenarios(next);
  };
  const removeScenario = (idx: number) => {
    if (scenarios.length <= 1) return;
    setScenarios(scenarios.filter((_, i) => i !== idx));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      title: title.trim(),
      context: context.trim(),
      variables: variables.map((v) => v.trim()).filter(Boolean),
      scenarios: scenarios
        .filter((s) => s.name.trim())
        .map((s) => ({ ...s, assumptions: s.assumptions.map((a) => a.trim()).filter(Boolean) })),
      timeframes: timeframes.filter(Boolean),
      brain_side: brainSide,
      related_audit_id: relatedAuditId || undefined,
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
          <GitBranch className="w-5 h-5 text-fusion-primary" />
          <h3 className="text-lg font-bold text-text-primary">{initial?.title ? '编辑模拟' : '新建未来模拟'}</h3>
        </div>
        <button type="button" onClick={onCancel} className="text-text-muted hover:text-danger transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="space-y-2">
        <label className="text-sm text-text-secondary">模拟标题</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例如：如果我开始远程工作，未来一年会怎样？"
          className="w-full px-4 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-fusion-primary/50"
          required
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm text-text-secondary">决策背景与假设</label>
        <textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder="描述你正在考虑的决策、当前约束、已知信息等..."
          rows={4}
          className="w-full px-4 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-fusion-primary/50 resize-none"
          required
        />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm text-text-secondary">关键变量</label>
          <button
            type="button"
            onClick={addVariable}
            className="text-xs flex items-center gap-1 text-fusion-primary hover:text-fusion-primary/80 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> 添加变量
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {variables.map((v, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input
                value={v}
                onChange={(e) => updateVariable(idx, e.target.value)}
                placeholder={`变量 ${idx + 1}`}
                className="flex-1 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-fusion-primary/50 text-sm"
              />
              {variables.length > 1 && (
                <button type="button" onClick={() => removeVariable(idx)} className="text-text-muted hover:text-danger">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm text-text-secondary">情景设定</label>
          <button
            type="button"
            onClick={addScenario}
            className="text-xs flex items-center gap-1 text-fusion-primary hover:text-fusion-primary/80 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> 添加情景
          </button>
        </div>
        <AnimatePresence>
          {scenarios.map((scenario, sIdx) => (
            <motion.div
              key={sIdx}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.05] space-y-3"
            >
              <div className="flex items-center gap-2">
                <input
                  value={scenario.name}
                  onChange={(e) => updateScenario(sIdx, 'name', e.target.value)}
                  placeholder="情景名称"
                  className="flex-1 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-fusion-primary/50 text-sm"
                />
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={scenario.probability}
                  onChange={(e) => updateScenario(sIdx, 'probability', Number(e.target.value))}
                  className="w-20 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-text-primary focus:outline-none focus:border-fusion-primary/50 text-sm"
                />
                <span className="text-xs text-text-muted">%</span>
                {scenarios.length > 1 && (
                  <button type="button" onClick={() => removeScenario(sIdx)} className="text-text-muted hover:text-danger">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {scenario.assumptions.map((assumption, aIdx) => (
                  <div key={aIdx} className="flex items-center gap-2">
                    <input
                      value={assumption}
                      onChange={(e) => updateScenarioAssumption(sIdx, aIdx, e.target.value)}
                      placeholder={`假设 ${aIdx + 1}`}
                      className="flex-1 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-fusion-primary/50 text-sm"
                    />
                    {scenario.assumptions.length > 1 && (
                      <button type="button" onClick={() => removeAssumption(sIdx, aIdx)} className="text-text-muted hover:text-danger">
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => addAssumption(sIdx)}
                  className="text-xs text-fusion-primary hover:text-fusion-primary/80 flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> 添加假设
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <div className="space-y-2">
        <label className="text-sm text-text-secondary">时间尺度</label>
        <div className="flex flex-wrap gap-2">
          {timeframes.map((tf, idx) => (
            <input
              key={idx}
              value={tf}
              onChange={(e) => {
                const next = [...timeframes];
                next[idx] = e.target.value;
                setTimeframes(next);
              }}
              className="w-24 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-text-primary text-center text-sm focus:outline-none focus:border-fusion-primary/50"
            />
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm text-text-secondary">参考脑侧</label>
        <div className="flex gap-3">
          {[
            { value: 'personal', label: '个人脑', icon: Brain },
            { value: 'network', label: '网络脑', icon: Globe },
            { value: 'both', label: '双脑融合', icon: Layers },
          ].map((side) => {
            const Icon = side.icon;
            return (
              <button
                key={side.value}
                type="button"
                onClick={() => setBrainSide(side.value)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm border transition-colors ${
                  brainSide === side.value
                    ? 'bg-fusion-primary/10 border-fusion-primary/30 text-fusion-primary'
                    : 'bg-white/[0.03] border-white/[0.08] text-text-secondary hover:text-text-primary'
                }`}
              >
                <Icon className="w-4 h-4" />
                {side.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm text-text-secondary flex items-center gap-1.5">
          <Link2 className="w-3.5 h-3.5" />
          关联决策审计（可选）
        </label>
        <select
          value={relatedAuditId}
          onChange={(e) => setRelatedAuditId(e.target.value)}
          className="w-full px-4 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-text-primary text-sm focus:outline-none focus:border-fusion-primary/50"
        >
          <option value="">不关联决策审计</option>
          {audits.map((audit) => (
            <option key={audit.id} value={audit.id}>
              {audit.title}
            </option>
          ))}
        </select>
        {audits.length === 0 && (
          <p className="text-xs text-text-muted">暂无决策审计，可先在「决策审计」中创建。</p>
        )}
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

export default FutureSimulationForm;
