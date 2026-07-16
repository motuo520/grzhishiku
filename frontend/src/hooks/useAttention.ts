import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { attentionApi } from '@/api/attention';

const DEFAULT_QUERY_OPTIONS = {
  staleTime: 30 * 1000,
  refetchOnWindowFocus: false,
};

export const useAttention = (brainSide?: string) => {
  const queryClient = useQueryClient();

  const { data: activities, isLoading: isLoadingActivities } = useQuery({
    queryKey: ['attention', 'activities'],
    queryFn: async () => {
      const response = await attentionApi.listActivities();
      return response.data;
    },
    ...DEFAULT_QUERY_OPTIONS,
  });

  const { data: dashboard, isLoading: isLoadingDashboard } = useQuery({
    queryKey: ['attention', 'dashboard', brainSide],
    queryFn: async () => {
      const response = await attentionApi.dashboard(brainSide);
      return response.data;
    },
    ...DEFAULT_QUERY_OPTIONS,
  });

  const { data: stats, isLoading: isLoadingStats } = useQuery({
    queryKey: ['attention', 'stats', brainSide],
    queryFn: async () => {
      const response = await attentionApi.stats(brainSide);
      return response.data;
    },
    ...DEFAULT_QUERY_OPTIONS,
  });

  const { data: score, isLoading: isLoadingScore } = useQuery({
    queryKey: ['attention', 'score', brainSide],
    queryFn: async () => {
      const response = await attentionApi.score(brainSide);
      return response.data;
    },
    ...DEFAULT_QUERY_OPTIONS,
  });

  const { data: categories, isLoading: isLoadingCategories } = useQuery({
    queryKey: ['attention', 'categories'],
    queryFn: async () => {
      const response = await attentionApi.categories();
      return response.data;
    },
    ...DEFAULT_QUERY_OPTIONS,
  });

  const { data: guardianRules, isLoading: isLoadingGuardianRules } = useQuery({
    queryKey: ['attention', 'guardian-rules'],
    queryFn: async () => {
      const response = await attentionApi.listGuardianRules();
      return response.data;
    },
    ...DEFAULT_QUERY_OPTIONS,
  });

  const { data: rations, isLoading: isLoadingRations } = useQuery({
    queryKey: ['attention', 'rations'],
    queryFn: async () => {
      const response = await attentionApi.listRations();
      return response.data;
    },
    ...DEFAULT_QUERY_OPTIONS,
  });

  const createCategoryMutation = useMutation({
    mutationFn: attentionApi.createCategory,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['attention', 'categories'] }),
  });

  const updateCategoryMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof attentionApi.updateCategory>[1] }) =>
      attentionApi.updateCategory(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['attention', 'categories'] }),
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: attentionApi.deleteCategory,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['attention', 'categories'] }),
  });

  const createGuardianRuleMutation = useMutation({
    mutationFn: attentionApi.createGuardianRule,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['attention', 'guardian-rules'] }),
  });

  const updateGuardianRuleMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof attentionApi.updateGuardianRule>[1] }) =>
      attentionApi.updateGuardianRule(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['attention', 'guardian-rules'] }),
  });

  const deleteGuardianRuleMutation = useMutation({
    mutationFn: attentionApi.deleteGuardianRule,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['attention', 'guardian-rules'] }),
  });

  const createRationMutation = useMutation({
    mutationFn: attentionApi.createRation,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['attention', 'rations'] }),
  });

  const updateRationMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof attentionApi.updateRation>[1] }) =>
      attentionApi.updateRation(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['attention', 'rations'] }),
  });

  const deleteRationMutation = useMutation({
    mutationFn: attentionApi.deleteRation,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['attention', 'rations'] }),
  });

  const { data: deepWorkSessions } = useQuery({
    queryKey: ['attention', 'deep-work', brainSide],
    queryFn: async () => {
      const response = await attentionApi.listDeepWork(brainSide);
      return response.data;
    },
    ...DEFAULT_QUERY_OPTIONS,
  });

  const createActivityMutation = useMutation({
    mutationFn: attentionApi.createActivity,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attention'] });
    },
  });

  const startDeepWorkMutation = useMutation({
    mutationFn: (data: Parameters<typeof attentionApi.startDeepWork>[0]) =>
      attentionApi.startDeepWork(data).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attention'] });
    },
  });

  const pauseDeepWorkMutation = useMutation({
    mutationFn: (id: string) => attentionApi.pauseDeepWork(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attention'] });
    },
  });

  const resumeDeepWorkMutation = useMutation({
    mutationFn: (id: string) => attentionApi.resumeDeepWork(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attention'] });
    },
  });

  const endDeepWorkMutation = useMutation({
    mutationFn: (id: string) => attentionApi.endDeepWork(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attention'] });
    },
  });

  const recordInterruptionMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      attentionApi.recordInterruption(id, { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attention'] });
    },
  });

  return {
    activities,
    dashboard,
    stats,
    score,
    categories,
    guardianRules,
    rations,
    deepWorkSessions,
    isLoading: isLoadingActivities,
    isLoadingDashboard,
    isLoadingStats,
    isLoadingScore,
    isLoadingCategories,
    isLoadingGuardianRules,
    isLoadingRations,
    createActivity: createActivityMutation.mutateAsync,
    startDeepWork: startDeepWorkMutation.mutateAsync,
    pauseDeepWork: pauseDeepWorkMutation.mutateAsync,
    resumeDeepWork: resumeDeepWorkMutation.mutateAsync,
    endDeepWork: endDeepWorkMutation.mutateAsync,
    recordInterruption: recordInterruptionMutation.mutateAsync,
    createCategory: createCategoryMutation.mutateAsync,
    updateCategory: updateCategoryMutation.mutateAsync,
    deleteCategory: deleteCategoryMutation.mutateAsync,
    createGuardianRule: createGuardianRuleMutation.mutateAsync,
    updateGuardianRule: updateGuardianRuleMutation.mutateAsync,
    deleteGuardianRule: deleteGuardianRuleMutation.mutateAsync,
    createRation: createRationMutation.mutateAsync,
    updateRation: updateRationMutation.mutateAsync,
    deleteRation: deleteRationMutation.mutateAsync,
    isStartingDeepWork: startDeepWorkMutation.isPending,
  };
};
