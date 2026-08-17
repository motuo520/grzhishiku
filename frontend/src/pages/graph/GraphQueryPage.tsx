import { FC, useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Sparkles, Send, Loader2, AlertCircle, FileText, BookOpen, Scissors } from 'lucide-react';
import { useGraphifyStatus, useGraphifyQuery } from '@/hooks/useGraphify';
import ModelSelector from '@/components/llm/ModelSelector';
import type { GraphifySource } from '@/api/graphify';

interface QAItem {
  question: string;
  answer: string;
  ok: boolean;
  sources?: GraphifySource[];
}

// 来源内链直达：笔记→笔记详情，知识单元→知识详情，剪藏→剪藏列表
const sourceLink = (s: GraphifySource): string => {
  if (s.content_type === 'note') return `/ingest/notes/${s.id}`;
  if (s.content_type === 'knowledge') return `/knowledge/${s.id}`;
  return '/ingest/clipper';
};

const sourceIcon = (t: GraphifySource['content_type']) =>
  t === 'note' ? <FileText className="w-3 h-3" /> : t === 'knowledge' ? <BookOpen className="w-3 h-3" /> : <Scissors className="w-3 h-3" />;

// 把答案里的《条目名》渲染成直达链接（能匹配到检索来源的才加链）
const AnswerWithLinks: FC<{ text: string; sources: GraphifySource[] }> = ({ text, sources }) => {
  const parts = text.split(/(《[^》]+》)/g);
  return (
    <div className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">
      {parts.map((part, i) => {
        if (part.startsWith('《') && part.endsWith('》')) {
          const title = part.slice(1, -1);
          const hit = sources.find((s) => s.title === title);
          if (hit) {
            return (
              <Link key={i} to={sourceLink(hit)} className="text-info hover:underline">
                {part}
              </Link>
            );
          }
        }
        return <span key={i}>{part}</span>;
      })}
    </div>
  );
};

const EXAMPLE_QUESTIONS = [
  '我的知识图谱里有哪些核心主题？',
  '和「费曼学习法」相关的内容有哪些？',
  '最近剪藏的文章之间有什么关联？',
];

const GraphQueryPage: FC = () => {
  const { data: status, isLoading: statusLoading } = useGraphifyStatus();
  const query = useGraphifyQuery();
  const [searchParams, setSearchParams] = useSearchParams();

  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState<QAItem[]>([]);
  const [modelId, setModelId] = useState<string>('');

  const ask = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || query.isPending) return;
    // 消费掉 URL 参数，避免刷新后重复提问
    if (searchParams.has('q')) {
      const next = new URLSearchParams(searchParams);
      next.delete('q');
      setSearchParams(next, { replace: true });
    }
    query.mutate({ question: trimmed, preferred_model: modelId || undefined }, {
      onSuccess: (data) => {
        setHistory((prev) => [
          { question: trimmed, answer: data.ok ? (data.result || '') : (data.error || '查询失败'), ok: data.ok, sources: data.sources },
          ...prev,
        ]);
      },
      onError: (err: any) => {
        setHistory((prev) => [
          { question: trimmed, answer: err?.message || '查询失败', ok: false },
          ...prev,
        ]);
      },
    });
    setQuestion('');
  };

  // 支持从图谱节点跳转过来时自动提问
  useEffect(() => {
    const q = searchParams.get('q');
    if (q && status?.has_graph) {
      setQuestion(q);
      ask(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get('q'), status?.has_graph]);

  // 未构建图谱时的引导
  if (!statusLoading && !status?.has_graph) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-6">
        <Sparkles className="w-12 h-12 text-text-muted mb-4" />
        <div className="text-text-primary font-semibold mb-2">知识图谱尚未构建</div>
        <div className="text-sm text-text-secondary max-w-md">
          请先在「知识网络」页点击「重建图谱」，构建完成后即可用自然语言查询你的知识网络。
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">智能查询</h1>
          <p className="text-sm text-text-secondary mt-1">用自然语言向你的知识图谱提问</p>
        </div>

        {/* 提问输入区 */}
        <div className="card flex items-center gap-3">
          <ModelSelector value={modelId} onChange={setModelId} taskType="analysis" className="w-44 shrink-0" />
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') ask(question); }}
            placeholder="输入你的问题..."
            className="flex-1 bg-bg-tertiary border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-text-primary outline-none focus:border-info/50"
          />
          <button
            onClick={() => ask(question)}
            disabled={!question.trim() || query.isPending}
            className="btn-primary flex items-center gap-2 disabled:opacity-50"
          >
            {query.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            提问
          </button>
        </div>

        {/* 示例问题 */}
        {history.length === 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-text-muted flex items-center gap-1">
              <Sparkles className="w-3 h-3" />
              试试：
            </span>
            {EXAMPLE_QUESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => setQuestion(q)}
                className="px-3 py-1.5 rounded-full text-xs text-text-secondary bg-white/[0.03] border border-white/[0.08] hover:bg-white/[0.08] hover:text-text-primary transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {query.isPending && (
          <div className="card flex items-center gap-2 text-sm text-text-secondary">
            <Loader2 className="w-4 h-4 animate-spin text-info" />
            正在图谱中检索...
          </div>
        )}

        {/* 本次会话的问答历史 */}
        <div className="space-y-4">
          {history.map((item, idx) => (
            <div key={idx} className="space-y-2">
              <div className="flex justify-end">
                <div className="max-w-[85%] px-4 py-2.5 rounded-2xl rounded-tr-sm bg-info/15 border border-info/25 text-sm text-text-primary">
                  {item.question}
                </div>
              </div>
              <div className="flex justify-start">
                <div className={`max-w-[85%] px-4 py-3 rounded-2xl rounded-tl-sm border ${
                  item.ok
                    ? 'bg-white/[0.03] border-white/[0.08]'
                    : 'bg-red-400/10 border-red-400/25'
                }`}>
                  {item.ok ? (
                    <div className="space-y-2.5">
                      <AnswerWithLinks text={item.answer} sources={item.sources || []} />
                      {(item.sources?.length ?? 0) > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-white/[0.06]">
                          <span className="text-[10px] text-text-muted">来源：</span>
                          {item.sources!.map((s) => (
                            <Link
                              key={s.id}
                              to={sourceLink(s)}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] text-text-secondary bg-white/[0.04] border border-white/[0.08] hover:border-info/40 hover:text-info transition-colors"
                            >
                              {sourceIcon(s.content_type)}
                              {s.title}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-xs text-red-400 flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      {item.answer}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default GraphQueryPage;
