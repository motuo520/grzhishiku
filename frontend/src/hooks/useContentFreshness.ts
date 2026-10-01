import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import api from '@/api/client';
import { useAuth } from '@/hooks/useAuth';
import { invalidateContentQueries } from '@/utils/invalidateContent';

// B+A 准实时刷新（09-14）：后台写入（同步拉取/自动打标/图谱自进化）改库前端无感——
// B：每 60s 轮询 /system/content-version 聚合戳，戳变才失效刷新（active-only，
//     未挂载查询标 stale 进页再取），戳不变零成本；
// A：每 30min 无条件保底全刷一次（防戳的锚点漏算某类变更，同物理图水位多锚哲学）。
// 标签页不可见时两轮都暂停（省电）；游客不轮（演示库静态）。
const POLL_MS = 60_000;
const SWEEP_MS = 30 * 60_000;

export const useContentFreshness = () => {
  const queryClient = useQueryClient();
  const { isLoggedIn } = useAuth();
  const lastStamp = useRef<string | null>(null);

  useEffect(() => {
    if (!isLoggedIn) {
      lastStamp.current = null;
      return;
    }
    const check = async () => {
      if (document.hidden) return;
      try {
        const { data } = await api.get<{ stamp: string }>('/api/v1/system/content-version');
        if (lastStamp.current && data.stamp !== lastStamp.current) {
          invalidateContentQueries(queryClient);
        }
        lastStamp.current = data.stamp;
      } catch {
        // 静默：断网/后端重启时下轮再试，不打搅用户
      }
    };
    check();  // 挂载即取基线戳（不触发失效）
    const poll = window.setInterval(check, POLL_MS);
    const sweep = window.setInterval(() => {
      if (!document.hidden) invalidateContentQueries(queryClient);
    }, SWEEP_MS);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(sweep);
    };
  }, [isLoggedIn, queryClient]);
};
