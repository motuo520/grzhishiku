import { FC } from 'react';
import { Brain, TrendingUp, Clock, BookOpen, Target } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '@/store/navigation';
import { brainApi } from '@/api/brain';
import { attentionApi } from '@/api/attention';
import { knowledgeApi } from '@/api/knowledge';
import { capsulesApi } from '@/api/capsules';

const Dashboard: FC = () => {
  const { brainSide } = useNavigation();
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

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold text-text-primary tracking-tight">欢迎回到你的第二大脑</h1>
          <p className="text-text-secondary mt-2 text-lg">记忆、注意力与创造力在此交汇。今天，你想沉淀什么？</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`badge-${brainSide === 'network' ? 'network' : brainSide === 'both' ? 'fusion' : 'personal'}`}>
            {brainSide === 'network' ? 'Network Brain' : brainSide === 'both' ? 'Dual Brain' : 'Personal Brain'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, i) => (
          <div key={i} className="card hover:border-border-color hover:bg-bg-tertiary transition-all">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg bg-bg-secondary ${stat.color}`}>
                  <stat.icon className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-text-primary">{stat.value}</div>
                  <div className="text-sm text-text-secondary">{stat.label}</div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold text-text-primary mb-4">最近活动</h3>
          <div className="flex items-center justify-center h-48 text-text-secondary">
            <p>暂无最近活动</p>
          </div>
        </div>

        <div className="card">
          <h3 className="text-lg font-semibold text-text-primary mb-4">知识分布</h3>
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
    </div>
  );
};

export default Dashboard;
