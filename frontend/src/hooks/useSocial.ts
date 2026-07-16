import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { socialApi, SocialAccountCreateData } from '@/api/social';

export const useSocialAccounts = () => {
  const queryClient = useQueryClient();

  const { data: accounts, isLoading } = useQuery({
    queryKey: ['social-accounts'],
    queryFn: async () => {
      const response = await socialApi.listAccounts();
      return response.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: socialApi.createAccount,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['social-accounts'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => socialApi.deleteAccount(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['social-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['social-messages'] });
    },
  });

  return {
    accounts,
    isLoading,
    createAccount: createMutation.mutateAsync,
    deleteAccount: deleteMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
};

export const useSocialMessages = (filters?: {
  account_id?: string;
  conversation_id?: string;
  q?: string;
}) => {
  const queryClient = useQueryClient();

  const { data: messages, isLoading } = useQuery({
    queryKey: ['social-messages', filters],
    queryFn: async () => {
      const response = await socialApi.listMessages(filters);
      return response.data;
    },
  });

  const saveToKnowledgeMutation = useMutation({
    mutationFn: ({ id, tag_ids, brain_side }: { id: string; tag_ids?: string[]; brain_side?: string }) =>
      socialApi.saveToKnowledge(id, tag_ids, brain_side),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['social-messages'] });
      queryClient.invalidateQueries({ queryKey: ['knowledge'] });
      queryClient.invalidateQueries({ queryKey: ['tags'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => socialApi.deleteMessage(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['social-messages'] });
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

export const useSocialUpload = () => {
  const queryClient = useQueryClient();

  const uploadMutation = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) =>
      socialApi.uploadFile(id, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['social-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['social-messages'] });
    },
  });

  return {
    uploadFile: uploadMutation.mutateAsync,
    isUploading: uploadMutation.isPending,
  };
};
