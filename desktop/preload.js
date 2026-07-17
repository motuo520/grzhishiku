// 预加载脚本：在隔离环境中向前端暴露少量桌面能力。
// 前端可通过 window.psbDesktop?.isDesktop 判断自己运行在桌面壳内。
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('psbDesktop', {
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
});
