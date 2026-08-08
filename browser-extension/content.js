console.log('PSB Content Script Loaded');

// Text highlighting and quick note
let highlightOverlay = null;

function initContentScript() {
  document.addEventListener('keydown', handleKeyDown);
  document.addEventListener('mouseup', handleTextSelection);

  // Listen for messages from popup/background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_TOKEN') {
      const token = localStorage.getItem('access_token') || '';
      sendResponse({ token });
      return true;
    }
    return false;
  });
}

function handleKeyDown(e) {
  // Ctrl+Shift+S: Quick save selected text
  if (e.ctrlKey && e.shiftKey && e.key === 'S') {
    const selectedText = window.getSelection().toString();
    if (selectedText) {
      saveQuickNote(selectedText);
    }
  }

  // Ctrl+Shift+N: New capsule
  if (e.ctrlKey && e.shiftKey && e.key === 'N') {
    const selectedText = window.getSelection().toString();
    showQuickNoteDialog(selectedText);
  }
}

function handleTextSelection() {
  const selection = window.getSelection();
  if (selection.toString().length > 0) {
    showHighlightTooltip(selection);
  } else {
    hideHighlightTooltip();
  }
}

function showHighlightTooltip(selection) {
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();

  if (!highlightOverlay) {
    highlightOverlay = document.createElement('div');
    highlightOverlay.id = 'psb-highlight-overlay';
    highlightOverlay.style.cssText = `
      position: fixed;
      z-index: 999999;
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 8px 12px;
      display: flex;
      gap: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
    `;
    document.body.appendChild(highlightOverlay);
  }

  highlightOverlay.innerHTML = `
    <button id="psb-save-clip" style="background:#58a6ff;color:#fff;border:none;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:12px;">保存</button>
    <button id="psb-create-capsule" style="background:#d29922;color:#fff;border:none;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:12px;">胶囊</button>
  `;

  // position:fixed 使用 client 坐标，不应叠加 scrollX/scrollY
  highlightOverlay.style.left = `${rect.left}px`;
  highlightOverlay.style.top = `${rect.top - 40}px`;

  // 在注入容器内查询控件，避免宿主页面预置同 ID 元素造成 DOM clobbering
  highlightOverlay.querySelector('#psb-save-clip')?.addEventListener('click', () => {
    saveQuickNote(selection.toString());
    hideHighlightTooltip();
  });

  highlightOverlay.querySelector('#psb-create-capsule')?.addEventListener('click', () => {
    showQuickNoteDialog(selection.toString());
    hideHighlightTooltip();
  });
}

function hideHighlightTooltip() {
  if (highlightOverlay) {
    highlightOverlay.remove();
    highlightOverlay = null;
  }
}

function saveQuickNote(text) {
  chrome.runtime.sendMessage({
    type: 'QUICK_NOTE',
    data: {
      text,
      url: window.location.href,
      title: document.title,
    },
  }, (response) => {
    if (response?.success) {
      showToast('已保存到第二大脑');
    } else {
      showToast('保存失败：' + (response?.error || '请检查登录状态'));
    }
  });
}

function showQuickNoteDialog(text) {
  const dialog = document.createElement('div');
  dialog.id = 'psb-quick-note-dialog';
  dialog.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 999999;
    background: #0d1117;
    border: 1px solid #30363d;
    border-radius: 12px;
    padding: 24px;
    width: 400px;
    max-width: 90vw;
    box-shadow: 0 8px 32px rgba(0,0,0,0.8);
  `;

  dialog.innerHTML = `
    <h3 style="color:#c9d1d9;margin:0 0 16px 0;font-size:16px;">快速创建胶囊</h3>
    <textarea id="psb-note-text" style="width:100%;height:120px;background:#21262d;border:1px solid #30363d;border-radius:8px;color:#c9d1d9;padding:12px;resize:none;box-sizing:border-box;">${escapeHtml(text)}</textarea>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">
      <button id="psb-cancel" style="background:#21262d;color:#8b949e;border:1px solid #30363d;padding:8px 16px;border-radius:6px;cursor:pointer;">取消</button>
      <button id="psb-save" style="background:#58a6ff;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;">保存</button>
    </div>
  `;

  document.body.appendChild(dialog);

  dialog.querySelector('#psb-cancel')?.addEventListener('click', () => {
    dialog.remove();
  });

  dialog.querySelector('#psb-save')?.addEventListener('click', () => {
    const noteText = dialog.querySelector('#psb-note-text')?.value || '';
    saveQuickNote(noteText);
    dialog.remove();
  });
}

function showToast(message) {
  let toast = document.getElementById('psb-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'psb-toast';
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 999999;
      background: #0d1117;
      color: #c9d1d9;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 12px 16px;
      font-size: 13px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
      transition: opacity 0.3s;
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.opacity = '1';
  setTimeout(() => {
    toast.style.opacity = '0';
  }, 3000);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Initialize
initContentScript();
