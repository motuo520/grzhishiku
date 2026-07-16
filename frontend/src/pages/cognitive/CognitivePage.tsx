import { FC, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Brain, AlertTriangle, Scale, Fingerprint, Zap, BarChart3,
  ChevronRight, Eye, Search, TrendingUp, Filter, Lightbulb,
  ClipboardCheck, GitBranch, Gamepad2, FileText
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import CognitiveHero from '@/components/brain/CognitiveHero';

const features = [
  {
    id: 'fingerprint',
    title: '思维指纹',
    description: '扫描个人脑或网络脑，生成六维认知画像：分析深度、创造性、逻辑性、情感表达、结构化与批判性思维。',
    icon: Fingerprint,
    color: 'text-info',
    bgColor: 'bg-info/10',
    borderColor: 'border-info/20',
    path: '/cognitive/fingerprint',
  },
  {
    id: 'bias',
    title: '认知偏差检测',
    description: '在个人笔记与外部知识中识别确认偏误、锚定效应、达克效应等潜在思维盲区。',
    icon: AlertTriangle,
    color: 'text-warning',
    bgColor: 'bg-warning/10',
    borderColor: 'border-warning/20',
    path: '/cognitive/bias',
  },
  {
    id: 'conflict',
    title: '脑侧冲突',
    description: '发现个人脑与网络脑之间的观点张力、证据冲突与信息缺口，让两脑相互校验。',
    icon: Scale,
    color: 'text-danger',
    bgColor: 'bg-danger/10',
    borderColor: 'border-danger/20',
    path: '/cognitive/conflict',
  },
  {
    id: 'audit',
    title: '决策审计',
    description: '记录关键决策，AI 帮你复盘信心、偏差、风险与更优路径。',
    icon: ClipboardCheck,
    color: 'text-success',
    bgColor: 'bg-success/10',
    borderColor: 'border-success/20',
    path: '/cognitive/audit',
  },
  {
    id: 'simulate',
    title: '未来模拟',
    description: '设定变量与情景，让 AI 为你推演不同时间尺度下的可能未来。',
    icon: GitBranch,
    color: 'text-fusion-primary',
    bgColor: 'bg-fusion-primary/10',
    borderColor: 'border-fusion-primary/20',
    path: '/cognitive/simulate',
  },
  {
    id: 'challenge',
    title: '认知挑战',
    description: '每日一道思维训练题，在偏差识别、反事实思考与反思练习中提升认知弹性。',
    icon: Gamepad2,
    color: 'text-purple-400',
    bgColor: 'bg-purple-400/10',
    borderColor: 'border-purple-400/20',
    path: '/cognitive/challenge',
  },
  {
    id: 'weekly-report',
    title: '认知周报',
    description: '每周一次，回顾你的输入、反思、决策与偏差觉察，量化认知健康状态。',
    icon: FileText,
    color: 'text-orange-400',
    bgColor: 'bg-orange-400/10',
    borderColor: 'border-orange-400/20',
    path: '/cognitive/weekly-report',
  },
];

const stats = [
  { label: '分析维度', value: '6', icon: Eye, color: 'text-info' },
  { label: '偏差类型', value: '6', icon: Filter, color: 'text-warning' },
  { label: '双脑对比', value: '2', icon: Brain, color: 'text-fusion-primary' },
  { label: '趋势天数', value: '30', icon: TrendingUp, color: 'text-success' },
];

const CognitivePage: FC = () => {
  const navigate = useNavigate();
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      <CognitiveHero />

      {/* Feature Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {features.map((feature) => {
          const Icon = feature.icon;
          const isHovered = hovered === feature.id;

          return (
            <motion.div
              key={feature.id}
              className="glass-card p-6 cursor-pointer group relative overflow-hidden"
              onMouseEnter={() => setHovered(feature.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => navigate(feature.path)}
              whileHover={{ scale: 1.02, y: -4 }}
              transition={{ duration: 0.3 }}
            >
              <AnimatePresence>
                {isHovered && (
                  <motion.div
                    className={`absolute inset-0 opacity-10 ${feature.bgColor}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 0.1 }}
                    exit={{ opacity: 0 }}
                    style={{
                      background: `radial-gradient(circle at 50% 50%, currentColor, transparent 70%)`,
                    }}
                  />
                )}
              </AnimatePresence>

              <div className="relative z-10">
                <div className="flex items-start justify-between mb-4">
                  <div className={`p-3 rounded-xl ${feature.bgColor} ${feature.borderColor} border`}>
                    <Icon className={`w-6 h-6 ${feature.color}`} />
                  </div>
                  <ChevronRight
                    className={`w-5 h-5 transition-all duration-300 ${
                      isHovered ? `${feature.color} translate-x-1` : 'text-text-muted'
                    }`}
                  />
                </div>

                <h3 className="text-xl font-bold text-text-primary mb-2 group-hover:text-text-primary transition-colors">
                  {feature.title}
                </h3>
                <p className="text-text-secondary text-sm leading-relaxed">
                  {feature.description}
                </p>

                <div className="mt-4 flex items-center gap-2 text-sm">
                  <span className={`${feature.color} font-medium`}>立即探索</span>
                  <Zap className={`w-4 h-4 ${feature.color}`} />
                </div>
              </div>

              <div className={`absolute -bottom-4 -right-4 w-24 h-24 rounded-full opacity-5 ${feature.bgColor}`} />
            </motion.div>
          );
        })}
      </div>

      {/* Stats Overview */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-5 h-5 text-fusion-primary" />
          <h2 className="text-lg font-bold text-text-primary">认知镜像概览</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {stats.map((stat, i) => {
            const StatIcon = stat.icon;
            return (
              <div key={i} className="text-center p-4 rounded-xl bg-white/[0.02] border border-white/[0.05]">
                <StatIcon className={`w-5 h-5 ${stat.color} mx-auto mb-2`} />
                <div className="text-2xl font-bold text-text-primary">{stat.value}</div>
                <div className="text-xs text-text-secondary mt-1">{stat.label}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Tips */}
      <div className="glass-card p-6 border-fusion-primary/10">
        <div className="flex items-center gap-2 mb-3">
          <Lightbulb className="w-5 h-5 text-warning" />
          <h3 className="font-bold text-text-primary">使用提示</h3>
        </div>
        <ul className="space-y-2 text-sm text-text-secondary">
          <li className="flex items-start gap-2">
            <span className="text-info mt-0.5">•</span>
            切换「个人脑 / 网络脑 / 双脑融合」可分别洞察不同来源的思维特征。
          </li>
          <li className="flex items-start gap-2">
            <span className="text-info mt-0.5">•</span>
            思维指纹需要至少 5 篇笔记或知识单元才能生成准确画像。
          </li>
          <li className="flex items-start gap-2">
            <span className="text-info mt-0.5">•</span>
            脑侧冲突会自动比对个人想法与外部知识，帮你发现隐藏的认知张力。
          </li>
        </ul>
      </div>
    </div>
  );
};

export default CognitivePage;
