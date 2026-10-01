import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { brainApi } from '@/api/brain';
import { getToken } from '@/api/auth';
import { useNavigation } from '@/store/navigation';
import type { BrainSide } from '@/types';

export const useBrain = () => {
  const queryClient = useQueryClient();
  const { setBrainSide } = useNavigation();

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ['brain', 'status'],
    queryFn: async () => {
      const response = await brainApi.status();
      return response.data;
    },
  });

  // Sync backend brain state to local navigation store
  useEffect(() => {
    // 游客演示（无本地 token）：脑侧是纯前端状态，不被演示号服务端的 active_brain 回顶
    if (!getToken()) return;
    if (status?.active_brain) {
      setBrainSide(status.active_brain);
    }
  }, [status?.active_brain, setBrainSide]);

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['brain', 'stats'],
    queryFn: async () => {
      const response = await brainApi.stats();
      return response.data;
    },
  });

  const switchMutation = useMutation({
    mutationFn: (target_brain: BrainSide) => brainApi.switch(target_brain),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['brain'] });
      // Sync the new brain state to navigation store immediately
      if (response.data?.active_brain) {
        setBrainSide(response.data.active_brain);
      }
    },
  });

  const searchMutation = useMutation({
    mutationFn: ({ query, brain_sides }: { query: string; brain_sides?: BrainSide[] }) =>
      brainApi.fusionSearch(query, brain_sides),
  });

  return {
    status,
    stats,
    activeBrain: status?.active_brain || 'both',
    switchBrain: switchMutation.mutateAsync,
    search: searchMutation.mutateAsync,
    isSwitching: switchMutation.isPending,
    isSearching: searchMutation.isPending,
    searchResults: searchMutation.data?.data,
    isLoading: statusLoading || statsLoading,
  };
};
