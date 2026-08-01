import { useCallback, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  authApi,
  setToken,
  clearToken,
  isAuthenticated,
  isTokenExpiringSoon,
} from '@/api/auth';

export const useAuth = () => {
  const queryClient = useQueryClient();

  const {
    data: user,
    isLoading: isLoadingUser,
  } = useQuery({
    queryKey: ['user'],
    queryFn: async () => {
      const response = await authApi.me();
      return response.data;
    },
    enabled: isAuthenticated(),
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 min
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  // Token auto-refresh: every 5 minutes check if token is expiring within 30 min
  useEffect(() => {
    if (!isAuthenticated()) return;

    const interval = setInterval(async () => {
      if (isTokenExpiringSoon(30)) {
        try {
          const response = await authApi.refresh();
          setToken(response.data.access_token);
          queryClient.invalidateQueries({ queryKey: ['user'] });
        } catch {
          clearToken();
          queryClient.clear();
          window.location.href = '/welcome';
        }
      }
    }, 5 * 60 * 1000); // 5 minutes

    return () => clearInterval(interval);
  }, [queryClient]);

  const loginMutation = useMutation({
    mutationFn: authApi.login,
    onSuccess: (response) => {
      setToken(response.data.access_token);
      queryClient.invalidateQueries({ queryKey: ['user'] });
      queryClient.invalidateQueries({ queryKey: ['auth'] });
    },
  });

  const registerMutation = useMutation({
    mutationFn: authApi.register,
    onSuccess: (response) => {
      setToken(response.data.access_token);
      queryClient.invalidateQueries({ queryKey: ['user'] });
      queryClient.invalidateQueries({ queryKey: ['auth'] });
    },
  });

  const logout = useCallback(() => {
    authApi.logout().catch(() => {}); // best-effort server-side logout
    clearToken();
    queryClient.clear();
    window.location.reload();
  }, [queryClient]);

  const isLoggedIn = !!isAuthenticated() && !!user;

  return {
    user: user ?? null,
    isLoggedIn,
    isLoading: isLoadingUser,
    isLoadingUser,
    login: loginMutation.mutateAsync,
    register: registerMutation.mutateAsync,
    logout,
    loginError: loginMutation.error,
    registerError: registerMutation.error,
    isLoggingIn: loginMutation.isPending,
    isRegistering: registerMutation.isPending,
    refreshUser: useCallback(() => {
      queryClient.invalidateQueries({ queryKey: ['user'] });
    }, [queryClient]),
  };
};
