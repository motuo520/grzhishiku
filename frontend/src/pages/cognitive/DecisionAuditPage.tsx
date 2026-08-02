import { FC, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, ClipboardCheck, Loader2, Filter } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cognitiveApi, DecisionAudit, DecisionAuditCreateRequest } from '@/api/cognitive';
import CognitiveHero from '@/components/brain/CognitiveHero';
import DecisionAuditForm from '@/components/brain/DecisionAuditForm';
import DecisionAuditCard from '@/components/brain/DecisionAuditCard';
import ModelSelector from '@/components/llm/ModelSelector';
import AiErrorNotice from '@/components/llm/AiErrorNotice';

const DecisionAuditPage: FC = () => {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingAudit, setEditingAudit] = useState<DecisionAudit | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [modelId, setModelId] = useState<string>('');

  const { data, isLoading } = useQuery({
    queryKey: ['cognitive', 'decision-audits', statusFilter],
    queryFn: async () => {
      const response = await cognitiveApi.listDecisionAudits({ status: statusFilter || undefined, limit: 100 });
      return response.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: cognitiveApi.createDecisionAudit,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cognitive', 'decision-audits'] });
      setShowForm(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<DecisionAuditCreateRequest> }) =>
      cognitiveApi.updateDecisionAudit(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cognitive', 'decision-audits'] });
      setEditingAudit(null);
      setShowForm(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: cognitiveApi.deleteDecisionAudit,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cognitive', 'decision-audits'] });
    },
  });

  const analyzeMutation = useMutation({
    mutationFn: ({ id, preferred_model }: { id: string; preferred_model?: string }) =>
      cognitiveApi.analyzeDecisionAudit(id, preferred_model),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cognitive', 'decision-audits'] });
    },
  });

  const handleSubmit = (formData: DecisionAuditCreateRequest) => {
    if (editingAudit) {
      updateMutation.mutate({ id: editingAudit.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleEdit = (audit: DecisionAudit) => {
    setEditingAudit(audit);
    setShowForm(true);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingAudit(null);
  };

  const handleNew = () => {
    setEditingAudit(null);
    setShowForm(true);
  };

  const audits: DecisionAudit[] = data?.items || [];

  const initialFormData: Partial<DecisionAuditCreateRequest> = editingAudit
    ? {
        title: editingAudit.title,
        context: editingAudit.context,
        options: editingAudit.options,
        expected_outcome: editingAudit.expected_outcome,
        actual_outcome: editingAudit.actual_outcome,
        decision_date: editingAudit.decision_date,
        brain_side: editingAudit.brain_side,
      }
    : {};

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <CognitiveHero
        title="决策审计"
        subtitle="记录关键决策，让 AI 帮你复盘信心、偏差、风险与更优路径"
      />

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <ClipboardCheck className="w-5 h-5 text-fusion-primary" />
          <div>
            <h2 className="text-lg font-bold text-text-primary">决策审计台</h2>
            <p className="text-xs text-text-secondary">已记录 {data?.total || 0} 条决策</p>
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
                <option value="pending">待分析</option>
                <option value="reviewed">已审计</option>
                <option value="closed">已关闭</option>
              </select>
            </div>
            <button onClick={handleNew} className="btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" />
              <span>新建审计</span>
            </button>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showForm && (
          <DecisionAuditForm
            key="form"
            initial={initialFormData}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            loading={createMutation.isPending || updateMutation.isPending}
          />
        )}
      </AnimatePresence>

      <AiErrorNotice error={analyzeMutation.error || createMutation.error || updateMutation.error || deleteMutation.error} />

      {isLoading ? (
        <div className="glass-card p-12 flex flex-col items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-info mb-4" />
          <p className="text-text-secondary">加载决策审计...</p>
        </div>
      ) : audits.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <div className="p-4 rounded-full bg-fusion-primary/10 w-fit mx-auto mb-4">
            <ClipboardCheck className="w-8 h-8 text-fusion-primary" />
          </div>
          <h3 className="text-lg font-bold text-text-primary mb-2">还没有决策审计</h3>
          <p className="text-text-secondary text-sm max-w-md mx-auto mb-4">
            记录一个重要决定，AI 会帮你分析其中的认知偏差、潜在风险和改进建议。
          </p>
          <button onClick={handleNew} className="btn-primary flex items-center gap-2 mx-auto">
            <Plus className="w-4 h-4" />
            <span>创建第一条决策审计</span>
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {audits.map((audit, index) => (
            <motion.div
              key={audit.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <DecisionAuditCard
                audit={audit}
                onAnalyze={(id) => analyzeMutation.mutate({ id, preferred_model: modelId || undefined })}
                onEdit={handleEdit}
                onDelete={(id) => deleteMutation.mutate(id)}
                analyzing={analyzeMutation.isPending}
              />
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DecisionAuditPage;
