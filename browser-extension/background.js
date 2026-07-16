import Clipper from './modules/clipper.js';

console.log('PSB Background Service Worker Started');

const clipper = new Clipper();

// Extension initialization
chrome.runtime.onInstalled.addListener((details) => {
  console.log('PSB Extension installed', details.reason);

  // Initialize storage
  chrome.storage.local.set({
    psb_initialized: true,
    attention_tracking: false,
    deep_work_active: false,
    clips: [],
    capsules: [],
  });
});

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
    sendResponse(result);
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleQuickNote(data, sendResponse) {
  try {
    const result = await clipper.quickNote(data);
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
    await chrome.storage.local.set({
      deep_work_active: false,
      deep_work_config: null,
    });
    sendResponse({ success: true, status: 'ended' });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}
