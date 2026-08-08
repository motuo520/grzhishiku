class SyncManager {
  constructor() {
    this.apiUrl = null;
    this.apiToken = null;
    this.syncInterval = 5 * 60 * 1000; // 5 minutes
    this.syncTimer = null;
    this.loadConfig();
  }

  async loadConfig() {
    const stored = await chrome.storage.local.get(['api_url', 'api_token', 'sync_interval']);
    this.apiUrl = stored.api_url || 'http://localhost:8000';
    this.apiToken = stored.api_token || '';
    this.syncInterval = (stored.sync_interval || 5) * 60 * 1000;
  }

  async searchKnowledge(query) {
    if (!this.apiToken) return { results: [] };

    try {
      const response = await fetch(`${this.apiUrl}/api/v1/brain/fusion-search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiToken}`,
        },
        body: JSON.stringify({ query, limit: 10 }),
      });

      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      console.error('Search knowledge failed:', error);
    }

    return { results: [] };
  }

  async processVerificationQueue() {
    const stored = await chrome.storage.local.get('verification_queue');
    const queue = stored.verification_queue || [];

    if (queue.length === 0) return;

    for (const item of queue.slice(0, 5)) {
      try {
        const response = await fetch(`${this.apiUrl}/api/v1/knowledge/${item.id}/verify`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiToken}`,
          },
        });

        if (response.ok) {
          item.status = 'processing';
        }
      } catch (error) {
        console.error('Verification failed:', error);
      }
    }

    await chrome.storage.local.set({ verification_queue: queue.filter((q) => q.status !== 'completed') });
  }

  async fullSync() {
    if (!this.apiToken) return { success: false, error: 'No API token' };

    const results = {
      clips: 0,
      capsules: 0,
      errors: [],
    };

    try {
      // Sync clips
      const clipStored = await chrome.storage.local.get('clips');
      const clips = clipStored.clips || [];
      const unsyncedClips = clips.filter((c) => !c.synced);

      for (const clip of unsyncedClips) {
        try {
          const response = await fetch(`${this.apiUrl}/api/v1/knowledge`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${this.apiToken}`,
            },
            body: JSON.stringify({
              content_raw: clip.full_text,
              source_url: clip.url,
              source_title: clip.title,
            }),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          clip.synced = true;
          results.clips++;
        } catch (error) {
          results.errors.push(`Clip ${clip.id}: ${error.message}`);
        }
      }

      await chrome.storage.local.set({ clips });

      // Sync capsules
      const capsuleStored = await chrome.storage.local.get('capsules');
      const capsules = capsuleStored.capsules || [];
      const unsyncedCapsules = capsules.filter((c) => !c.synced);

      for (const capsule of unsyncedCapsules) {
        try {
          const response = await fetch(`${this.apiUrl}/api/v1/capsules`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${this.apiToken}`,
            },
            body: JSON.stringify(capsule),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          capsule.synced = true;
          results.capsules++;
        } catch (error) {
          results.errors.push(`Capsule ${capsule.id}: ${error.message}`);
        }
      }

      await chrome.storage.local.set({ capsules });

      return { success: true, results };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  startAutoSync() {
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.syncTimer = setInterval(() => this.fullSync(), this.syncInterval);
  }

  stopAutoSync() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SyncManager;
}
