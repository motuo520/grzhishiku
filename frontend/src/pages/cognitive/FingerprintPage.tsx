import { FC, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, Legend
} from 'recharts';
import {
  TrendingUp, Lightbulb, Target, Zap, BarChart3,
  Loader2, RefreshCw, BookOpen, GitBranch, Heart, Layers, Search, Sparkles, Shield
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { cognitiveApi } from '@/api/cognitive';
import type { BrainSide } from '@/types';
import BrainSideToggle from '@/components/brain/BrainSideToggle';
import CognitiveHero from '@/components/brain/CognitiveHero';
import ModelSelector from '@/components/llm/ModelSelector';
import AiErrorNotice from '@/components/llm/AiErrorNotice';


const RADAR_COLORS = ['#58a6ff', '#3fb950', '#d29922', '#f85149', '#a371f7', '#39c5cf'];

const DECISION_STYLE_CONFIG: Record<string, { color: string; icon: typeof Shield; label: string }> = {
  '谨慎型': { color: 'text-success', icon: Shield, label: '谨慎稳健' },
  '直觉型': { color: 'text-warning', icon: Zap, label: '敏锐直觉' },
  '分析型': { color: 'text-info', icon: Search, label: '理性分析' },
};

const FingerprintPage: FC = () => {
  const [brainSide, setBrainSide] = useState<BrainSide>('both');
  const [generating, setGenerating] = useState(false);
  const [modelId, setModelId] = useState<string>('');

  // 不在挂载时自动跑 LLM（整库分析计费）；点「开始分析」才 refetch，30 分钟内复用缓存
  const { data, isLoading, refetch, error } = useQuery({
    queryKey: ['cognitive', 'fingerprint', brainSide, modelId],
    queryFn: async () => {
      const response = await cognitiveApi.fingerprint(50, brainSide, modelId || undefined);
      return response.data;
    },
    enabled: false,
    staleTime: 30 * 60 * 1000,
  });

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await refetch();
    } finally {
      setGenerating(false);
    }
  };

  const fingerprint = data;

  const radarData = fingerprint?.radar_dimensions?.map((dim) => ({
    dimension: dim.name,
    score: dim.score,
    fullMark: 100,
  })) || [];

  const trendData = fingerprint?.trends?.map((t) => ({
    date: t.date.slice(5),
    分析深度: t.analysis_depth,
    创造性: t.creativity,
    逻辑性: t.logic,
    情感表达: t.emotional_expression,
    结构化: t.structure,
    批判性思维: t.critical_thinking,
  })) || [];

  const topicData = fingerprint?.topics?.map((t) => ({
    name: t.topic,
    value: t.percentage,
  })) || [];

  const decisionStyle = fingerprint?.decision_style || '分析型';
  const styleConfig = DECISION_STYLE_CONFIG[decisionStyle] || DECISION_STYLE_CONFIG['分析型'];
  const StyleIcon = styleConfig.icon;

  const sideLabel = brainSide === 'personal' ? '个人脑' : brainSide === 'network' ? '网络脑' : '双脑融合';

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <CognitiveHero
        title="思维指纹"
        subtitle="从六维认知画像中，看见你的思维节律与认知偏好"
      />

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Sparkles className="w-5 h-5 text-fusion-primary" />
          <div>
            <h2 className="text-lg font-bold text-text-primary">{sideLabel} · 思维画像</h2>
            <p className="text-xs text-text-secondary">当前分析 {fingerprint?.analyzed_items_count || 0} 条内容</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-3">
            <ModelSelector value={modelId} onChange={setModelId} taskType="analysis" className="w-48" />
          </div>
          <div className="flex items-center gap-3">
            <BrainSideToggle value={brainSide} onChange={setBrainSide} />
            <button
              onClick={handleGenerate}
              disabled={isLoading || generating}
              className="btn-secondary flex items-center gap-2"
            >
              {isLoading || generating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              <span>{isLoading || generating ? '分析中...' : fingerprint ? '重新分析' : '开始分析'}</span>
            </button>
          </div>
        </div>
      </div>

      <AiErrorNotice error={error} />

      {fingerprint?.degraded && (
        <div className="glass-card p-4 border-warning/20 bg-warning/5 flex items-start gap-2">
          <Sparkles className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
          <p className="text-sm text-warning">
            AI 分析暂时不可用，以下为基于你内容的本地估算结果（数字较粗糙），稍后点「重新分析」可获得精准画像。
          </p>
        </div>
      )}

      {(isLoading || generating) && !fingerprint ? (
        <div className="glass-card p-12 flex flex-col items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-info mb-4" />
          <p className="text-text-secondary">正在分析你的思维特征...</p>
        </div>
      ) : !fingerprint ? (
        <div className="glass-card p-12 flex flex-col items-center justify-center">
          <Sparkles className="w-8 h-8 text-info mb-4" />
          <p className="text-text-secondary">点击右上角「开始分析」生成你的思维指纹报告（会消耗 LLM 费用）</p>
        </div>
      ) : (
        <>
          {/* Top Stats Row */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="glass-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <BookOpen className="w-4 h-4 text-info" />
                <span className="text-sm text-text-secondary">分析内容</span>
              </div>
              <div className="text-2xl font-bold text-text-primary">
                {fingerprint?.analyzed_items_count || 0}
              </div>
              <div className="text-xs text-text-muted">篇笔记/知识单元</div>
            </div>
            <div className="glass-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <GitBranch className="w-4 h-4 text-fusion-primary" />
                <span className="text-sm text-text-secondary">逻辑偏好</span>
              </div>
              <div className="text-2xl font-bold text-text-primary">
                {fingerprint?.logic_preference || '归纳'}
              </div>
              <div className="text-xs text-text-muted">主要推理方式</div>
            </div>
            <div className="glass-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <Heart className="w-4 h-4 text-danger" />
                <span className="text-sm text-text-secondary">情感倾向</span>
              </div>
              <div className="text-2xl font-bold text-text-primary">
                {fingerprint?.emotional_tendency
                  ? `${Math.round((fingerprint.emotional_tendency.positive || 0) * 100)}% 积极`
                  : '—'}
              </div>
              <div className="text-xs text-text-muted">整体情感基调</div>
            </div>
            <div className="glass-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <Layers className="w-4 h-4 text-success" />
                <span className="text-sm text-text-secondary">词汇多样性</span>
              </div>
              <div className="text-2xl font-bold text-text-primary">
                {fingerprint?.vocabulary_diversity
                  ? `${(fingerprint.vocabulary_diversity * 100).toFixed(1)}%`
                  : '—'}
              </div>
              <div className="text-xs text-text-muted">Type-Token Ratio</div>
            </div>
          </div>

          {/* Radar Chart + Decision Style */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 glass-card p-6">
              <div className="flex items-center gap-2 mb-4">
                <Target className="w-5 h-5 text-info" />
                <h2 className="text-lg font-bold text-text-primary">六维认知画像</h2>
              </div>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
                    <PolarGrid stroke="#30363d" />
                    <PolarAngleAxis dataKey="dimension" tick={{ fill: '#8b949e', fontSize: 12 }} />
                    <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: '#6e7681', fontSize: 10 }} />
                    <Radar
                      name="思维评分"
                      dataKey="score"
                      stroke="#58a6ff"
                      fill="#58a6ff"
                      fillOpacity={0.2}
                      strokeWidth={2}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#161b22',
                        border: '1px solid #30363d',
                        borderRadius: '12px',
                        color: '#c9d1d9',
                      }}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="space-y-4">
              {/* Decision Style Badge */}
              <div className="glass-card p-6 text-center">
                <div className="text-sm text-text-secondary mb-3">主要决策风格</div>
                <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/[0.05] border border-white/[0.1] ${styleConfig.color}`}>
                  <StyleIcon className="w-5 h-5" />
                  <span className="text-lg font-bold">{decisionStyle}</span>
                </div>
                <p className="text-xs text-text-muted mt-3">
                  基于你近期{sideLabel}内容，你倾向于{styleConfig.label}型决策方式。
                </p>
              </div>

              {/* Topic Pie Chart */}
              <div className="glass-card p-6">
                <div className="flex items-center gap-2 mb-3">
                  <BarChart3 className="w-4 h-4 text-fusion-primary" />
                  <h3 className="font-bold text-text-primary text-sm">主题偏好</h3>
                </div>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={topicData}
                        cx="50%"
                        cy="50%"
                        innerRadius={40}
                        outerRadius={70}
                        paddingAngle={4}
                        dataKey="value"
                      >
                        {topicData.map((_, index) => (
                          <Cell key={index} fill={RADAR_COLORS[index % RADAR_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#161b22',
                          border: '1px solid #30363d',
                          borderRadius: '12px',
                          color: '#c9d1d9',
                        }}
                        formatter={(value: number) => `${value}%`}
                      />
                      <Legend
                        formatter={(value: string) => <span style={{ color: '#8b949e', fontSize: 12 }}>{value}</span>}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>

          {/* Trend Chart */}
          <div className="glass-card p-6">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-5 h-5 text-success" />
              <h2 className="text-lg font-bold text-text-primary">30天认知趋势</h2>
            </div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
                  <XAxis dataKey="date" tick={{ fill: '#6e7681', fontSize: 11 }} />
                  <YAxis domain={[0, 100]} tick={{ fill: '#6e7681', fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#161b22',
                      border: '1px solid #30363d',
                      borderRadius: '12px',
                      color: '#c9d1d9',
                    }}
                  />
                  <Area type="monotone" dataKey="分析深度" stroke="#58a6ff" fill="#58a6ff" fillOpacity={0.1} strokeWidth={2} />
                  <Area type="monotone" dataKey="创造性" stroke="#a371f7" fill="#a371f7" fillOpacity={0.1} strokeWidth={2} />
                  <Area type="monotone" dataKey="逻辑性" stroke="#3fb950" fill="#3fb950" fillOpacity={0.1} strokeWidth={2} />
                  <Area type="monotone" dataKey="批判性思维" stroke="#f85149" fill="#f85149" fillOpacity={0.1} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Suggestions */}
          <div className="glass-card p-6">
            <div className="flex items-center gap-2 mb-4">
              <Lightbulb className="w-5 h-5 text-warning" />
              <h2 className="text-lg font-bold text-text-primary">改进建议</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(fingerprint?.suggestions || []).map((suggestion, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="flex items-start gap-3 p-4 rounded-xl bg-white/[0.02] border border-white/[0.05] hover:border-warning/20 transition-colors"
                >
                  <div className="p-2 rounded-lg bg-warning/10 text-warning flex-shrink-0">
                    <Zap className="w-4 h-4" />
                  </div>
                  <p className="text-sm text-text-primary leading-relaxed">{suggestion}</p>
                </motion.div>
              ))}
              {(fingerprint?.suggestions || []).length === 0 && (
                <p className="text-text-secondary text-sm col-span-2 text-center py-4">
                  暂无建议，开始记录更多内容吧
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default FingerprintPage;
