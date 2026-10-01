import { createContext, ReactNode, useContext } from 'react';

// DialogHost 的 context 与 hook 独立成文件（react-refresh/only-export-components：
// hook 与组件同文件导出会破坏 HMR 语义，存量 eslint 基线不加新 warning）

export interface ConfirmRequest {
  text: ReactNode;
  confirmText: string;
  resolve: (ok: boolean) => void;
}

export interface DialogContextValue {
  askConfirm: (text: ReactNode, confirmText?: string) => Promise<boolean>;
}

export const DialogContext = createContext<DialogContextValue>({ askConfirm: async () => false });

export const useConfirm = () => useContext(DialogContext).askConfirm;
