/// <reference types="vite/client" />

/** 桌面端（Electron preload）注入的桥接对象 */
interface PsbDesktopBridge {
  isDesktop: boolean;
  platform: string;
  versions: { electron: string; chrome: string };
  backendPort: () => Promise<number | null>;
  restartBackend: () => Promise<boolean>;
  onQuickNote: (callback: () => void) => () => void;
}

interface Window {
  psbDesktop?: PsbDesktopBridge;
}
