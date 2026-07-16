// browser-extension/modules/capsule-bridge.js
// 时间胶囊桥接模块：连接扩展与本地后端

export class CapsuleBridge {
  constructor(apiBase) {
    this.apiBase = apiBase;
  }

  // 快速添加选中内容到时间胶囊
  async quickAdd(tabId, selectionText) {
    const tab = await chrome.tabs.get(tabId);
    
    // 打开创建弹窗
    await chrome.windows.create({
      url: `${chrome.runtime.getURL('capsule-create.html')}?` +
           `content=${encodeURIComponent(selectionText)}&` +
           `url=${encodeURIComponent(tab.url)}&` +
           `title=${encodeURIComponent(tab.title)}`,
      type: 'popup',
      width: 600,
      height: 700
    });
  }

  // 创建胶囊
  async create(data) {
    const response = await fetch(`${this.apiBase}/capsules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (!response.ok) throw new Error('创建胶囊失败');
    return await response.json();
  }

  // 检查待解锁胶囊
  async checkUnlockedCapsules() {
    try {
      const response = await fetch(`${this.apiBase}/capsules?status=unlocked&limit=10`);
      if (!response.ok) return [];
      
      const data = await response.json();
      
      // 过滤出本次会话未通知过的
      const { notifiedCapsules = [] } = await chrome.storage.local.get('notifiedCapsules');
      const newUnlocked = data.capsules.filter(c => !notifiedCapsules.includes(c.id));
      
      // 记录已通知
      if (newUnlocked.length > 0) {
        await chrome.storage.local.set({
          notifiedCapsules: [...notifiedCapsules, ...newUnlocked.map(c => c.id)].slice(-100)
        });
      }
      
      return newUnlocked;
    } catch (err) {
      console.error('检查胶囊失败:', err);
      return [];
    }
  }

  // 获取胶囊列表
  async list(filter = {}) {
    const query = new URLSearchParams(filter);
    const response = await fetch(`${this.apiBase}/capsules?${query}`);
    return await response.json();
  }
}

// browser-extension/modules/sync.js
// 同步管理模块：离线队列、数据同步、验证队列

export class SyncManager {
  constructor(apiBase) {
    this.apiBase = apiBase;
  }

  // 搜索知识库
  async searchKnowledge(query) {
    const response = await fetch(`${this.apiBase}/knowledge?search=${encodeURIComponent(query)}`);
    return await response.json();
  }

  // 获取统计
  async getStats(period = 'today') {
    const response = await fetch(`${this.apiBase}/stats?period=${period}`);
    return await response.json();
  }

  // 处理验证队列
  async processVerificationQueue() {
    try {
      const response = await fetch(`${this.apiBase}/knowledge/batch-verify/progress`, {
        method: 'GET'
      });
      
      if (response.ok) {
        const progress = await response.json();
        
        if (progress.status === 'completed' && progress.results) {
          // 有完成的验证，通知用户
          const { confirmed = 0, disputed = 0, debunked = 0 } = progress.results;
          
          if (disputed > 0 || debunked > 0) {
            chrome.notifications.create({
              type: 'basic',
              iconUrl: 'icons/icon48.png',
              title: '🛡️ 知识验证完成',
              message: `已验证 ${confirmed} 条，${disputed} 条有争议，${debunked} 条已证伪`
            });
          }
        }
      }
    } catch (err) {
      console.error('验证队列检查失败:', err);
    }
  }

  // 全量同步（手动触发）
  async fullSync() {
    // 同步剪藏数据
    await this.syncClips();
    // 同步注意力数据
    await this.syncAttention();
    // 同步胶囊数据
    await this.syncCapsules();
  }

  async syncClips() {
    const { pendingClips = [] } = await chrome.storage.local.get('pendingClips');
    if (pendingClips.length === 0) return;

    try {
      const response = await fetch(`${this.apiBase}/knowledge/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: pendingClips })
      });

      if (response.ok) {
        await chrome.storage.local.set({ pendingClips: [] });
      }
    } catch (err) {
      console.error('剪藏同步失败:', err);
    }
  }

  async syncAttention() {
    // 由 AttentionTracker 内部处理
  }

  async syncCapsules() {
    // 由 CapsuleBridge 内部处理
  }
}

// browser-extension/modules/clipper.js 补充（已有基础，补充本地缓存）
export class Clipper {
  constructor(apiBase) {
    this.apiBase = apiBase;
  }

  async clipPage(tab) {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPageContent
    });

    const pageData = results[0].result;
    
    // 尝试在线保存，失败则本地缓存
    try {
      const response = await fetch(`${this.apiBase}/knowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: { raw: pageData.content, type: 'claim' },
          source: {
            url: pageData.url,
            title: pageData.title,
            type: 'web_page',
            author: pageData.author,
            publishDate: pageData.publishDate
          },
          tags: ['clipped', 'web', new URL(pageData.url).hostname.replace('www.', '')]
        })
      });

      if (!response.ok) throw new Error('Server error');
      
      const result = await response.json();
      await this.updateStats('totalClipped');
      return result;
    } catch (err) {
      // 离线缓存
      await this.cacheOffline('pendingClips', {
        type: 'clip',
        data: pageData,
        timestamp: Date.now()
      });
      throw new Error('已离线缓存，将在连接恢复后同步');
    }
  }

  async clipSelection(tabId, selectionText) {
    const context = await chrome.scripting.executeScript({
      target: { tabId },
      func: (text) => {
        const selection = window.getSelection();
        if (!selection.rangeCount) return null;
        const range = selection.getRangeAt(0);
        const fullText = range.commonAncestorContainer.textContent;
        const startPos = fullText.indexOf(text);
        return {
          selectedText: text,
          contextBefore: fullText.substring(Math.max(0, startPos - 100), startPos),
          contextAfter: fullText.substring(startPos + text.length, startPos + text.length + 100),
          url: window.location.href,
          title: document.title
        };
      },
      args: [selectionText]
    });

    const clipData = context[0].result;
    if (!clipData) throw new Error('无法获取选中内容');

    try {
      const response = await fetch(`${this.apiBase}/knowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: { raw: clipData.selectedText, type: 'claim' },
          source: { url: clipData.url, title: clipData.title, type: 'web_page' },
          metadata: { context: { before: clipData.contextBefore, after: clipData.contextAfter } },
          tags: ['clipped', 'selection']
        })
      });

      if (!response.ok) throw new Error('Server error');
      return await response.json();
    } catch (err) {
      await this.cacheOffline('pendingClips', {
        type: 'selection',
        data: clipData,
        timestamp: Date.now()
      });
      throw new Error('已离线缓存');
    }
  }

  async quickNote(note) {
    try {
      const response = await fetch(`${this.apiBase}/knowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: { raw: note.content, type: 'opinion' },
          source: { url: note.url, title: note.title, type: 'quick_note' },
          tags: ['quick-note']
        })
      });

      if (!response.ok) throw new Error('Server error');
      await this.updateStats('totalNotes');
      return await response.json();
    } catch (err) {
      await this.cacheOffline('pendingNotes', note);
      throw new Error('已离线缓存');
    }
  }

  async cacheOffline(key, data) {
    const { [key]: existing = [] } = await chrome.storage.local.get(key);
    existing.push(data);
    await chrome.storage.local.set({ [key]: existing.slice(-100) }); // 保留最近100条
  }

  async updateStats(field) {
    const { stats = {} } = await chrome.storage.local.get('stats');
    stats[field] = (stats[field] || 0) + 1;
    await chrome.storage.local.set({ stats });
  }
}

// 页面内容提取函数（在页面上下文中执行）
function extractPageContent() {
  let article = null;
  try {
    if (window.Readability) {
      article = new Readability(document.cloneNode(true)).parse();
    }
  } catch (e) {}

  const authorSelectors = [
    'meta[name="author"]', 'meta[property="article:author"]',
    '.author', '[rel="author"]', '.byline', '[class*="author"]'
  ];
  let author = null;
  for (const sel of authorSelectors) {
    const el = document.querySelector(sel);
    if (el) { author = el.content || el.textContent; break; }
  }

  const dateSelectors = [
    'meta[property="article:published_time"]', 'meta[name="publishedDate"]',
    'meta[name="date"]', 'time[datetime]', '[class*="date"]', '[class*="time"]'
  ];
  let publishDate = null;
  for (const sel of dateSelectors) {
    const el = document.querySelector(sel);
    if (el) { publishDate = el.content || el.dateTime || el.textContent; break; }
  }

  return {
    title: document.title,
    url: window.location.href,
    domain: window.location.hostname,
    author,
    publishDate,
    content: article ? article.textContent : document.body.innerText,
    excerpt: article?.excerpt || document.querySelector('meta[name="description"]')?.content || '',
    readingTime: Math.ceil((article?.textContent || document.body.innerText).split(/\s+/).length / 200),
    images: Array.from(document.querySelectorAll('img'))
      .filter(img => img.naturalWidth > 200 && img.naturalHeight > 200)
      .map(img => ({ src: img.src, alt: img.alt, width: img.naturalWidth, height: img.naturalHeight }))
      .slice(0, 5),
    tags: (document.querySelector('meta[name="keywords"]')?.content?.split(',') || [])
  };
}
