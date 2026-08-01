import { FC, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, RefreshCw, Loader2, Calendar } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cognitiveApi, WeeklyReport } from '@/api/cognitive';
import CognitiveHero from '@/components/brain/CognitiveHero';
import WeeklyReportScore from '@/components/brain/WeeklyReportScore';
import WeeklyReportInsights from '@/components/brain/WeeklyReportInsights';
import WeeklyReportList from '@/components/brain/WeeklyReportList';
import ModelSelector from '@/components/llm/ModelSelector';
import AiErrorNotice from '@/components/llm/AiErrorNotice';

const CognitiveWeeklyReportPage: FC = () => {
  const queryClient = useQueryClient();
  const [selectedReport, setSelectedReport] = useState<WeeklyReport | null>(null);
  const [modelId, setModelId] = useState<string>('');

  const { data: latestReport, isLoading: latestLoading } = useQuery({
    queryKey: ['cognitive', 'weekly-report', 'latest'],
    queryFn: async () => {
      const response = await cognitiveApi.getLatestWeeklyReport();
      return response.data;
    },
  });

  const { data: history, isLoading: historyLoading } = useQuery({
    queryKey: ['cognitive', 'weekly-reports', 'list'],
    queryFn: async () => {
      const response = await cognitiveApi.listWeeklyReports({ limit: 12 });
      return response.data;
    },
  });

  const generateMutation = useMutation({
    mutationFn: (preferred_model?: string) => cognitiveApi.generateWeeklyReport(true, preferred_model),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cognitive', 'weekly-report'] });
      queryClient.invalidateQueries({ queryKey: ['cognitive', 'weekly-reports'] });
    },
  });

  const displayReport = selectedReport || latestReport;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <CognitiveHero
        title="认知健康周报"
        subtitle="每周一次，回顾你的输入、反思、决策与偏差觉察，量化认知健康状态"
      />

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <FileText className="w-5 h-5 text-fusion-primary" />
          <div>
            <h2 className="text-lg font-bold text-text-primary">周报中心</h2>
            <p className="text-xs text-text-secondary">
              {displayReport
                ? `${displayReport.week_start.slice(0, 10)} ~ ${displayReport.week_end.slice(0, 10)}`
                : '暂无周报'}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-3">
            <ModelSelector value={modelId} onChange={setModelId} taskType="analysis" className="w-48" />
          </div>
          <button
            onClick={() => generateMutation.mutate(modelId || undefined)}
            disabled={generateMutation.isPending}
            className="btn-primary flex items-center gap-2"
          >
            {generateMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            <span>{generateMutation.isPending ? '生成中...' : '生成本周周报'}</span>
          </button>
        </div>
      </div>

      <AiErrorNotice error={generateMutation.error} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <AnimatePresence mode="wait">
            {displayReport ? (
              <motion.div
                key={displayReport.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6"
              >
                <WeeklyReportScore
                  score={displayReport.health_score}
                  summary={displayReport.summary}
                  dimensions={displayReport.dimensions}
                  stats={displayReport.stats}
                  loading={latestLoading && !displayReport}
                />
                <WeeklyReportInsights
                  highlights={displayReport.highlights}
                  risks={displayReport.risks}
                  suggestions={displayReport.suggestions}
                />
              </motion.div>
            ) : (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="glass-card p-12 text-center"
              >
                <div className="p-4 rounded-full bg-fusion-primary/10 w-fit mx-auto mb-4">
                  <Calendar className="w-8 h-8 text-fusion-primary" />
                </div>
                <h3 className="text-lg font-bold text-text-primary mb-2">还没有认知健康周报</h3>
                <p className="text-text-secondary text-sm max-w-md mx-auto mb-4">
                  点击右上角按钮，AI 会基于你本周的笔记、知识、挑战、审计与模拟数据生成首份周报。
                </p>
                <div className="flex flex-col items-center gap-2">
                  <div className="flex items-center gap-3">
                    <ModelSelector value={modelId} onChange={setModelId} taskType="analysis" className="w-48" />
                  </div>
                  <button
                    onClick={() => generateMutation.mutate(modelId || undefined)}
                    disabled={generateMutation.isPending}
                    className="btn-primary flex items-center gap-2"
                  >
                    {generateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    <span>{generateMutation.isPending ? '生成中...' : '生成周报'}</span>
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="lg:col-span-1">
          <WeeklyReportList
            reports={history?.items || []}
            selectedId={displayReport?.id}
            onSelect={setSelectedReport}
            loading={historyLoading}
          />
        </div>
      </div>
    </div>
  );
};

export default CognitiveWeeklyReportPage;
