import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tagsApi, TagUpdateData } from '@/api/tags';

export const useTags = () => {
  const queryClient = useQueryClient();

  const { data: tags, isLoading } = useQuery({
    queryKey: ['tags'],
    queryFn: async () => {
      const response = await tagsApi.list();
      return response.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: tagsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: TagUpdateData }) => tagsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => tagsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] });
    },
  });

  const mergeMutation = useMutation({
    mutationFn: ({ id, targetTagId }: { id: string; targetTagId: string }) => tagsApi.merge(id, targetTagId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      queryClient.invalidateQueries({ queryKey: ['clips'] });
      queryClient.invalidateQueries({ queryKey: ['knowledge'] });
      queryClient.invalidateQueries({ queryKey: ['notes'] });
    },
  });

  const cleanupMutation = useMutation({
    mutationFn: tagsApi.cleanup,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] });
    },
  });

  return {
    tags,
    isLoading,
    createTag: createMutation.mutateAsync,
    updateTag: updateMutation.mutateAsync,
    deleteTag: deleteMutation.mutateAsync,
    mergeTags: mergeMutation.mutateAsync,
    cleanupOrphanedTags: cleanupMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
    isMerging: mergeMutation.isPending,
    isCleaningUp: cleanupMutation.isPending,
  };
};

export const useTagAssociations = (tagId: string | null) => {
  return useQuery({
    queryKey: ['tag-associations', tagId],
    queryFn: async () => {
      if (!tagId) return null;
      const response = await tagsApi.associations(tagId);
      return response.data;
    },
    enabled: !!tagId,
    staleTime: 1 * 60 * 1000,
  });
};
