import api from './client';

export interface RssFeed {
  id: string;
  user_id: string;
  title?: string;
  url: string;
  description?: string;
  site_url?: string;
  fetch_status: string;
  fetch_error?: string;
  last_fetched_at?: string;
  status: string;
  created_at: string;
  updated_at: string;
  unread_count?: number;
}

export interface RssEntry {
  id: string;
  feed_id: string;
  title?: string;
  link: string;
  summary?: string;
  author?: string;
  published_at?: string;
  is_read: boolean;
  is_saved: boolean;
  external_id?: string;
  created_at: string;
}

export interface FeedCreateData {
  url: string;
  title?: string;
}

export interface FeedUpdateData {
  title?: string;
  status?: 'active' | 'paused' | 'deleted';
}

export interface AutoFetchConfig {
  feed_id: string;
  enabled: boolean;
  interval_minutes: number;
  last_fetched_at?: string | null;
  next_due_at?: string | null;
}

export const rssApi = {
  listFeeds: () => api.get<RssFeed[]>('/api/v1/rss/sources'),
  createFeed: (data: FeedCreateData) => api.post<RssFeed>('/api/v1/rss/sources', data),
  updateFeed: (id: string, data: FeedUpdateData) => api.put<RssFeed>(`/api/v1/rss/sources/${id}`, data),
  deleteFeed: (id: string) => api.delete(`/api/v1/rss/sources/${id}`),
  fetchFeed: (id: string) => api.post<{ success: boolean; added: number; total_parsed: number }>(`/api/v1/rss/sources/${id}/fetch`),
  getAutoFetch: (id: string) => api.get<AutoFetchConfig>(`/api/v1/rss/sources/${id}/auto-fetch`),
  setAutoFetch: (id: string, data: { enabled: boolean; interval_minutes: number }) =>
    api.put<AutoFetchConfig>(`/api/v1/rss/sources/${id}/auto-fetch`, data),
  listEntries: (feedId: string, params?: { unread_only?: boolean; saved_only?: boolean; limit?: number }) =>
    api.get<RssEntry[]>(`/api/v1/rss/sources/${feedId}/entries`, { params }),
  markRead: (entryId: string) => api.post<RssEntry>(`/api/v1/rss/entries/${entryId}/read`),
  saveEntry: (entryId: string, asClip?: boolean) =>
    api.post(`/api/v1/rss/entries/${entryId}/save`, { as_clip: asClip ?? true }),
  deleteEntry: (entryId: string) => api.delete(`/api/v1/rss/entries/${entryId}`),
  batchDeleteEntries: (ids: string[]) => api.request({ method: 'DELETE', url: '/api/v1/rss/entries/batch', data: { ids } }),
};

