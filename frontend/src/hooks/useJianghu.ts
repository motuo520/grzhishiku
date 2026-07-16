import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { jianghuApi, type PracticeRecordCreateData, type RelevanceCheckRequest, type ContextGuideCreateData, type ContextGuideUpdateData, type ExperimentLogCreateData, type ExperimentLogUpdateData } from '@/api/jianghu';

const JIANGHU_KEY = 'jianghu';

export function usePracticeRecords(params?: { target_type?: string; target_id?: string; practice_type?: string; brain_side?: string; limit?: number; offset?: number }) {
  return useQuery({
    queryKey: [JIANGHU_KEY, 'practice-records', params],
    queryFn: async () => {
      const response = await jianghuApi.listPracticeRecords(params);
      return response.data;
    },
    placeholderData: keepPreviousData,
  });
}

export function useCreatePracticeRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: jianghuApi.createPracticeRecord,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [JIANGHU_KEY, 'practice-records'] });
    },
  });
}

export function useDailyReviews(params?: { status?: string; limit?: number; offset?: number }) {
  return useQuery({
    queryKey: [JIANGHU_KEY, 'daily-reviews', params],
    queryFn: async () => {
      const response = await jianghuApi.listDailyReviews(params);
      return response.data;
    },
    placeholderData: keepPreviousData,
  });
}

export function useGenerateDailyReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      data,
      preferred_model,
    }: {
      data?: Parameters<typeof jianghuApi.generateDailyReview>[0];
      preferred_model?: string;
    }) => {
      const response = await jianghuApi.generateDailyReview(data, preferred_model);
      return response.data;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: [JIANGHU_KEY, 'daily-reviews'] });
      qc.invalidateQueries({ queryKey: [JIANGHU_KEY, 'knowledge-health'] });
    },
  });
}

export function useKnowledgeHealth(brain_side?: string) {
  return useQuery({
    queryKey: [JIANGHU_KEY, 'knowledge-health', brain_side],
    queryFn: async () => {
      const response = await jianghuApi.getKnowledgeHealth(brain_side);
      return response.data;
    },
  });
}

export function useRelevanceCheck() {
  return useMutation({
    mutationFn: async ({
      data,
      preferred_model,
    }: {
      data: RelevanceCheckRequest;
      preferred_model?: string;
    }) => {
      const response = await jianghuApi.checkRelevance(data, preferred_model);
      return response.data;
    },
  });
}

export function useContextGuides(is_active?: boolean) {
  return useQuery({
    queryKey: [JIANGHU_KEY, 'context-guides', is_active],
    queryFn: async () => {
      const response = await jianghuApi.listContextGuides(is_active);
      return response.data;
    },
  });
}

export function useCreateContextGuide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: jianghuApi.createContextGuide,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [JIANGHU_KEY, 'context-guides'] });
    },
  });
}

export function useUpdateContextGuide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ContextGuideUpdateData }) =>
      jianghuApi.updateContextGuide(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [JIANGHU_KEY, 'context-guides'] });
    },
  });
}

export function useDeleteContextGuide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: jianghuApi.deleteContextGuide,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [JIANGHU_KEY, 'context-guides'] });
    },
  });
}

export function useGenerateContextGuide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      brain_side,
      preferred_model,
      title,
    }: {
      brain_side?: string;
      preferred_model?: string;
      title?: string;
    }) => {
      const response = await jianghuApi.generateContextGuide({ brain_side, preferred_model, title });
      return response.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [JIANGHU_KEY, 'context-guides'] });
    },
  });
}

export function useExperimentLogs(filters?: { status?: string; brain_side?: string }) {
  return useQuery({
    queryKey: [JIANGHU_KEY, 'experiment-logs', filters],
    queryFn: async () => {
      const response = await jianghuApi.listExperimentLogs(filters);
      return response.data;
    },
  });
}

export function useCreateExperimentLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: jianghuApi.createExperimentLog,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [JIANGHU_KEY, 'experiment-logs'] });
    },
  });
}

export function useUpdateExperimentLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ExperimentLogUpdateData }) =>
      jianghuApi.updateExperimentLog(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [JIANGHU_KEY, 'experiment-logs'] });
    },
  });
}

export function useDeleteExperimentLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: jianghuApi.deleteExperimentLog,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [JIANGHU_KEY, 'experiment-logs'] });
    },
  });
}

export function useUpdateDailyReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof jianghuApi.updateDailyReview>[1] }) =>
      jianghuApi.updateDailyReview(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [JIANGHU_KEY, 'daily-reviews'] });
    },
  });
}

export function useDeletePracticeRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: jianghuApi.deletePracticeRecord,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [JIANGHU_KEY, 'practice-records'] });
      qc.invalidateQueries({ queryKey: [JIANGHU_KEY, 'knowledge-health'] });
    },
  });
}
