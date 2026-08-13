import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { capsulesApi } from '@/api/capsules';
import { invalidateContentQueries } from '@/utils/invalidateContent';

export const useCapsules = (brainSide?: string) => {
  const queryClient = useQueryClient();

  const { data: capsules, isLoading } = useQuery({
    queryKey: ['capsules', brainSide],
    queryFn: async () => {
      const response = await capsulesApi.list(brainSide);
      return response.data;
    },
  });

  const { data: stats } = useQuery({
    queryKey: ['capsules', 'stats'],
    queryFn: async () => {
      const response = await capsulesApi.stats();
      return response.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: capsulesApi.create,
    onSuccess: () => {
      invalidateContentQueries(queryClient);
    },
  });

  const unlockMutation = useMutation({
    mutationFn: (id: string) => capsulesApi.unlock(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['capsules'] });
    },
  });

  const collectMutation = useMutation({
    mutationFn: (id: string) => capsulesApi.collect(id),
    onSuccess: () => {
      invalidateContentQueries(queryClient);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => capsulesApi.delete(id),
    onSuccess: () => {
      invalidateContentQueries(queryClient);
    },
  });

  const dialogueMutation = useMutation({
    mutationFn: ({ id, message }: { id: string; message: string }) =>
      capsulesApi.dialogue(id, { message }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['capsules', 'dialogue', vars.id] });
    },
  });

  return {
    capsules,
    stats,
    isLoading,
    createCapsule: createMutation.mutateAsync,
    unlockCapsule: unlockMutation.mutateAsync,
    collectCapsule: collectMutation.mutateAsync,
    deleteCapsule: deleteMutation.mutateAsync,
    sendDialogue: dialogueMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isUnlocking: unlockMutation.isPending,
    isCollecting: collectMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
};

export const useCapsulePlaza = () => {
  const queryClient = useQueryClient();

  const { data: capsules, isLoading } = useQuery({
    queryKey: ['capsules', 'plaza'],
    queryFn: async () => {
      const response = await capsulesApi.plaza();
      return response.data;
    },
  });

  const collectMutation = useMutation({
    mutationFn: (id: string) => capsulesApi.collect(id),
    onSuccess: () => {
      invalidateContentQueries(queryClient);
    },
  });

  return {
    capsules,
    isLoading,
    collectCapsule: collectMutation.mutateAsync,
    isCollecting: collectMutation.isPending,
  };
};

export const useCapsuleSchedule = (brainSide?: string) => {
  const { data: capsules, isLoading } = useQuery({
    queryKey: ['capsules', 'schedule', brainSide],
    queryFn: async () => {
      const response = await capsulesApi.schedule(brainSide);
      return response.data;
    },
  });

  return { capsules, isLoading };
};

export const useCapsuleDialogue = (capsuleId: string | undefined) => {
  const queryClient = useQueryClient();

  const { data: dialogue, isLoading } = useQuery({
    queryKey: ['capsules', 'dialogue', capsuleId],
    queryFn: async () => {
      if (!capsuleId) return null;
      const response = await capsulesApi.getDialogue(capsuleId);
      return response.data;
    },
    enabled: !!capsuleId,
  });

  const sendMutation = useMutation({
    mutationFn: ({ message, preferred_model }: { message: string; preferred_model?: string }) =>
      capsulesApi.dialogue(capsuleId!, { message, preferred_model }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['capsules', 'dialogue', capsuleId] });
    },
  });

  return {
    dialogue,
    isLoading,
    sendMessage: sendMutation.mutateAsync,
    isSending: sendMutation.isPending,
  };
};
