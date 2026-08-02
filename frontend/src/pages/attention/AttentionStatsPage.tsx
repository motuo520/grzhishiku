import { FC, useState } from 'react';
import { Brain, Clock, Shield, Target, User, Globe, Layers, Sparkles, Loader2 } from 'lucide-react';
import { useAttention } from '@/hooks/useAttention';
import ModelSelector from '@/components/llm/ModelSelector';
import AiErrorNotice from '@/components/llm/AiErrorNotice';
import { completeText } from '@/api/llm';
import { attentionApi, AttentionWeeklyReport } from '@/api/attention';

const BRAIN_TABS = [
  { key: 'both', label: '双脑总览', icon: Layers },
  { key: 'personal', label: '个人脑', icon: User },
  { key: 'network', label: '网络脑', icon: Globe },
];

const AttentionStatsPage: FC = () => {
  const [brainSide, setBrainSide] = useState<'both' | 'personal' | 'network'>('both');
  const {
    stats,
    score,
    categories,
    rations,
    isLoadingStats,
    isLoadingScore,
    isLoadingCategories,
    isLoadingRations,
  } = useAttention(brainSide);
  const [modelId, setModelId] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [aiError, setAiError] = useState<any>(null);
  const [wrLoading, setWrLoading] = useState(false);
  const [wrError, setWrError] = useState<any>(null);
  const [weeklyReport, setWeeklyReport] = useState<AttentionWeeklyReport | null>(null);
  const [wrNarrative, setWrNarrative] = useState<string | null>(null);

  const daily = stats?.daily ?? { total_activities: 0, total_focus_minutes: 0, deep_work_sessions: 0, interruptions: 0 };
  const scoreData = score ?? { score: 0, breakdown: { focus_duration_score: 0, interruption_penalty: 0, deep_work_score: 0 } };

  const isPersonal = brainSide === 'personal' || brainSide === 'both';
  const isNetwork = brainSide === 'network' || brainSide === 'both';

  const personalCategories = (categories || []).filter((c) => c.brain_side === 'personal' || c.brain_side === 'both');

  // 汇总口径：总用量 / 总预算，避免“平均百分比”误导
  const totalBudgetAllocated = personalCategories.reduce((sum, c) => sum + (c.allocated_minutes || 0), 0);
  const totalBudgetUsed = personalCategories.reduce((sum, c) => sum + (c.used_minutes || 0), 0);
  const budgetExecutionRate = totalBudgetAllocated > 0
    ? Math.round((totalBudgetUsed / totalBudgetAllocated) * 100)
    : 0;

  const totalRationLimit = (rations || []).reduce((sum, r) => sum + (r.daily_limit_minutes || 0), 0);
  const totalRationUsed = (rations || []).reduce((sum, r) => sum + (r.used_minutes || 0), 0);
  const rationExecutionRate = totalRationLimit > 0
    ? Math.round((totalRationUsed / totalRationLimit) * 100)
    : 0;

  const isLoading = isLoadingStats || isLoadingScore || isLoadingCategories || isLoadingRations;

  const insightPrompt = `请根据以下注意力数据生成一段简洁的洞察报告（200 字以内），指出亮点、风险和一条可执行建议。\n\n${JSON.stringify({
    brain_side: brainSide,
    daily: stats?.daily ?? daily,
    score: score ?? { score: 0, breakdown: scoreData.breakdown },
    categories: (categories || []).map((c) => ({ name: c.name, brain_side: c.brain_side, used_minutes: c.used_minutes, allocated_minutes: c.allocated_minutes })),
    rations: (rations || []).map((r) => ({ name: r.name, used_minutes: r.used_minutes, daily_limit_minutes: r.daily_limit_minutes })),
  }, null, 2)}`;

  const handleGenerateInsight = async () => {
    setAiLoading(true);
    setAiError(null);
    try {
      const result = await completeText({
        prompt: insightPrompt,
        system_prompt: '你是一位注意力管理教练。请基于用户的专注时长、干扰次数、深度工作次数、时间预算执行率等数据，给出专业、温和、可执行的洞察报告。',
        model: modelId || undefined,
        task_type: 'analysis',
      });
      setAiInsight(result.text);
    } catch (e: any) {
      setAiError(e);
    } finally {
      setAiLoading(false);
    }
  };

  const handleGenerateWeeklyReport = async () => {
    setWrLoading(true);
    setWrError(null);
    setWrNarrative(null);
    try {
      const res = await attentionApi.weeklyReport(brainSide);
      const report = res.data;
      setWeeklyReport(report);
      const weeklyPrompt = `请根据以下最近 7 天注意力数据，生成一段 200 字以内的中文周报：总结本周专注表现、亮点、风险，并给出 1-2 条可执行建议。\n\n${JSON.stringify(report, null, 2)}`;
      const result = await completeText({
        prompt: weeklyPrompt,
        system_prompt: '你是一位注意力管理教练。请基于用户最近一周的专注时长、深度工作次数、干扰次数、每日趋势和分类分布，给出专业、温和、可执行的周报。',
        model: modelId || undefined,
        task_type: 'analysis',
      });
      setWrNarrative(result.text);
    } catch (e: any) {
      setWrError(e);
    } finally {
      setWrLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 max-w-7xl mx-auto flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-info" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">统计分析</h1>
          <p className="text-sm text-text-secondary mt-1">跨脑侧注意力模式洞察</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ModelSelector value={modelId} onChange={setModelId} taskType="analysis" className="w-48" />
          <button
            onClick={handleGenerateInsight}
            disabled={aiLoading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-warning/10 border border-warning/30 text-warning text-xs font-medium hover:bg-warning/20 transition-colors disabled:opacity-50"
          >
            {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            生成洞察
          </button>
        </div>
      </div>

      {aiError && <AiErrorNotice error={aiError} />}

      {aiInsight && (
        <div className="card border-l-4 border-l-warning">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-warning" />
            <h3 className="text-sm font-semibold text-text-primary">洞察报告</h3>
          </div>
          <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">{aiInsight}</p>
        </div>
      )}

      <div className="flex items-center gap-2 p-1 rounded-xl bg-white/[0.03] border border-white/[0.08]">
        {BRAIN_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = brainSide === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setBrainSide(tab.key as typeof brainSide)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                active ? 'bg-info/15 text-info' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatsCard icon={Brain} label="专注时长" value={`${daily.total_focus_minutes} 分钟`} color="text-personal-primary" />
        <StatsCard icon={Shield} label="干扰次数" value={`${daily.interruptions} 次`} color="text-network-primary" />
        <StatsCard icon={Target} label="综合专注评分" value={String(scoreData.score)} color="text-fusion-primary" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {isPersonal && (
          <div className="card">
            <div className="flex items-center gap-2 mb-4">
              <Brain className="w-5 h-5 text-personal-primary" />
              <h3 className="text-lg font-semibold text-text-primary">个人脑报告</h3>
            </div>
            <ul className="space-y-2 text-sm text-text-secondary">
              <li>· 今日深度工作 {daily.deep_work_sessions} 次</li>
              <li>· 专注时长评分 {scoreData.breakdown.focus_duration_score} 分</li>
              <li>· 时间预算执行率 {budgetExecutionRate}%（{totalBudgetUsed}/{totalBudgetAllocated} 分钟）</li>
            </ul>
          </div>
        )}

        {isNetwork && (
          <div className="card">
            <div className="flex items-center gap-2 mb-4">
              <Shield className="w-5 h-5 text-network-primary" />
              <h3 className="text-lg font-semibold text-text-primary">网络脑报告</h3>
            </div>
            <ul className="space-y-2 text-sm text-text-secondary">
              <li>· 今日干扰次数 {daily.interruptions} 次</li>
              <li>· 干扰控制评分 {scoreData.breakdown.interruption_penalty} 分</li>
              <li>· 信息流配额执行率 {rationExecutionRate}%（{totalRationUsed}/{totalRationLimit} 分钟）</li>
            </ul>
          </div>
        )}
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-info" />
            <h3 className="text-lg font-semibold text-text-primary">周报生成</h3>
          </div>
          <button
            onClick={handleGenerateWeeklyReport}
            disabled={wrLoading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-info/10 border border-info/30 text-info text-xs font-medium hover:bg-info/20 transition-colors disabled:opacity-50"
          >
            {wrLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            生成本周周报
          </button>
        </div>

        {wrError && <AiErrorNotice error={wrError} className="mb-3" />}

        {!weeklyReport && !wrLoading && (
          <p className="text-sm text-text-secondary">
            点击「生成本周周报」，汇总最近 7 天（{brainSide === 'personal' ? '个人脑' : brainSide === 'network' ? '网络脑' : '双脑'}）的专注表现并生成周报。
          </p>
        )}

        {weeklyReport && (
          <div className="space-y-4">
            <div className="text-xs text-text-muted">{weeklyReport.week_start} ~ {weeklyReport.week_end}</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <MiniStat label="总专注" value={`${weeklyReport.total_focus_minutes} 分钟`} />
              <MiniStat label="深度工作" value={`${weeklyReport.deep_work_sessions} 次`} />
              <MiniStat label="干扰次数" value={`${weeklyReport.interruptions} 次`} />
              <MiniStat label="平均评分" value={String(weeklyReport.average_focus_score)} />
            </div>

            {weeklyReport.category_distribution.length > 0 && (
              <div>
                <div className="text-xs text-text-muted mb-2">分类分布</div>
                <div className="flex flex-wrap gap-2">
                  {weeklyReport.category_distribution.map((c) => (
                    <span key={c.key} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/[0.04] border border-white/[0.08] text-xs text-text-secondary">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                      {c.name} {c.minutes} 分钟
                    </span>
                  ))}
                </div>
              </div>
            )}

            {weeklyReport.daily_trend.length > 0 && (
              <div>
                <div className="text-xs text-text-muted mb-2">每日专注（分钟）</div>
                <div className="flex items-end gap-2 h-24">
                  {weeklyReport.daily_trend.map((d) => {
                    const max = Math.max(1, ...weeklyReport.daily_trend.map((x) => x.focus_minutes));
                    const h = Math.round((d.focus_minutes / max) * 100);
                    return (
                      <div key={d.date} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                        <div className="w-full bg-info/40 rounded-t" style={{ height: `${Math.max(4, h)}%` }} title={`${d.focus_minutes} 分钟`} />
                        <span className="text-[10px] text-text-muted">{d.day}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {wrNarrative && (
              <div className="border-t border-white/[0.08] pt-3">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="w-4 h-4 text-info" />
                  <span className="text-sm font-semibold text-text-primary">周报</span>
                </div>
                <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">{wrNarrative}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const StatsCard: FC<{ icon: React.ElementType; label: string; value: string; color: string }> = ({
  icon: Icon, label, value, color,
}) => (
  <div className="card flex items-center gap-3">
    <Icon className={`w-6 h-6 ${color}`} />
    <div>
      <div className="text-2xl font-bold text-text-primary">{value}</div>
      <div className="text-xs text-text-muted">{label}</div>
    </div>
  </div>
);

const MiniStat: FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-xl bg-white/[0.03] border border-white/[0.08] p-3">
    <div className="text-lg font-bold text-text-primary">{value}</div>
    <div className="text-xs text-text-muted">{label}</div>
  </div>
);

export default AttentionStatsPage;
