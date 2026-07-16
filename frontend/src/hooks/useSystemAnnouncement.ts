import { useQuery } from '@tanstack/react-query';
import api from '@/api/client';

export interface SystemAnnouncement {
  title: string;
  content: string;
  effective_at?: string;
  enabled: boolean;
}

export function useSystemAnnouncement() {
  return useQuery<SystemAnnouncement>({
    queryKey: ['system-announcement'],
    queryFn: async () => {
      const res = await api.get('/api/v1/system/announcement');
      return res.data;
    },
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
  });
}
