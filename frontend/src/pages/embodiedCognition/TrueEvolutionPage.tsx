import { FC, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useNavigation } from '@/store/navigation';
import { useEmbodied } from '@/hooks/useEmbodied';
import { useNotes } from '@/hooks/useNotes';
import { useKnowledge } from '@/hooks/useKnowledge';
import { useExperimentLogs } from '@/hooks/useJianghu';
import ModelSelector from '@/components/llm/ModelSelector';
import LLMCostBadge from '@/components/llm/LLMCostBadge';
import {
  TrendingUp, Plus, Loader2, Save, Trash2, Edit3, X, Sparkles,
  CheckCircle2, XCircle, ChevronRight, AlertTriangle, Lightbulb,
  BookOpen, FileText, FlaskConical
} from 'lucide-react';
import type { EvolutionReflection } from '@/api/embodied';

const DISCOMFORT_OPTIONS = [
  { value: 1, label: '轻微不适', color: 'text-success' },
  { value: 2, label: '有点难受', color: 'text-info' },
  { value: 3, label: '明显痛苦', color: 'text-warning' },
  { value: 4, label: '相当煎熬', color: 'text-orange-400' },
  { value: 5, label: '极度挣扎', color: 'text-danger' },
];

const RELATED_TYPE_OPTIONS: { value: EvolutionReflection['related_content_type']; label: string; icon: React.ElementType }[] = [
  { value: 'note', label: '笔记', icon: FileText },
  { value: 'knowledge_unit', label: '知识单元', icon: BookOpen },
  { value: 'experiment_log', label: '实验记录', icon: FlaskConical },
];

const EMPTY_FORM = {
  title: '',
  discomfort_level: 3,
  pain_description: '',
  joy_description: '',
  learning: '',
  is_true_evolution: true,
  related_content_type: undefined as EvolutionReflection['related_content_type'],
  related_content_id: '',
};

const TrueEvolutionPage: FC = () => {
  const navigate = useNavigate();
  const { brainSide } = useNavigation();
  const {
    evolutionReflections,
    isLoadingEvolutionReflections,
    evolutionReflectionsError,
    createEvolutionReflection,
    updateEvolutionReflection,
    deleteEvolutionReflection,
    analyzeEvolutionReflections,
    isCreatingEvolutionReflection,
    isUpdatingEvolutionReflection,
    isAnalyzingEvolutionReflections,
    toast,
  } = useEmbodied(brainSide);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [modelId, setModelId] = useState<string>();
  const [analysis, setAnalysis] = useState<{
    summary: string;
    true_evolution_ratio: number;
    patterns: string[];
    warnings: string[];
    next_steps: string[];
  } | null>(null);

  const { notes } = useNotes({ brain_side: brainSide === 'unknown' ? undefined : brainSide });
  const { units: knowledgeUnits } = useKnowledge(brainSide);
  const { data: experimentLogsData } = useExperimentLogs({
    brain_side: brainSide === 'unknown' ? undefined : brainSide,
  });
  const experimentLogs: { id: string; title: string }[] = experimentLogsData || [];

  const targetOptions: { id: string; label: string }[] = useMemo(() => {
    switch (form.related_content_type) {
      case 'note':
        return (notes || []).map((n) => ({ id: n.id, label: n.title || n.content?.slice(0, 60) || '(无标题)' }));
      case 'knowledge_unit':
        return (knowledgeUnits || []).map((k) => ({ id: k.id, label: k.content_raw?.slice(0, 80) || '(无内容)' }));
      case 'experiment_log':
        return experimentLogs.map((l) => ({ id: l.id, label: l.title }));
      default:
        return [];
    }
  }, [form.related_content_type, notes, knowledgeUnits, experimentLogs]);

  const startNew = () => {
    setEditingId('new');
    setForm({ ...EMPTY_FORM });
    setAnalysis(null);
  };

  const startEdit = (r: EvolutionReflection) => {
    setEditingId(r.id);
    setForm({
      title: r.title,
      discomfort_level: r.discomfort_level,
      pain_description: r.pain_description || '',
      joy_description: r.joy_description || '',
      learning: r.learning || '',
      is_true_evolution: r.is_true_evolution,
      related_content_type: r.related_content_type,
      related_content_id: r.related_content_id || '',
    });
    setAnalysis(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const handleSave = async () => {
    if (!form.title.trim()) return;
    const payload = {
      ...form,
      // 未选关联时显式传 null：空串 '' 过不了后端 pattern 校验（422），
      // undefined 会被 exclude_unset 丢弃导致已有关联清不掉；显式 null 才会落库清空
      related_content_type: form.related_content_type ?? null,
      related_content_id: form.related_content_id || null,
    };
    if (editingId === 'new') {
      await createEvolutionReflection({
        ...payload,
        // 双脑/未知视角下新建默认归到个人脑，保证记录至少在一个脑侧过滤下可见，永不存成 both
        brain_side: brainSide === 'both' || brainSide === 'unknown' ? 'personal' : brainSide,
      });
    } else if (editingId) {
      // 编辑不带 brain_side，后端 exclude_unset 会保留原值，避免被当前导航视角静默改写
      await updateEvolutionReflection({ id: editingId, data: payload });
    }
    cancelEdit();
  };

  const handleDelete = async (id: string) => {
    if (confirm('确定删除这条反思记录？')) {
      await deleteEvolutionReflection(id);
    }
  };

  const handleAnalyze = async () => {
    setAnalysis(null);
    const data = await analyzeEvolutionReflections(modelId);
    setAnalysis(data);
  };

  const relatedLink = (r: EvolutionReflection) => {
    if (!r.related_content_id) return null;
    if (r.related_content_type === 'note') return `/ingest/notes/${r.related_content_id}`;
    if (r.related_content_type === 'knowledge_unit') return `/knowledge/${r.related_content_id}`;
    if (r.related_content_type === 'experiment_log') return `/social-brain/experimenter`;
    return null;
  };

  const relatedLabel = (r: EvolutionReflection) => {
    if (!r.related_content_type) return null;
    const found = RELATED_TYPE_OPTIONS.find((o) => o.value === r.related_content_type);
    return found?.label;
  };

  const trueCount = evolutionReflections.filter((r) => r.is_true_evolution).length;
  const ratio = evolutionReflections.length > 0 ? trueCount / evolutionReflections.length : 0;
  const sideLabel = brainSide === 'personal' ? '个人脑' : brainSide === 'network' ? '网络脑' : '双脑';

  return (
    <div className="p-6 max-w-6xl mx-auto h-full overflow-auto">
      {toast && createPortal(
        <div className={`fixed top-4 right-4 z-[100] px-4 py-3 rounded-[2px] border ${
          toast.type === 'success'
            ? 'bg-success/20 border-success/30 text-success'
            : 'bg-danger/20 border-danger/30 text-danger'
        }`}>
          <div className="flex items-center gap-2">
            {toast.type === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            <span className="text-sm">{toast.message}</span>
          </div>
        </div>,
        document.body
      )}

      <div className="flex items-start justify-between flex-wrap gap-4 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-text-primary flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-info" />
            真进化 vs 伪成熟
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            真正的进化伴随摩擦与痛苦后的喜悦；舒服往往只是在吃老本。记录并审视你的成长是否真实。
            <span className="ml-1 text-text-muted">当前：{sideLabel}</span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-3">
            <ModelSelector value={modelId} onChange={setModelId} taskType="analysis" className="w-48" />
            <LLMCostBadge modelId={modelId} inputText={evolutionReflections.map((r) => r.title + (r.pain_description || '')).join('\n')} outputTokenEstimate={400} />
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleAnalyze}
              disabled={isAnalyzingEvolutionReflections || evolutionReflections.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-info/10 text-info hover:bg-info/20 transition-colors disabled:opacity-50"
            >
              {isAnalyzingEvolutionReflections ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              AI 综合分析
            </button>
            <button
              onClick={startNew}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-success/10 text-success hover:bg-success/20 transition-colors"
            >
              <Plus className="w-4 h-4" />
              新建反思
            </button>
          </div>
        </div>
      </div>

      {analysis && (
        <div className="rounded-xl border border-info/20 bg-info/5 p-5 mb-6">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-full bg-info/10 text-info">
              <Lightbulb className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <h3 className="text-base font-medium text-text-primary">AI 成长分析</h3>
                <span className={`text-sm font-bold ${analysis.true_evolution_ratio >= 0.6 ? 'text-success' : analysis.true_evolution_ratio >= 0.3 ? 'text-warning' : 'text-danger'}`}>
                  真进化比例：{(analysis.true_evolution_ratio * 100).toFixed(0)}%
                </span>
              </div>
              <p className="text-sm text-text-secondary mb-3">{analysis.summary}</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                {analysis.patterns.length > 0 && (
                  <div>
                    <p className="text-xs text-text-muted mb-1">发现的模式</p>
                    {analysis.patterns.map((p, i) => (
                      <div key={i} className="flex items-start gap-1.5 text-text-secondary">
                        <ChevronRight className="w-3.5 h-3.5 mt-0.5 text-info shrink-0" />
                        <span>{p}</span>
                      </div>
                    ))}
                  </div>
                )}
                {analysis.warnings.length > 0 && (
                  <div>
                    <p className="text-xs text-text-muted mb-1">伪成熟信号</p>
                    {analysis.warnings.map((w, i) => (
                      <div key={i} className="flex items-start gap-1.5 text-text-secondary">
                        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-warning shrink-0" />
                        <span>{w}</span>
                      </div>
                    ))}
                  </div>
                )}
                {analysis.next_steps.length > 0 && (
                  <div>
                    <p className="text-xs text-text-muted mb-1">下一步建议</p>
                    {analysis.next_steps.map((s, i) => (
                      <div key={i} className="flex items-start gap-1.5 text-text-secondary">
                        <ChevronRight className="w-3.5 h-3.5 mt-0.5 text-success shrink-0" />
                        <span>{s}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="rounded-xl border border-white/[0.06] bg-bg-secondary p-4">
          <p className="text-xs text-text-secondary mb-1">总记录数</p>
          <p className="text-2xl font-bold text-text-primary">{evolutionReflections.length}</p>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-bg-secondary p-4">
          <p className="text-xs text-text-secondary mb-1">真进化比例</p>
          <p className={`text-2xl font-bold ${ratio >= 0.6 ? 'text-success' : ratio >= 0.3 ? 'text-warning' : 'text-danger'}`}>
            {(ratio * 100).toFixed(0)}%
          </p>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-bg-secondary p-4">
          <p className="text-xs text-text-secondary mb-1">平均不适等级</p>
          <p className="text-2xl font-bold text-text-primary">
            {evolutionReflections.length > 0
              ? (evolutionReflections.reduce((sum, r) => sum + r.discomfort_level, 0) / evolutionReflections.length).toFixed(1)
              : '—'}
          </p>
        </div>
      </div>

      {editingId && (
        <div className="rounded-xl border border-white/[0.06] bg-bg-secondary p-4 mb-6 space-y-3">
          <input
            type="text"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="这次成长的标题"
            className="w-full px-3 py-2 rounded-lg bg-bg-primary border border-white/[0.06] text-sm text-text-primary"
          />

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-text-secondary">不适等级：</span>
            {DISCOMFORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setForm({ ...form, discomfort_level: opt.value })}
                className={`px-2.5 py-1 rounded-lg text-xs border transition-all ${
                  form.discomfort_level === opt.value
                    ? `${opt.color} bg-white/[0.05] border-current`
                    : 'bg-white/[0.03] text-text-secondary border-white/[0.06]'
                }`}
              >
                {opt.value} - {opt.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <textarea
              value={form.pain_description}
              onChange={(e) => setForm({ ...form, pain_description: e.target.value })}
              placeholder="痛苦/摩擦：你经历了什么不适？"
              className="w-full px-3 py-2 rounded-lg bg-bg-primary border border-white/[0.06] text-sm text-text-primary min-h-[100px]"
            />
            <textarea
              value={form.joy_description}
              onChange={(e) => setForm({ ...form, joy_description: e.target.value })}
              placeholder="喜悦/突破：克服后获得了什么？"
              className="w-full px-3 py-2 rounded-lg bg-bg-primary border border-white/[0.06] text-sm text-text-primary min-h-[100px]"
            />
          </div>

          <textarea
            value={form.learning}
            onChange={(e) => setForm({ ...form, learning: e.target.value })}
            placeholder="学到了什么？和之前的自己有什么不同？"
            className="w-full px-3 py-2 rounded-lg bg-bg-primary border border-white/[0.06] text-sm text-text-primary min-h-[80px]"
          />

          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-text-secondary">判断：</span>
            <button
              onClick={() => setForm({ ...form, is_true_evolution: true })}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-all ${
                form.is_true_evolution
                  ? 'text-success border-success/30 bg-success/10'
                  : 'bg-white/[0.03] text-text-secondary border-white/[0.06]'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              真进化
            </button>
            <button
              onClick={() => setForm({ ...form, is_true_evolution: false })}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-all ${
                !form.is_true_evolution
                  ? 'text-warning border-warning/30 bg-warning/10'
                  : 'bg-white/[0.03] text-text-secondary border-white/[0.06]'
              }`}
            >
              <XCircle className="w-3.5 h-3.5" />
              伪成熟/舒适区
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <select
              value={form.related_content_type || ''}
              onChange={(e) => setForm({ ...form, related_content_type: (e.target.value || undefined) as EvolutionReflection['related_content_type'], related_content_id: '' })}
              className="px-3 py-2 rounded-lg bg-bg-primary border border-white/[0.06] text-sm text-text-primary"
            >
              <option value="">关联到（可选）</option>
              {RELATED_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            {form.related_content_type && (
              <select
                value={form.related_content_id}
                onChange={(e) => setForm({ ...form, related_content_id: e.target.value })}
                className="px-3 py-2 rounded-lg bg-bg-primary border border-white/[0.06] text-sm text-text-primary min-w-[200px]"
              >
                <option value="">选择{RELATED_TYPE_OPTIONS.find((o) => o.value === form.related_content_type)?.label}</option>
                {targetOptions.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            )}
          </div>

          <div className="flex items-center justify-end gap-2">
            <button onClick={cancelEdit} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-text-secondary hover:bg-white/[0.04]">
              <X className="w-3.5 h-3.5" />
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={isCreatingEvolutionReflection || isUpdatingEvolutionReflection || !form.title.trim()}
              className="flex items-center gap-1 px-4 py-1.5 rounded-lg bg-info/10 text-info hover:bg-info/20 transition-colors disabled:opacity-50 text-xs"
            >
              {isCreatingEvolutionReflection || isUpdatingEvolutionReflection ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              保存
            </button>
          </div>
        </div>
      )}

      {evolutionReflectionsError ? (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
          {(evolutionReflectionsError as any)?.message}
        </div>
      ) : isLoadingEvolutionReflections ? (
        <div className="text-sm text-text-secondary flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          加载中...
        </div>
      ) : (
        <div className="space-y-3">
          {evolutionReflections.map((r) => {
            const discomfort = DISCOMFORT_OPTIONS.find((o) => o.value === r.discomfort_level) || DISCOMFORT_OPTIONS[0];
            const relatedType = RELATED_TYPE_OPTIONS.find((o) => o.value === r.related_content_type);
            const link = relatedLink(r);
            return (
              <div key={r.id} className="rounded-xl border border-white/[0.06] bg-bg-secondary p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${r.is_true_evolution ? 'text-success border-success/30 bg-success/10' : 'text-warning border-warning/30 bg-warning/10'}`}>
                        {r.is_true_evolution ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                        {r.is_true_evolution ? '真进化' : '伪成熟'}
                      </span>
                      <span className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${discomfort.color} border-current/20 bg-white/[0.03]`}>
                        不适 {r.discomfort_level} · {discomfort.label}
                      </span>
                      {relatedType && link && (
                        <button
                          onClick={() => navigate(link)}
                          className="text-[10px] text-info hover:underline"
                        >
                          关联{relatedType.label}
                        </button>
                      )}
                      <span className="text-[10px] text-text-muted">
                        {new Date(r.updated_at).toLocaleString('zh-CN')}
                      </span>
                    </div>
                    <h3 className="text-sm font-medium text-text-primary mb-1">{r.title}</h3>
                    {(r.pain_description || r.joy_description) && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-text-secondary mb-2">
                        {r.pain_description && (
                          <div className="p-2 rounded-lg bg-white/[0.03]">
                            <span className="text-text-muted">痛苦：</span>{r.pain_description}
                          </div>
                        )}
                        {r.joy_description && (
                          <div className="p-2 rounded-lg bg-white/[0.03]">
                            <span className="text-text-muted">喜悦：</span>{r.joy_description}
                          </div>
                        )}
                      </div>
                    )}
                    {r.learning && (
                      <p className="text-xs text-text-secondary"><span className="text-text-muted">收获：</span>{r.learning}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => startEdit(r)}
                      className="p-1.5 rounded-lg text-text-secondary hover:bg-white/[0.04] hover:text-text-primary transition-colors"
                      title="编辑"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(r.id)}
                      className="p-1.5 rounded-lg text-danger hover:bg-danger/10 transition-colors"
                      title="删除"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          {evolutionReflections.length === 0 && !editingId && (
            <div className="p-8 rounded-xl border border-white/[0.06] bg-bg-secondary text-center text-text-secondary">
              <TrendingUp className="w-10 h-10 mx-auto mb-3 text-text-muted/40" />
              <p className="text-sm">暂无反思记录。</p>
              <p className="text-xs mt-1">当你感到不适却最终突破时，记录下来，判断这是真进化还是伪成熟。</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TrueEvolutionPage;
