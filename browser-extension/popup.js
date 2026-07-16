import Clipper from './modules/clipper.js';

const clipper = new Clipper();

async function tryFetchPageToken() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) {
      return null;
    }
    const result = await chrome.tabs.sendMessage(tab.id, { type: 'GET_TOKEN' });
    if (result?.token) {
      await chrome.storage.local.set({ api_token: result.token });
      return result.token;
    }
  } catch {
    // content script may not be injected on this page
  }
  return null;
}

document.addEventListener('DOMContentLoaded', () => {
  const startDeepWorkBtn = document.getElementById('start-deep-work');
  const clipCurrentBtn = document.getElementById('clip-current');

  // Try to auto-pick token from the current PSB tab
  tryFetchPageToken().catch(() => {});

  startDeepWorkBtn?.addEventListener('click', async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'START_DEEP_WORK',
        config: { duration: 25, task: 'Focused work' },
      });
      console.log('Deep work started:', response);
      startDeepWorkBtn.textContent = '深度工作中...';
      startDeepWorkBtn.style.background = '#238636';
    } catch (error) {
      console.error('Failed to start deep work:', error);
    }
  });

  clipCurrentBtn?.addEventListener('click', async () => {
    if (!clipCurrentBtn) return;
    const originalText = clipCurrentBtn.textContent;
    clipCurrentBtn.textContent = '剪藏中...';
    clipCurrentBtn.disabled = true;

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const result = await clipper.clipPage(tab);

      if (result.success) {
        clipCurrentBtn.textContent = '已剪藏!';
        clipCurrentBtn.style.background = '#238636';
      } else {
        clipCurrentBtn.textContent = '剪藏失败';
        clipCurrentBtn.title = result.error || '未知错误';
      }
    } catch (error) {
      console.error('Failed to clip page:', error);
      clipCurrentBtn.textContent = '剪藏失败';
      clipCurrentBtn.title = error.message || '未知错误';
    }

    setTimeout(() => {
      clipCurrentBtn.textContent = originalText;
      clipCurrentBtn.style.background = '';
      clipCurrentBtn.disabled = false;
      clipCurrentBtn.title = '';
    }, 2000);
  });

  // Load stats from storage
  chrome.storage.local.get(['today_focus', 'today_clips'], (result) => {
    if (result.today_focus) {
      document.getElementById('today-focus').textContent = result.today_focus;
    }
    if (result.today_clips) {
      document.getElementById('today-clips').textContent = result.today_clips;
    }
  });
});
