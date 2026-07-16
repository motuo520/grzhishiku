import { FC, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  GitBranch, Loader2, Clock, ArrowRight, BarChart3, Save
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { emergenceApi, CounterfactualResponse, EmergenceHistoryItem, type BrainSide, type SelectedSource } from '@/api/emergence';
import SourcePoolPanel from '@/components/emergence/SourcePoolPanel';
import SaveIdeaModal from '@/components/emergence/SaveIdeaModal';
import { ToolOptionsBar } from '@/components/emergence/ToolOptions';
import AiErrorNotice from '@/components/llm/AiErrorNotice';

const toSourceParams = (sources: SelectedSource[]) => ({
  source_ids: sources.length > 0 ? sources.map((s) => s.id) : undefined,
  source_types: sources.length > 0 ? sources.map((s) => s.type) : undefined,
});

const CounterfactualPage: FC = () => {
  const [premise, setPremise] = useState('如果互联网从未被发明');
  const [timelineDepth, setTimelineDepth] = useState(3);
  const [result, setResult] = useState<CounterfactualResponse | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const [selectedSources, setSelectedSources] = useState<SelectedSource[]>([]);
  const [brainSide, setBrainSide] = useState<BrainSide>('both');
  const [preferredModel, setPreferredModel] = useState('');
  const [saveOpen, setSaveOpen] = useState(false);

  const queryClient = useQueryClient();

  const { mutate, isPending, error } = useMutation({
    mutationFn: emergenceApi.counterfactual,
    onSuccess: (response) => {
      setResult(response.data);
      queryClient.invalidateQueries({ queryKey: ['emergence', 'history'] });
    },
  });

  const { data: historyData } = useQuery({
    queryKey: ['emergence', 'history', 'counterfactual'],
    queryFn: async () => {
      const response = await emergenceApi.history('counterfactual', 0, 50);
      return response.data;
    },
  });

  const handleGenerate = () => {
    if (!premise.trim()) return;
    mutate({
      premise,
      timeline_depth: timelineDepth,
      brain_side: brainSide,
      ...toSourceParams(selectedSources),
      preferred_model: preferredModel.trim() || undefined,
    });
  };

  const handleLoadHistory = (item: EmergenceHistoryItem) => {
    const input = item.input as { premise: string; timeline_depth: number };
    setPremise(input.premise || '');
    setTimelineDepth(input.timeline_depth || 3);
    setBrainSide((item.brain_side as BrainSide) || 'both');
    const ids = item.source_ids || [];
    const types = item.source_types || [];
    setSelectedSources(
      ids.map((id, idx) => ({ id, type: types[idx] || 'source' }))
    );
    setResult({
      id: item.id,
      ...item.output,
      created_at: item.created_at,
    } as CounterfactualResponse);
  };

  const summaryText = useMemo(() => {
    if (!result) return '';
    const branchSummaries = (result.branches || []).map(
      (b, i) => `阶段 ${i + 1}：${b.stage}（概率 ${Math.round((b.probability || 0) * 100)}%）`
    );
    return [`前提：${premise}`, ...branchSummaries].join('\n');
  }, [result, premise]);

  const probabilityColor = (prob: number) => {
    if (prob <= 0.3) return '#f85149';
    if (prob <= 0.6) return '#d29922';
    return '#3fb950';
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch className="w-6 h-6 text-success" />
          <h1 className="text-2xl font-bold text-text-primary">反事实探索</h1>
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
              inputText={premise}
              taskType="reasoning"
            />

            <div className="mb-4">
              <label className="text-sm text-text-secondary mb-2 block">假设前提</label>
              <input
                type="text"
                value={premise}
                onChange={(e) => setPremise(e.target.value)}
                className="input"
                placeholder="输入一个假设...（例如：如果互联网从未被发明）"
              />
            </div>
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm text-text-secondary">时间线深度</label>
                <span className="text-sm font-bold text-info">{timelineDepth} 层</span>
              </div>
              <input
                type="range"
                min={1}
                max={5}
                value={timelineDepth}
                onChange={(e) => setTimelineDepth(Number(e.target.value))}
                className="w-full h-2 bg-bg-tertiary rounded-lg appearance-none cursor-pointer accent-info"
              />
              <div className="flex justify-between text-xs text-text-muted mt-1">
                <span>浅层</span>
                <span>深层</span>
              </div>
            </div>
            <button
              onClick={handleGenerate}
              disabled={isPending || !premise.trim()}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>推演中...</span>
                </>
              ) : (
                <>
                  <GitBranch className="w-4 h-4" />
                  <span>开始推演</span>
                </>
              )}
            </button>
            <AiErrorNotice error={error} className="mt-4" />
          </div>

          {/* Result Timeline */}
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

              {result.branches?.map((branch, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: -30 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.2 }}
                  className="glass-card p-6 relative"
                >
                  {/* Timeline connector */}
                  {index > 0 && (
                    <div className="absolute -top-6 left-6 w-px h-6 bg-success/30" />
                  )}
                  {index < (result.branches?.length || 0) - 1 && (
                    <div className="absolute -bottom-6 left-6 w-px h-6 bg-success/30" />
                  )}

                  <div className="flex items-start gap-4">
                    {/* Timeline dot */}
                    <div className="relative flex-shrink-0">
                      <div className="w-12 h-12 rounded-full bg-success/10 border border-success/30 flex items-center justify-center">
                        <span className="text-sm font-bold text-success">{index + 1}</span>
                      </div>
                    </div>

                    <div className="flex-1 space-y-3">
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-bold text-text-primary">{branch.stage}</h3>
                        <span
                          className="px-2 py-0.5 text-xs font-bold rounded-full"
                          style={{
                            backgroundColor: `${probabilityColor(branch.probability || 0)}22`,
                            color: probabilityColor(branch.probability || 0),
                            border: `1px solid ${probabilityColor(branch.probability || 0)}44`,
                          }}
                        >
                          概率 {(branch.probability || 0) * 100}%
                        </span>
                      </div>

                      <p className="text-sm text-text-secondary">影响范围: {branch.impact_scope}</p>

                      {/* Key Nodes */}
                      <div className="space-y-2">
                        {branch.key_nodes?.map((node, ni) => (
                          <div
                            key={ni}
                            className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.05]"
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-bold text-info">{node.time}</span>
                              <ArrowRight className="w-3 h-3 text-text-muted" />
                              <span className="text-sm font-bold text-text-primary">{node.event}</span>
                            </div>
                            <p className="text-xs text-text-secondary">{node.consequence}</p>
                          </div>
                        ))}
                      </div>

                      {/* Probability bar */}
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-text-muted">概率评估</span>
                        <div className="flex-1 h-2 rounded-full bg-bg-tertiary overflow-hidden">
                          <motion.div
                            className="h-full rounded-full"
                            style={{ backgroundColor: probabilityColor(branch.probability || 0) }}
                            initial={{ width: 0 }}
                            animate={{ width: `${(branch.probability || 0) * 100}%` }}
                            transition={{ duration: 0.8, delay: index * 0.2 }}
                          />
                        </div>
                      </div>

                      {/* Reality comparison */}
                      <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.05]">
                        <div className="flex items-center gap-2 mb-1">
                          <BarChart3 className="w-3 h-3 text-text-muted" />
                          <span className="text-xs font-bold text-text-muted">现实对比</span>
                        </div>
                        <p className="text-sm text-text-secondary">{branch.reality_comparison}</p>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
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
                const input = item.input as { premise: string };
                return (
                  <div
                    key={item.id}
                    onClick={() => handleLoadHistory(item)}
                    className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.05] hover:border-success/30 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-text-muted">
                        {new Date(item.created_at).toLocaleDateString()}
                      </span>
                      {(item.source_ids?.length || 0) > 0 && (
                        <span className="text-[10px] text-info">{item.source_ids?.length} 素材</span>
                      )}
                    </div>
                    <div className="text-sm text-text-primary font-medium line-clamp-2">
                      {input.premise}
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
        defaultTitle={premise}
        summary={summaryText}
        brainSide={brainSide}
        sourceResultIds={result?.id ? [result.id] : []}
      />
    </div>
  );
};

export default CounterfactualPage;
