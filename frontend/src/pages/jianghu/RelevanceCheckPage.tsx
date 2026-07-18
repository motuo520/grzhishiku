import { FC, useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useRelevanceCheck } from '@/hooks/useJianghu';
import { useNavigation } from '@/store/navigation';
import ModelSelector from '@/components/llm/ModelSelector';
import LLMCostBadge from '@/components/llm/LLMCostBadge';
import { Filter, Loader2, BookOpen, AlertCircle, CheckCircle2, XCircle, Sparkles, ArrowRight } from 'lucide-react';

const ACTION_MAP: Record<string, { label: string; icon: React.ElementType; color: string; desc: string; path?: string }> = {
  import: { label: '直接导入', icon: CheckCircle2, color: 'text-success', desc: '这条内容与你高度相关，建议立即收录', path: '/ingest/clipper' },
  import_with_practice: { label: '导入并践行', icon: Sparkles, color: 'text-info', desc: '内容相关且有行动价值，建议导入后做实操记录', path: '/social-brain/practice-records' },
  read_later: { label: '稍后读', icon: BookOpen, color: 'text-warning', desc: '有一定相关性，先存起来再决定', path: '/ingest/read-later' },
  ignore: { label: '忽略', icon: XCircle, color: 'text-danger', desc: '当前与你关联不大，不必分散注意力' },
};

const CONTENT_TYPE_OPTIONS = [
  { value: 'book_excerpt', label: '书摘' },
  { value: 'article', label: '文章' },
  { value: 'webpage', label: '网页' },
  { value: 'other', label: '其它' },
];

const RelevanceCheckPage: FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [content, setContent] = useState(searchParams.get('content') || '');
  const [context, setContext] = useState('');
  const [contentType, setContentType] = useState('book_excerpt');
  const [modelId, setModelId] = useState<string>();
  const { brainSide } = useNavigation();
  const check = useRelevanceCheck();

  useEffect(() => {
    const initial = searchParams.get('content');
    if (initial) setContent(initial);
  }, [searchParams]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    check.mutate({
      data: { content, content_type: contentType, user_context_summary: context || undefined, brain_side: brainSide },
      preferred_model: modelId,
    });
  };

  const action = check.data ? ACTION_MAP[check.data.suggested_action] || ACTION_MAP.read_later : null;
  const ActionIcon = action?.icon || BookOpen;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-xl font-semibold text-text-primary flex items-center gap-2 mb-2">
        <Filter className="w-5 h-5 text-danger" />
        关我屁事检测
      </h1>
      <p className="text-sm text-text-secondary mb-6">粘贴一段外部内容，判断它与你当前的关注点有多相关。</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="粘贴一段文章、书摘或网页内容..."
          className="w-full px-4 py-3 rounded-[2px] bg-bg-secondary border border-white/[0.06] text-sm text-text-primary min-h-[160px]"
        />
        <textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder="可选：补充你当前的上下文（最近关注什么、在解决什么问题）..."
          className="w-full px-4 py-3 rounded-[2px] bg-bg-secondary border border-white/[0.06] text-sm text-text-primary min-h-[80px]"
        />
        <div className="flex items-center gap-3">
          <span className="text-xs text-text-secondary">内容类型</span>
          <select
            value={contentType}
            onChange={(e) => setContentType(e.target.value)}
            className="px-3 py-2 rounded-[2px] bg-bg-secondary border border-white/[0.06] text-sm text-text-primary"
          >
            {CONTENT_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex flex-col gap-1.5">
            <ModelSelector
              value={modelId}
              onChange={setModelId}
              taskType="analysis"
              className="w-48"
            />
            <LLMCostBadge
              modelId={modelId}
              inputText={`${content}\n\n上下文：${context}`}
              outputTokenEstimate={600}
            />
          </div>
          <button
            type="submit"
            disabled={check.isPending || !content.trim()}
            className="flex items-center gap-2 px-4 py-2 rounded-[2px] bg-info/10 text-info hover:bg-info/20 transition-colors disabled:opacity-50"
          >
            {check.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Filter className="w-4 h-4" />}
            检测关联度
          </button>
        </div>
        {check.isError && (
          <div className="p-3 rounded-[2px] bg-danger/10 border border-danger/30 text-sm text-danger">
            {(check.error as any)?.message || '操作失败，请重试'}
          </div>
        )}
      </form>

      {check.data && (
        <div className="mt-6 rounded-[2px] border border-white/[0.06] bg-bg-secondary overflow-hidden">
          <div className="p-4 border-b border-white/[0.06]">
            <div className="flex items-center gap-3 mb-3">
              <div className={`w-10 h-10 rounded-[2px] bg-white/[0.03] flex items-center justify-center ${action?.color || 'text-info'}`}>
                <ActionIcon className="w-5 h-5" />
              </div>
              <div>
                <div className={`text-sm font-medium ${action?.color || 'text-info'}`}>{action?.label}</div>
                <div className="text-xs text-text-secondary">{action?.desc}</div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs text-text-secondary">关联度</span>
              <div className="flex-1 h-2 rounded-full bg-bg-primary overflow-hidden">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${check.data.personal_relevance_score * 100}%` }}
                />
              </div>
              <span className="text-sm font-medium text-text-primary">{(check.data.personal_relevance_score * 100).toFixed(0)}%</span>
            </div>
          </div>

          <div className="p-4 space-y-3">
            <div>
              <div className="flex items-center gap-1.5 text-xs text-text-secondary mb-1">
                <AlertCircle className="w-3.5 h-3.5" />
                判断理由
              </div>
              <p className="text-sm text-text-primary leading-relaxed">{check.data.reason}</p>
            </div>

            {check.data.connection_evidence && (
              <div>
                <div className="flex items-center gap-1.5 text-xs text-text-secondary mb-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  关联证据
                </div>
                <p className="text-sm text-text-secondary leading-relaxed">{check.data.connection_evidence}</p>
              </div>
            )}

            {check.data.first_action && (
              <div className="p-3 rounded-[2px] bg-info/5 border border-info/10">
                <div className="text-xs text-info mb-1">建议第一步行动</div>
                <p className="text-sm text-text-primary">{check.data.first_action}</p>
              </div>
            )}

            {action && (
              <div className="pt-1">
                {action.path ? (
                  <button
                    type="button"
                    onClick={() => navigate(action.path as string)}
                    className="flex items-center gap-2 px-4 py-2 rounded-[2px] bg-info/10 text-info hover:bg-info/20 transition-colors text-sm"
                  >
                    {action.label}
                    <ArrowRight className="w-4 h-4" />
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-2 px-4 py-2 rounded-[2px] bg-white/[0.03] text-text-muted text-sm cursor-not-allowed">
                    <XCircle className="w-4 h-4" />
                    已忽略
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default RelevanceCheckPage;
