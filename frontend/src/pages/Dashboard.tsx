import { FC, useState } from 'react';
import { Brain, TrendingUp, Clock, BookOpen, Target, Sparkles, ArrowRight, Download, Search, MessageCircle, Loader2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useNavigation } from '@/store/navigation';
import { brainApi } from '@/api/brain';
import { attentionApi } from '@/api/attention';
import { knowledgeApi } from '@/api/knowledge';
import { capsulesApi } from '@/api/capsules';

const Dashboard: FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { brainSide } = useNavigation();
  const [seedMessage, setSeedMessage] = useState<string | null>(null);

  const { data: brainStatus } = useQuery({
    queryKey: ['brain', 'status'],
    queryFn: async () => {
      const response = await brainApi.status();
      return response.data;
    },
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });

  const { data: attentionDashboard } = useQuery({
    queryKey: ['attention', 'dashboard'],
    queryFn: async () => {
      const response = await attentionApi.dashboard();
      return response.data;
    },
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });

  const { data: knowledgeStats } = useQuery({
    queryKey: ['knowledge', 'stats'],
    queryFn: async () => {
      const response = await knowledgeApi.stats();
      return response.data;
    },
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });

  const { data: capsuleStats } = useQuery({
    queryKey: ['capsules', 'stats'],
    queryFn: async () => {
      const response = await capsulesApi.stats();
      return response.data;
    },
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });

  const seedMutation = useMutation({
    mutationFn: () => knowledgeApi.seedDemo(),
    onSuccess: (response) => {
      setSeedMessage(response.data.message);
      queryClient.invalidateQueries({ queryKey: ['knowledge'] });
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      queryClient.invalidateQueries({ queryKey: ['brain', 'status'] });
    },
    onError: (error: any) => {
      setSeedMessage(error?.response?.data?.detail || '导入失败，请稍后重试');
    },
  });

  const personalCount = brainStatus?.personal_count ?? 0;
  const networkCount = brainStatus?.network_count ?? 0;
  const totalItems = brainStatus?.total_items ?? 0;
  const totalPercent = totalItems > 0 ? Math.round((networkCount / totalItems) * 100) : 0;
  const personalPercent = totalItems > 0 ? Math.round((personalCount / totalItems) * 100) : 0;

  const stats = [
    {
      icon: BookOpen,
      label: '知识单元',
      value: String(knowledgeStats?.both?.total ?? 0),
      color: 'text-info',
    },
    {
      icon: Clock,
      label: '时间胶囊',
      value: String(capsuleStats?.both?.total ?? 0),
      color: 'text-warning',
    },
    {
      icon: Target,
      label: '今日专注',
      value: `${attentionDashboard?.total_focus_today ?? 0}h`,
      color: 'text-success',
    },
    {
      icon: TrendingUp,
      label: '大脑内容',
      value: String(totalItems),
      color: 'text-fusion-primary',
    },
  ];

  const dateStr = new Date().toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });

  const isEmpty = (knowledgeStats?.both?.total ?? 0) === 0;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="border-b border-border-light pb-5">
        <div className="eyebrow mb-2">{dateStr}</div>
        <div className="flex items-end justify-between gap-4">
          <h1 className="text-3xl sm:text-4xl font-bold text-text-primary tracking-tight">欢迎回来</h1>
          <span className={`badge-${brainSide === 'network' ? 'network' : brainSide === 'both' ? 'fusion' : 'personal'}`}>
            {brainSide === 'network' ? 'Network Brain' : brainSide === 'both' ? 'Dual Brain' : 'Personal Brain'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, i) => (
          <div key={i} className="card transition-colors">
            <div className="flex items-start justify-between">
              <div>
                <div className="eyebrow">{stat.label}</div>
                <div className="text-3xl font-bold text-text-primary mt-2">{stat.value}</div>
              </div>
              <stat.icon className={`w-5 h-5 ${stat.color} opacity-70`} />
            </div>
          </div>
        ))}
      </div>

      {isEmpty && (
        <div className="card border border-accent/30 bg-accent/[0.03]">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-4 h-4 text-accent" />
                <span className="text-sm font-semibold text-accent">首次使用</span>
              </div>
              <h3 className="text-xl font-bold text-text-primary mb-2">导入示例大脑，30 秒内问出第一个问题</h3>
              <p className="text-sm text-text-secondary leading-relaxed">
                我们准备了 200 条预置笔记：读书笔记、菜谱、工作记录。导入后，你就可以直接向 AI 提问，比如"番茄炒蛋怎么做"或"原子习惯的核心观点"。
              </p>
              {seedMessage && (
                <p className="text-sm text-accent mt-3">{seedMessage}</p>
              )}
            </div>
            <button
              onClick={() => seedMutation.mutate()}
              disabled={seedMutation.isPending}
              className="shrink-0 inline-flex items-center gap-2 px-5 py-2.5 rounded-[2px] bg-accent hover:bg-[var(--accent-hover)] text-[var(--accent-ink)] text-sm font-medium transition-colors disabled:opacity-60"
            >
              {seedMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              {seedMutation.isPending ? '导入中…' : '导入示例大脑'}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold text-text-primary mb-4 pb-3 border-b border-border-light">新手三步</h3>
          <div className="space-y-4">
            {[
              {
                step: '1',
                icon: Download,
                title: isEmpty ? '导入示例大脑（或自己存一条）' : '继续存资料',
                desc: isEmpty ? '点击上方按钮，体验 200 条预置笔记。' : '用剪藏、笔记、导入继续丰富知识库。',
                action: isEmpty ? () => seedMutation.mutate() : () => navigate('/ingest'),
                actionLabel: isEmpty ? '导入' : '去存资料',
              },
              {
                step: '2',
                icon: MessageCircle,
                title: '问一句话',
                desc: '打开右下角 AI 助手，提问并选择本地或云端模型。',
                action: () => window.dispatchEvent(new CustomEvent('psb:chat:open')),
                actionLabel: '打开 AI 助手',
              },
              {
                step: '3',
                icon: Search,
                title: '看到引用出处',
                desc: '每个回答都会标注来自哪条笔记，点击即可跳回原文。',
                action: () => navigate('/knowledge'),
                actionLabel: '查看知识库',
              },
            ].map((item) => (
              <div key={item.step} className="flex gap-4">
                <div className="w-8 h-8 rounded-[2px] bg-bg-tertiary border border-border-color flex items-center justify-center shrink-0 text-sm font-bold text-accent">
                  {item.step}
                </div>
                <div className="flex-1">
                  <h4 className="text-base font-bold text-text-primary mb-1 flex items-center gap-2">
                    <item.icon className="w-4 h-4 text-text-secondary" />
                    {item.title}
                  </h4>
                  <p className="text-sm text-text-secondary mb-2">{item.desc}</p>
                  <button
                    onClick={item.action}
                    disabled={seedMutation.isPending && item.step === '1' && isEmpty}
                    className="inline-flex items-center gap-1 text-xs text-accent hover:text-[var(--accent-link)] transition-colors disabled:opacity-60"
                  >
                    {item.actionLabel}
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h3 className="text-lg font-semibold text-text-primary mb-4 pb-3 border-b border-border-light">知识分布</h3>
          <div className="flex items-center justify-center h-48">
            <div className="relative w-32 h-32">
              <div className="absolute inset-0 rounded-full border-8 border-network-primary/30" />
              <div className="absolute inset-2 rounded-full border-8 border-personal-primary/30" />
              <div className="absolute inset-4 rounded-full border-8 border-fusion-primary/20" />
              <div className="absolute inset-0 flex items-center justify-center">
                <Brain className="w-8 h-8 text-info" />
              </div>
            </div>
          </div>
          <div className="flex justify-center gap-6 mt-4">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-network-primary" />
              <span className="text-sm text-text-secondary">网络 {totalPercent}%</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-personal-primary" />
              <span className="text-sm text-text-secondary">个人 {personalPercent}%</span>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="text-lg font-semibold text-text-primary mb-4 pb-3 border-b border-border-light">最近活动</h3>
        <div className="flex items-center justify-center h-48 text-text-secondary">
          <p>暂无最近活动</p>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
