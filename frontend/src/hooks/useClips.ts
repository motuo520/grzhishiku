import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clipsApi, ClipUpdateData } from '@/api/clips';
import { invalidateContentQueries } from '@/utils/invalidateContent';

export interface ClipFilters {
  q?: string;
  domain?: string;
  tag_ids?: string[];
  limit?: number;
}

export const useClips = (filters: ClipFilters = {}) => {
  const queryClient = useQueryClient();

  const tagIdsParam = filters.tag_ids && filters.tag_ids.length > 0
    ? filters.tag_ids.join(',')
    : undefined;

  const { data: clips, isLoading } = useQuery({
    queryKey: ['clips', { q: filters.q, domain: filters.domain, tag_ids: tagIdsParam, limit: filters.limit }],
    queryFn: async () => {
      const response = await clipsApi.list({
        q: filters.q,
        domain: filters.domain,
        tag_ids: tagIdsParam,
        limit: filters.limit,
      });
      return response.data;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const createMutation = useMutation({
    mutationFn: clipsApi.create,
    onSuccess: () => {
      invalidateContentQueries(queryClient);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => clipsApi.delete(id),
    onSuccess: () => {
      invalidateContentQueries(queryClient);
    },
  });

  const batchCreateMutation = useMutation({
    mutationFn: clipsApi.batchCreate,
    onSuccess: () => {
      invalidateContentQueries(queryClient);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: ClipUpdateData }) => clipsApi.update(id, data),
    onSuccess: () => {
      invalidateContentQueries(queryClient);
    },
  });

  const saveToKnowledgeMutation = useMutation({
    mutationFn: (id: string) => clipsApi.saveToKnowledge(id),
    onSuccess: () => {
      invalidateContentQueries(queryClient);
    },
  });

  const batchUpdateTagsMutation = useMutation({
    mutationFn: async ({ ids, tags }: { ids: string[]; tags: string[] }) => {
      const results = await Promise.all(
        ids.map(async (id) => {
          try {
            await clipsApi.update(id, { tags });
            return { id, success: true };
          } catch (e: any) {
            return { id, success: false, error: e.message || '更新失败' };
          }
        })
      );
      const failed = results.filter((r) => !r.success);
      if (failed.length > 0) {
        throw new Error(`${failed.length} 条剪藏打标签失败`);
      }
      return results;
    },
    onSuccess: () => {
      invalidateContentQueries(queryClient);
    },
  });

  return {
    clips,
    isLoading,
    createClip: createMutation.mutateAsync,
    deleteClip: deleteMutation.mutateAsync,
    batchCreateClips: batchCreateMutation.mutateAsync,
    updateClip: updateMutation.mutateAsync,
    saveToKnowledge: saveToKnowledgeMutation.mutateAsync,
    batchUpdateTags: batchUpdateTagsMutation.mutateAsync,
    fetchMetadata: clipsApi.fetchMetadata,
    isCreating: createMutation.isPending,
    isDeleting: deleteMutation.isPending,
    isBatchCreating: batchCreateMutation.isPending,
    isUpdating: updateMutation.isPending,
    isSavingToKnowledge: saveToKnowledgeMutation.isPending,
    isBatchUpdatingTags: batchUpdateTagsMutation.isPending,
  };
};
