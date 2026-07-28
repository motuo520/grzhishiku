import { FC, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle, Shield, Eye, Brain, Search, Filter,
  Loader2, ChevronDown, X, Check, AlertCircle, TrendingUp, Lightbulb, Sparkles
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { cognitiveApi, BiasItem, BiasSummaryItem } from '@/api/cognitive';
import type { BrainSide } from '@/types';
import BrainSideToggle from '@/components/brain/BrainSideToggle';
import CognitiveHero from '@/components/brain/CognitiveHero';
import ModelSelector from '@/components/llm/ModelSelector';
import LLMCostBadge from '@/components/llm/LLMCostBadge';
import AiErrorNotice from '@/components/llm/AiErrorNotice';

const BIAS_TYPES = ['确认偏误', '锚定效应', '幸存者偏差', '归因错误', '可得性启发', '达克效应'];

/** 偏差检测输入文本约 4000 tokens，用于费用估算。 */
const BIAS_INPUT_TEXT = Array(4000).fill('思').join('');

const BIAS_TYPE_ICONS: Record<string, typeof AlertTriangle> = {
  '确认偏误': Eye,
  '锚定效应': Search,
  '幸存者偏差': TrendingUp,
  '归因错误': Brain,
  '可得性启发': Filter,
  '达克效应': AlertCircle,
};

const SEVERITY_COLORS: Record<number, { bg: string; border: string; text: string; label: string }> = {
  1: { bg: 'bg-success/10', border: 'border-success/20', text: 'text-success', label: '轻微' },
  2: { bg: 'bg-success/10', border: 'border-success/20', text: 'text-success', label: '轻微' },
  3: { bg: 'bg-warning/10', border: 'border-warning/20', text: 'text-warning', label: '中等' },
  4: { bg: 'bg-warning/10', border: 'border-warning/20', text: 'text-warning', label: '中等' },
  5: { bg: 'bg-danger/10', border: 'border-danger/20', text: 'text-danger', label: '严重' },
};

/** 从后端完整名称中提取短名，例如 "确认偏误 (Confirmation Bias)" -> "确认偏误" */
const getShortBiasType = (fullName: string) => {
  for (const short of BIAS_TYPES) {
    if (fullName.includes(short)) return short;
  }
  return fullName;
};

const BiasPage: FC = () => {
  const [brainSide, setBrainSide] = useState<BrainSide>('both');
  const [detecting, setDetecting] = useState(false);
  const [filterType, setFilterType] = useState<string | null>(null);
  const [filterSeverity, setFilterSeverity] = useState<number | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [modelId, setModelId] = useState<string>('');

  const {
    data: detectionData,
    isLoading: detectionLoading,
    refetch: refetchDetection,
    error: detectionError,
  } = useQuery<{
    detected_biases: BiasItem[];
    total_analyzed: number;
    bias_count: number;
  }>({
    queryKey: ['cognitive', 'bias-detection', brainSide, modelId],
    queryFn: async () => {
      const response = await cognitiveApi.detectBias(50, brainSide, modelId || undefined);
      return response.data;
    },
    enabled: false,
  });

  const {
    data: summaryData,
    isLoading: summaryLoading,
    refetch: refetchSummary,
    error: summaryError,
  } = useQuery({
    queryKey: ['cognitive', 'bias-summary', brainSide, modelId],
    queryFn: async () => {
      const response = await cognitiveApi.biasSummary(brainSide, modelId || undefined);
      return response.data;
    },
    // 不在挂载时自动跑 LLM（单次约需 1 分钟且计费）；点「开始检测」才 refetch，30 分钟内复用缓存
    enabled: false,
    staleTime: 30 * 60 * 1000,
  });

  const handleDetect = async () => {
    setDetecting(true);
    try {
      await refetchDetection();
      await refetchSummary();
    } finally {
      setDetecting(false);
    }
  };

  const detectedBiases: BiasItem[] = detectionData?.detected_biases || [];
  const summary: BiasSummaryItem[] = summaryData?.summaries || [];

  const filteredBiases: BiasItem[] = detectedBiases.filter((b: BiasItem) => {
    const shortType = getShortBiasType(b.bias_type);
    if (filterType && shortType !== filterType) return false;
    if (filterSeverity && b.severity !== filterSeverity) return false;
    return true;
  });

  const sideLabel = brainSide === 'personal' ? '个人脑' : brainSide === 'network' ? '网络脑' : '双脑融合';

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <CognitiveHero
        title="认知偏差检测"
        subtitle="扫描思维盲区，让个人脑与网络脑都经得起审视"
      />

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Sparkles className="w-5 h-5 text-warning" />
          <div>
            <h2 className="text-lg font-bold text-text-primary">{sideLabel} · 偏差扫描</h2>
            <p className="text-xs text-text-secondary">覆盖 6 类常见认知偏差</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-3">
            <ModelSelector value={modelId} onChange={setModelId} taskType="analysis" className="w-48" />
            <LLMCostBadge modelId={modelId} inputText={BIAS_INPUT_TEXT} outputTokenEstimate={600} />
          </div>
          <div className="flex items-center gap-3">
            <BrainSideToggle value={brainSide} onChange={setBrainSide} />
            <button
              onClick={handleDetect}
              disabled={detecting || detectionLoading}
              className="btn-secondary flex items-center gap-2"
            >
              {detecting || detectionLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Brain className="w-4 h-4" />
              )}
              <span>{detecting || detectionLoading ? '检测中...' : '开始检测'}</span>
            </button>
          </div>
        </div>
      </div>

      <AiErrorNotice error={detectionError || summaryError} />

      {/* Bias Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {summary.map((item, index) => {
          const avgSev = item.average_severity || 0;
          const sevColor = SEVERITY_COLORS[Math.round(avgSev)] || SEVERITY_COLORS[1];
          const shortType = getShortBiasType(item.bias_type);
          const BiasIcon = BIAS_TYPE_ICONS[shortType] || AlertTriangle;

          return (
            <motion.div
              key={item.bias_type}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className={`glass-card p-4 cursor-pointer hover:scale-105 transition-transform ${
                filterType === shortType ? 'border-warning/50' : ''
              }`}
              onClick={() => setFilterType(filterType === shortType ? null : shortType)}
            >
              <div className="flex items-center justify-between mb-2">
                <BiasIcon className={`w-4 h-4 ${item.count > 0 ? 'text-warning' : 'text-text-muted'}`} />
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${sevColor.bg} ${sevColor.text}`}>
                  {item.count}
                </span>
              </div>
              <div className="text-sm font-bold text-text-primary mb-1">{item.bias_type}</div>
              <div className="text-xs text-text-muted">
                平均严重度: <span className={sevColor.text}>{avgSev.toFixed(1)}</span>
              </div>
            </motion.div>
          );
        })}
        {summary.length === 0 && !summaryLoading &&
          BIAS_TYPES.map((type, index) => (
            <motion.div
              key={type}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="glass-card p-4 opacity-50"
            >
              <div className="flex items-center justify-between mb-2">
                <AlertTriangle className="w-4 h-4 text-text-muted" />
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-white/[0.03] text-text-muted">0</span>
              </div>
              <div className="text-sm font-bold text-text-primary mb-1">{type}</div>
              <div className="text-xs text-text-muted">平均严重度: —</div>
            </motion.div>
          ))}
      </div>

      {/* Filters + Detection List */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-info" />
            <h2 className="text-lg font-bold text-text-primary">偏差详情</h2>
            <span className="text-sm text-text-muted">({filteredBiases.length} 条)</span>
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            <Filter className="w-4 h-4" />
            <span>筛选</span>
            <ChevronDown className={`w-4 h-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          </button>
        </div>

        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden mb-4"
            >
              <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.05] space-y-3">
                <div className="flex flex-wrap gap-2">
                  <span className="text-sm text-text-secondary mr-2">偏差类型:</span>
                  {BIAS_TYPES.map((type) => (
                    <button
                      key={type}
                      onClick={() => setFilterType(filterType === type ? null : type)}
                      className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                        filterType === type
                          ? 'border-warning/50 bg-warning/10 text-warning'
                          : 'border-white/[0.08] text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="text-sm text-text-secondary mr-2">严重程度:</span>
                  {[1, 2, 3, 4, 5].map((sev) => {
                    const sc = SEVERITY_COLORS[sev];
                    return (
                      <button
                        key={sev}
                        onClick={() => setFilterSeverity(filterSeverity === sev ? null : sev)}
                        className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                          filterSeverity === sev
                            ? `${sc.border} ${sc.bg} ${sc.text}`
                            : 'border-white/[0.08] text-text-secondary hover:text-text-primary'
                        }`}
                      >
                        {sev}级
                      </button>
                    );
                  })}
                </div>
                {(filterType || filterSeverity) && (
                  <button
                    onClick={() => { setFilterType(null); setFilterSeverity(null); }}
                    className="text-xs text-text-muted hover:text-danger flex items-center gap-1"
                  >
                    <X className="w-3 h-3" /> 清除筛选
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Detection List */}
        {detectedBiases.length === 0 && !detectionLoading && !detecting ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="p-4 rounded-full bg-success/10 mb-4">
              <Check className="w-8 h-8 text-success" />
            </div>
            <h3 className="text-lg font-bold text-text-primary mb-2">暂未检测到明显认知偏差</h3>
            <p className="text-text-secondary text-sm max-w-md">
              点击右上角「开始检测」按钮，AI 将分析你最近的{sideLabel}内容并检测潜在认知偏差。
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredBiases.map((bias, index) => {
              const sc = SEVERITY_COLORS[bias.severity] || SEVERITY_COLORS[1];
              return (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className={`p-4 rounded-xl border ${sc.border} bg-white/[0.02] hover:bg-white/[0.04] transition-colors`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`px-2.5 py-1 text-xs font-bold rounded-full ${sc.bg} ${sc.text}`}>
                        {sc.label}
                      </span>
                      <span className="text-sm font-bold text-text-primary">{bias.bias_type}</span>
                      <span className="text-xs text-text-muted">严重度 {bias.severity}/5</span>
                    </div>
                    <span className="text-xs text-text-muted">{bias.source_type}</span>
                  </div>
                  <div className="mb-3">
                    <p className="text-sm text-text-secondary leading-relaxed italic">
                      "{bias.text_snippet}"
                    </p>
                  </div>
                  <div className="flex items-start gap-2">
                    <Lightbulb className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-text-primary">{bias.suggestion}</p>
                  </div>
                </motion.div>
              );
            })}
            {filteredBiases.length === 0 && detectedBiases.length > 0 && (
              <p className="text-center text-text-secondary py-8">当前筛选条件下无匹配结果</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default BiasPage;
