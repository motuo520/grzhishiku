import { FC, useState, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bookmark, Upload, Link2, Trash2, Check, Loader2, AlertCircle,
  Globe, Folder, ArrowLeft, Import, ExternalLink, Search,
  Filter, Edit2, CheckCircle2, Copy, FolderTree, Tag
} from 'lucide-react';
import { useClips } from '@/hooks/useClips';

interface BookmarkItem {
  id: string;
  title: string;
  url: string;
  domain: string;
  folder?: string;
  selected: boolean;
  isDuplicate?: boolean;
}

const BookmarksPage: FC = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ success: number; failed: number } | null>(null);

  // Filters & search
  const [searchQuery, setSearchQuery] = useState('');
  const [folderFilter, setFolderFilter] = useState<string>('__all__');
  const [showDuplicatesOnly, setShowDuplicatesOnly] = useState(false);

  // Inline editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editUrl, setEditUrl] = useState('');

  // Tags to attach on import
  const [globalTags, setGlobalTags] = useState('');

  const { batchCreateClips } = useClips();

  const generateId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const getDomainFromUrl = (url: string): string => {
    try {
      const u = new URL(url);
      return u.hostname.replace(/^www\./, '');
    } catch {
      return 'unknown';
    }
  };

  const parseBookmarksHtml = useCallback((html: string): BookmarkItem[] => {
    const items: BookmarkItem[] = [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const walk = (element: Element, folderStack: string[] = []) => {
      for (const child of Array.from(element.children)) {
        if (child.tagName === 'DT') {
          const h3 = child.querySelector(':scope > h3');
          const a = child.querySelector(':scope > a[href]');
          const dl = child.querySelector(':scope > dl');

          if (h3) {
            folderStack.push(h3.textContent?.trim() || '');
            if (dl) walk(dl, folderStack);
            folderStack.pop();
          } else if (a) {
            const url = a.getAttribute('href') || '';
            if (
              url &&
              !url.startsWith('javascript:') &&
              !url.startsWith('place:') &&
              !url.startsWith('data:')
            ) {
              items.push({
                id: generateId(),
                title: a.textContent?.trim() || url,
                url,
                domain: getDomainFromUrl(url),
                folder: folderStack.filter(Boolean).join(' / ') || undefined,
                selected: true,
              });
            }
          } else if (dl) {
            walk(dl, folderStack);
          }
        } else if (child.tagName === 'DL') {
          walk(child, folderStack);
        }
      }
    };

    const rootDl = doc.querySelector('dl');
    if (rootDl) walk(rootDl);

    // Fallback: flat list of all links if no nested structure found
    if (items.length === 0) {
      doc.querySelectorAll('a[href]').forEach((a) => {
        const url = a.getAttribute('href') || '';
        if (
          url &&
          !url.startsWith('javascript:') &&
          !url.startsWith('place:') &&
          !url.startsWith('data:')
        ) {
          items.push({
            id: generateId(),
            title: a.textContent?.trim() || url,
            url,
            domain: getDomainFromUrl(url),
            selected: true,
          });
        }
      });
    }

    return items;
  }, []);

  const detectDuplicates = (items: BookmarkItem[]): BookmarkItem[] => {
    const seen = new Map<string, number>();
    items.forEach((item) => {
      seen.set(item.url, (seen.get(item.url) || 0) + 1);
    });
    return items.map((item) => ({
      ...item,
      isDuplicate: (seen.get(item.url) || 0) > 1,
    }));
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setIsParsing(true);
    setError(null);
    setResult(null);
    try {
      const allParsed: BookmarkItem[] = [];
      for (const file of files) {
        const text = await file.text();
        const parsed = parseBookmarksHtml(text);
        allParsed.push(...parsed);
      }
      if (allParsed.length === 0) {
        setError('未解析到书签，请确认上传的是浏览器导出的 HTML 书签文件');
      } else {
        setBookmarks((prev) => detectDuplicates([...prev, ...allParsed]));
      }
    } catch (e: any) {
      setError('解析失败：' + (e.message || '文件格式错误'));
    } finally {
      setIsParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const toggleSelection = (id: string) => {
    setBookmarks((prev) =>
      prev.map((b) => (b.id === id ? { ...b, selected: !b.selected } : b))
    );
  };

  const toggleAll = () => {
    const allSelected = visibleBookmarks.every((b) => b.selected);
    const visibleIds = new Set(visibleBookmarks.map((b) => b.id));
    setBookmarks((prev) =>
      prev.map((b) => (visibleIds.has(b.id) ? { ...b, selected: !allSelected } : b))
    );
  };

  const removeItem = (id: string) => {
    setBookmarks((prev) => prev.filter((b) => b.id !== id));
  };

  const batchDeleteSelected = () => {
    setBookmarks((prev) => prev.filter((b) => !b.selected));
  };

  const clearAll = () => {
    setBookmarks([]);
    setResult(null);
    setError(null);
    setSearchQuery('');
    setFolderFilter('__all__');
  };

  const startEdit = (b: BookmarkItem) => {
    setEditingId(b.id);
    setEditTitle(b.title);
    setEditUrl(b.url);
  };

  const saveEdit = () => {
    if (!editingId) return;
    setBookmarks((prev) =>
      prev.map((b) =>
        b.id === editingId
          ? { ...b, title: editTitle.trim() || b.title, url: editUrl.trim() || b.url, domain: getDomainFromUrl(editUrl.trim() || b.url) }
          : b
      )
    );
    setEditingId(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditTitle('');
    setEditUrl('');
  };

  const deduplicate = () => {
    const seen = new Set<string>();
    setBookmarks((prev) =>
      prev.filter((b) => {
        if (seen.has(b.url)) return false;
        seen.add(b.url);
        return true;
      })
    );
  };

  const openUrl = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const openSelected = () => {
    const selected = bookmarks.filter((b) => b.selected);
    // Open max 10 at a time to avoid popup blockers
    selected.slice(0, 10).forEach((b) => openUrl(b.url));
    if (selected.length > 10) {
      setError('一次最多打开 10 个页面，已打开前 10 个');
    }
  };

  // Folder list
  const folders = useMemo(() => {
    const set = new Set<string>();
    bookmarks.forEach((b) => {
      if (b.folder) set.add(b.folder);
    });
    return Array.from(set).sort();
  }, [bookmarks]);

  // Filtered visible bookmarks
  const visibleBookmarks = useMemo(() => {
    return bookmarks.filter((b) => {
      if (showDuplicatesOnly && !b.isDuplicate) return false;
      if (folderFilter !== '__all__' && b.folder !== folderFilter) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        b.title.toLowerCase().includes(q) ||
        b.url.toLowerCase().includes(q) ||
        (b.folder && b.folder.toLowerCase().includes(q))
      );
    });
  }, [bookmarks, searchQuery, folderFilter, showDuplicatesOnly]);

  const selectedCount = useMemo(
    () => bookmarks.filter((b) => b.selected).length,
    [bookmarks]
  );

  const visibleSelectedCount = useMemo(
    () => visibleBookmarks.filter((b) => b.selected).length,
    [visibleBookmarks]
  );

  const duplicateCount = useMemo(
    () => bookmarks.filter((b) => b.isDuplicate).length,
    [bookmarks]
  );

  const handleImport = async () => {
    const selected = bookmarks.filter((b) => b.selected);
    if (selected.length === 0) return;
    setIsImporting(true);
    setError(null);
    setResult(null);
    setImportProgress(0);
    try {
      const globalTagList = globalTags
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean);

      const data = {
        items: selected.map((b) => {
          const folderTag = b.folder ? [b.folder.split(' / ').pop() || b.folder] : [];
          return {
            title: b.title,
            url: b.url,
            domain: b.domain,
            excerpt: '',
            brain_side: 'network' as const,
            tags: [...new Set([...folderTag, ...globalTagList])],
          };
        }),
      };
      const res = await batchCreateClips(data);
      setResult({ success: res.data.success_count, failed: res.data.failed_count });
      setImportProgress(100);
      if (res.data.failed_count > 0) {
        setError(`${res.data.failed_count} 条书签导入失败`);
      }
      setBookmarks((prev) => prev.filter((b) => !b.selected));
    } catch (e: any) {
      setError('导入失败：' + (e.message || '未知错误'));
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/ingest')}
            className="p-2 rounded-lg hover:bg-white/[0.06] text-text-secondary hover:text-text-primary transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
              <Bookmark className="w-6 h-6 text-info" />
              浏览器书签
            </h1>
            <p className="text-sm text-text-secondary mt-1">
              导入浏览器导出的 HTML 书签文件，批量保存为剪藏
            </p>
          </div>
        </div>
        {bookmarks.length > 0 && (
          <button
            onClick={clearAll}
            className="flex items-center gap-1.5 text-xs text-text-muted hover:text-danger transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            清空全部
          </button>
        )}
      </div>

      {/* Upload Area */}
      {bookmarks.length === 0 && !result && (
        <div
          onClick={() => fileInputRef.current?.click()}
          className="card border-dashed border-2 border-white/[0.12] hover:border-info/30 hover:bg-info/5 transition-all cursor-pointer flex flex-col items-center justify-center py-16"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".html,.htm"
            multiple
            onChange={handleFileChange}
            className="hidden"
          />
          <div className="w-14 h-14 rounded-2xl bg-info/10 flex items-center justify-center mb-4">
            <Upload className="w-7 h-7 text-info" />
          </div>
          <div className="text-sm font-medium text-text-primary mb-1">
            点击上传浏览器书签 HTML 文件
          </div>
          <div className="text-xs text-text-muted">
            支持 Chrome / Edge / Firefox / Safari 导出的 bookmarks.html，可多选
          </div>
        </div>
      )}

      {isParsing && (
        <div className="card flex flex-col items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-info animate-spin mb-3" />
          <div className="text-sm text-text-secondary">正在解析书签...</div>
        </div>
      )}

      {error && (
        <div className="card flex items-center gap-2 text-sm text-danger bg-danger/5 border-danger/20">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {result && (
        <div className="card flex items-center gap-3 text-sm bg-success/5 border-success/20">
          <div className="w-8 h-8 rounded-full bg-success/10 flex items-center justify-center">
            <CheckCircle2 className="w-4 h-4 text-success" />
          </div>
          <div>
            <div className="font-medium text-text-primary">
              导入完成：成功 {result.success} 条，失败 {result.failed} 条
            </div>
            <div className="text-text-muted text-xs">
              可在「浏览器剪藏」中查看已导入的内容
            </div>
          </div>
        </div>
      )}

      {/* Bookmark List */}
      {bookmarks.length > 0 && (
        <div className="space-y-4">
          {/* Toolbar */}
          <div className="card space-y-3">
            <div className="flex flex-col lg:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索标题、链接、文件夹..."
                  className="w-full bg-bg-tertiary border border-white/[0.08] rounded-xl pl-10 pr-4 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-info/50"
                />
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <FolderTree className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                  <select
                    value={folderFilter}
                    onChange={(e) => setFolderFilter(e.target.value)}
                    className="bg-bg-tertiary border border-white/[0.08] rounded-xl pl-9 pr-8 py-2 text-sm text-text-primary outline-none focus:border-info/50 appearance-none"
                  >
                    <option value="__all__">全部文件夹</option>
                    {folders.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={() => setShowDuplicatesOnly((v) => !v)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-colors ${
                    showDuplicatesOnly
                      ? 'bg-warning/10 text-warning border-warning/30'
                      : 'bg-white/[0.03] text-text-secondary border-white/[0.08] hover:bg-white/[0.06]'
                  }`}
                >
                  <Copy className="w-3.5 h-3.5" />
                  重复 {duplicateCount > 0 && `(${duplicateCount})`}
                </button>
                {duplicateCount > 0 && (
                  <button
                    onClick={deduplicate}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-white/[0.03] text-text-secondary border border-white/[0.08] hover:bg-white/[0.06] transition-colors"
                  >
                    去重
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/[0.03] text-text-secondary hover:bg-white/[0.06] transition-colors"
              >
                <Upload className="w-3.5 h-3.5" />
                追加文件
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".html,.htm"
                multiple
                onChange={handleFileChange}
                className="hidden"
              />
              <button
                onClick={toggleAll}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/[0.03] text-text-secondary hover:bg-white/[0.06] transition-colors"
              >
                <Check className="w-3.5 h-3.5" />
                {visibleSelectedCount === visibleBookmarks.length && visibleBookmarks.length > 0 ? '全不选' : '全选'}
              </button>
              <button
                onClick={openSelected}
                disabled={selectedCount === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/[0.03] text-text-secondary hover:bg-white/[0.06] transition-colors disabled:opacity-50"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                打开选中
              </button>
              <button
                onClick={batchDeleteSelected}
                disabled={selectedCount === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/[0.03] text-danger hover:bg-danger/10 transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                删除选中
              </button>
              <div className="flex-1" />
              <div className="text-xs text-text-muted">
                共 {bookmarks.length} 条 · 显示 {visibleBookmarks.length} 条 · 已选 {selectedCount} 条
              </div>
            </div>
          </div>

          {/* Global tags */}
          <div className="flex items-center gap-2">
            <Tag className="w-4 h-4 text-text-muted" />
            <input
              type="text"
              value={globalTags}
              onChange={(e) => setGlobalTags(e.target.value)}
              placeholder="导入时统一附加标签，逗号分隔"
              className="flex-1 bg-transparent text-sm text-text-primary placeholder-text-muted outline-none"
            />
          </div>

          {/* List */}
          <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
            {visibleBookmarks.length === 0 ? (
              <div className="card flex flex-col items-center justify-center py-12 text-text-secondary text-sm">
                <Filter className="w-10 h-10 text-text-muted mb-2" />
                没有匹配的书签
              </div>
            ) : (
              visibleBookmarks.map((bookmark) => (
                <div
                  key={bookmark.id}
                  className={`card flex items-start gap-3 p-3 transition-colors ${
                    bookmark.selected ? 'border-info/20 bg-info/5' : ''
                  } ${bookmark.isDuplicate ? 'border-warning/10' : ''}`}
                >
                  <button
                    onClick={() => toggleSelection(bookmark.id)}
                    className={`w-5 h-5 rounded border flex items-center justify-center transition-colors mt-0.5 ${
                      bookmark.selected
                        ? 'bg-info border-info text-white'
                        : 'border-white/[0.12] hover:border-info/50'
                    }`}
                  >
                    {bookmark.selected && <Check className="w-3.5 h-3.5" />}
                  </button>

                  <div className="w-8 h-8 rounded-lg bg-white/[0.03] flex items-center justify-center shrink-0 mt-0.5">
                    <Globe className="w-4 h-4 text-text-muted" />
                  </div>

                  <div className="flex-1 min-w-0">
                    {editingId === bookmark.id ? (
                      <div className="space-y-2">
                        <input
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="w-full bg-bg-tertiary border border-white/[0.08] rounded-lg px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-info/50"
                        />
                        <input
                          value={editUrl}
                          onChange={(e) => setEditUrl(e.target.value)}
                          className="w-full bg-bg-tertiary border border-white/[0.08] rounded-lg px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-info/50"
                        />
                        <div className="flex items-center gap-2">
                          <button onClick={saveEdit} className="text-xs text-info hover:underline">保存</button>
                          <button onClick={cancelEdit} className="text-xs text-text-muted hover:underline">取消</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-medium text-text-primary truncate">
                            {bookmark.title}
                          </div>
                          {bookmark.isDuplicate && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/10 text-warning border border-warning/20">
                              重复
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-text-muted mt-1">
                          <Link2 className="w-3 h-3 shrink-0" />
                          <span className="truncate">{bookmark.url}</span>
                        </div>
                        {bookmark.folder && (
                          <div className="flex items-center gap-1 text-[10px] text-text-muted mt-1">
                            <Folder className="w-3 h-3" />
                            {bookmark.folder}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => openUrl(bookmark.url)}
                      className="p-1.5 rounded-lg hover:bg-white/[0.06] text-text-muted hover:text-info transition-colors"
                      title="打开原页"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => startEdit(bookmark)}
                      className="p-1.5 rounded-lg hover:bg-white/[0.06] text-text-muted hover:text-text-primary transition-colors"
                      title="编辑"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => removeItem(bookmark.id)}
                      className="p-1.5 rounded-lg hover:bg-danger/10 text-text-muted hover:text-danger transition-colors"
                      title="删除"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Import button */}
          <div className="flex items-center justify-between pt-2">
            <div className="text-xs text-text-muted">
              文件夹会自动作为标签导入，可在上方统一追加标签
            </div>
            <button
              onClick={handleImport}
              disabled={selectedCount === 0 || isImporting}
              className="btn-primary flex items-center gap-2 disabled:opacity-50"
            >
              {isImporting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Import className="w-4 h-4" />
              )}
              导入选中的 {selectedCount} 条书签到剪藏
            </button>
          </div>

          {/* Import progress */}
          {isImporting && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-text-muted">
                <span>导入中...</span>
                <span>{importProgress}%</span>
              </div>
              <div className="h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                <div
                  className="h-full bg-info rounded-full transition-all"
                  style={{ width: `${importProgress}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default BookmarksPage;
