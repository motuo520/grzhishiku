async endCurrentActivity(reason = 'completed') {
    if (!this.currentActivity) return;
    
    const endTime = Date.now();
    const duration = Math.round((endTime - this.currentActivity.startTime) / 1000 / 60);
    
    const activity = {
      ...this.currentActivity,
      endTime,
      actualDuration: duration,
      completionStatus: reason
    };
    
    // 计算专注评分
    const focusScore = this.calculateFocusScore(activity);
    activity.focusScore = focusScore;
    
    this.activities.push(activity);
    this.currentActivity = null;
    
    // 存储到本地缓存
    await this.queueForSync(activity);
    
    return activity;
  }
  
  calculateFocusScore(activity) {
    const durationScore = Math.min(activity.actualDuration / 25, 1) * 25;
    const interruptionScore = Math.max(0, 100 - this.distractions.length * 10);
    const switchingScore = this.lastTab === activity.url ? 100 : 85;
    
    return Math.round((durationScore + interruptionScore + switchingScore) / 3);
  }
  
  async startDeepWork(config) {
    const rules = config.rules || {
      blockNotifications: true,
      blockedApps: [],
      blockedWebsites: ['twitter.com', 'reddit.com', 'youtube.com', 'bilibili.com'],
      allowedWebsites: ['github.com', 'stackoverflow.com', 'docs.python.org', 'developer.mozilla.org'],
      ambientSound: null,
      breakInterval: 25,
      breakDuration: 5
    };
    
    // 启用网络请求拦截
    if (rules.blockedWebsites?.length > 0) {
      await this.enableBlocking(rules.blockedWebsites);
    }
    
    // 屏蔽通知
    if (rules.blockNotifications) {
      await chrome.contentSettings.notifications.set({
        primaryPattern: '<all_urls>',
        setting: 'block'
      });
    }
    
    this.deepWorkSession = {
      id: `dw_${Date.now()}`,
      task: config.task,
      plannedDuration: config.duration,
      startedAt: Date.now(),
      interruptions: 0,
      blockedAttempts: 0,
      rules
    };
    
    // 启动定时检查
    this.focusCheckInterval = setInterval(() => {
      this.checkFocusStatus();
    }, 10000);
    
    // 记录活动
    await this.recordActivity({
      type: 'deep_work',
      url: 'local://deep-work',
      title: `深度工作: ${config.task}`,
      category: 'deep_work'
    });
    
    return this.deepWorkSession;
  }
  
  async endDeepWork(reason) {
    if (!this.deepWorkSession) return null;
    
    clearInterval(this.focusCheckInterval);
    
    const session = {
      ...this.deepWorkSession,
      endedAt: Date.now(),
      actualDuration: Math.round((Date.now() - this.deepWorkSession.startedAt) / 1000 / 60),
      endReason: reason
    };
    
    // 清除拦截规则
    await this.disableBlocking();
    
    // 恢复通知
    await chrome.contentSettings.notifications.set({
      primaryPattern: '<all_urls>',
      setting: 'ask'
    });
    
    // 结束当前活动
    await this.endCurrentActivity(reason === 'completed' ? 'completed' : 'interrupted');
    
    // 存储会话
    await this.storeSession(session);
    
    this.deepWorkSession = null;
    return session;
  }
  
  async enableBlocking(domains) {
    const rules = domains.map((domain, index) => ({
      id: index + 1,
      priority: 1,
      action: { type: 'block' },
      condition: {
        urlFilter: `||${domain}`,
        resourceTypes: ['main_frame']
      }
    }));
    
    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: rules,
      removeRuleIds: []
    });
  }
  
  async disableBlocking() {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: [],
      removeRuleIds: existing.map(r => r.id)
    });
  }
  
  async checkFocusStatus() {
    if (!this.deepWorkSession) return;
    
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const currentUrl = tabs[0]?.url;
    
    if (!currentUrl) return;
    
    const isBlocked = this.deepWorkSession.rules.blockedWebsites.some(d => 
      currentUrl.includes(d)
    );
    
    if (isBlocked) {
      this.deepWorkSession.blockedAttempts++;
      
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: '🔒 深度工作守护',
        message: '检测到非工作网站访问，已拦截。坚持就是胜利！'
      });
    }
  }
  
  async getStatus() {
    return {
      currentActivity: this.currentActivity,
      deepWorkSession: this.deepWorkSession,
      todayStats: await this.getTodayStats(),
      streak: this.calculateStreak()
    };
  }
  
  async getTodayStats() {
    const today = new Date().toDateString();
    const activities = this.activities.filter(a => 
      new Date(a.startTime).toDateString() === today
    );
    
    const byCategory = {};
    let totalFocus = 0;
    
    activities.forEach(a => {
      byCategory[a.category] = (byCategory[a.category] || 0) + (a.actualDuration || 0);
      if (a.focusScore) totalFocus += a.focusScore;
    });
    
    return {
      totalActivities: activities.length,
      totalMinutes: activities.reduce((s, a) => s + (a.actualDuration || 0), 0),
      averageFocus: activities.length > 0 ? Math.round(totalFocus / activities.length) : 0,
      byCategory
    };
  }
  
  calculateStreak() {
    // 简化版：返回连续专注次数
    return this.activities.filter(a => a.focusScore > 70).length;
  }
  
  async analyzePatterns() {
    const activities = await this.getRecentActivities(30);
    
    const patterns = [];
    
    // 检测午后低谷
    const afternoonActivities = activities.filter(a => {
      const hour = new Date(a.startTime).getHours();
      return hour >= 14 && hour <= 16;
    });
    
    const avgAfternoonFocus = afternoonActivities.reduce((s, a) => s + (a.focusScore || 0), 0) / 
      (afternoonActivities.length || 1);
    
    if (avgAfternoonFocus < 50 && afternoonActivities.length > 5) {
      patterns.push({
        name: 'afternoon_slump',
        description: '下午 2-4 点注意力明显下降，建议安排低强度任务或休息',
        confidence: 0.8,
        severity: 'warning'
      });
    }
    
    // 检测频繁切换
    if (this.distractions.length > 10) {
      patterns.push({
        name: 'high_switching',
        description: '今日切换频率较高，建议启用深度工作守护',
        confidence: 0.9,
        severity: 'warning'
      });
    }
    
    return { patterns, importantFindings: patterns };
  }
  
  async getRecentActivities(days) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return this.activities.filter(a => a.startTime > cutoff);
  }
  
  async queueForSync(activity) {
    const { pendingActivities = [] } = await chrome.storage.local.get('pendingActivities');
    pendingActivities.push(activity);
    await chrome.storage.local.set({ pendingActivities });
  }
  
  async sync() {
    const { pendingActivities = [] } = await chrome.storage.local.get('pendingActivities');
    if (pendingActivities.length === 0) return;
    
    try {
      const response = await fetch(`${this.apiBase}/attention/activities/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activities: pendingActivities })
      });
      
      if (response.ok) {
        await chrome.storage.local.set({ pendingActivities: [] });
      }
    } catch (err) {
      console.error('Sync failed:', err);
    }
  }
  
  async storeSession(session) {
    const { sessions = [] } = await chrome.storage.local.get('deepWorkSessions');
    sessions.push(session);
    await chrome.storage.local.set({ deepWorkSessions: sessions.slice(-50) });
  }
}
