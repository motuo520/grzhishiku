import { FC, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, GitBranch, Loader2, Filter } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cognitiveApi, FutureSimulation, FutureSimulationCreateRequest } from '@/api/cognitive';
import CognitiveHero from '@/components/brain/CognitiveHero';
import FutureSimulationForm from '@/components/brain/FutureSimulationForm';
import FutureSimulationCard from '@/components/brain/FutureSimulationCard';
import ModelSelector from '@/components/llm/ModelSelector';
import AiErrorNotice from '@/components/llm/AiErrorNotice';

const FutureSimulationPage: FC = () => {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingSim, setEditingSim] = useState<FutureSimulation | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [modelId, setModelId] = useState<string>('');

  const { data, isLoading } = useQuery({
    queryKey: ['cognitive', 'future-simulations', statusFilter],
    queryFn: async () => {
      const response = await cognitiveApi.listFutureSimulations({ status: statusFilter || undefined, limit: 100 });
      return response.data;
    },
  });

  const { data: auditsData } = useQuery({
    queryKey: ['cognitive', 'decision-audits', 'select'],
    queryFn: async () => {
      const response = await cognitiveApi.listDecisionAudits({ limit: 200 });
      return response.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: cognitiveApi.createFutureSimulation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cognitive', 'future-simulations'] });
      setShowForm(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<FutureSimulationCreateRequest> }) =>
      cognitiveApi.updateFutureSimulation(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cognitive', 'future-simulations'] });
      setEditingSim(null);
      setShowForm(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: cognitiveApi.deleteFutureSimulation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cognitive', 'future-simulations'] });
    },
  });

  const runMutation = useMutation({
    mutationFn: ({ id, preferred_model }: { id: string; preferred_model?: string }) =>
      cognitiveApi.runFutureSimulation(id, preferred_model),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cognitive', 'future-simulations'] });
    },
  });

  const handleSubmit = (formData: FutureSimulationCreateRequest) => {
    if (editingSim) {
      updateMutation.mutate({ id: editingSim.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleEdit = (sim: FutureSimulation) => {
    setEditingSim(sim);
    setShowForm(true);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingSim(null);
  };

  const handleNew = () => {
    setEditingSim(null);
    setShowForm(true);
  };

  const simulations: FutureSimulation[] = data?.items || [];
  const audits = auditsData?.items || [];

  const initialFormData: Partial<FutureSimulationCreateRequest> = editingSim
    ? {
        title: editingSim.title,
        context: editingSim.context,
        variables: editingSim.variables,
        scenarios: editingSim.scenarios,
        timeframes: editingSim.timeframes,
        brain_side: editingSim.brain_side,
        related_audit_id: editingSim.related_audit_id,
      }
    : {};

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <CognitiveHero
        title="未来模拟"
        subtitle="设定变量与情景，让 AI 为你推演不同时间尺度下的可能未来"
      />

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <GitBranch className="w-5 h-5 text-fusion-primary" />
          <div>
            <h2 className="text-lg font-bold text-text-primary">未来情景推演台</h2>
            <p className="text-xs text-text-secondary">已创建 {data?.total || 0} 个模拟</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-3">
            <ModelSelector value={modelId} onChange={setModelId} taskType="creative" className="w-48" />
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.08]">
              <Filter className="w-4 h-4 text-text-secondary" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-transparent text-sm text-text-secondary focus:outline-none"
              >
                <option value="">全部状态</option>
                <option value="pending">待模拟</option>
                <option value="simulated">已推演</option>
              </select>
            </div>
            <button onClick={handleNew} className="btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" />
              <span>新建模拟</span>
            </button>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showForm && (
          <FutureSimulationForm
            key="sim-form"
            initial={initialFormData}
            audits={audits}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            loading={createMutation.isPending || updateMutation.isPending}
          />
        )}
      </AnimatePresence>

      <AiErrorNotice error={runMutation.error || createMutation.error || updateMutation.error || deleteMutation.error} />

      {isLoading ? (
        <div className="glass-card p-12 flex flex-col items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-info mb-4" />
          <p className="text-text-secondary">加载未来模拟...</p>
        </div>
      ) : simulations.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <div className="p-4 rounded-full bg-fusion-primary/10 w-fit mx-auto mb-4">
            <GitBranch className="w-8 h-8 text-fusion-primary" />
          </div>
          <h3 className="text-lg font-bold text-text-primary mb-2">还没有未来模拟</h3>
          <p className="text-text-secondary text-sm max-w-md mx-auto mb-4">
            定义一个决策、关键变量与几种情景，AI 会帮你推演短期、中期、长期的可能结果。
          </p>
          <button onClick={handleNew} className="btn-primary flex items-center gap-2 mx-auto">
            <Plus className="w-4 h-4" />
            <span>创建第一个未来模拟</span>
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {simulations.map((sim, index) => (
            <motion.div
              key={sim.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <FutureSimulationCard
                simulation={sim}
                audits={audits}
                onRun={(id) => runMutation.mutate({ id, preferred_model: modelId || undefined })}
                onEdit={handleEdit}
                onDelete={(id) => deleteMutation.mutate(id)}
                running={runMutation.isPending}
              />
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
};

export default FutureSimulationPage;
