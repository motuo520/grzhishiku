import { useQuery, useMutation, useQueryClient, useQueries } from '@tanstack/react-query';
import { pipelineApi, type PipelineStats, type PipelineItem } from '@/api/pipeline';
import type { BrainSide } from '@/types';

const PIPELINE_STAGES = ['raw', 'card', 'extracted', 'collided', 'approved'] as const;

function normalizeSide(side: BrainSide): 'personal' | 'network' | 'both' {
  if (side === 'personal' || side === 'network') return side;
  return 'both';
}

function safeParseTime(dateStr?: string | null): number {
  if (!dateStr) return 0;
  const t = new Date(dateStr).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export const usePipelineStats = (brainSide: BrainSide = 'both') => {
  const side = normalizeSide(brainSide);
  const { data: stats, isLoading, error, refetch } = useQuery<PipelineStats>({
    queryKey: ['pipeline', 'stats', { brain_side: side }],
    queryFn: async () => {
      const response = await pipelineApi.stats(side);
      return response.data;
    },
  });
  return { stats, isLoading, error, refetch };
};

export const usePipelineItems = (stage: string, brainSide: BrainSide = 'both') => {
  const side = normalizeSide(brainSide);
  const { data: items, isLoading, error, refetch } = useQuery<PipelineItem[]>({
    queryKey: ['pipeline', 'items', { stage, brain_side: side }],
    queryFn: async () => {
      const response = await pipelineApi.items(stage, side);
      return response.data;
    },
    enabled: !!stage,
  });
  return { items, isLoading, error, refetch };
};

export const useRecentPipelineItems = (brainSide: BrainSide = 'both', perStage = 5) => {
  const side = normalizeSide(brainSide);
  const queries = useQueries({
    queries: PIPELINE_STAGES.map((stage) => ({
      queryKey: ['pipeline', 'recent', { stage, brain_side: side }],
      queryFn: async () => {
        const response = await pipelineApi.items(stage, side);
        return response.data.slice(0, perStage);
      },
    })),
  });

  const isLoading = queries.some((q) => q.isLoading);
  const error = queries.find((q) => q.error)?.error || null;
  const refetch = () => Promise.all(queries.map((q) => q.refetch()));

  const items = queries
    .flatMap((q) => q.data || [])
    .sort((a, b) => safeParseTime(b.created_at) - safeParseTime(a.created_at))
    .slice(0, 15);

  return { items, isLoading, error, refetch };
};

export const useTransitionItem = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      content_type,
      content_id,
      stage,
    }: {
      content_type: string;
      content_id: string;
      stage: string;
    }) => {
      const response = await pipelineApi.transitionStage(content_type, content_id, stage);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipeline', 'stats'] });
      queryClient.invalidateQueries({ queryKey: ['pipeline', 'items'] });
      queryClient.invalidateQueries({ queryKey: ['pipeline', 'recent'] });
    },
  });
};

export const useExtractConcepts = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ content_type, content_id, preferred_model }: { content_type: string; content_id: string; preferred_model?: string }) => {
      const response = await pipelineApi.extract(content_type, content_id, preferred_model);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipeline', 'stats'] });
      queryClient.invalidateQueries({ queryKey: ['pipeline', 'items'] });
      queryClient.invalidateQueries({ queryKey: ['pipeline', 'recent'] });
      queryClient.invalidateQueries({ queryKey: ['knowledge'] });
    },
  });
};

export const useCollideConcept = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ concept_id, preferred_model }: { concept_id: string; preferred_model?: string }) => {
      const response = await pipelineApi.collide(concept_id, preferred_model);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipeline', 'stats'] });
      queryClient.invalidateQueries({ queryKey: ['pipeline', 'items'] });
      queryClient.invalidateQueries({ queryKey: ['pipeline', 'recent'] });
      queryClient.invalidateQueries({ queryKey: ['knowledge'] });
    },
  });
};

export const useRevertPipelineItem = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ content_type, content_id }: { content_type: string; content_id: string }) => {
      const response = await pipelineApi.revert(content_type, content_id);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipeline', 'stats'], refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: ['pipeline', 'items'], refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: ['pipeline', 'recent'], refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: ['knowledge'], refetchType: 'all' });
    },
  });
};

export const useDeletePipelineItem = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ content_type, content_id }: { content_type: string; content_id: string }) => {
      const response = await pipelineApi.remove(content_type, content_id);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipeline', 'stats'] });
      queryClient.invalidateQueries({ queryKey: ['pipeline', 'items'] });
      queryClient.invalidateQueries({ queryKey: ['pipeline', 'recent'] });
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      queryClient.invalidateQueries({ queryKey: ['knowledge'] });
    },
  });
};

export const useReviewCollision = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ collision_id, action, feedback }: { collision_id: string; action: 'approve' | 'reject'; feedback?: string }) => {
      const response = await pipelineApi.reviewCollision(collision_id, action, feedback);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipeline', 'stats'] });
      queryClient.invalidateQueries({ queryKey: ['pipeline', 'items'] });
      queryClient.invalidateQueries({ queryKey: ['pipeline', 'recent'] });
      queryClient.invalidateQueries({ queryKey: ['knowledge'] });
    },
  });
};

export const usePipelineHistory = (content_type?: string, content_id?: string) => {
  return useQuery({
    queryKey: ['pipeline', 'history', content_type, content_id],
    queryFn: async () => {
      if (!content_type || !content_id) return [];
      const response = await pipelineApi.history(content_type, content_id);
      return response.data;
    },
    enabled: !!content_type && !!content_id,
  });
};

export const useConvertBrainSide = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      content_type,
      content_id,
      target_brain_side,
      reason,
    }: {
      content_type: string;
      content_id: string;
      target_brain_side: 'personal' | 'network';
      reason?: string;
    }) => {
      const response = await pipelineApi.convertBrainSide(content_type, content_id, target_brain_side, reason);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipeline', 'stats'] });
      queryClient.invalidateQueries({ queryKey: ['pipeline', 'items'] });
      queryClient.invalidateQueries({ queryKey: ['pipeline', 'recent'] });
      queryClient.invalidateQueries({ queryKey: ['knowledge'] });
      queryClient.invalidateQueries({ queryKey: ['pipeline', 'history'] });
    },
  });
};
