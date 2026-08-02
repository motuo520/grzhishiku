import { FC, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigation } from '@/store/navigation';
import { useEmbodied } from '@/hooks/useEmbodied';
import { useNotes } from '@/hooks/useNotes';
import { useKnowledge } from '@/hooks/useKnowledge';
import ModelSelector from '@/components/llm/ModelSelector';
import {
  ShieldAlert, Sparkles, Loader2, CheckCircle2, XCircle,
  History, ChevronRight, AlertTriangle
} from 'lucide-react';

const EMPTY_FORM = {
  content: '',
  content_type: 'text',
  content_id: '',
} as {
  content: string;
  content_type: 'text' | 'note' | 'knowledge_unit';
  content_id: string;
};

const SOURCE_OPTIONS = [
  { value: 'text', label: '自由输入' },
  { value: 'note', label: '笔记' },
  { value: 'knowledge_unit', label: '知识单元' },
];

const DepthCheckPage: FC = () => {
  const { brainSide } = useNavigation();
  const {
    depthCheck,
    isDepthChecking,
    depthLogs,
    isLoadingDepthLogs,
    depthLogsError,
    toast,
  } = useEmbodied(brainSide);

  const [form, setForm] = useState(EMPTY_FORM);
  const [result, setResult] = useState<{
    depth_score: number;
    is_passed: boolean;
    feedback: string;
    suggestions: string[];
  } | null>(null);
  const [modelId, setModelId] = useState<string>();
  const [sourceType, setSourceType] = useState<'text' | 'note' | 'knowledge_unit'>('text');
  // 默认使用规则评估；用户可显式切到 AI 深度评估
  const [useAi, setUseAi] = useState(false);

  const { notes } = useNotes({ brain_side: brainSide === 'unknown' ? undefined : brainSide });
  const { units: knowledgeUnits } = useKnowledge(brainSide);

  const targetOptions = sourceType === 'note'
    ? (notes || []).map((n) => ({ id: n.id, label: n.title || n.content?.slice(0, 60) || '(无标题)', content: n.content || '' }))
    : sourceType === 'knowledge_unit'
    ? (knowledgeUnits || []).map((k) => ({ id: k.id, label: k.content_raw?.slice(0, 80) || '(无内容)', content: k.content_raw || '' }))
    : [];

  const handleSourceChange = (type: 'text' | 'note' | 'knowledge_unit') => {
    setSourceType(type);
    setForm({ ...form, content_type: type, content_id: '', content: '' });
    setResult(null);
  };

  const handleTargetChange = (id: string) => {
    const target = targetOptions.find((t) => t.id === id);
    // label 仅供下拉展示（截断），提交给后端做深度检查的必须是全文
    setForm({ ...form, content_id: id, content: target ? target.content : '' });
    setResult(null);
  };

  const handleCheck = async () => {
    if (!form.content.trim()) return;
    setResult(null);
    const data = await depthCheck({
      content: form.content,
      content_type: form.content_type,
      content_id: form.content_id || undefined,
      preferred_model: useAi ? modelId : undefined,
      use_ai: useAi,
    });
    setResult(data);
  };

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
            <ShieldAlert className="w-5 h-5 text-info" />
            内容深度检查
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            保存时 AI 自动评估：这条内容是否太肤浅？作为认知防御系统，拦截低质量输入。
            <span className="ml-1 text-text-muted">当前：{sideLabel}</span>
          </p>
        </div>
        {useAi && (
          <div className="flex flex-col items-end gap-2">
            <ModelSelector value={modelId} onChange={setModelId} taskType="analysis" className="w-48" />
          </div>
        )}
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-bg-secondary p-4 mb-6 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {SOURCE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => handleSourceChange(opt.value as typeof sourceType)}
              className={`px-3 py-1.5 rounded-lg text-xs border transition-all ${
                sourceType === opt.value
                  ? 'bg-info/15 text-info border-info/30'
                  : 'bg-white/[0.03] text-text-secondary border-white/[0.06] hover:bg-white/[0.05]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {sourceType !== 'text' && (
          <select
            value={form.content_id}
            onChange={(e) => handleTargetChange(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-bg-primary border border-white/[0.06] text-sm text-text-primary"
          >
            <option value="">选择要检查的{sourceType === 'note' ? '笔记' : '知识单元'}</option>
            {targetOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        )}

        <textarea
          value={form.content}
          onChange={(e) => setForm({ ...form, content: e.target.value })}
          placeholder="输入或选择一段内容，让 AI 评估其认知深度..."
          className="w-full px-3 py-2 rounded-lg bg-bg-primary border border-white/[0.06] text-sm text-text-primary min-h-[160px] leading-relaxed"
          disabled={sourceType !== 'text' && !form.content_id}
        />

        <div className="flex items-center justify-end gap-3">
          <div className="flex items-center gap-1 p-1 rounded-lg bg-bg-primary border border-white/[0.06]">
            <button
              onClick={() => setUseAi(false)}
              className={`px-3 py-1.5 rounded-md text-xs transition-all ${
                !useAi
                  ? 'bg-success/15 text-success border border-success/30'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              规则评估（免费）
            </button>
            <button
              onClick={() => setUseAi(true)}
              className={`px-3 py-1.5 rounded-md text-xs transition-all ${
                useAi
                  ? 'bg-info/15 text-info border border-info/30'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              AI 深度评估（付费）
            </button>
          </div>
          <button
            onClick={handleCheck}
            disabled={isDepthChecking || !form.content.trim()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-info/10 text-info hover:bg-info/20 transition-colors disabled:opacity-50"
          >
            {isDepthChecking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {useAi ? 'AI 深度检查' : '规则检查'}
          </button>
        </div>
      </div>

      {result && (
        <div className={`rounded-xl border p-5 mb-6 ${result.is_passed ? 'border-success/20 bg-success/5' : 'border-warning/20 bg-warning/5'}`}>
          <div className="flex items-start gap-4">
            <div className={`p-3 rounded-full ${result.is_passed ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>
              {result.is_passed ? <CheckCircle2 className="w-6 h-6" /> : <AlertTriangle className="w-6 h-6" />}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <h3 className="text-base font-medium text-text-primary">
                  {result.is_passed ? '深度检查通过' : '内容可能过于肤浅'}
                </h3>
                <span className={`text-sm font-bold ${result.depth_score >= 0.7 ? 'text-success' : result.depth_score >= 0.4 ? 'text-warning' : 'text-danger'}`}>
                  深度分：{(result.depth_score * 100).toFixed(0)}%
                </span>
              </div>
              <p className="text-sm text-text-secondary mb-3">{result.feedback}</p>
              {result.suggestions.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-text-muted">改进建议：</p>
                  {result.suggestions.map((s, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm text-text-secondary">
                      <ChevronRight className="w-3.5 h-3.5 mt-0.5 text-info shrink-0" />
                      <span>{s}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="mb-4 flex items-center gap-2">
        <History className="w-4 h-4 text-text-muted" />
        <h2 className="text-sm font-medium text-text-primary">最近检查记录</h2>
      </div>

      {depthLogsError ? (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
          {(depthLogsError as any)?.message}
        </div>
      ) : isLoadingDepthLogs ? (
        <div className="text-sm text-text-secondary flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          加载中...
        </div>
      ) : (
        <div className="space-y-3">
          {depthLogs.slice(0, 20).map((log) => (
            <div
              key={log.id}
              className="rounded-xl border border-white/[0.06] bg-bg-secondary p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${log.is_passed ? 'text-success border-success/30 bg-success/10' : 'text-warning border-warning/30 bg-warning/10'}`}>
                      {log.is_passed ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                      {log.is_passed ? '通过' : '未通过'}
                    </span>
                    <span className="text-[10px] text-text-muted">{log.content_type}</span>
                    <span className="text-[10px] text-text-muted">
                      {new Date(log.created_at).toLocaleString('zh-CN')}
                    </span>
                  </div>
                  <p className="text-sm text-text-primary line-clamp-2">{log.content_preview || log.feedback}</p>
                  <p className="text-xs text-text-secondary mt-1">{log.feedback}</p>
                </div>
                <div className="text-sm font-bold shrink-0">
                  <span className={log.depth_score >= 0.7 ? 'text-success' : log.depth_score >= 0.4 ? 'text-warning' : 'text-danger'}>
                    {(log.depth_score * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            </div>
          ))}
          {depthLogs.length === 0 && (
            <div className="p-8 rounded-xl border border-white/[0.06] bg-bg-secondary text-center text-text-secondary">
              <ShieldAlert className="w-10 h-10 mx-auto mb-3 text-text-muted/40" />
              <p className="text-sm">暂无深度检查记录。</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DepthCheckPage;
