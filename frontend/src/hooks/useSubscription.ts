import { useState, useEffect, useCallback, useMemo } from 'react';
import apiClient from '@/api/client';

export interface Plan {
  id: string;
  name: string;
  slug: string;
  description?: string;
  price_monthly: number;  // 分
  price_yearly: number;   // 分
  currency: string;
  features: Record<string, any>;
  limits: Record<string, any>;
}

export interface Subscription {
  id: string;
  plan_id: string;
  plan_name?: string;
  status: 'active' | 'cancelled' | 'expired' | 'paused' | 'trial';
  billing_cycle: 'monthly' | 'yearly';
  price_paid: number;
  current_period_end?: string;
  auto_renew: boolean;
  trial_end?: string;
}

export interface SubscriptionState {
  plans: Plan[];
  currentSubscription: Subscription | null;
  isLoading: boolean;
  error: string | null;
  tier: 'free' | 'storage';
  features: Record<string, any>;
}

// ─── 订阅状态 Hook ───
export function useSubscription(): SubscriptionState & {
  subscribe: (planId: string, cycle: 'monthly' | 'yearly', payment_method?: string) => Promise<void>;
  cancel: (reason?: string) => Promise<void>;
  refresh: () => Promise<void>;
  checkFeature: (feature: string) => boolean;
  checkLimit: (key: string, current: number) => boolean;
} {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [currentSubscription, setCurrentSubscription] = useState<Subscription | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const tier: 'free' | 'storage' = (currentSubscription?.status === 'active' || currentSubscription?.status === 'trial')
    ? (plans.find(p => p.id === currentSubscription.plan_id)?.slug as 'free' | 'storage' || 'free')
    : 'free';

  const features = useMemo(() => (
    currentSubscription?.status === 'active' || currentSubscription?.status === 'trial'
      ? plans.find(p => p.id === currentSubscription.plan_id)?.features || {}
      : plans.find(p => p.slug === 'free')?.features || {}
  ), [currentSubscription, plans]);

  const fetchPlans = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/api/v1/billing/plans');
      setPlans(data);
    } catch (err: any) {
      console.warn('[Subscription] Failed to fetch plans:', err.message);
    }
  }, []);

  const fetchSubscription = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { data } = await apiClient.get('/api/v1/billing/subscription');
      setCurrentSubscription(data);
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 401) {
        setCurrentSubscription(null);
      } else {
        setError(err.message || 'Failed to load subscription');
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([fetchPlans(), fetchSubscription()]);
  }, [fetchPlans, fetchSubscription]);

  const subscribe = useCallback(async (planId: string, cycle: 'monthly' | 'yearly', payment_method?: string) => {
    try {
      await apiClient.post('/api/v1/billing/subscribe', {
        plan_id: planId,
        billing_cycle: cycle,
        payment_method,
      });
      // 支付成功后获取完整订阅对象
      await fetchSubscription();
    } catch (err: any) {
      setError(err?.response?.data?.detail || err.message || 'Subscribe failed');
      throw err;
    }
  }, [fetchSubscription]);

  const cancel = useCallback(async (reason?: string) => {
    try {
      await apiClient.delete('/api/v1/billing/subscription', { data: { reason } });
      await fetchSubscription();
    } catch (err: any) {
      setError(err?.response?.data?.detail || err.message || 'Cancel failed');
      throw err;
    }
  }, [fetchSubscription]);

  const checkFeature = useCallback((feature: string): boolean => {
    if (!features) return false;
    return features[feature] === true;
  }, [features]);

  const checkLimit = useCallback((key: string, current: number): boolean => {
    const limits = plans.find(p => p.id === currentSubscription?.plan_id)?.limits || {};
    const limit = limits[key];
    if (limit === null || limit === undefined) return true; // 无限制
    return current < limit;
  }, [plans, currentSubscription]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    plans,
    currentSubscription,
    isLoading,
    error,
    tier,
    features,
    subscribe,
    cancel,
    refresh,
    checkFeature,
    checkLimit,
  };
}

// ─── 订阅等级守卫 Hook ───
export function useRequireSubscription(minTier: 'free' | 'storage') {
  const { tier, isLoading } = useSubscription();

  const TIER_LEVELS = { free: 0, storage: 1 };
  const hasAccess = !isLoading && TIER_LEVELS[tier] >= TIER_LEVELS[minTier];

  return { hasAccess, tier, isLoading };
}

// ─── 支付历史 Hook ───
export function usePayments() {
  const [payments, setPayments] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchPayments = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data } = await apiClient.get('/api/v1/billing/payments');
      setPayments(data);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { payments, isLoading, refresh: fetchPayments };
}

// ─── 发票管理 Hook ───
export function useInvoices() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchInvoices = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data } = await apiClient.get('/api/v1/billing/invoices');
      setInvoices(data);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const createInvoice = useCallback(async (paymentId: string, title?: string, email?: string) => {
    const { data } = await apiClient.post('/api/v1/billing/invoices', {
      payment_id: paymentId,
      title,
      email,
    });
    await fetchInvoices();
    return data;
  }, [fetchInvoices]);

  return { invoices, isLoading, refresh: fetchInvoices, createInvoice };
}
