import { useQuery } from '@tanstack/react-query';
import api from '@/api/client';

export interface SystemFeatures {
  registration_open: boolean;
  maintenance_enabled: boolean;
  feature_flags: Record<string, boolean>;
  modules: Record<string, boolean>;
  tier: string;
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

/**
 * 平台模型计费（外部模型控制台）是否开启。
 * 开源/自托管默认 false：隐藏充值、余额、模型市场等计费 UI；
 * 运营方在系统配置 feature_flags.platform_billing_enabled 置 true 后显示。
 */
export function usePlatformBilling(): boolean {
  const { data } = useSystemFeatures();
  return data?.feature_flags?.platform_billing_enabled === true;
}
