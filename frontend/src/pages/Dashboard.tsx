import { FC } from 'react';
import { useNavigate } from 'react-router-dom';
import { Brain, TrendingUp, Clock, BookOpen, Target, Inbox, ArrowRight, FileText, PenLine } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '@/store/navigation';
import { brainApi } from '@/api/brain';
import { attentionApi } from '@/api/attention';
import { knowledgeApi } from '@/api/knowledge';
import { capsulesApi } from '@/api/capsules';
import { notesApi } from '@/api/notes';

// Dashboard = 行动页（09-05 拍板）：首屏回答「我现在该干什么」——待整理入口 +
// 最近 5 条笔记；四个统计卡压缩成一行（大数字卡片空落落，信息密度为零）。
const Dashboard: FC = () => {
  const { brainSide } = useNavigation();
  const navigate = useNavigate();
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

  // 最近 5 条笔记（行动页主内容区）
  const { data: recentNotes } = useQuery({
    queryKey: ['notes', 'recent5'],
    queryFn: async () => {
      const response = await notesApi.list({ limit: 5, sort: 'created_at', order: 'desc' });
      return response.data;
    },
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });

  const personalCount = brainStatus?.personal_count ?? 0;
  const networkCount = brainStatus?.network_count ?? 0;
  const totalItems = brainStatus?.total_items ?? 0;
  const unfiledCount = brainStatus?.unfiled_count ?? 0;
  const totalPercent = totalItems > 0 ? Math.round((networkCount / totalItems) * 100) : 0;
  const personalPercent = totalItems > 0 ? Math.round((personalCount / totalItems) * 100) : 0;

  // 压缩到一行的统计条
  const statsRow = [
    { icon: TrendingUp, label: '大脑内容', value: String(totalItems) },
    { icon: BookOpen, label: '知识单元', value: String(knowledgeStats?.both?.total ?? 0) },
    { icon: Clock, label: '时间胶囊', value: String(capsuleStats?.both?.total ?? 0) },
    { icon: Target, label: '今日专注', value: `${attentionDashboard?.total_focus_today ?? 0}h` },
  ];

  const dateStr = new Date().toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="border-b border-border-light pb-5">
        <div className="eyebrow mb-2">{dateStr}</div>
        <div className="flex items-end justify-between gap-4">
          <h1 className="text-3xl sm:text-4xl font-bold text-text-primary tracking-tight">欢迎回来</h1>
          <span className={`badge-${brainSide === 'network' ? 'network' : brainSide === 'both' ? 'fusion' : 'personal'}`}>
            {brainSide === 'network' ? '网络脑' : brainSide === 'both' ? '整合脑' : '个人脑'}
          </span>
        </div>
      </div>

      {/* 统计条：一行压缩（原四大卡片信息密度过低） */}
      <div className="card !py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        {statsRow.map((stat, i) => (
          <div key={i} className="flex items-center gap-2">
            <stat.icon className="w-4 h-4 text-text-muted" />
            <span className="text-xs text-text-secondary">{stat.label}</span>
            <span className="text-sm font-semibold text-text-primary">{stat.value}</span>
          </div>
        ))}
      </div>

      {/* 行动主卡：待整理入口——首屏回答「现在该干什么」 */}
      <div className="card flex items-center gap-4 border-l-2 border-l-info">
        <div className="w-10 h-10 rounded-[2px] bg-info/10 flex items-center justify-center shrink-0">
          <Inbox className="w-5 h-5 text-info" />
        </div>
        <div className="flex-1 min-w-0">
          {unfiledCount > 0 ? (
            <>
              <div className="text-base font-semibold text-text-primary">{unfiledCount} 条内容待整理</div>
              <div className="text-xs text-text-secondary mt-0.5">未归档的笔记/剪藏/知识——归档进目录树，或交给「自动理好」管线加工</div>
            </>
          ) : (
            <>
              <div className="text-base font-semibold text-text-primary">库里没有待整理的内容</div>
              <div className="text-xs text-text-secondary mt-0.5">都归置好了。去记一条新的，或让 AI 帮你回顾</div>
            </>
          )}
        </div>
        {unfiledCount > 0 ? (
          <button
            onClick={() => navigate('/ingest/notes?folder_id=none')}
            className="btn-primary flex items-center gap-1.5 shrink-0"
          >
            开始整理
            <ArrowRight className="w-4 h-4" />
          </button>
        ) : (
          <button
            onClick={() => navigate('/ingest/notes')}
            className="btn-primary flex items-center gap-1.5 shrink-0"
          >
            <PenLine className="w-4 h-4" />
            写一条笔记
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 最近 5 条笔记（替代原「最近活动」空卡） */}
        <div className="card">
          <h3 className="text-lg font-semibold text-text-primary mb-4 pb-3 border-b border-border-light">最近笔记</h3>
          {(recentNotes || []).length > 0 ? (
            <div className="divide-y divide-border-light">
              {recentNotes!.map((n) => (
                <button
                  key={n.id}
                  onClick={() => navigate(`/ingest/notes/${n.id}`)}
                  className="w-full flex items-start gap-3 py-2.5 text-left hover:bg-white/[0.03] transition-colors rounded-[2px] px-1"
                >
                  <FileText className="w-4 h-4 text-text-muted shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-text-primary truncate">{n.title || '无标题笔记'}</div>
                    <div className="text-xs text-text-muted truncate mt-0.5">
                      {(n.content || '').replace(/[#>*`\n]/g, ' ').trim().slice(0, 60)}
                    </div>
                  </div>
                  <span className="text-[10px] text-text-muted shrink-0 mt-1">
                    {new Date(n.created_at).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-48 gap-3 text-text-secondary">
              <p className="text-sm">还没有笔记</p>
              <button
                onClick={() => navigate('/ingest/notes')}
                className="btn-primary flex items-center gap-1.5 text-xs"
              >
                <PenLine className="w-3.5 h-3.5" />
                写第一条笔记
              </button>
            </div>
          )}
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
    </div>
  );
};

export default Dashboard;
