import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { knowledgeApi, type KnowledgeUpdateData } from '@/api/knowledge';
import { invalidateContentQueries } from '@/utils/invalidateContent';
import type { KnowledgeSourcesResponse, SourceCredibilityResponse, KnowledgeStatsResponse } from '@/types';

const KNOWLEDGE_KEY = ['knowledge'] as const;

export interface KnowledgeListFilters {
  tag_ids?: string;
  folder_id?: string;
  content_subtype?: string;
}

export const useKnowledge = (brain_side?: string, filters?: KnowledgeListFilters) => {
  const queryClient = useQueryClient();

  const {
    data: units,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: [...KNOWLEDGE_KEY, 'list', brain_side ?? 'all', filters ?? {}],
    queryFn: async () => {
      const response = await knowledgeApi.list({
        ...(brain_side ? { brain_side } : {}),
        ...(filters?.tag_ids ? { tag_ids: filters.tag_ids } : {}),
        ...(filters?.folder_id ? { folder_id: filters.folder_id } : {}),
        ...(filters?.content_subtype ? { content_subtype: filters.content_subtype } : {}),
      });
      return response.data;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const {
    data: stats,
    isLoading: isStatsLoading,
    error: statsError,
    refetch: refetchStats,
  } = useQuery<KnowledgeStatsResponse>({
    queryKey: [...KNOWLEDGE_KEY, 'stats'],
    queryFn: async () => {
      const response = await knowledgeApi.stats();
      return response.data;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const createMutation = useMutation({
    mutationFn: knowledgeApi.create,
    onSuccess: () => {
      invalidateContentQueries(queryClient);
    },
  });

  const verifyMutation = useMutation({
    mutationFn: ({ id, preferred_model }: { id: string; preferred_model?: string }) =>
      knowledgeApi.verify(id, preferred_model),
    onSuccess: () => {
      invalidateContentQueries(queryClient);
    },
  });

  return {
    units,
    stats,
    isLoading,
    isStatsLoading,
    error,
    statsError,
    refetch,
    refetchStats,
    createUnit: createMutation.mutateAsync,
    verifyUnit: verifyMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isVerifying: verifyMutation.isPending,
  };
};

export const useKnowledgeUnit = (id: string) => {
  const queryClient = useQueryClient();

  const {
    data: unit,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: [...KNOWLEDGE_KEY, id],
    queryFn: async () => {
      const response = await knowledgeApi.get(id);
      return response.data;
    },
    enabled: !!id,
  });

  const { data: sources, isLoading: isSourcesLoading } = useQuery<KnowledgeSourcesResponse>({
    queryKey: [...KNOWLEDGE_KEY, id, 'sources'],
    queryFn: async () => {
      const response = await knowledgeApi.sources(id);
      return response.data;
    },
    enabled: !!id,
  });

  const domain = unit?.source_url ? (() => {
    try {
      return new URL(unit.source_url).hostname;
    } catch {
      return null;
    }
  })() : null;

  const { data: credibility } = useQuery<SourceCredibilityResponse>({
    queryKey: [...KNOWLEDGE_KEY, 'domain-credibility', domain],
    queryFn: async () => {
      const response = await knowledgeApi.sourceCredibility(domain!);
      return response.data;
    },
    enabled: !!domain,
  });

  const verifyMutation = useMutation({
    mutationFn: (preferred_model?: string) => knowledgeApi.verify(id, preferred_model),
    onSuccess: () => {
      invalidateContentQueries(queryClient);
    },
  });

  const counterEvidenceMutation = useMutation({
    mutationFn: (data: { evidence_text: string; evidence_url?: string }) =>
      knowledgeApi.counterEvidence(id, data),
    onSuccess: () => {
      invalidateContentQueries(queryClient);
    },
  });

  return {
    unit,
    sources,
    credibility,
    isLoading,
    isSourcesLoading,
    error,
    refetch,
    verifyUnit: verifyMutation.mutateAsync,
    submitCounterEvidence: counterEvidenceMutation.mutateAsync,
    isVerifying: verifyMutation.isPending,
    isSubmittingEvidence: counterEvidenceMutation.isPending,
  };
};

export const useCounterEvidence = (brain_side?: string) => {
  const {
    data: units,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: [...KNOWLEDGE_KEY, 'counter-evidence', brain_side ?? 'all'],
    queryFn: async () => {
      const response = await knowledgeApi.counterEvidenceList(brain_side);
      return response.data;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  return { units, isLoading, error, refetch };
};

export const useUpdateKnowledgeUnit = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: KnowledgeUpdateData }) =>
      knowledgeApi.update(id, data),
    onSuccess: () => {
      invalidateContentQueries(queryClient);
    },
  });
};

export const useTimeliness = (brain_side?: string) => {
  const {
    data: units,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: [...KNOWLEDGE_KEY, 'timeliness', brain_side ?? 'all'],
    queryFn: async () => {
      const response = await knowledgeApi.timelinessList(brain_side);
      return response.data;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  return { units, isLoading, error, refetch };
};

export const useSourceAggregates = () => {
  const {
    data: sources,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: [...KNOWLEDGE_KEY, 'sources'],
    queryFn: async () => {
      const response = await knowledgeApi.sourceAggregates();
      return response.data;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  return { sources, isLoading, error, refetch };
};
