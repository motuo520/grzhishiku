import { FC, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Activity, Clock, Brain, AlertTriangle, Target, User, Globe, Layers,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts';
import { useAttention } from '@/hooks/useAttention';

const CHART_COLORS = ['#58a6ff', '#3fb950', '#f778ba', '#d29922', '#8b949e', '#a371f7'];
const DARK_BG = '#161b22';
const GRID_COLOR = '#30363d';

const CircularProgress: FC<{ value: number; size?: number; strokeWidth?: number; color?: string }> = ({
  value, size = 120, strokeWidth = 8, color = '#58a6ff'
}) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={GRID_COLOR} strokeWidth={strokeWidth} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth}
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-text-primary">{Math.round(value)}</span>
        <span className="text-[10px] text-text-muted">分</span>
      </div>
    </div>
  );
};

const BRAIN_TABS = [
  { key: 'both', label: '双脑总览', icon: Layers },
  { key: 'personal', label: '个人脑', icon: User },
  { key: 'network', label: '网络脑', icon: Globe },
];

const AttentionDashboardPage: FC = () => {
  const [brainSide, setBrainSide] = useState<'both' | 'personal' | 'network'>('both');
  const { stats, score, isLoadingStats, isLoadingScore } = useAttention(brainSide);

  if (isLoadingStats || isLoadingScore) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-info border-t-transparent rounded-full" />
      </div>
    );
  }

  const daily = stats?.daily ?? { total_activities: 0, total_focus_minutes: 0, deep_work_sessions: 0, interruptions: 0 };
  const weekly = stats?.weekly ?? [];
  const categories = stats?.categories ?? [];
  const scoreData = score ?? { score: 0, breakdown: { focus_duration_score: 0, interruption_penalty: 0, deep_work_score: 0 }, trend: [] };

  const overviewCards = [
    { icon: Activity, label: '总活动', value: daily.total_activities, unit: '', color: '#58a6ff', bg: 'rgba(88,166,255,0.08)' },
    { icon: Clock, label: '专注时长', value: daily.total_focus_minutes, unit: '分钟', color: '#3fb950', bg: 'rgba(63,185,80,0.08)' },
    { icon: Brain, label: '深度工作', value: daily.deep_work_sessions, unit: '次', color: '#a371f7', bg: 'rgba(163,113,247,0.08)' },
    { icon: AlertTriangle, label: '干扰次数', value: daily.interruptions, unit: '次', color: '#d29922', bg: 'rgba(210,153,34,0.08)' },
  ];

  const pieData = categories.length > 0 ? categories : [
    { name: '工作', key: 'work', minutes: 0, color: '#58a6ff' },
    { name: '学习', key: 'study', minutes: 0, color: '#3fb950' },
    { name: '娱乐', key: 'entertainment', minutes: 0, color: '#f778ba' },
    { name: '社交', key: 'social', minutes: 0, color: '#d29922' },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">注意力仪表盘</h1>
          <p className="text-sm text-text-secondary mt-1">双脑注意力资源总览</p>
        </div>
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
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {overviewCards.map((card, i) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="card"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: card.bg, color: card.color }}>
                <card.icon className="w-5 h-5" />
              </div>
              <div>
                <div className="text-2xl font-bold text-text-primary">{card.value}<span className="text-sm text-text-muted font-normal ml-1">{card.unit}</span></div>
                <div className="text-xs text-text-muted">{card.label}</div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Weekly Trend Line Chart */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="card lg:col-span-2"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-text-primary">本周专注趋势</h3>
            <span className="text-xs text-text-muted">单位：分钟</span>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={weekly}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
                <XAxis dataKey="day" stroke="#8b949e" fontSize={12} />
                <YAxis stroke="#8b949e" fontSize={12} />
                <Tooltip
                  contentStyle={{ backgroundColor: DARK_BG, border: `1px solid ${GRID_COLOR}`, borderRadius: 8, color: '#c9d1d9' }}
                  itemStyle={{ color: '#58a6ff' }}
                />
                <Line type="monotone" dataKey="focus_minutes" stroke="#58a6ff" strokeWidth={2} dot={{ fill: '#58a6ff', r: 3 }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* Category Pie Chart */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="card"
        >
          <h3 className="text-lg font-semibold text-text-primary mb-4">分类占比</h3>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%" cy="50%" innerRadius={50} outerRadius={80}
                  paddingAngle={3} dataKey="minutes"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color || CHART_COLORS[index % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: DARK_BG, border: `1px solid ${GRID_COLOR}`, borderRadius: 8, color: '#c9d1d9' }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 space-y-2">
            {pieData.map((cat) => (
              <div key={cat.key} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.color }} />
                  <span className="text-text-primary">{cat.name}</span>
                </span>
                <span className="text-text-muted">{cat.minutes} min</span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Focus Score */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        className="card"
      >
        <div className="flex items-center gap-2 mb-4">
          <Target className="w-5 h-5 text-info" />
          <h3 className="text-lg font-semibold text-text-primary">专注评分</h3>
        </div>
        <div className="flex flex-col md:flex-row items-center gap-8">
          <CircularProgress value={scoreData.score} color={scoreData.score >= 80 ? '#3fb950' : scoreData.score >= 50 ? '#58a6ff' : '#d29922'} />
          <div className="flex-1 w-full space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-text-secondary">专注时长 (60%)</span>
                <span className="text-text-primary font-medium">{scoreData.breakdown.focus_duration_score} 分</span>
              </div>
              <div className="h-2 bg-white/[0.05] rounded-full overflow-hidden">
                <div className="h-full bg-info rounded-full transition-all" style={{ width: `${scoreData.breakdown.focus_duration_score}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-text-secondary">干扰控制 (20%)</span>
                <span className="text-text-primary font-medium">{scoreData.breakdown.interruption_penalty} 分</span>
              </div>
              <div className="h-2 bg-white/[0.05] rounded-full overflow-hidden">
                <div className="h-full bg-success rounded-full transition-all" style={{ width: `${scoreData.breakdown.interruption_penalty}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-text-secondary">深度工作 (20%)</span>
                <span className="text-text-primary font-medium">{scoreData.breakdown.deep_work_score} 分</span>
              </div>
              <div className="h-2 bg-white/[0.05] rounded-full overflow-hidden">
                <div className="h-full bg-fusion-primary rounded-full transition-all" style={{ width: `${scoreData.breakdown.deep_work_score}%` }} />
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default AttentionDashboardPage;
