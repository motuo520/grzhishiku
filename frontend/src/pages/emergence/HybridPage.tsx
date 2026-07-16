import { FC, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  GitMerge, Loader2, Clock, Check, AlertTriangle, Gauge, Lightbulb, Save
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { emergenceApi, HybridResponse, EmergenceHistoryItem, type BrainSide, type SelectedSource } from '@/api/emergence';
import SourcePoolPanel from '@/components/emergence/SourcePoolPanel';
import SaveIdeaModal from '@/components/emergence/SaveIdeaModal';
import { ToolOptionsBar } from '@/components/emergence/ToolOptions';
import AiErrorNotice from '@/components/llm/AiErrorNotice';

const toSourceParams = (sources: SelectedSource[]) => ({
  source_ids: sources.length > 0 ? sources.map((s) => s.id) : undefined,
  source_types: sources.length > 0 ? sources.map((s) => s.type) : undefined,
});

const HybridPage: FC = () => {
  const [conceptA, setConceptA] = useState('区块链');
  const [conceptB, setConceptB] = useState('民主投票');
  const [result, setResult] = useState<HybridResponse | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const [selectedSources, setSelectedSources] = useState<SelectedSource[]>([]);
  const [brainSide, setBrainSide] = useState<BrainSide>('both');
  const [preferredModel, setPreferredModel] = useState('');
  const [saveOpen, setSaveOpen] = useState(false);

  const queryClient = useQueryClient();

  const { mutate, isPending, error } = useMutation({
    mutationFn: emergenceApi.hybrid,
    onSuccess: (response) => {
      setResult(response.data);
      queryClient.invalidateQueries({ queryKey: ['emergence', 'history'] });
    },
  });

  const { data: historyData } = useQuery({
    queryKey: ['emergence', 'history', 'hybrid'],
    queryFn: async () => {
      const response = await emergenceApi.history('hybrid', 0, 50);
      return response.data;
    },
  });

  const handleGenerate = () => {
    if (!conceptA.trim() || !conceptB.trim()) return;
    mutate({
      concept_a: conceptA,
      concept_b: conceptB,
      brain_side: brainSide,
      ...toSourceParams(selectedSources),
      preferred_model: preferredModel.trim() || undefined,
    });
  };

  const handleLoadHistory = (item: EmergenceHistoryItem) => {
    const input = item.input as { concept_a: string; concept_b: string };
    setConceptA(input.concept_a || '');
    setConceptB(input.concept_b || '');
    setBrainSide((item.brain_side as BrainSide) || 'both');
    const ids = item.source_ids || [];
    const types = item.source_types || [];
    setSelectedSources(
      ids.map((id, idx) => ({ id, type: types[idx] || 'source' }))
    );
    setResult({
      id: item.id,
      ...item.output,
      scores: item.scores || {},
      created_at: item.created_at,
    } as HybridResponse);
  };

  const summaryText = useMemo(() => {
    if (!result) return '';
    const parts = [
      `新概念：${result.name}`,
      `定义：${result.definition}`,
      `核心特征：${(result.features || []).join('；')}`,
      `应用场景：${(result.applications || []).join('；')}`,
    ];
    return parts.join('\n');
  }, [result]);

  const scoreColor = (score: number) => {
    if (score <= 3) return 'text-success';
    if (score <= 6) return 'text-warning';
    if (score <= 8) return 'text-danger';
    return 'text-fusion-primary';
  };

  const scoreBarColor = (score: number) => {
    if (score <= 3) return '#3fb950';
    if (score <= 6) return '#d29922';
    if (score <= 8) return '#f85149';
    return '#a371f7';
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitMerge className="w-6 h-6 text-fusion-primary" />
          <h1 className="text-2xl font-bold text-text-primary">概念杂交</h1>
        </div>
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="btn-secondary flex items-center gap-2"
        >
          <Clock className="w-4 h-4" />
          <span>{showHistory ? '隐藏历史' : '历史记录'}</span>
        </button>
      </div>

      <div className={`grid gap-6 ${showHistory ? 'grid-cols-1 lg:grid-cols-3' : 'grid-cols-1'}`}>
        {/* Main Work Area */}
        <div className={showHistory ? 'lg:col-span-2' : ''}>
          <SourcePoolPanel
            selectedSources={selectedSources}
            onSelectionChange={setSelectedSources}
          />

          {/* Input */}
          <div className="glass-card p-6 mb-6">
            <ToolOptionsBar
              brainSide={brainSide}
              onBrainSideChange={setBrainSide}
              preferredModel={preferredModel}
              onPreferredModelChange={setPreferredModel}
              inputText={`${conceptA} ${conceptB}`}
              taskType="creative"
            />

            <div className="flex items-center gap-4 mb-6">
              <div className="flex-1">
                <label className="text-sm text-text-secondary mb-2 block">概念 A</label>
                <input
                  type="text"
                  value={conceptA}
                  onChange={(e) => setConceptA(e.target.value)}
                  className="input"
                  placeholder="输入第一个概念..."
                />
              </div>
              <div className="pt-6">
                <GitMerge className="w-5 h-5 text-fusion-primary" />
              </div>
              <div className="flex-1">
                <label className="text-sm text-text-secondary mb-2 block">概念 B</label>
                <input
                  type="text"
                  value={conceptB}
                  onChange={(e) => setConceptB(e.target.value)}
                  className="input"
                  placeholder="输入第二个概念..."
                />
              </div>
            </div>
            <button
              onClick={handleGenerate}
              disabled={isPending || !conceptA.trim() || !conceptB.trim()}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>融合中...</span>
                </>
              ) : (
                <>
                  <GitMerge className="w-4 h-4" />
                  <span>开始融合</span>
                </>
              )}
            </button>
            <AiErrorNotice error={error} className="mt-4" />
          </div>

          {/* Result */}
          {result && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              <div className="flex items-center justify-end">
                <button
                  onClick={() => setSaveOpen(true)}
                  className="btn-secondary flex items-center gap-2 text-xs py-2 px-3"
                >
                  <Save className="w-3.5 h-3.5" />
                  保存到成果库
                </button>
              </div>

              {/* New Concept Name */}
              <div className="glass-card p-6 text-center border-fusion-primary/30">
                <div className="text-sm text-text-secondary mb-2">新概念</div>
                <h2 className="text-3xl font-bold text-text-primary">{result.name}</h2>
              </div>

              {/* Definition */}
              <div className="glass-card p-6">
                <div className="text-sm text-text-secondary mb-2">定义</div>
                <p className="text-text-primary leading-relaxed">{result.definition}</p>
              </div>

              {/* Core Features */}
              <div className="glass-card p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Check className="w-4 h-4 text-success" />
                  <span className="text-sm font-bold text-text-primary">核心特征</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {result.features?.map((feature, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.1 }}
                      className="flex items-start gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/[0.05]"
                    >
                      <div className="p-1 rounded-full bg-success/10 text-success flex-shrink-0 mt-0.5">
                        <Check className="w-3 h-3" />
                      </div>
                      <span className="text-sm text-text-primary">{feature}</span>
                    </motion.div>
                  ))}
                </div>
              </div>

              {/* Applications */}
              <div className="glass-card p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Lightbulb className="w-4 h-4 text-warning" />
                  <span className="text-sm font-bold text-text-primary">应用场景</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {result.applications?.map((app, i) => (
                    <div
                      key={i}
                      className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.05]"
                    >
                      <span className="text-xs text-fusion-primary font-bold mb-2 block">场景 {i + 1}</span>
                      <p className="text-sm text-text-primary">{app}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Risks */}
              <div className="glass-card p-6 border-danger/20">
                <div className="flex items-center gap-2 mb-4">
                  <AlertTriangle className="w-4 h-4 text-danger" />
                  <span className="text-sm font-bold text-danger">潜在风险</span>
                </div>
                <div className="space-y-2">
                  {result.risks?.map((risk, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm text-text-secondary">
                      <AlertTriangle className="w-3 h-3 text-danger mt-0.5 flex-shrink-0" />
                      {risk}
                    </div>
                  ))}
                </div>
              </div>

              {/* Maturity Score */}
              <div className="glass-card p-6">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Gauge className="w-4 h-4 text-info" />
                    <span className="text-sm font-bold text-text-primary">成熟度评分</span>
                  </div>
                  <span className={`text-2xl font-bold ${scoreColor(result.maturity_score || 0)}`}>
                    {result.maturity_score}/10
                  </span>
                </div>
                <div className="h-3 rounded-full bg-bg-tertiary overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ backgroundColor: scoreBarColor(result.maturity_score || 0) }}
                    initial={{ width: 0 }}
                    animate={{ width: `${((result.maturity_score || 0) / 10) * 100}%` }}
                    transition={{ duration: 1 }}
                  />
                </div>
              </div>
            </motion.div>
          )}
        </div>

        {/* History Sidebar */}
        {showHistory && (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="glass-card p-4 h-fit"
          >
            <div className="flex items-center gap-2 mb-4">
              <Clock className="w-4 h-4 text-text-secondary" />
              <h3 className="font-bold text-text-primary text-sm">历史记录</h3>
            </div>
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {historyData?.items?.map((item) => {
                const input = item.input as { concept_a: string; concept_b: string };
                return (
                  <div
                    key={item.id}
                    onClick={() => handleLoadHistory(item)}
                    className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.05] hover:border-fusion-primary/30 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-text-muted">
                        {new Date(item.created_at).toLocaleDateString()}
                      </span>
                      {(item.source_ids?.length || 0) > 0 && (
                        <span className="text-[10px] text-info">{item.source_ids?.length} 素材</span>
                      )}
                    </div>
                    <div className="text-sm text-text-primary font-medium">
                      {input.concept_a} × {input.concept_b}
                    </div>
                  </div>
                );
              })}
              {(!historyData?.items || historyData.items.length === 0) && (
                <p className="text-xs text-text-muted text-center py-4">暂无历史记录</p>
              )}
            </div>
          </motion.div>
        )}
      </div>

      <SaveIdeaModal
        isOpen={saveOpen}
        onClose={() => setSaveOpen(false)}
        defaultTitle={result?.name || `${conceptA} × ${conceptB}`}
        summary={summaryText}
        brainSide={brainSide}
        sourceResultIds={result?.id ? [result.id] : []}
      />
    </div>
  );
};

export default HybridPage;
