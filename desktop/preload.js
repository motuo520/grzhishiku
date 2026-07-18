// 预加载脚本：在隔离环境中向前端暴露少量桌面能力。
// 前端可通过 window.psbDesktop?.isDesktop 判断自己运行在桌面端内。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('psbDesktop', {
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
  /** 当前内嵌后端端口（未启动时为 null） */
  backendPort: () => ipcRenderer.invoke('psb:backend-port'),
  /** 重启内嵌后端，成功 resolve true */
  restartBackend: () => ipcRenderer.invoke('psb:restart-backend'),
  /** 订阅全局快捷键（Ctrl+Shift+N）快记事件；返回取消订阅函数 */
  onQuickNote: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('psb:quick-note', listener);
    return () => ipcRenderer.removeListener('psb:quick-note', listener);
  },
});
