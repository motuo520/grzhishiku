import { FC } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Gamepad2, AlertCircle, RefreshCw } from 'lucide-react';
import { cognitiveApi } from '@/api/cognitive';
import CognitiveHero from '@/components/brain/CognitiveHero';
import ChallengeStatsCard from '@/components/brain/ChallengeStatsCard';
import DailyChallengeCard from '@/components/brain/DailyChallengeCard';
import ChallengeHistoryList from '@/components/brain/ChallengeHistoryList';

const CognitiveChallengePage: FC = () => {
  const queryClient = useQueryClient();

  const {
    data: challenge,
    isLoading: challengeLoading,
    error: challengeError,
    refetch: refetchChallenge,
  } = useQuery({
    queryKey: ['cognitive', 'challenge', 'daily'],
    queryFn: async () => {
      const response = await cognitiveApi.getDailyChallenge();
      return response.data;
    },
  });

  const {
    data: stats,
    isLoading: statsLoading,
    error: statsError,
    refetch: refetchStats,
  } = useQuery({
    queryKey: ['cognitive', 'challenge', 'stats'],
    queryFn: async () => {
      const response = await cognitiveApi.getChallengeStats();
      return response.data;
    },
  });

  const {
    data: history,
    isLoading: historyLoading,
    error: historyError,
    refetch: refetchHistory,
  } = useQuery({
    queryKey: ['cognitive', 'challenge', 'history'],
    queryFn: async () => {
      const response = await cognitiveApi.getChallengeHistory();
      return response.data;
    },
  });

  const answerMutation = useMutation({
    mutationFn: ({ id, answer }: { id: string; answer: string }) =>
      cognitiveApi.submitChallengeAnswer(id, answer),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cognitive', 'challenge'] });
    },
  });

  const skipMutation = useMutation({
    mutationFn: cognitiveApi.skipChallenge,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cognitive', 'challenge'] });
    },
  });

  const hasError = challengeError || statsError || historyError;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <CognitiveHero
        title="认知挑战"
        subtitle="每日一道思维训练题，在偏差识别、反事实思考与反思练习中提升认知弹性"
      />

      {hasError && (
        <div className="glass-card p-6 border-danger/20 bg-danger/5">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-danger flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-bold text-danger mb-1">部分模块加载失败</h3>
              <p className="text-sm text-text-secondary mb-3">
                可能是后端新表尚未创建，请重启后端服务后刷新页面。若仍有问题，可点击重试。
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => { refetchChallenge(); refetchStats(); refetchHistory(); }}
                  className="btn-secondary flex items-center gap-2 text-sm"
                >
                  <RefreshCw className="w-4 h-4" /> 重试
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ChallengeStatsCard stats={stats} loading={statsLoading} />

      <DailyChallengeCard
        challenge={challenge}
        loading={challengeLoading}
        onAnswer={(id, answer) => answerMutation.mutate({ id, answer })}
        onSkip={(id) => skipMutation.mutate(id)}
        answering={answerMutation.isPending}
      />

      <ChallengeHistoryList history={history} loading={historyLoading} />
    </div>
  );
};

export default CognitiveChallengePage;
