import { FC, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useDailyReviews, useGenerateDailyReview, useUpdateDailyReview } from '@/hooks/useJianghu';
import { useNavigation } from '@/store/navigation';
import { knowledgeApi } from '@/api/knowledge';
import ModelSelector from '@/components/llm/ModelSelector';
import EvolutionChainBar from '@/components/EvolutionChainBar';
import { Calendar, Loader2, Sparkles, CheckCircle2, AlertCircle, Lightbulb, Star, ChevronDown, ChevronUp, ShieldCheck, ShieldOff, SearchCheck, Trash2 } from 'lucide-react';

const DailyReviewPage: FC = () => {
  const { brainSide } = useNavigation();
  const navigate = useNavigate();
  const [limit, setLimit] = useState(30);
  const { data: reviews, isLoading, isFetching, isError, error, refetch } = useDailyReviews({ limit });
  const generate = useGenerateDailyReview();
  const updateReview = useUpdateDailyReview();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string>();

  // 待验证存量：验证是被动环节，把它顶到复盘页用户眼前（点击去验证中心）
  const { data: pendingVerify } = useQuery({
    queryKey: ['knowledge', 'pending-verify-count', brainSide],
    queryFn: async () => {
      const side = brainSide === 'both' ? undefined : brainSide;
      const [unverified, checking] = await Promise.all([
        knowledgeApi.list({ status: 'unverified', brain_side: side }).then((r) => r.data.length),
        knowledgeApi.list({ status: 'checking', brain_side: side }).then((r) => r.data.length),
      ]);
      return unverified + checking;
    },
    staleTime: 5 * 60 * 1000,
  });

  // 可信回顾：最近确认的可信结论（验证通过的知识单元）
  const queryClient = useQueryClient();
  const refreshTrusted = () =>
    queryClient.invalidateQueries({ queryKey: ['knowledge', 'trusted-review'] });
  const { data: trustedUnits } = useQuery({
    queryKey: ['knowledge', 'trusted-review', brainSide],
    queryFn: () =>
      knowledgeApi
        .list({
          status: 'confirmed',
          sort_by: 'updated_at',
          sort_order: 'desc',
          brain_side: brainSide === 'both' ? undefined : brainSide,
        })
        .then((r) => r.data.slice(0, 20)),
    staleTime: 5 * 60 * 1000,
  });

  const isThisWeek = (dateStr: string) =>
    Date.now() - new Date(dateStr).getTime() < 7 * 24 * 60 * 60 * 1000;

  const handleGenerate = () => {
    generate.mutate(
      { data: { brain_side: brainSide }, preferred_model: modelId },
      { onSuccess: () => refetch() }
    );
  };

  const toggleExpand = (id: string) => {
    setExpandedId((current) => (current === id ? null : id));
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case 'reviewed':
        return <span className="px-2 py-0.5 rounded-[2px] bg-success/10 text-success text-xs border border-success/30">已复盘</span>;
      case 'generated':
        return <span className="px-2 py-0.5 rounded-[2px] bg-info/10 text-info text-xs border border-info/30">已生成</span>;
      case 'archived':
        return <span className="px-2 py-0.5 rounded-[2px] bg-text-muted/10 text-text-muted text-xs border border-white/[0.06]">已归档</span>;
      default:
        return <span className="px-2 py-0.5 rounded-[2px] bg-warning/10 text-warning text-xs border border-warning/30">待处理</span>;
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-text-primary flex items-center gap-2">
            <Calendar className="w-5 h-5 text-warning" />
            每日复盘
          </h1>
          <p className="text-sm text-text-secondary mt-1">用 AI 总结今日输入，发现差距与下一步行动。</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-end gap-1.5">
            <ModelSelector
              value={modelId}
              onChange={setModelId}
              taskType="analysis"
              className="w-48"
            />
          </div>
          <button
            onClick={handleGenerate}
            disabled={generate.isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-[2px] bg-info/10 text-info hover:bg-info/20 transition-colors disabled:opacity-50"
          >
            {generate.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            生成今日复盘
          </button>
        </div>
      </div>

      <div className="mb-6">
        <EvolutionChainBar />
      </div>

      {(generate.isError || updateReview.isError) && (
        <div className="mb-4">
          <div className="p-3 rounded-[2px] bg-danger/10 border border-danger/30 text-sm text-danger">
            {((generate.error || updateReview.error) as any)?.message || '操作失败，请重试'}
          </div>
        </div>
      )}

      {isError && (
        <div className="mb-4">
          <div className="p-3 rounded-[2px] bg-danger/10 border border-danger/30 text-sm text-danger">
            {(error as any)?.message || '操作失败，请重试'}
          </div>
        </div>
      )}

      {isLoading && (
        <div className="text-sm text-text-secondary flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          加载中...
        </div>
      )}

      {reviews && reviews.length === 0 && !isLoading && (
        <div className="p-8 rounded-[2px] border border-white/[0.06] bg-bg-secondary text-center text-text-secondary">
          暂无复盘记录，点击右上角生成今日复盘。
        </div>
      )}

      <div className="space-y-4">
        {reviews?.map((review) => {
          const isExpanded = expandedId === review.id;
          return (
            <div key={review.id} className="rounded-[2px] border border-white/[0.06] bg-bg-secondary overflow-hidden">
              <div className="flex items-center">
                <button
                  onClick={() => toggleExpand(review.id)}
                  className="flex-1 min-w-0 flex items-center justify-between p-4 text-left hover:bg-white/[0.02] transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Calendar className="w-4 h-4 text-text-muted shrink-0" />
                    <span className="text-sm font-medium text-text-primary truncate">{review.review_date}</span>
                    {statusBadge(review.status)}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {review.action_items.length > 0 && (
                      <span className="text-xs text-text-muted">{review.action_items.length} 个行动</span>
                    )}
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-text-muted" /> : <ChevronDown className="w-4 h-4 text-text-muted" />}
                  </div>
                </button>
                {review.status !== 'reviewed' && review.status !== 'archived' && (
                  <button
                    onClick={() => updateReview.mutate({ id: review.id, data: { status: 'reviewed' } })}
                    disabled={updateReview.isPending}
                    className="flex items-center gap-1.5 mr-4 px-3 py-1.5 rounded-[2px] bg-success/10 text-success hover:bg-success/20 transition-colors text-xs shrink-0 disabled:opacity-50"
                  >
                    {updateReview.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                    标记已复盘
                  </button>
                )}
              </div>

              {isExpanded && (
                <div className="px-4 pb-4 space-y-4 border-t border-white/[0.06]">
                  {review.content_summary && (
                    <div className="pt-4">
                      <div className="flex items-center gap-2 text-xs text-text-secondary mb-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-info" />
                        内容摘要
                      </div>
                      <p className="text-sm text-text-primary whitespace-pre-wrap leading-relaxed">{review.content_summary}</p>
                    </div>
                  )}

                  {review.ai_reflection && (
                    <div>
                      <div className="flex items-center gap-2 text-xs text-text-secondary mb-1.5">
                        <Lightbulb className="w-3.5 h-3.5 text-warning" />
                        AI 反思
                      </div>
                      <p className="text-sm text-text-secondary whitespace-pre-wrap leading-relaxed">{review.ai_reflection}</p>
                    </div>
                  )}

                  {review.gaps_found.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 text-xs text-text-secondary mb-1.5">
                        <AlertCircle className="w-3.5 h-3.5 text-danger" />
                        发现的差距
                      </div>
                      <ul className="space-y-1">
                        {review.gaps_found.map((gap, idx) => (
                          <li key={idx} className="text-sm text-text-secondary flex items-start gap-2">
                            <span className="text-danger">•</span>
                            {gap}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {review.action_items.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 text-xs text-text-secondary mb-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-success" />
                        改进行动
                      </div>
                      <ul className="space-y-1">
                        {review.action_items.map((item, idx) => (
                          <li key={idx} className="text-sm text-text-secondary flex items-start gap-2">
                            <span className="text-success">•</span>
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {review.praise_items.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 text-xs text-text-secondary mb-1.5">
                        <Star className="w-3.5 h-3.5 text-warning" />
                        值得肯定
                      </div>
                      <ul className="space-y-1">
                        {review.praise_items.map((item, idx) => (
                          <li key={idx} className="text-sm text-text-secondary flex items-start gap-2">
                            <span className="text-warning">•</span>
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {reviews && reviews.length >= limit && (
        <div className="mt-6 flex justify-center">
          <button
            onClick={() => setLimit((l) => l + 30)}
            disabled={isFetching}
            className="flex items-center gap-2 px-4 py-2 rounded-[2px] bg-info/10 text-info hover:bg-info/20 transition-colors disabled:opacity-50"
          >
            {isFetching && <Loader2 className="w-4 h-4 animate-spin" />}
            {isFetching ? '加载中…' : '加载更多'}
          </button>
        </div>
      )}

      {/* 可信回顾：验证通过的结论沉淀区 */}
      <div className="mt-8 rounded-[2px] border border-white/[0.06] bg-bg-secondary p-5">
        <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-success" />
          可信回顾
          {(pendingVerify ?? 0) > 0 && (
            <button
              onClick={() => navigate('/knowledge/verify')}
              className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded-[2px] bg-warning/10 text-warning text-xs border border-warning/30 hover:bg-warning/20 transition-colors"
              title="这些知识还没验过「对不对」，去验证中心处理"
            >
              {pendingVerify} 条待验证 →
            </button>
          )}
        </h2>
        <p className="text-xs text-text-muted mt-1 mb-4">验证通过的结论会沉淀在这里，建议每周回顾一次</p>
        {!trustedUnits || trustedUnits.length === 0 ? (
          <div className="py-6 text-center text-sm text-text-secondary">本周还没有新确认的可信结论</div>
        ) : (
          <div className="space-y-2">
            {trustedUnits.map((unit) => (
              <div
                key={unit.id}
                onClick={() => navigate(`/knowledge/${unit.id}`)}
                className="flex items-center gap-3 p-2.5 rounded-[2px] bg-white/[0.02] hover:bg-white/[0.05] cursor-pointer transition-all"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-text-primary truncate">
                    {(unit.content_raw || '').slice(0, 60)}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-text-muted mt-1">
                    <span>{unit.brain_side === 'network' ? '网络脑' : unit.brain_side === 'both' ? '双脑' : '个人脑'}</span>
                    <span>确认于 {new Date(unit.updated_at).toLocaleDateString('zh-CN')}</span>
                  </div>
                </div>
                {isThisWeek(unit.updated_at) && (
                  <span className="px-2 py-0.5 rounded-[2px] bg-success/10 text-success text-xs border border-success/30 shrink-0">本周新增</span>
                )}
                {/* 操作：复审（进详情）/ 移出可信（revoked 决议，条目保留）/ 删除（软删） */}
                <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => navigate(`/knowledge/${unit.id}`)}
                    title="人工复审：进入详情查看验证历史、重验或反证"
                    className="p-1.5 rounded-[2px] text-text-muted hover:text-info hover:bg-info/10 transition-colors"
                  >
                    <SearchCheck className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={async () => {
                      if (!confirm('移出可信？该条目的可信标记将被撤销（回到待验证），内容本身保留。')) return;
                      await knowledgeApi.disputeResolution(unit.id, { resolution: 'revoked' });
                      refreshTrusted();
                    }}
                    title="移出可信：撤销可信标记，条目保留"
                    className="p-1.5 rounded-[2px] text-text-muted hover:text-warning hover:bg-warning/10 transition-colors"
                  >
                    <ShieldOff className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={async () => {
                      if (!confirm('直接删除这条知识？删除后从所有列表消失，不可恢复。')) return;
                      await knowledgeApi.delete(unit.id);
                      refreshTrusted();
                    }}
                    title="直接删除该知识单元"
                    className="p-1.5 rounded-[2px] text-text-muted hover:text-danger hover:bg-danger/10 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default DailyReviewPage;
