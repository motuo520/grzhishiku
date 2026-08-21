import { FC, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@/store/navigation';
import { jianghuApi } from '@/api/jianghu';
import ModelSelector from '@/components/llm/ModelSelector';
import {
  Zap, Loader2, Sparkles, ArrowDownToLine, FileOutput, Coins,
  TrendingUp, Lightbulb, ChevronRight
} from 'lucide-react';
import type { CognitivePotentialItem } from '@/api/jianghu';

const CATEGORIES = [
  {
    key: 'sinkable' as const,
    label: '可下沉',
    desc: '转化为习惯、决策框架或行动清单',
    icon: ArrowDownToLine,
    color: 'text-success',
    bg: 'bg-success/10',
    border: 'border-success/20',
  },
  {
    key: 'outputable' as const,
    label: '可产出',
    desc: '写成文章、做成课程或分享',
    icon: FileOutput,
    color: 'text-info',
    bg: 'bg-info/10',
    border: 'border-info/20',
  },
  {
    key: 'monetizable' as const,
    label: '可变现',
    desc: '有明确受众需求，能产品化或服务化',
    icon: Coins,
    color: 'text-yellow-400',
    bg: 'bg-yellow-400/10',
    border: 'border-yellow-400/20',
  },
];

const CognitivePotentialPage: FC = () => {
  const navigate = useNavigate();
  const { brainSide } = useNavigation();
  const [modelId, setModelId] = useState<string>();
  const [activeTab, setActiveTab] = useState<'sinkable' | 'outputable' | 'monetizable'>('sinkable');

  const side = brainSide === 'unknown' ? 'both' : brainSide;
  // 结果按脑侧缓存 + 服务端已落库：换模型、重进页面都不丢（修：queryKey 曾含 modelId，
  // 换模型即换缓存键 → enabled:false 不自动拉取 → 界面空掉，看似「结果没保存」）。
  const queryClient = useQueryClient();
  const queryKey = ['jianghu', 'cognitive-potential', brainSide] as const;
  const { data, isError, error } = useQuery({
    queryKey,
    queryFn: () => jianghuApi.getCognitivePotentialLatest(side),
    staleTime: 5 * 60 * 1000,
  });
  const analyzeMutation = useMutation({
    mutationFn: () =>
      jianghuApi.analyzeCognitivePotential({ brain_side: side, preferred_model: modelId }).then((r) => r.data),
    onSuccess: (fresh) => queryClient.setQueryData(queryKey, fresh),
  });
  const isFetching = analyzeMutation.isPending;
  const displayError =
    (analyzeMutation.error as any)?.message || (isError ? (error as any)?.message : null);

  const handleAnalyze = () => {
    analyzeMutation.mutate();
  };

  const linkFor = (item: CognitivePotentialItem) =>
    item.content_type === 'note' ? `/ingest/notes/${item.content_id}` : `/knowledge/${item.content_id}`;

  const currentItems = data?.[activeTab] || [];
  const currentMeta = CATEGORIES.find((c) => c.key === activeTab)!;

  return (
    <div className="p-6 max-w-6xl mx-auto h-full overflow-auto">
      <div className="flex items-start justify-between flex-wrap gap-4 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-text-primary flex items-center gap-2">
            <Zap className="w-5 h-5 text-yellow-400" />
            认知势能
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            认知势能下去就能产生能量、赚到钱。分析你当前脑侧的知识资产，找出能下沉、能产出、能变现的内容。
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-end gap-1.5">
            <ModelSelector value={modelId} onChange={setModelId} taskType="analysis" className="w-48" />
          </div>
          <button
            onClick={handleAnalyze}
            disabled={isFetching}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-info/10 text-info hover:bg-info/20 transition-colors disabled:opacity-50"
          >
            {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            AI 分析
          </button>
        </div>
      </div>

      {displayError && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400 mb-6">
          {displayError || 'AI 分析失败'}
        </div>
      )}

      {data?.analyzed_at && (
        <div className="text-xs text-text-muted mb-4">
          最近分析：{new Date(data.analyzed_at).toLocaleString()}{data.model_used ? ` · 模型 ${data.model_used}` : ''}（结果已保存，换设备/模型不丢失）
        </div>
      )}

      {data && (
        <div className="rounded-xl border border-white/[0.06] bg-bg-secondary p-4 mb-6">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-yellow-400/10 flex items-center justify-center shrink-0">
              <Lightbulb className="w-4 h-4 text-yellow-400" />
            </div>
            <div>
              <div className="text-xs text-text-muted mb-1">整体判断</div>
              <p className="text-sm text-text-primary leading-relaxed">{data.summary}</p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {CATEGORIES.map((cat) => {
          const Icon = cat.icon;
          const count = data?.[cat.key]?.length ?? 0;
          const isActive = activeTab === cat.key;
          return (
            <button
              key={cat.key}
              onClick={() => setActiveTab(cat.key)}
              className={`text-left rounded-xl border p-4 transition-all ${
                isActive ? `${cat.border} ${cat.bg}` : 'border-white/[0.06] bg-bg-secondary hover:bg-white/[0.03]'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className={`w-9 h-9 rounded-lg ${cat.bg} flex items-center justify-center`}>
                  <Icon className={`w-4 h-4 ${cat.color}`} />
                </div>
                <span className={`text-lg font-semibold ${cat.color}`}>{count}</span>
              </div>
              <div className="text-sm font-medium text-text-primary">{cat.label}</div>
              <div className="text-xs text-text-secondary mt-1">{cat.desc}</div>
            </button>
          );
        })}
      </div>

      {isFetching && !data && (
        <div className="rounded-xl border border-white/[0.06] bg-bg-secondary p-8 text-center text-text-secondary">
          <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
          <p className="text-sm">正在分析认知势能...</p>
        </div>
      )}

      {data && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
            <currentMeta.icon className={`w-4 h-4 ${currentMeta.color}`} />
            {currentMeta.label}候选
          </div>
          {currentItems.length === 0 ? (
            <div className="rounded-xl border border-white/[0.06] bg-bg-secondary p-6 text-center text-text-secondary text-sm">
              当前脑侧暂无{currentMeta.label}候选，先去沉淀一些高质量知识吧。
            </div>
          ) : (
            currentItems.map((item, idx) => (
              <div
                key={`${item.content_id}-${idx}`}
                className="rounded-xl border border-white/[0.06] bg-bg-secondary p-4 hover:border-white/[0.1] transition-all"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs px-1.5 py-0.5 rounded border ${item.content_type === 'note' ? 'text-warning border-warning/30 bg-warning/10' : 'text-info border-info/30 bg-info/10'}`}>
                        {item.content_type === 'note' ? '笔记' : '知识'}
                      </span>
                      <span className={`text-xs font-medium ${currentMeta.color}`}>
                        势能 {Math.round(item.score * 100)}%
                      </span>
                    </div>
                    <h3 className="text-sm font-medium text-text-primary truncate">{item.title}</h3>
                    <p className="text-xs text-text-secondary mt-1 leading-relaxed">{item.reason}</p>
                    <div className="mt-2 p-2.5 rounded-lg bg-white/[0.03]">
                      <div className="text-[10px] text-text-muted mb-0.5">建议行动</div>
                      <div className="text-xs text-text-secondary">{item.suggested_action}</div>
                    </div>
                  </div>
                  {item.content_id && (
                    <button
                      onClick={() => navigate(linkFor(item))}
                      className="flex items-center gap-1 text-xs text-info hover:underline shrink-0"
                    >
                      查看
                      <ChevronRight className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {!data && !isFetching && !isError && (
        <div className="rounded-xl border border-white/[0.06] bg-bg-secondary p-8 text-center text-text-secondary">
          <TrendingUp className="w-10 h-10 mx-auto mb-3 text-text-muted/40" />
          <p className="text-sm">还没有分析结果。</p>
          <p className="text-xs mt-1">点击右上角「AI 分析」，评估这个脑侧的认知势能。</p>
        </div>
      )}
    </div>
  );
};

export default CognitivePotentialPage;
