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
    mutationFn: ({ file, title, indexOnly }: { file: File; title?: string; indexOnly?: boolean }) => documentApi.upload(file, title, indexOnly),
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

  // 手动归档/移出文件夹（口径B：文档只手动归档）；文本类文档在线编辑 title/content
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { folder_id?: string | null; title?: string; content?: string; index_only?: boolean } }) => documentApi.update(id, data),
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
    updateDocument: updateMutation.mutateAsync,
    saveToKnowledge: saveToKnowledgeMutation.mutateAsync,
    isUploading: uploadMutation.isPending,
    isReextracting: reextractMutation.isPending,
    isDeleting: deleteMutation.isPending,
    isSavingToKnowledge: saveToKnowledgeMutation.isPending,
  };
};
