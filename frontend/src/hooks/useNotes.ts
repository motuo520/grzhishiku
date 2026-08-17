import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notesApi, NoteUpdateData, Note } from '@/api/notes';
import { invalidateContentQueries } from '@/utils/invalidateContent';

export const useNotes = (filters?: { q?: string; tag_ids?: string; brain_side?: string; folder_id?: string; limit?: number }) => {
  const queryClient = useQueryClient();

  const { data: notes, isLoading } = useQuery({
    queryKey: ['notes', filters?.q, filters?.tag_ids, filters?.brain_side, filters?.folder_id, filters?.limit],
    queryFn: async () => {
      // 后端单页上限 100；请求量超出时自动分页拉取并合并（如进化轨迹要全量笔记）
      const limit = filters?.limit;
      if (!limit || limit <= 100) {
        const response = await notesApi.list(filters);
        return response.data;
      }
      const all: Note[] = [];
      let skip = 0;
      while (all.length < limit) {
        const pageSize = Math.min(100, limit - all.length);
        const response = await notesApi.list({ ...filters, limit: pageSize, skip });
        const batch: Note[] = response.data || [];
        all.push(...batch);
        if (batch.length < pageSize) break;
        skip += batch.length;
      }
      return all;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const createMutation = useMutation({
    mutationFn: notesApi.create,
    onSuccess: () => {
      invalidateContentQueries(queryClient);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: NoteUpdateData }) => notesApi.update(id, data),
    onSuccess: () => {
      invalidateContentQueries(queryClient);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => notesApi.delete(id),
    onSuccess: () => {
      invalidateContentQueries(queryClient);
    },
  });

  const batchCreateMutation = useMutation({
    mutationFn: notesApi.batchCreate,
    onSuccess: () => {
      invalidateContentQueries(queryClient);
    },
  });

  const batchDeleteMutation = useMutation({
    mutationFn: notesApi.batchDelete,
    onSuccess: () => {
      invalidateContentQueries(queryClient);
    },
  });

  const batchUpdateTagsMutation = useMutation({
    mutationFn: async ({ ids, tags }: { ids: string[]; tags: string[] }) => {
      const results = await Promise.all(
        ids.map(async (id) => {
          try {
            await notesApi.update(id, { tags });
            return { id, success: true };
          } catch (e: any) {
            return { id, success: false, error: e.message || '更新失败' };
          }
        })
      );
      const failed = results.filter((r) => !r.success);
      if (failed.length > 0) {
        throw new Error(`${failed.length} 条笔记打标签失败`);
      }
      return results;
    },
    onSuccess: () => {
      invalidateContentQueries(queryClient);
    },
  });

  return {
    notes,
    isLoading,
    createNote: createMutation.mutateAsync,
    updateNote: updateMutation.mutateAsync,
    deleteNote: deleteMutation.mutateAsync,
    batchCreateNotes: batchCreateMutation.mutateAsync,
    batchDeleteNotes: batchDeleteMutation.mutateAsync,
    batchUpdateTags: batchUpdateTagsMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
    isBatchCreating: batchCreateMutation.isPending,
    isBatchDeleting: batchDeleteMutation.isPending,
    isBatchUpdatingTags: batchUpdateTagsMutation.isPending,
  };
};
