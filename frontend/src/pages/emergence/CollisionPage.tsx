import { FC, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Flame, Plus, X, Loader2, Clock, MessageCircle, CheckCircle, AlertCircle, Save
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { emergenceApi, CollisionResponse, EmergenceHistoryItem, type BrainSide, type SelectedSource } from '@/api/emergence';
import SourcePoolPanel from '@/components/emergence/SourcePoolPanel';
import SaveIdeaModal from '@/components/emergence/SaveIdeaModal';
import { ToolOptionsBar } from '@/components/emergence/ToolOptions';
import AiErrorNotice from '@/components/llm/AiErrorNotice';

const toSourceParams = (sources: SelectedSource[]) => ({
  source_ids: sources.length > 0 ? sources.map((s) => s.id) : undefined,
  source_types: sources.length > 0 ? sources.map((s) => s.type) : undefined,
});

const STANCE_COLORS: Record<string, { bg: string; border: string; text: string; label: string }> = {
  '支持': { bg: 'bg-success/10', border: 'border-success/20', text: 'text-success', label: '支持' },
  '反对': { bg: 'bg-danger/10', border: 'border-danger/20', text: 'text-danger', label: '反对' },
  '中立': { bg: 'bg-white/[0.03]', border: 'border-white/[0.08]', text: 'text-text-secondary', label: '中立' },
};

const CollisionPage: FC = () => {
  const [topic, setTopic] = useState('人工智能是否应该拥有版权');
  const [perspectives, setPerspectives] = useState(['法律', '伦理', '经济', '技术']);
  const [newPerspective, setNewPerspective] = useState('');
  const [result, setResult] = useState<CollisionResponse | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const [selectedSources, setSelectedSources] = useState<SelectedSource[]>([]);
  const [brainSide, setBrainSide] = useState<BrainSide>('both');
  const [preferredModel, setPreferredModel] = useState('');
  const [saveOpen, setSaveOpen] = useState(false);

  const queryClient = useQueryClient();

  const { mutate, isPending, error } = useMutation({
    mutationFn: emergenceApi.collision,
    onSuccess: (response) => {
      setResult(response.data);
      queryClient.invalidateQueries({ queryKey: ['emergence', 'history'] });
    },
  });

  const { data: historyData } = useQuery({
    queryKey: ['emergence', 'history', 'collision'],
    queryFn: async () => {
      const response = await emergenceApi.history('collision', 0, 50);
      return response.data;
    },
  });

  const handleAddPerspective = () => {
    if (newPerspective.trim() && !perspectives.includes(newPerspective.trim())) {
      setPerspectives([...perspectives, newPerspective.trim()]);
      setNewPerspective('');
    }
  };

  const handleRemovePerspective = (p: string) => {
    setPerspectives(perspectives.filter((x) => x !== p));
  };

  const handleGenerate = () => {
    if (!topic.trim() || perspectives.length === 0) return;
    mutate({
      topic,
      perspectives,
      brain_side: brainSide,
      ...toSourceParams(selectedSources),
      preferred_model: preferredModel.trim() || undefined,
    });
  };

  const handleLoadHistory = (item: EmergenceHistoryItem) => {
    const input = item.input as { topic: string; perspectives: string[] };
    setTopic(input.topic || '');
    setPerspectives(input.perspectives || []);
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
    } as CollisionResponse);
  };

  const summaryText = useMemo(() => {
    if (!result) return '';
    const parts = [
      `话题：${topic}`,
      `共识：${(result.consensus || []).join('；')}`,
      `分歧：${(result.divergence || []).join('；')}`,
    ];
    return parts.join('\n');
  }, [result, topic]);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flame className="w-6 h-6 text-warning" />
          <h1 className="text-2xl font-bold text-text-primary">创意碰撞</h1>
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
              inputText={`${topic} ${perspectives.join(' ')}`}
              taskType="reasoning"
            />

            <div className="mb-4">
              <label className="text-sm text-text-secondary mb-2 block">讨论话题</label>
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                className="input"
                placeholder="输入一个值得讨论的话题..."
              />
            </div>

            <div className="mb-4">
              <label className="text-sm text-text-secondary mb-2 block">参与视角</label>
              <div className="flex flex-wrap gap-2 mb-2">
                {perspectives.map((p) => {
                  const stance = STANCE_COLORS['中立'];
                  return (
                    <div
                      key={p}
                      className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-sm border ${stance.bg} ${stance.border}`}
                    >
                      <span className={stance.text}>{p}</span>
                      <button
                        onClick={() => handleRemovePerspective(p)}
                        className="text-text-muted hover:text-danger ml-1"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newPerspective}
                  onChange={(e) => setNewPerspective(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddPerspective()}
                  className="input flex-1"
                  placeholder="添加新视角（如：社会学）..."
                />
                <button onClick={handleAddPerspective} className="btn-secondary px-3">
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            <button
              onClick={handleGenerate}
              disabled={isPending || !topic.trim() || perspectives.length === 0}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>碰撞中...</span>
                </>
              ) : (
                <>
                  <Flame className="w-4 h-4" />
                  <span>开始碰撞</span>
                </>
              )}
            </button>
            <AiErrorNotice error={error} className="mt-4" />
          </div>

          {/* Results */}
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

              {/* Perspectives */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {result.perspectives?.map((p, i) => {
                  const stance = STANCE_COLORS[p.stance] || STANCE_COLORS['中立'];
                  return (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.1 }}
                      className={`glass-card p-4 border ${stance.border}`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${stance.bg} ${stance.text}`}>
                          {stance.label}
                        </span>
                        <span className="text-sm font-bold text-text-primary">{p.role}</span>
                      </div>
                      <p className="text-sm text-text-secondary mb-2">{p.argument}</p>
                      <p className="text-xs text-text-muted">反驳: {p.counter}</p>
                    </motion.div>
                  );
                })}
              </div>

              {/* Dialogue */}
              <div className="glass-card p-6">
                <div className="flex items-center gap-2 mb-4">
                  <MessageCircle className="w-4 h-4 text-fusion-primary" />
                  <span className="text-sm font-bold text-text-primary">模拟辩论</span>
                </div>
                <div className="space-y-3">
                  {result.dialogue?.map((d, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.1 }}
                      className={`flex ${i % 2 === 0 ? 'justify-start' : 'justify-end'}`}
                    >
                      <div
                        className={`max-w-[80%] p-3 rounded-xl text-sm ${
                          i % 2 === 0
                            ? 'bg-white/[0.03] border border-white/[0.08] text-text-primary rounded-tl-sm'
                            : 'bg-info/10 border border-info/20 text-info rounded-tr-sm'
                        }`}
                      >
                        <div className="text-xs font-bold mb-1 opacity-70">{d.speaker}</div>
                        <div>{d.content}</div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>

              {/* Consensus & Divergence */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="glass-card p-4 border-success/20">
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle className="w-4 h-4 text-success" />
                    <span className="text-sm font-bold text-success">共识点</span>
                  </div>
                  <ul className="space-y-2">
                    {result.consensus?.map((c, i) => (
                      <li key={i} className="text-sm text-text-secondary flex items-start gap-2">
                        <span className="text-success mt-1">•</span>
                        {c}
                      </li>
                    ))}
                    {(!result.consensus || result.consensus.length === 0) && (
                      <p className="text-xs text-text-muted">未找到明显共识</p>
                    )}
                  </ul>
                </div>
                <div className="glass-card p-4 border-danger/20">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertCircle className="w-4 h-4 text-danger" />
                    <span className="text-sm font-bold text-danger">分歧点</span>
                  </div>
                  <ul className="space-y-2">
                    {result.divergence?.map((d, i) => (
                      <li key={i} className="text-sm text-text-secondary flex items-start gap-2">
                        <span className="text-danger mt-1">•</span>
                        {d}
                      </li>
                    ))}
                    {(!result.divergence || result.divergence.length === 0) && (
                      <p className="text-xs text-text-muted">未找到明显分歧</p>
                    )}
                  </ul>
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
                const input = item.input as { topic: string };
                return (
                  <div
                    key={item.id}
                    onClick={() => handleLoadHistory(item)}
                    className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.05] hover:border-warning/30 cursor-pointer transition-colors"
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
                      {input.topic}
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
        defaultTitle={topic}
        summary={summaryText}
        brainSide={brainSide}
        sourceResultIds={result?.id ? [result.id] : []}
      />
    </div>
  );
};

export default CollisionPage;
