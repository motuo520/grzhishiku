import { useQuery, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/api/client';
import { usePlatformBilling } from '@/hooks/useSystemFeatures';

export interface LLMBalance {
  balance: number;
  frozen: number;
  total_deposited: number;
  total_used: number;
  currency: string;
}

const BALANCE_QUERY_KEY = ['llmBalance'];
const BALANCE_INTERVAL_MS = 30000;
const BALANCE_STALE_MS = 30000;

export function useLLMBalance(_pollIntervalMs = BALANCE_INTERVAL_MS) {
  const queryClient = useQueryClient();
  const platformBilling = usePlatformBilling();

  const { data: balance, isLoading, error, refetch } = useQuery({
    queryKey: BALANCE_QUERY_KEY,
    queryFn: async () => {
      const { data } = await apiClient.get('/api/v1/billing/balance');
      return data as LLMBalance;
    },
    // 平台计费关闭（开源/自托管）时不请求，接口本身会 404
    enabled: platformBilling,
    staleTime: BALANCE_STALE_MS,
    refetchInterval: BALANCE_INTERVAL_MS,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const refresh = async () => {
    await refetch();
  };

  const setBalance = (value: LLMBalance) => {
    queryClient.setQueryData(BALANCE_QUERY_KEY, value);
  };

  return {
    balance,
    loading: isLoading,
    error: error ? (error as any)?.response?.data?.detail || (error as Error).message || '加载余额失败' : null,
    refresh,
    setBalance,
  };
}

export function invalidateLLMBalance(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: BALANCE_QUERY_KEY });
}
