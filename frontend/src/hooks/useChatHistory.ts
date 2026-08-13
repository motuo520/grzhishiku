import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { chatApi } from '@/api/chat';

// queryKey 前缀 'chat' 已登记进 invalidateContent.ts 的内容失效前缀列表
const CHAT_KEY = ['chat'] as const;

export const useChatConversations = () => {
  const query = useQuery({
    queryKey: [...CHAT_KEY, 'conversations'],
    queryFn: async () => {
      const res = await chatApi.listConversations();
      return res.data;
    },
  });

  return {
    conversations: query.data?.conversations ?? [],
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    error: query.error,
  };
};

export const useChatConversationDetail = (id: string | null) => {
  const query = useQuery({
    queryKey: [...CHAT_KEY, 'conversation', id],
    queryFn: async () => {
      const res = await chatApi.getConversation(id as string);
      return res.data;
    },
    enabled: !!id,
  });

  return {
    conversation: query.data ?? null,
    messages: query.data?.messages ?? [],
    isLoading: query.isLoading,
    error: query.error,
  };
};

export const useCreateConversation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (title?: string) => chatApi.createConversation(title),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CHAT_KEY });
    },
  });
};

export const useRenameConversation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      chatApi.renameConversation(id, title),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CHAT_KEY });
    },
  });
};

export const useDeleteConversation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => chatApi.deleteConversation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CHAT_KEY });
    },
  });
};
