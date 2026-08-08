import Clipper from './modules/clipper.js';

console.log('PSB Background Service Worker Started');

const clipper = new Clipper();

// Extension initialization
chrome.runtime.onInstalled.addListener((details) => {
  console.log('PSB Extension installed', details.reason);

  // Initialize storage only when keys are absent, so updates do not wipe local data.
  chrome.storage.local.get(
    {
      psb_initialized: null,
      attention_tracking: null,
      deep_work_active: null,
      clips: null,
      capsules: null,
    },
    (existing) => {
      const defaults = {};
      if (existing.psb_initialized === null) defaults.psb_initialized = true;
      if (existing.attention_tracking === null) defaults.attention_tracking = false;
      if (existing.deep_work_active === null) defaults.deep_work_active = false;
      if (existing.clips === null) defaults.clips = [];
      if (existing.capsules === null) defaults.capsules = [];

      if (Object.keys(defaults).length > 0) chrome.storage.local.set(defaults);
    }
  );

  // 右键菜单：整页剪藏 / 剪藏选中内容
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'psb-clip-page',
      title: '剪藏此页到钤记',
      contexts: ['page'],
    });
    chrome.contextMenus.create({
      id: 'psb-clip-selection',
      title: '剪藏选中内容到钤记',
      contexts: ['selection'],
    });
  });
});

// 右键菜单点击：复用 clipper，结果走系统通知反馈（右键没有 popup 承载反馈）
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === 'psb-clip-page') {
      const result = await clipper.clipPage(tab);
      if (result && result.success !== false) await bumpTodayClips();
      notify(result && result.success !== false ? '已剪藏此页' : `剪藏失败：${result?.error || '未知错误'}`);
    } else if (info.menuItemId === 'psb-clip-selection' && info.selectionText) {
      const result = await clipper.clipSelection(tab.id, info.selectionText);
      if (result && result.success !== false) await bumpTodayClips();
      notify(result && result.success !== false ? '已剪藏选中内容' : `剪藏失败：${result?.error || '未知错误'}`);
    }
  } catch (error) {
    notify(`剪藏失败：${error.message}`);
  }
});

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function ensureTodayStats() {
  const dateKey = todayKey();
  const existing = await chrome.storage.local.get(['stats_date', 'today_focus', 'today_clips']);

  if (existing.stats_date !== dateKey) {
    const fresh = { stats_date: dateKey, today_focus: 0, today_clips: 0 };
    await chrome.storage.local.set(fresh);
    return fresh;
  }

  return {
    stats_date: existing.stats_date,
    today_focus: existing.today_focus || 0,
    today_clips: existing.today_clips || 0,
  };
}

async function bumpTodayClips() {
  const stats = await ensureTodayStats();
  await chrome.storage.local.set({ today_clips: stats.today_clips + 1 });
}

function notify(message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: '钤记剪藏',
    message,
  });
}

// Message handling from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message);

  if (message.type === 'CLIP_PAGE') {
    handleClipPage(sender.tab, sendResponse);
    return true; // Async response
  }

  if (message.type === 'QUICK_NOTE') {
    handleQuickNote(message.data, sendResponse);
    return true;
  }

  if (message.type === 'START_DEEP_WORK') {
    startDeepWork(message.config, sendResponse);
    return true;
  }

  if (message.type === 'END_DEEP_WORK') {
    endDeepWork(sendResponse);
    return true;
  }

  sendResponse({ success: false, error: 'Unknown message type' });
});

async function handleClipPage(tab, sendResponse) {
  try {
    const result = await clipper.clipPage(tab);
    if (result && result.success !== false) await bumpTodayClips();
    sendResponse(result);
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleQuickNote(data, sendResponse) {
  try {
    const result = await clipper.quickNote(data);
    if (result && result.success !== false) await bumpTodayClips();
    sendResponse(result);
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function startDeepWork(config, sendResponse) {
  try {
    console.log('Starting deep work:', config);
    await chrome.storage.local.set({
      deep_work_active: true,
      deep_work_config: config,
      deep_work_started: Date.now(),
    });
    sendResponse({ success: true, status: 'started' });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function endDeepWork(sendResponse) {
  try {
    console.log('Ending deep work');
    const [stored, stats] = await Promise.all([
      chrome.storage.local.get(['deep_work_started']),
      ensureTodayStats(),
    ]);

    let focusMinutes = 0;
    if (typeof stored.deep_work_started === 'number') {
      focusMinutes = Math.max(0, Math.round((Date.now() - stored.deep_work_started) / 60000));
    }

    await chrome.storage.local.set({
      deep_work_active: false,
      deep_work_config: null,
      deep_work_started: null,
      today_focus: stats.today_focus + focusMinutes,
    });

    sendResponse({ success: true, status: 'ended' });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}
