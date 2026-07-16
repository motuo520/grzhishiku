// browser-extension/vite.config.js
import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync } from 'fs';

// 自定义插件：复制 manifest.json 和静态资源到 dist
const copyManifest = () => ({
  name: 'copy-manifest',
  closeBundle() {
    const distDir = resolve(__dirname, 'dist');
    if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });
    
    copyFileSync(
      resolve(__dirname, 'manifest.json'),
      resolve(distDir, 'manifest.json')
    );
    
    // 复制图标
    const iconDir = resolve(distDir, 'icons');
    if (!existsSync(iconDir)) mkdirSync(iconDir, { recursive: true });
    
    ['icon16.png', 'icon32.png', 'icon48.png', 'icon128.png'].forEach(icon => {
      try {
        copyFileSync(resolve(__dirname, 'icons', icon), resolve(iconDir, icon));
      } catch (e) {}
    });
    
    // 复制 HTML 文件
    ['popup.html', 'options.html', 'capsule-create.html'].forEach(html => {
      try {
        copyFileSync(resolve(__dirname, html), resolve(distDir, html));
      } catch (e) {}
    });
    
    console.log('✅ Extension files copied to dist/');
  }
});

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'background.js'),
        content: resolve(__dirname, 'content.js'),
        popup: resolve(__dirname, 'popup.js'),
        options: resolve(__dirname, 'options.js')
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) return 'content.css';
          return 'assets/[name]-[hash][extname]';
        }
      }
    }
  },
  plugins: [copyManifest()]
});

// browser-extension/package.json
{
  "name": "second-brain-clipper",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "build:firefox": "vite build && node scripts/patch-manifest.js firefox",
    "lint": "eslint .",
    "test": "vitest"
  },
  "devDependencies": {
    "vite": "^5.0.0",
    "eslint": "^8.0.0",
    "vitest": "^1.0.0"
  }
}

// browser-extension/scripts/patch-manifest.js
// 用于生成 Firefox 兼容的 manifest
import { readFileSync, writeFileSync } from 'fs';

const target = process.argv[2] || 'chrome';
const manifest = JSON.parse(readFileSync('dist/manifest.json', 'utf8'));

if (target === 'firefox') {
  manifest.manifest_version = 2;
  manifest.browser_action = manifest.action;
  delete manifest.action;
  manifest.background.scripts = [manifest.background.service_worker];
  delete manifest.background.service_worker;
  delete manifest.background.type;
  manifest.permissions.push('webRequest');
  manifest.permissions.push('webRequestBlocking');
}

writeFileSync('dist/manifest.json', JSON.stringify(manifest, null, 2));
console.log(`Manifest patched for ${target}`);

// browser-extension/content.js
// 内容脚本：注入页面交互、高亮、快速笔记

class PageHighlighter {
  constructor() {
    this.selections = [];
    this.highlightClass = 'sb-highlight';
    this.injectStyles();
  }

  injectStyles() {
    if (document.getElementById('sb-styles')) return;
    const style = document.createElement('style');
    style.id = 'sb-styles';
    style.textContent = `
      .sb-highlight {
        background: linear-gradient(120deg, rgba(88, 166, 255, 0.3) 0%, rgba(88, 166, 255, 0.15) 100%);
        border-radius: 2px;
        padding: 0 2px;
      }
      .sb-quick-note {
        position: fixed;
        z-index: 999999;
        background: #21262d;
        border: 1px solid #30363d;
        border-radius: 12px;
        padding: 16px;
        width: 400px;
        max-width: 90vw;
        box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        font-family: system-ui, -apple-system, sans-serif;
        color: #c9d1d9;
      }
      .sb-note-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; font-weight: 600; }
      .sb-note-header .sb-close { background: none; border: none; color: #8b949e; font-size: 20px; cursor: pointer; }
      .sb-note-dialog textarea { width: 100%; height: 120px; background: #0d1117; border: 1px solid #30363d; border-radius: 8px; padding: 10px; color: #c9d1d9; resize: vertical; font-family: inherit; }
      .sb-note-actions { display: flex; gap: 8px; margin-top: 12px; }
      .sb-note-actions button { padding: 8px 16px; border-radius: 6px; border: none; cursor: pointer; font-size: 14px; }
      .sb-save { background: #238636; color: white; }
      .sb-capsule { background: #58a6ff; color: white; }
      .sb-cancel { background: #30363d; color: #8b949e; }
    `;
    document.head.appendChild(style);
  }

  highlight(selection, color = 'blue') {
    const range = selection.getRangeAt(0);
    const span = document.createElement('span');
    span.className = `${this.highlightClass} ${this.highlightClass}-${color}`;
    span.dataset.timestamp = Date.now();
    
    try {
      range.surroundContents(span);
      this.selections.push({
        text: selection.toString(),
        color,
        timestamp: Date.now(),
        url: window.location.href
      });
      return true;
    } catch (e) {
      // 跨元素选择时回退方案
      const fragment = range.extractContents();
      span.appendChild(fragment);
      range.insertNode(span);
      return true;
    }
  }
}

// 初始化
const highlighter = new PageHighlighter();

// 监听来自 background 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.type) {
    case 'EXTRACT_PAGE':
      sendResponse({
        title: document.title,
        url: window.location.href,
        content: document.body.innerText.substring(0, 5000)
      });
      break;

    case 'HIGHLIGHT_SELECTION':
      const sel = window.getSelection();
      const success = highlighter.highlight(sel, request.color);
      sendResponse({ success, selections: highlighter.selections });
      break;

    case 'GET_SELECTION':
      sendResponse({
        text: window.getSelection().toString(),
        context: window.getSelection().rangeCount > 0 
          ? window.getSelection().getRangeAt(0).commonAncestorContainer.textContent.substring(0, 200)
          : ''
      });
      break;

    case 'SHOW_QUICK_NOTE':
      showQuickNoteDialog(request.prefill);
      sendResponse({ shown: true });
      break;

    default:
      sendResponse({ error: 'Unknown message type' });
  }
  return true;
});

// 快捷键
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === 'S') {
    e.preventDefault();
    chrome.runtime.sendMessage({ type: 'CLIP_PAGE' });
  }
  if (e.ctrlKey && e.shiftKey && e.key === 'N') {
    e.preventDefault();
    showQuickNoteDialog(window.getSelection().toString());
  }
});

function showQuickNoteDialog(prefill = '') {
  const existing = document.getElementById('sb-quick-note');
  if (existing) existing.remove();

  const dialog = document.createElement('div');
  dialog.id = 'sb-quick-note';
  dialog.className = 'sb-quick-note';
  dialog.innerHTML = `
    <div class="sb-note-header">
      <span>📝 快速笔记</span>
      <button class="sb-close">×</button>
    </div>
    <textarea placeholder="记录你的想法...">${prefill ? `> ${prefill}\n\n` : ''}</textarea>
    <div class="sb-note-actions">
      <button class="sb-save">💾 保存</button>
      <button class="sb-capsule">⏳ 添加到胶囊</button>
      <button class="sb-cancel">取消</button>
    </div>
  `;

  // 居中定位
  dialog.style.top = '50%';
  dialog.style.left = '50%';
  dialog.style.transform = 'translate(-50%, -50%)';

  document.body.appendChild(dialog);

  const textarea = dialog.querySelector('textarea');
  textarea.focus();

  dialog.querySelector('.sb-close').onclick = () => dialog.remove();
  dialog.querySelector('.sb-cancel').onclick = () => dialog.remove();

  dialog.querySelector('.sb-save').onclick = async () => {
    const note = textarea.value.trim();
    if (!note) return;
    await chrome.runtime.sendMessage({
      type: 'QUICK_NOTE',
      note: { content: note, url: window.location.href, title: document.title, timestamp: new Date().toISOString() }
    });
    dialog.remove();
    showToast('✓ 笔记已保存');
  };

  dialog.querySelector('.sb-capsule').onclick = async () => {
    const note = textarea.value.trim();
    if (!note) return;
    await chrome.runtime.sendMessage({
      type: 'CREATE_CAPSULE',
      data: {
        content: { type: 'text', body: note, mood: { emotion: 'calm', intensity: 5, energyLevel: 5 } },
        unlock: { type: 'temporal', config: { date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() } }
      }
    });
    dialog.remove();
    showToast('✓ 已添加到时间胶囊');
  };
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; background: #238636; color: white;
    padding: 12px 20px; border-radius: 8px; z-index: 999999; font-family: system-ui;
    animation: fadeIn 0.3s ease;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 2000);
}

// popup.js 简化版
// 用于点击扩展图标时的弹出面板

document.addEventListener('DOMContentLoaded', async () => {
  const statusEl = document.getElementById('status');
  const statsEl = document.getElementById('stats');
  const actionsEl = document.getElementById('actions');

  // 获取状态
  const { status, stats } = await chrome.runtime.sendMessage({ type: 'GET_ATTENTION_STATUS' });

  if (status?.deepWorkSession) {
    statusEl.innerHTML = `
      <div class="flex items-center gap-2 text-green-400">
        <div class="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
        深度工作中: ${status.deepWorkSession.task}
      </div>
      <div class="mt-2 text-sm text-gray-400">
        已进行 ${Math.round((Date.now() - status.deepWorkSession.startedAt) / 60000)} 分钟
      </div>
    `;
  } else {
    statusEl.innerHTML = `<div class="text-gray-400">未在深度工作模式</div>`;
  }

  if (stats) {
    statsEl.innerHTML = `
      <div class="grid grid-cols-3 gap-2 text-center">
        <div class="bg-gray-800 rounded-lg p-2">
          <div class="text-lg font-bold text-blue-400">${stats.totalClipped || 0}</div>
          <div class="text-xs text-gray-500">剪藏</div>
        </div>
        <div class="bg-gray-800 rounded-lg p-2">
          <div class="text-lg font-bold text-green-400">${stats.totalNotes || 0}</div>
          <div class="text-xs text-gray-500">笔记</div>
        </div>
        <div class="bg-gray-800 rounded-lg p-2">
          <div class="text-lg font-bold text-purple-400">${Math.round((stats.deepWorkMinutes || 0) / 60 * 10) / 10}h</div>
          <div class="text-xs text-gray-500">深度工作</div>
        </div>
      </div>
    `;
  }

  // 快捷操作按钮
  actionsEl.innerHTML = `
    <button id="btn-focus" class="w-full py-2 bg-blue-600 rounded-lg text-white text-sm hover:bg-blue-500">
      🛡️ 启动深度工作
    </button>
    <button id="btn-clip" class="w-full py-2 bg-gray-700 rounded-lg text-white text-sm hover:bg-gray-600 mt-2">
      📥 剪藏当前页面
    </button>
    <button id="btn-note" class="w-full py-2 bg-gray-700 rounded-lg text-white text-sm hover:bg-gray-600 mt-2">
      📝 快速笔记
    </button>
  `;

  document.getElementById('btn-focus').onclick = () => {
    chrome.runtime.sendMessage({
      type: 'START_DEEP_WORK',
      config: { duration: 25, task: '专注任务' }
    });
    window.close();
  };

  document.getElementById('btn-clip').onclick = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.runtime.sendMessage({ type: 'CLIP_PAGE' }, () => window.close());
  };

  document.getElementById('btn-note').onclick = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      chrome.tabs.sendMessage(tab.id, { type: 'SHOW_QUICK_NOTE' });
      window.close();
    });
  };
});
