import { useCallback, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  authApi,
  setToken,
  setRefreshToken,
  clearToken,
  clearRefreshToken,
  isAuthenticated,
  isTokenExpiringSoon,
} from '@/api/auth';

// 模块级单例定时器句柄，防止多个 useAuth 实例各建一个刷新定时器
let refreshTimerRef: { current: ReturnType<typeof setInterval> | null } = { current: null };

export const useAuth = () => {
  const queryClient = useQueryClient();

  const {
    data: user,
    isLoading: isLoadingUser,
    error: userError,
  } = useQuery({
    queryKey: ['user'],
    queryFn: async () => {
      const response = await authApi.me();
      return response.data;
    },
    enabled: isAuthenticated(),
    // 401/403 是确定性失败（token 失效），重试无意义；
    // 网络抖动/5xx/启动竞态是瞬时失败，必须重试——否则一次失败就把用户
    // 永久卡在欢迎页（user 查询不刷新、守卫静默弹回、按钮看似失灵）
    retry: (failureCount, error: any) => {
      const status = error?.response?.status;
      if (status === 401 || status === 403) return false;
      return failureCount < 4;
    },
    retryDelay: (attempt) => 1500 * (attempt + 1),
    staleTime: 5 * 60 * 1000, // 5 min
    refetchOnWindowFocus: true, // 瞬时失败缓存后，聚焦窗口即自愈
    refetchOnReconnect: false,
  });

  // Token auto-refresh: 模块级单例定时器，避免多组件各建一个竞态刷新
  useEffect(() => {
    if (!isAuthenticated()) return;

    if (refreshTimerRef.current) {
      clearInterval(refreshTimerRef.current);
    }
    refreshTimerRef.current = setInterval(async () => {
      if (!isAuthenticated()) return;
      if (isTokenExpiringSoon(30)) {
        try {
          const response = await authApi.refresh();
          setToken(response.data.access_token);
          if (response.data.refresh_token) setRefreshToken(response.data.refresh_token);
          queryClient.invalidateQueries({ queryKey: ['user'] });
        } catch (err: any) {
          // 仅认证错误（401/403）才登出；网络抖动保留会话
          if (err?.response?.status === 401 || err?.response?.status === 403) {
            clearToken();
            clearRefreshToken();
            queryClient.clear();
            window.location.href = '/welcome';
          }
        }
      }
    }, 5 * 60 * 1000); // 5 minutes

    return () => {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [queryClient, isAuthenticated]);

  const loginMutation = useMutation({
    mutationFn: authApi.login,
    onSuccess: (response) => {
      setToken(response.data.access_token);
      if (response.data.refresh_token) setRefreshToken(response.data.refresh_token);
      queryClient.invalidateQueries({ queryKey: ['user'] });
      queryClient.invalidateQueries({ queryKey: ['auth'] });
    },
  });

  const registerMutation = useMutation({
    mutationFn: authApi.register,
    onSuccess: (response) => {
      setToken(response.data.access_token);
      if (response.data.refresh_token) setRefreshToken(response.data.refresh_token);
      queryClient.invalidateQueries({ queryKey: ['user'] });
      queryClient.invalidateQueries({ queryKey: ['auth'] });
    },
  });

  const logout = useCallback(() => {
    authApi.logout().catch(() => {}); // best-effort server-side logout
    clearToken();
    clearRefreshToken();
    queryClient.clear();
    window.location.reload();
  }, [queryClient]);

  const isLoggedIn = !!isAuthenticated() && !!user;

  return {
    user: user ?? null,
    isLoggedIn,
    isLoading: isLoadingUser,
    isLoadingUser,
    /** user 查询的失败对象（429/5xx/网络抖动时 AuthGuard 据此不踢人） */
    userError,
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
