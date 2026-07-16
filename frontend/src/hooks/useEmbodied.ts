import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { embodiedApi, type BrainSide as ApiBrainSide, type DepthCheckRequest, type EvolutionReflectionCreate, type EvolutionReflectionUpdate } from '@/api/embodied';
import type { BrainSide } from '@/store/navigation';

export const useEmbodied = (brainSide: BrainSide = 'both') => {
  const queryClient = useQueryClient();
  const normalizedBrainSide: ApiBrainSide = brainSide === 'unknown' ? 'both' : brainSide;

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Depth check logs
  const {
    data: depthLogs,
    isLoading: isLoadingDepthLogs,
    error: depthLogsError,
    refetch: refetchDepthLogs,
  } = useQuery({
    queryKey: ['embodied', 'depth-check', 'logs'],
    queryFn: async () => {
      const response = await embodiedApi.listDepthCheckLogs();
      return response.data;
    },
  });

  const depthCheckMutation = useMutation({
    mutationFn: async (payload: DepthCheckRequest) => {
      const response = await embodiedApi.depthCheck(payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['embodied', 'depth-check', 'logs'] });
    },
    onError: (err: any) => showToast(err?.message || '深度检查失败', 'error'),
  });

  // Evolution reflections
  const {
    data: evolutionReflections,
    isLoading: isLoadingEvolutionReflections,
    error: evolutionReflectionsError,
    refetch: refetchEvolutionReflections,
  } = useQuery({
    queryKey: ['embodied', 'evolution-reflections', normalizedBrainSide],
    queryFn: async () => {
      const response = await embodiedApi.listEvolutionReflections(normalizedBrainSide);
      return response.data;
    },
  });

  const createEvolutionReflection = useMutation({
    mutationFn: async (payload: EvolutionReflectionCreate) => {
      const response = await embodiedApi.createEvolutionReflection(payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['embodied', 'evolution-reflections'] });
    },
    onError: (err: any) => showToast(err?.message || '保存失败', 'error'),
  });

  const updateEvolutionReflection = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: EvolutionReflectionUpdate }) => {
      const response = await embodiedApi.updateEvolutionReflection(id, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['embodied', 'evolution-reflections'] });
    },
    onError: (err: any) => showToast(err?.message || '保存失败', 'error'),
  });

  const deleteEvolutionReflection = useMutation({
    mutationFn: async (id: string) => {
      await embodiedApi.deleteEvolutionReflection(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['embodied', 'evolution-reflections'] });
    },
    onError: (err: any) => showToast(err?.message || '删除失败', 'error'),
  });

  const analyzeEvolutionReflections = useMutation({
    mutationFn: async (preferred_model?: string) => {
      const response = await embodiedApi.analyzeEvolutionReflections(normalizedBrainSide, preferred_model);
      return response.data;
    },
    onError: (err: any) => showToast(err?.message || '分析失败', 'error'),
  });

  // Mood & location
  const {
    data: moodLocationData,
    isLoading: isLoadingMoodLocation,
    error: moodLocationError,
    refetch: refetchMoodLocation,
  } = useQuery({
    queryKey: ['embodied', 'mood-location', normalizedBrainSide],
    queryFn: async () => {
      const response = await embodiedApi.getMoodLocation(normalizedBrainSide);
      return response.data;
    },
  });

  return {
    toast,

    depthLogs: depthLogs || [],
    isLoadingDepthLogs,
    depthLogsError,
    refetchDepthLogs,
    depthCheck: depthCheckMutation.mutateAsync,
    isDepthChecking: depthCheckMutation.isPending,

    evolutionReflections: evolutionReflections || [],
    isLoadingEvolutionReflections,
    evolutionReflectionsError,
    refetchEvolutionReflections,
    createEvolutionReflection: createEvolutionReflection.mutateAsync,
    updateEvolutionReflection: updateEvolutionReflection.mutateAsync,
    deleteEvolutionReflection: deleteEvolutionReflection.mutateAsync,
    analyzeEvolutionReflections: analyzeEvolutionReflections.mutateAsync,
    isCreatingEvolutionReflection: createEvolutionReflection.isPending,
    isUpdatingEvolutionReflection: updateEvolutionReflection.isPending,
    isDeletingEvolutionReflection: deleteEvolutionReflection.isPending,
    isAnalyzingEvolutionReflections: analyzeEvolutionReflections.isPending,

    moodLocationData: moodLocationData || { items: [], stats: { mood_distribution: {}, location_distribution: {}, total: 0 } },
    isLoadingMoodLocation,
    moodLocationError,
    refetchMoodLocation,
  };
};
