import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { emailApi } from '@/api/email';

export const useEmailAccounts = () => {
  const queryClient = useQueryClient();

  const { data: accounts, isLoading } = useQuery({
    queryKey: ['email-accounts'],
    queryFn: async () => {
      const response = await emailApi.listAccounts();
      return response.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: emailApi.createAccount,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-accounts'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => emailApi.deleteAccount(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['email-messages'] });
    },
  });

  const syncMutation = useMutation({
    mutationFn: ({ id, maxMessages }: { id: string; maxMessages?: number }) =>
      emailApi.syncAccount(id, maxMessages),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['email-messages'] });
    },
  });

  return {
    accounts,
    isLoading,
    createAccount: createMutation.mutateAsync,
    deleteAccount: deleteMutation.mutateAsync,
    syncAccount: syncMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isDeleting: deleteMutation.isPending,
    isSyncing: syncMutation.isPending,
  };
};

export const useEmailMessages = (filters?: { account_id?: string; q?: string; status?: string; limit?: number }) => {
  const queryClient = useQueryClient();

  const { data: messages, isLoading } = useQuery({
    queryKey: ['email-messages', filters],
    queryFn: async () => {
      const response = await emailApi.listMessages(filters);
      return response.data;
    },
  });

  const saveToKnowledgeMutation = useMutation({
    mutationFn: ({ id, tag_ids }: { id: string; tag_ids?: string[] }) =>
      emailApi.saveToKnowledge(id, tag_ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-messages'] });
      queryClient.invalidateQueries({ queryKey: ['knowledge'] });
      queryClient.invalidateQueries({ queryKey: ['tags'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => emailApi.deleteMessage(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-messages'] });
    },
  });

  return {
    messages,
    isLoading,
    saveToKnowledge: saveToKnowledgeMutation.mutateAsync,
    deleteMessage: deleteMutation.mutateAsync,
    isSavingToKnowledge: saveToKnowledgeMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
};
