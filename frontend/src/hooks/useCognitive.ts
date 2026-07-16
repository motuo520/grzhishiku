import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cognitiveApi } from '@/api/cognitive';

export const useCognitive = () => {
  const queryClient = useQueryClient();

  const {
    data: fingerprintData,
    isLoading: isLoadingFingerprint,
    refetch: refetchFingerprint,
  } = useQuery({
    queryKey: ['cognitive', 'fingerprint'],
    queryFn: async () => {
      const response = await cognitiveApi.fingerprint(50, 'both');
      return response.data;
    },
    enabled: false,
  });

  const {
    data: biasData,
    isLoading: isLoadingBias,
    refetch: refetchBias,
  } = useQuery({
    queryKey: ['cognitive', 'bias-detection'],
    queryFn: async () => {
      const response = await cognitiveApi.detectBias(50, 'both');
      return response.data;
    },
    enabled: false,
  });

  const {
    data: biasSummary,
    isLoading: isLoadingBiasSummary,
    refetch: refetchBiasSummary,
  } = useQuery({
    queryKey: ['cognitive', 'bias-summary'],
    queryFn: async () => {
      const response = await cognitiveApi.biasSummary('both');
      return response.data;
    },
    enabled: false,
  });

  const fingerprintMutation = useMutation({
    mutationFn: async (preferred_model?: string) => {
      const response = await cognitiveApi.fingerprint(50, 'both', preferred_model);
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['cognitive', 'fingerprint'], data);
    },
  });

  const detectBiasMutation = useMutation({
    mutationFn: async (preferred_model?: string) => {
      const response = await cognitiveApi.detectBias(50, 'both', preferred_model);
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['cognitive', 'bias-detection'], data);
    },
  });

  return {
    fingerprintData: fingerprintData || null,
    biasData: biasData || null,
    biasSummary: biasSummary || null,
    isLoadingFingerprint: isLoadingFingerprint || fingerprintMutation.isPending,
    isLoadingBias: isLoadingBias || detectBiasMutation.isPending,
    isLoadingBiasSummary: isLoadingBiasSummary,
    generateFingerprint: fingerprintMutation.mutateAsync,
    detectBias: detectBiasMutation.mutateAsync,
    refetchFingerprint,
    refetchBias,
    refetchBiasSummary,
  };
};
