import { useQuery } from '@tanstack/react-query';
import api from '@/api/client';

export interface SystemFeatures {
  registration_open: boolean;
  maintenance_enabled: boolean;
  feature_flags: Record<string, boolean>;
  modules: Record<string, boolean>;
}

export function useSystemFeatures() {
  return useQuery<SystemFeatures>({
    queryKey: ['system-features'],
    queryFn: async () => {
      const res = await api.get('/api/v1/system/features');
      return res.data;
    },
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
