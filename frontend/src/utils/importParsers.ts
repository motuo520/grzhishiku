/**
 * Shared import parsers for bookmarks HTML, JSON and CSV.
 * Used by ClipperPage (local import) and BatchImportPage.
 */

export interface ImportItem {
  type: 'note' | 'clip';
  title: string;
  content?: string;
  url?: string;
  domain?: string;
  excerpt?: string;
  tags?: string[];
}

export function getDomainFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

export function parseBookmarksHtml(html: string): ImportItem[] {
  const items: ImportItem[] = [];
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const links = doc.querySelectorAll('a[href]');
    links.forEach((a) => {
      const url = a.getAttribute('href');
      if (!url || url.startsWith('javascript:') || url.startsWith('place:') || url.startsWith('data:')) return;
      const title = a.textContent?.trim() || url;
      items.push({
        type: 'clip',
        title,
        url,
        domain: getDomainFromUrl(url),
        excerpt: '',
      });
    });
  } catch {
    // parsing error: return empty
  }
  return items;
}

export function parseLocalJson(text: string, fileName?: string): ImportItem[] {
  const items: ImportItem[] = [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      parsed.forEach((item: any, idx: number) => {
        if (item.url) {
          items.push({
            type: 'clip',
            title: item.title || item.url || `剪藏 ${idx + 1}`,
            url: item.url,
            domain: item.domain || getDomainFromUrl(item.url),
            excerpt: item.excerpt || '',
            tags: Array.isArray(item.tags) ? item.tags : undefined,
          });
        } else {
          items.push({
            type: 'note',
            title: item.title || fileName || `笔记 ${idx + 1}`,
            content: item.content || item.body || item.text || JSON.stringify(item),
            tags: Array.isArray(item.tags) ? item.tags : undefined,
          });
        }
      });
    } else if (parsed.notes || parsed.clips) {
      (parsed.notes || []).forEach((n: any, idx: number) =>
        items.push({
          type: 'note',
          title: n.title || `笔记 ${idx + 1}`,
          content: n.content || '',
          tags: Array.isArray(n.tags) ? n.tags : undefined,
        })
      );
      (parsed.clips || []).forEach((c: any, idx: number) =>
        items.push({
          type: 'clip',
          title: c.title || `剪藏 ${idx + 1}`,
          url: c.url || '',
          domain: c.domain || getDomainFromUrl(c.url || ''),
          excerpt: c.excerpt || '',
          tags: Array.isArray(c.tags) ? c.tags : undefined,
        })
      );
    } else {
      items.push({
        type: 'note',
        title: fileName || '导入笔记',
        content: JSON.stringify(parsed, null, 2),
      });
    }
  } catch {
    // parsing error: return empty
  }
  return items;
}

export function parseLocalCsv(text: string): ImportItem[] {
  const items: ImportItem[] = [];
  try {
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return items;
    const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
    const titleIdx = header.indexOf('title');
    const contentIdx = header.indexOf('content');
    const urlIdx = header.indexOf('url');
    const domainIdx = header.indexOf('domain');
    const excerptIdx = header.indexOf('excerpt');
    const tagsIdx = header.indexOf('tags');

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      if (urlIdx >= 0 && cols[urlIdx]?.trim()) {
        const url = cols[urlIdx].trim();
        items.push({
          type: 'clip',
          title: titleIdx >= 0 ? cols[titleIdx]?.trim() || url : url,
          url,
          domain: domainIdx >= 0 ? cols[domainIdx]?.trim() : getDomainFromUrl(url),
          excerpt: excerptIdx >= 0 ? cols[excerptIdx]?.trim() : undefined,
          tags: tagsIdx >= 0 ? cols[tagsIdx]?.split(/[,，;；]/).map((t) => t.trim()).filter(Boolean) : undefined,
        });
      } else if (titleIdx >= 0 || contentIdx >= 0) {
        items.push({
          type: 'note',
          title: titleIdx >= 0 ? cols[titleIdx]?.trim() || `笔记 ${i}` : `笔记 ${i}`,
          content: contentIdx >= 0 ? cols[contentIdx]?.trim() || '' : '',
          tags: tagsIdx >= 0 ? cols[tagsIdx]?.split(/[,，;；]/).map((t) => t.trim()).filter(Boolean) : undefined,
        });
      }
    }
  } catch {
    // parsing error: return empty
  }
  return items;
}
