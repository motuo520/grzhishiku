import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { readLaterApi, ReadLaterUpdateData, ReadLaterFilters } from '@/api/readLater';

export const useReadLater = (filters?: ReadLaterFilters) => {
  const queryClient = useQueryClient();

  const { data: items, isLoading } = useQuery({
    queryKey: ['read-later', filters],
    queryFn: async () => {
      const response = await readLaterApi.list(filters);
      return response.data;
    },
    staleTime: 60 * 1000,
  });

  const createMutation = useMutation({
    mutationFn: readLaterApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['read-later'] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: ReadLaterUpdateData }) => readLaterApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['read-later'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => readLaterApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['read-later'] });
    },
  });

  const fetchContentMutation = useMutation({
    mutationFn: (id: string) => readLaterApi.fetchContent(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['read-later'] });
    },
  });

  const saveToKnowledgeMutation = useMutation({
    mutationFn: ({ id, tagIds }: { id: string; tagIds?: string[] }) => readLaterApi.saveToKnowledge(id, tagIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['read-later'] });
      queryClient.invalidateQueries({ queryKey: ['knowledge'] });
    },
  });

  return {
    items,
    isLoading,
    createItem: createMutation.mutateAsync,
    updateItem: updateMutation.mutateAsync,
    deleteItem: deleteMutation.mutateAsync,
    fetchContent: fetchContentMutation.mutateAsync,
    saveToKnowledge: saveToKnowledgeMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
    isFetchingContent: fetchContentMutation.isPending,
    isSavingToKnowledge: saveToKnowledgeMutation.isPending,
  };
};
