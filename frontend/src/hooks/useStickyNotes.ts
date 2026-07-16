import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { stickyNoteApi, type CreateStickyNoteData, type UpdateStickyNoteData } from '@/api/stickyNotes';

const STICKY_NOTES_KEY = ['sticky-notes'] as const;

export const useStickyNotes = (includeArchived = false) => {
  const query = useQuery({
    queryKey: [...STICKY_NOTES_KEY, includeArchived],
    queryFn: async () => {
      const res = await stickyNoteApi.getNotes(includeArchived);
      return res.data;
    },
  });

  return {
    notes: query.data?.notes ?? [],
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    error: query.error,
  };
};

export const useCreateStickyNote = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateStickyNoteData) => stickyNoteApi.createNote(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: STICKY_NOTES_KEY });
    },
  });
};

export const useUpdateStickyNote = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateStickyNoteData }) =>
      stickyNoteApi.updateNote(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: STICKY_NOTES_KEY });
    },
  });
};

export const useDeleteStickyNote = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => stickyNoteApi.deleteNote(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: STICKY_NOTES_KEY });
    },
  });
};

export const useConvertStickyNoteToNote = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => stickyNoteApi.convertToNote(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: STICKY_NOTES_KEY });
      queryClient.invalidateQueries({ queryKey: ['notes'] });
    },
  });
};
