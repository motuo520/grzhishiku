class CapsuleBridge {
  constructor() {
    this.apiUrl = null;
    this.apiToken = null;
    this.loadConfig();
  }

  async loadConfig() {
    const stored = await chrome.storage.local.get(['api_url', 'api_token']);
    this.apiUrl = stored.api_url || 'http://localhost:8000';
    this.apiToken = stored.api_token || '';
  }

  async quickAdd(tabId, text) {
    const clip = {
      id: Date.now().toString(),
      content_type: 'text',
      content_body: text,
      source_url: tabId,
      created_at: new Date().toISOString(),
    };

    await this._saveCapsule(clip);

    try {
      await this._syncCapsule(clip);
    } catch (error) {
      console.error('Sync capsule failed:', error);
    }

    return { success: true, clip };
  }

  async create(data) {
    const capsule = {
      id: Date.now().toString(),
      content_type: data.content_type || 'text',
      content_body: data.content_body || data.text || '',
      mood_emotion: data.mood || '',
      unlock_type: data.unlock_type || 'temporal',
      unlock_config: JSON.stringify(data.unlock_config || { unlock_date: null }),
      privacy_require_auth: false,
      privacy_allow_export: true,
      created_at: new Date().toISOString(),
    };

    await this._saveCapsule(capsule);

    try {
      await this._syncCapsule(capsule);
    } catch (error) {
      console.error('Sync capsule failed:', error);
    }

    return { success: true, capsule };
  }

  async checkUnlockedCapsules() {
    const stored = await chrome.storage.local.get('capsules');
    const capsules = stored.capsules || [];
    const now = new Date().toISOString();

    const unlocked = capsules.filter((c) => {
      if (c.unlock_status !== 'locked') return false;
      try {
        const config = JSON.parse(c.unlock_config || '{}');
        if (config.unlock_date && now >= config.unlock_date) return true;
      } catch {
        return false;
      }
      return false;
    });

    if (unlocked.length > 0) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: '时间胶囊已解锁',
        message: `${unlocked.length} 个时间胶囊已到达解锁时间`,
        priority: 1,
      });
    }

    return unlocked;
  }

  async _saveCapsule(capsule) {
    const stored = await chrome.storage.local.get('capsules');
    const capsules = stored.capsules || [];
    capsules.unshift(capsule);
    await chrome.storage.local.set({ capsules: capsules.slice(0, 500) });
  }

  async _syncCapsule(capsule) {
    if (!this.apiToken) return;

    const response = await fetch(`${this.apiUrl}/api/v1/capsules`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiToken}`,
      },
      body: JSON.stringify(capsule),
    });

    if (!response.ok) throw new Error('Sync failed');
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CapsuleBridge;
}
