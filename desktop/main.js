// 个人第二大脑 — 桌面端主进程（Electron 壳）
//
// 加载策略：
//   1. 设置了环境变量 PSB_WEB_URL（如 http://127.0.0.1:3000）→ 加载该地址（开发模式，配合 vite dev server）
//   2. 否则加载本地打包的前端 frontend/dist/index.html
//      注意：file:// 加载时前端相对路径 /api 不可用，需先用绝对 API 地址构建前端：
//      Windows:  set VITE_API_URL=http://127.0.0.1:8002 && npm run build
//
// 冒烟测试：electron . --smoke （主进程启动成功后立即退出，不创建窗口）

const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const SMOKE_TEST = process.argv.includes('--smoke');

function resolveIndexHtml() {
  // 打包后 frontend/dist 通过 electron-builder 的 extraFiles 放在 resources 下
  const candidates = [
    path.join(process.resourcesPath || '', 'frontend', 'dist', 'index.html'),
    path.join(__dirname, '..', 'frontend', 'dist', 'index.html'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      // ignore
    }
  }
  return null;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: '个人第二大脑',
    backgroundColor: '#0d1117',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  // 外部链接交给系统浏览器，不在应用内新开窗口
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  const webUrl = process.env.PSB_WEB_URL;
  if (webUrl) {
    win.loadURL(webUrl);
    return;
  }

  const indexHtml = resolveIndexHtml();
  if (indexHtml) {
    win.loadFile(indexHtml);
  } else {
    win.loadURL(
      'data:text/html;charset=utf-8,' +
        encodeURIComponent(
          '<body style="background:#0d1117;color:#e6edf3;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">' +
            '<div style="text-align:center"><h2>未找到前端构建产物</h2>' +
            '<p>请先在 frontend/ 目录执行 npm run build，或设置 PSB_WEB_URL 指向开发服务器。</p></div></body>'
        )
    );
  }
}

// 单实例：重复启动时聚焦已有窗口
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    if (SMOKE_TEST) {
      console.log('SMOKE OK: main process started');
      app.quit();
      return;
    }
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
