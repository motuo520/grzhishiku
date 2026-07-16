/**
 * Clipper Module - Extract and save web page content to PSB backend.
 */
import { createClip, saveLocalClip } from '../api-client.js';

class Clipper {
  async clipPage(tab) {
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: _extractPageContent,
      });

      const domain = _extractDomain(tab.url);
      const clip = {
        title: result.title || tab.title,
        url: tab.url,
        domain,
        excerpt: result.excerpt || result.textContent?.slice(0, 300) || '',
        full_text: result.textContent || '',
        brain_side: 'network',
        capture_method: 'browser_extension',
      };

      const saved = await createClip(clip);

      // Local cache as offline fallback
      await saveLocalClip({
        ...clip,
        id: saved.id,
        synced: true,
        synced_at: new Date().toISOString(),
      });

      return { success: true, clip: saved };
    } catch (error) {
      console.error('Clip page failed:', error);
      return { success: false, error: error.message };
    }
  }

  async clipSelection(tabId, selectedText) {
    if (!selectedText || selectedText.trim().length === 0) {
      return { success: false, error: 'No text selected' };
    }

    try {
      const tab = await chrome.tabs.get(tabId);
      const clip = {
        title: `Selected text from ${_extractDomain(tab.url)}`,
        url: tab.url,
        domain: _extractDomain(tab.url),
        excerpt: selectedText.slice(0, 300),
        full_text: selectedText,
        brain_side: 'network',
        capture_method: 'browser_extension_selection',
      };

      const saved = await createClip(clip);
      await saveLocalClip({
        ...clip,
        id: saved.id,
        synced: true,
        synced_at: new Date().toISOString(),
      });

      return { success: true, clip: saved };
    } catch (error) {
      console.error('Clip selection failed:', error);
      return { success: false, error: error.message };
    }
  }

  async quickNote(note) {
    try {
      const clip = {
        title: note.title || 'Quick Note',
        url: note.url || '',
        domain: note.url ? _extractDomain(note.url) : '',
        excerpt: note.text.slice(0, 300),
        full_text: note.text,
        brain_side: 'network',
        capture_method: 'manual_note',
      };

      const saved = await createClip(clip);
      await saveLocalClip({
        ...clip,
        id: saved.id,
        synced: true,
        synced_at: new Date().toISOString(),
      });

      return { success: true, clip: saved };
    } catch (error) {
      console.error('Quick note failed:', error);
      return { success: false, error: error.message };
    }
  }
}

function _extractPageContent() {
  // Simple extraction fallback (Readability can be swapped in later)
  const article = document.querySelector('article') || document.querySelector('main') || document.body;
  const title = document.title;
  const textContent = (article.innerText || article.textContent || '').trim();

  // Prefer meta description for excerpt
  const descMeta = document.querySelector('meta[name="description"]');
  const excerpt = descMeta ? descMeta.getAttribute('content') : textContent.slice(0, 300);

  return {
    title,
    textContent: textContent.slice(0, 10000),
    excerpt: excerpt ? excerpt.slice(0, 300) : '',
  };
}

function _extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

export default Clipper;
