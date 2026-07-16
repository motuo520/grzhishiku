import { FC, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Shuffle, ArrowRight, Lightbulb, Star, Gauge, Loader2, Clock, Save
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { emergenceApi, AssociateResponse, EmergenceHistoryItem, type BrainSide, type SelectedSource } from '@/api/emergence';
import SourcePoolPanel from '@/components/emergence/SourcePoolPanel';
import SaveIdeaModal from '@/components/emergence/SaveIdeaModal';
import { ToolOptionsBar } from '@/components/emergence/ToolOptions';
import AiErrorNotice from '@/components/llm/AiErrorNotice';

const toSourceParams = (sources: SelectedSource[]) => ({
  source_ids: sources.length > 0 ? sources.map((s) => s.id) : undefined,
  source_types: sources.length > 0 ? sources.map((s) => s.type) : undefined,
});

const AssociatePage: FC = () => {
  const [topicA, setTopicA] = useState('神经网络');
  const [topicB, setTopicB] = useState('城市交通');
  const [result, setResult] = useState<AssociateResponse | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const [selectedSources, setSelectedSources] = useState<SelectedSource[]>([]);
  const [brainSide, setBrainSide] = useState<BrainSide>('both');
  const [preferredModel, setPreferredModel] = useState('');
  const [saveOpen, setSaveOpen] = useState(false);

  const queryClient = useQueryClient();

  const { mutate, isPending, error } = useMutation({
    mutationFn: emergenceApi.associate,
    onSuccess: (response) => {
      setResult(response.data);
      queryClient.invalidateQueries({ queryKey: ['emergence', 'history'] });
    },
  });

  const { data: historyData } = useQuery({
    queryKey: ['emergence', 'history', 'associate'],
    queryFn: async () => {
      const response = await emergenceApi.history('associate', 0, 50);
      return response.data;
    },
  });

  const handleGenerate = () => {
    if (!topicA.trim() || !topicB.trim()) return;
    mutate({
      topic_a: topicA,
      topic_b: topicB,
      brain_side: brainSide,
      ...toSourceParams(selectedSources),
      preferred_model: preferredModel.trim() || undefined,
    });
  };

  const handleLoadHistory = (item: EmergenceHistoryItem) => {
    const input = item.input as { topic_a: string; topic_b: string };
    setTopicA(input.topic_a || '');
    setTopicB(input.topic_b || '');
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
    } as AssociateResponse);
  };

  const summaryText = useMemo(() => {
    if (!result) return '';
    const parts = [
      `联想概念：${result.concept}`,
      `路径：${(result.path || []).join(' → ')}`,
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
          <Shuffle className="w-6 h-6 text-info" />
          <h1 className="text-2xl font-bold text-text-primary">跨域联想</h1>
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

          {/* Input Section */}
          <div className="glass-card p-6 mb-6">
            <ToolOptionsBar
              brainSide={brainSide}
              onBrainSideChange={setBrainSide}
              preferredModel={preferredModel}
              onPreferredModelChange={setPreferredModel}
              inputText={`${topicA} ${topicB}`}
              taskType="creative"
            />

            <div className="flex items-center gap-4 mb-6">
              <div className="flex-1">
                <label className="text-sm text-text-secondary mb-2 block">主题 A</label>
                <input
                  type="text"
                  value={topicA}
                  onChange={(e) => setTopicA(e.target.value)}
                  className="input"
                  placeholder="输入第一个主题..."
                />
              </div>
              <div className="pt-6">
                <ArrowRight className="w-5 h-5 text-fusion-primary" />
              </div>
              <div className="flex-1">
                <label className="text-sm text-text-secondary mb-2 block">主题 B</label>
                <input
                  type="text"
                  value={topicB}
                  onChange={(e) => setTopicB(e.target.value)}
                  className="input"
                  placeholder="输入第二个主题..."
                />
              </div>
            </div>
            <button
              onClick={handleGenerate}
              disabled={isPending || !topicA.trim() || !topicB.trim()}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>生成联想中...</span>
                </>
              ) : (
                <>
                  <Shuffle className="w-4 h-4" />
                  <span>生成联想</span>
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

              {/* Concept Title */}
              <div className="glass-card p-6 text-center border-info/20">
                <div className="text-sm text-text-secondary mb-2">联想概念</div>
                <h2 className="text-2xl font-bold text-text-primary">{result.concept}</h2>
              </div>

              {/* Path */}
              <div className="glass-card p-6">
                <div className="text-sm text-text-secondary mb-4">联想路径</div>
                <div className="flex items-center justify-center gap-3 flex-wrap">
                  {result.path?.map((step, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="px-4 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-text-primary font-medium">
                        {step}
                      </div>
                      {i < (result.path?.length || 0) - 1 && (
                        <ArrowRight className="w-4 h-4 text-fusion-primary" />
                      )}
                    </div>
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
                    <div key={i} className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.05]">
                      <span className="text-xs text-fusion-primary font-bold mb-2 block">场景 {i + 1}</span>
                      <p className="text-sm text-text-primary">{app}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Scores */}
              <div className="grid grid-cols-2 gap-4">
                <div className="glass-card p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-text-secondary">创新度</span>
                    <Star className="w-4 h-4 text-warning" />
                  </div>
                  <div className="text-2xl font-bold mb-2">
                    <span className={scoreColor(result.innovation_score || 0)}>
                      {result.innovation_score}/10
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-bg-tertiary overflow-hidden">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ backgroundColor: scoreBarColor(result.innovation_score || 0) }}
                      initial={{ width: 0 }}
                      animate={{ width: `${((result.innovation_score || 0) / 10) * 100}%` }}
                      transition={{ duration: 0.8 }}
                    />
                  </div>
                </div>
                <div className="glass-card p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-text-secondary">可行性</span>
                    <Gauge className="w-4 h-4 text-info" />
                  </div>
                  <div className="text-2xl font-bold mb-2">
                    <span className={scoreColor(result.feasibility_score || 0)}>
                      {result.feasibility_score}/10
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-bg-tertiary overflow-hidden">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ backgroundColor: scoreBarColor(result.feasibility_score || 0) }}
                      initial={{ width: 0 }}
                      animate={{ width: `${((result.feasibility_score || 0) / 10) * 100}%` }}
                      transition={{ duration: 0.8 }}
                    />
                  </div>
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
                const input = item.input as { topic_a: string; topic_b: string };
                return (
                  <div
                    key={item.id}
                    onClick={() => handleLoadHistory(item)}
                    className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.05] hover:border-info/30 cursor-pointer transition-colors"
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
                      {input.topic_a} × {input.topic_b}
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
        defaultTitle={result?.concept || `${topicA} × ${topicB}`}
        summary={summaryText}
        brainSide={brainSide}
        sourceResultIds={result?.id ? [result.id] : []}
      />
    </div>
  );
};

export default AssociatePage;
