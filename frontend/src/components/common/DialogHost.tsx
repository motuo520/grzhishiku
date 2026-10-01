import { FC, ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { DialogContext, ConfirmRequest } from './dialogContext';

// Electron renderer 不支持 window.confirm / window.alert（静默失效，0.2.117 实捕死按钮）。
// 本模块是全局兜底（09-22 二批）：DialogHost 在 App 根部挂一次——
// ① useConfirm()（见 ./dialogContext）给各页面提供 Promise 版 askConfirm
//    （替代同步 window.confirm，确认框 createPortal 到 body，
//    血泪#57：浮层不被层叠上下文困住）；
// ② 挂载时把 window.alert 收编为右上角自动消失的通知条（alert 是同步 void
//    无法逐站等用户点完——收编成 toast 不打断流程，18 处存量与未来新增一并核销）。
// 逐站手写内联确认仍可用 InlinePrompt/InlineConfirm（就地语境更贴的场景）。

interface AlertToast {
  id: number;
  text: string;
}

export const DialogHost: FC<{ children?: ReactNode }> = ({ children }) => {
  const [req, setReq] = useState<ConfirmRequest | null>(null);
  const [toasts, setToasts] = useState<AlertToast[]>([]);
  const seq = useRef(0);

  const askConfirm = useCallback((text: ReactNode, confirmText = '确认') => {
    return new Promise<boolean>((resolve) => {
      // 未决旧请求按「取消」收口（连发两个确认时第一个 promise 不悬挂）
      setReq((cur) => {
        cur?.resolve(false);
        return { text, confirmText, resolve };
      });
    });
  }, []);

  const close = useCallback((ok: boolean) => {
    setReq((cur) => {
      cur?.resolve(ok);
      return null;
    });
  }, []);

  // window.alert 收编：同步 void API 换成自动消失的通知条（不拦流程）
  useEffect(() => {
    const native = window.alert.bind(window);
    window.alert = (message?: unknown) => {
      const id = ++seq.current;
      setToasts((cur) => [...cur.slice(-2), { id, text: String(message ?? '') }]);
      window.setTimeout(() => {
        setToasts((cur) => cur.filter((t) => t.id !== id));
      }, 4000);
    };
    return () => {
      window.alert = native;
    };
  }, []);

  return (
    <DialogContext.Provider value={{ askConfirm }}>
      {children}
      {createPortal(
        <>
          <AnimatePresence>
            {req && (
              <motion.div
                key="confirm-mask"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 px-4"
                onClick={() => close(false)}
              >
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.98 }}
                  transition={{ duration: 0.15 }}
                  className="glass-card w-full max-w-sm p-4 shadow-xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="text-[13px] text-text-primary leading-relaxed mb-3">{req.text}</div>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => close(false)}
                      className="px-3 py-1 rounded-[2px] text-xs text-text-secondary border border-border-color hover:text-text-primary hover:bg-white/[0.05] transition-colors"
                    >
                      取消
                    </button>
                    <button
                      autoFocus
                      onClick={() => close(true)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') close(true);
                      }}
                      className="px-3 py-1 rounded-[2px] text-xs bg-danger/20 text-danger border border-danger/30 hover:bg-danger/30 transition-colors"
                    >
                      {req.confirmText}
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="fixed top-4 right-4 z-[95] flex flex-col items-end gap-2 pointer-events-none">
            <AnimatePresence>
              {toasts.map((t) => (
                <motion.div
                  key={t.id}
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 16 }}
                  transition={{ duration: 0.15 }}
                  className="glass-card max-w-sm px-3 py-2 text-xs text-text-primary shadow-lg"
                >
                  {t.text}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </>,
        document.body,
      )}
    </DialogContext.Provider>
  );
};

export default DialogHost;
