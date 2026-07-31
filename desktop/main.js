// 个人第二大脑 — 桌面端主进程（深度集成版）
//
// 与"套壳"的区别：本进程拥有完整技术栈的生命周期——
//   1. 启动时 spawn 内嵌后端 sidecar（生产：resources/psb-backend/psb-backend.exe；
//      开发 PSB_DEV=1：backend/.venv 里的 python 跑 scripts/desktop_entry.py）
//   2. 后端在 127.0.0.1 动态端口上同源托管 API + 前端 SPA，窗口只面对本机回环
//   3. 托盘常驻：关窗不退出，托盘菜单可显示/退出；Ctrl+Shift+N 全局唤起快记
//   4. 退出时树杀 sidecar，不留孤儿进程
//
// 开发模式：
//   PSB_DEV=1 electron .            → 用源码 python 起后端（动态端口），加载后端托管的页面
//   PSB_WEB_URL=http://localhost:3000 electron .  → 直通前端 dev server（后端自行另起，热更新场景）
//   electron . --smoke              → 主进程+后端启动自检后立即退出

const { app, BrowserWindow, shell, Tray, Menu, globalShortcut, ipcMain, nativeImage } = require('electron');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');

const SMOKE_TEST = process.argv.includes('--smoke');
const IS_DEV = !!process.env.PSB_DEV;
const WEB_URL = process.env.PSB_WEB_URL; // 直通前端 dev server 时不启动 sidecar

const BACKEND_EXE_NAME = process.platform === 'win32' ? 'psb-backend.exe' : 'psb-backend';
const HEALTH_TIMEOUT_MS = 60000;
const QUICK_NOTE_ACCELERATOR = 'Control+Shift+N';

let mainWindow = null;
let tray = null;
let isQuitting = false;
let backend = null; // { proc, port, logStream }
let backendRestarting = false;
// 后端意外退出时自动重启：连续失败 3 次才展示错误页
let backendCrashCount = 0;
let backendLastCrashAt = 0;
const BACKEND_MAX_AUTO_RESTARTS = 3;
const BACKEND_CRASH_WINDOW_MS = 10 * 60 * 1000;

// ---------- sidecar ----------

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function resolveBackendCommand(port) {
  // 生产：PyInstaller 冻结的 sidecar
  const frozenExe = path.join(process.resourcesPath || '', 'psb-backend', BACKEND_EXE_NAME);
  if (!IS_DEV && fs.existsSync(frozenExe)) {
    return { cmd: frozenExe, args: [], cwd: path.dirname(frozenExe) };
  }
  // 开发：项目 venv 的 python 跑 desktop_entry.py
  const backendRoot = path.join(__dirname, '..', 'backend');
  const venvPython = path.join(backendRoot, '.venv', 'Scripts', 'python.exe');
  const python = fs.existsSync(venvPython) ? venvPython : 'python';
  return { cmd: python, args: [path.join(backendRoot, 'scripts', 'desktop_entry.py')], cwd: backendRoot };
}

function resolveFrontendDir() {
  const candidates = [
    path.join(process.resourcesPath || '', 'frontend', 'dist'),
    path.join(__dirname, '..', 'frontend', 'dist'),
  ];
  return candidates.find((p) => fs.existsSync(path.join(p, 'index.html'))) || null;
}

async function startBackend() {
  const port = await findFreePort();
  const { cmd, args, cwd } = resolveBackendCommand(port);
  const frontendDir = resolveFrontendDir();

  const logsDir = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  const logStream = fs.createWriteStream(path.join(logsDir, 'backend.log'), { flags: 'a' });
  logStream.write(`\n===== backend starting at ${new Date().toISOString()} (port ${port}) =====\n`);

  const env = {
    ...process.env,
    PSB_DATA_DIR: path.join(app.getPath('userData'), 'data'),
    PSB_PORT: String(port),
  };
  if (frontendDir) env.SERVE_FRONTEND_DIR = frontendDir;

  const proc = spawn(cmd, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', (d) => logStream.write(d));
  proc.stderr.on('data', (d) => logStream.write(d));
  proc.on('exit', (code) => {
    logStream.write(`backend exited with code ${code}\n`);
    logStream.end();
    if (backend && backend.proc === proc) backend = null;
    if (!isQuitting && !backendRestarting) handleUnexpectedBackendExit(code);
  });

  backend = { proc, port, logStream };
  return port;
}

async function waitForHealth(port, timeoutMs = HEALTH_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return true;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function killBackend() {
  if (!backend) return;
  const { proc } = backend;
  backend = null;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' });
    } else {
      proc.kill('SIGTERM');
      setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* already gone */ } }, 3000);
    }
  } catch {
    // already dead
  }
}

async function restartBackend() {
  if (backendRestarting) return null;
  backendRestarting = true;
  try {
    killBackend();
    const port = await startBackend();
    const ok = await waitForHealth(port);
    return ok ? port : null;
  } finally {
    backendRestarting = false;
  }
}

// 意外退出：短时间窗内自动重启（最多 3 次），仍失败才打扰用户
async function handleUnexpectedBackendExit(code) {
  const now = Date.now();
  if (now - backendLastCrashAt > BACKEND_CRASH_WINDOW_MS) backendCrashCount = 0;
  backendLastCrashAt = now;
  backendCrashCount += 1;

  if (backendCrashCount <= BACKEND_MAX_AUTO_RESTARTS) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(loadingPage(`后端服务意外停止，正在自动重启（第 ${backendCrashCount} 次）…`));
    }
    await new Promise((r) => setTimeout(r, 2000 * backendCrashCount)); // 退避
    const port = await restartBackend();
    if (port && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(`http://127.0.0.1:${port}`);
      return;
    }
  }
  showBackendError('后端进程意外退出（代码 ' + code + '），自动重启未成功。');
}

// ---------- 窗口 ----------

function loadingPage(message) {
  return (
    'data:text/html;charset=utf-8,' +
    encodeURIComponent(
      `<body style="background:#12100e;color:#9a9286;font-family:serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
        <div style="text-align:center">
          <div style="width:28px;height:28px;border:2px solid #bd4a2e;border-top-color:transparent;border-radius:50%;margin:0 auto 16px;animation:spin 1s linear infinite"></div>
          <p>${message}</p>
        </div>
        <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
      </body>`
    )
  );
}

function errorPage(detail) {
  return (
    'data:text/html;charset=utf-8,' +
    encodeURIComponent(
      `<body style="background:#12100e;color:#9a9286;font-family:serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
        <div style="text-align:center;max-width:420px">
          <h2 style="color:#e8e2d8;font-weight:normal">后端服务未能启动</h2>
          <p style="font-size:13px;line-height:1.8">${detail}</p>
          <p style="font-size:12px">日志见 userData/logs/backend.log</p>
          <a href="psb-action:restart" style="display:inline-block;margin-top:12px;padding:10px 28px;background:#bd4a2e;color:#f6ece6;text-decoration:none;font-size:14px">重启后端</a>
        </div>
      </body>`
    )
  );
}

function showBackendError(detail) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.loadURL(errorPage(detail));
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: '问墨',
    backgroundColor: '#12100e',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // 错误页的"重启后端"链接走 will-navigate 拦截（data: 页面无 preload 桥）
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url === 'psb-action:restart') {
      event.preventDefault();
      bootIntoWindow(true);
    }
  });

  // 外部链接交给系统浏览器，不在应用内新开窗口
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // 托盘常驻：关窗只隐藏，不退出
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

// 启动/重启后端并把窗口指到它
async function bootIntoWindow(isRestart = false) {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  mainWindow.show();
  mainWindow.loadURL(loadingPage(isRestart ? '正在重启后端服务…' : '正在启动后端服务…'));

  if (WEB_URL) {
    // 前端 dev server 直通：后端由开发者自行启动（如 make backend）
    mainWindow.loadURL(WEB_URL);
    return;
  }

  const port = backend ? backend.port : await startBackend().catch(() => null);
  if (!port) {
    mainWindow.loadURL(errorPage('后端进程启动失败。'));
    return;
  }
  const ok = await waitForHealth(port);
  if (ok) {
    mainWindow.loadURL(`http://127.0.0.1:${port}`);
  } else {
    killBackend();
    mainWindow.loadURL(errorPage('后端服务 60 秒内未就绪。'));
  }
}

// ---------- 托盘与快捷键 ----------

function createTray() {
  const iconPath = path.join(__dirname, 'icon.png');
  const icon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('问墨');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主界面', click: () => showMainWindow() },
    { type: 'separator' },
    { label: `快记（${QUICK_NOTE_ACCELERATOR.replace('Control', 'Ctrl')}）`, click: () => quickNote() },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } },
  ]));
  tray.on('click', () => showMainWindow());
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    bootIntoWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function quickNote() {
  showMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('psb:quick-note');
  }
}

// ---------- 应用生命周期 ----------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());

  app.whenReady().then(() => {
    ipcMain.handle('psb:restart-backend', async () => {
      const port = await restartBackend();
      if (port && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL(`http://127.0.0.1:${port}`);
      }
      return !!port;
    });
    ipcMain.handle('psb:backend-port', () => (backend ? backend.port : null));

    if (SMOKE_TEST) {
      (async () => {
        if (WEB_URL) {
          console.log('SMOKE OK: main process started (web url passthrough)');
          app.quit();
          return;
        }
        const port = await startBackend().catch(() => null);
        const ok = port ? await waitForHealth(port, 90000) : false;
        console.log(ok ? `SMOKE OK: backend healthy on port ${port}` : 'SMOKE FAIL: backend not healthy');
        killBackend();
        app.exit(ok ? 0 : 1);
      })();
      return;
    }

    createTray();
    bootIntoWindow();
    globalShortcut.register(QUICK_NOTE_ACCELERATOR, quickNote);

    app.on('activate', () => showMainWindow());
  });

  app.on('before-quit', () => { isQuitting = true; });
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    killBackend();
  });
  // 托盘常驻：窗口全关不退出（退出走托盘菜单）
  app.on('window-all-closed', () => {});
}
