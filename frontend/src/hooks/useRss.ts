import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rssApi, FeedUpdateData } from '@/api/rss';

export const useRssFeeds = () => {
  const queryClient = useQueryClient();

  const { data: feeds, isLoading } = useQuery({
    queryKey: ['rss-feeds'],
    queryFn: async () => {
      const response = await rssApi.listFeeds();
      return response.data;
    },
    staleTime: 60 * 1000,
  });

  const createMutation = useMutation({
    mutationFn: rssApi.createFeed,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rss-feeds'] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: FeedUpdateData }) => rssApi.updateFeed(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rss-feeds'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => rssApi.deleteFeed(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rss-feeds'] });
      queryClient.invalidateQueries({ queryKey: ['rss-entries'] });
    },
  });

  const fetchMutation = useMutation({
    mutationFn: (id: string) => rssApi.fetchFeed(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['rss-feeds'] });
      queryClient.invalidateQueries({ queryKey: ['rss-entries', id] });
    },
  });

  return {
    feeds,
    isLoading,
    createFeed: createMutation.mutateAsync,
    updateFeed: updateMutation.mutateAsync,
    deleteFeed: deleteMutation.mutateAsync,
    fetchFeed: fetchMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
    isFetching: fetchMutation.isPending,
  };
};

export const useRssEntries = (feedId: string | null, options?: { unread_only?: boolean; saved_only?: boolean; limit?: number }) => {
  const queryClient = useQueryClient();

  const { data: entries, isLoading } = useQuery({
    queryKey: ['rss-entries', feedId, options],
    queryFn: async () => {
      if (!feedId) return [];
      const response = await rssApi.listEntries(feedId, options);
      return response.data;
    },
    enabled: !!feedId,
    staleTime: 60 * 1000,
  });

  const markReadMutation = useMutation({
    mutationFn: rssApi.markRead,
    onSuccess: () => {
      if (feedId) queryClient.invalidateQueries({ queryKey: ['rss-entries', feedId] });
      queryClient.invalidateQueries({ queryKey: ['rss-feeds'] });
    },
  });

  const saveMutation = useMutation({
    mutationFn: (entryId: string) => rssApi.saveEntry(entryId),
    onSuccess: () => {
      if (feedId) queryClient.invalidateQueries({ queryKey: ['rss-entries', feedId] });
      queryClient.invalidateQueries({ queryKey: ['clips'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (entryId: string) => rssApi.deleteEntry(entryId),
    onSuccess: () => {
      if (feedId) queryClient.invalidateQueries({ queryKey: ['rss-entries', feedId] });
      queryClient.invalidateQueries({ queryKey: ['rss-feeds'] });
    },
  });

  return {
    entries,
    isLoading,
    markRead: markReadMutation.mutateAsync,
    saveEntry: saveMutation.mutateAsync,
    deleteEntry: deleteMutation.mutateAsync,
    isMarkingRead: markReadMutation.isPending,
    isSaving: saveMutation.isPending,
    isDeletingEntry: deleteMutation.isPending,
  };
};
