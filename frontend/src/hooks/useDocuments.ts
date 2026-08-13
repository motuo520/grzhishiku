import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { documentApi, DocumentFilters } from '@/api/document';
import { invalidateContentQueries } from '@/utils/invalidateContent';

export const useDocuments = (filters?: DocumentFilters) => {
  const queryClient = useQueryClient();

  const { data: documents, isLoading } = useQuery({
    queryKey: ['documents', filters],
    queryFn: async () => {
      const response = await documentApi.list(filters);
      return response.data;
    },
    staleTime: 60 * 1000,
  });

  const uploadMutation = useMutation({
    mutationFn: ({ file, title }: { file: File; title?: string }) => documentApi.upload(file, title),
    onSuccess: () => {
      invalidateContentQueries(queryClient);
    },
  });

  const reextractMutation = useMutation({
    mutationFn: (id: string) => documentApi.reextract(id),
    onSuccess: () => {
      invalidateContentQueries(queryClient);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => documentApi.delete(id),
    onSuccess: () => {
      invalidateContentQueries(queryClient);
    },
  });

  const saveToKnowledgeMutation = useMutation({
    mutationFn: ({ id, tagIds }: { id: string; tagIds?: string[] }) => documentApi.saveToKnowledge(id, tagIds),
    onSuccess: () => {
      invalidateContentQueries(queryClient);
    },
  });

  return {
    documents,
    isLoading,
    uploadDocument: uploadMutation.mutateAsync,
    reextractDocument: reextractMutation.mutateAsync,
    deleteDocument: deleteMutation.mutateAsync,
    saveToKnowledge: saveToKnowledgeMutation.mutateAsync,
    isUploading: uploadMutation.isPending,
    isReextracting: reextractMutation.isPending,
    isDeleting: deleteMutation.isPending,
    isSavingToKnowledge: saveToKnowledgeMutation.isPending,
  };
};
