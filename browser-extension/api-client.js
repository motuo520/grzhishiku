/**
 * PSB Browser Extension API Client
 *
 * Provides backend communication for the browser extension.
 * Defaults to http://localhost:8002 (project dev backend).
 * Token priority:
 *   1. Token passed explicitly to createClip
 *   2. Token stored in extension options (api_token)
 */

const DEFAULT_API_BASE = 'http://localhost:8002';

export async function getApiBase() {
  const stored = await chrome.storage.local.get('api_url');
  return stored.api_url || DEFAULT_API_BASE;
}

export async function getToken() {
  const stored = await chrome.storage.local.get('api_token');
  return stored.api_token || '';
}

export async function createClip(clipData, token, apiBase) {
  const base = apiBase || (await getApiBase());
  const authToken = token || (await getToken());

  if (!authToken) {
    throw new Error('未登录：未找到 access_token，请先登录 PSB 网页版或在扩展选项中填写 Token');
  }

  const payload = {
    title: clipData.title || clipData.url,
    url: clipData.url,
    domain: clipData.domain || _extractDomain(clipData.url),
    excerpt: clipData.excerpt || null,
    full_text: clipData.full_text || null,
    brain_side: clipData.brain_side || 'network',
    tags: clipData.tags || undefined,
  };

  const response = await fetch(`${base}/api/v1/clips/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const data = await response.json();
      detail = data.detail || data.message || JSON.stringify(data);
    } catch {
      // ignore
    }
    throw new Error(detail);
  }

  return response.json();
}

function _extractDomain(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

export async function saveLocalClip(clip) {
  const stored = await chrome.storage.local.get('clips');
  const clips = stored.clips || [];
  clips.unshift(clip);
  await chrome.storage.local.set({ clips: clips.slice(0, 1000) });
}
