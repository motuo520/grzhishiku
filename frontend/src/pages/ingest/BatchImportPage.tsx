import { FC, useState, useRef, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload, FileText, Link2, FileJson, Trash2, AlertCircle, Check, Loader2,
  X, Download, Globe, FileSpreadsheet, HardDrive
} from 'lucide-react';
import { useNotes } from '@/hooks/useNotes';
import { useClips } from '@/hooks/useClips';
import type { NoteCreateData } from '@/api/notes';
import type { ClipCreateData } from '@/api/clips';
import { getDomainFromUrl, parseBookmarksHtml, parseLocalJson, parseLocalCsv } from '@/utils/importParsers';

type ImportTab = 'markdown' | 'jsoncsv' | 'urls' | 'local';
type PreviewType = 'note' | 'clip';

interface PreviewItem {
  id: string;
  type: PreviewType;
  title: string;
  content?: string;
  url?: string;
  domain?: string;
  excerpt?: string;
  tags?: string[];
  error?: string;
}

const BatchImportPage: FC = () => {
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<ImportTab>(() => {
    const type = searchParams.get('type');
    if (type === 'notes') return 'markdown';
    if (type === 'clips') return 'urls';
    if (type === 'local') return 'local';
    return 'markdown';
  });
  const [previews, setPreviews] = useState<PreviewItem[]>([]);
  const [textInput, setTextInput] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<{ success: number; failed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const localFileInputRef = useRef<HTMLInputElement>(null);

  const { batchCreateNotes } = useNotes();
  const { batchCreateClips, fetchMetadata } = useClips();

  const notePreviews = useMemo(() => previews.filter(p => p.type === 'note'), [previews]);
  const clipPreviews = useMemo(() => previews.filter(p => p.type === 'clip'), [previews]);

  useEffect(() => {
    setResult(null);
    setError(null);
  }, [activeTab]);

  const addError = (message: string) => {
    setError(message);
    setTimeout(() => setError(null), 5000);
  };

  const generateId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsParsing(true);
    const newPreviews: PreviewItem[] = [];
    for (const file of Array.from(files)) {
      try {
        const name = file.name.replace(/\.[^/.]+$/, '');
        const text = await file.text();
        newPreviews.push({
          id: generateId(),
          type: 'note',
          title: name,
          content: text,
        });
      } catch {
        addError(`读取文件 ${file.name} 失败`);
      }
    }
    setPreviews(prev => [...prev, ...newPreviews]);
    setIsParsing(false);
  };

  const toPreviewItem = (item: import('@/utils/importParsers').ImportItem): PreviewItem => ({
    id: generateId(),
    type: item.type,
    title: item.title,
    content: item.content,
    url: item.url,
    domain: item.domain,
    excerpt: item.excerpt,
    tags: item.tags,
  });

  const handleLocalFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsParsing(true);
    setResult(null);
    const newPreviews: PreviewItem[] = [];

    for (const file of Array.from(files)) {
      try {
        const text = await file.text();
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        const baseName = file.name.replace(/\.[^/.]+$/, '');

        let imported: import('@/utils/importParsers').ImportItem[] = [];
        if (ext === 'html' || ext === 'htm') {
          imported = parseBookmarksHtml(text);
        } else if (ext === 'json') {
          imported = parseLocalJson(text, baseName);
        } else if (ext === 'csv') {
          imported = parseLocalCsv(text);
        } else if (ext === 'md' || ext === 'txt' || ext === 'markdown') {
          newPreviews.push({
            id: generateId(),
            type: 'note',
            title: baseName,
            content: text,
          });
          continue;
        } else {
          addError(`不支持的文件格式：${file.name}`);
          continue;
        }

        newPreviews.push(...imported.map(toPreviewItem));
      } catch (e: any) {
        addError(`读取文件 ${file.name} 失败：${e.message || '未知错误'}`);
      }
    }

    if (newPreviews.length > 0) {
      setPreviews(prev => [...prev, ...newPreviews]);
    }
    setIsParsing(false);
    if (localFileInputRef.current) localFileInputRef.current.value = '';
  };

  const parseJsonCsv = () => {
    const text = textInput.trim();
    if (!text) {
      addError('请输入 JSON 或 CSV 数据');
      return;
    }
    setIsParsing(true);
    try {
      let imported: import('@/utils/importParsers').ImportItem[] = [];
      if (text.startsWith('[') || text.startsWith('{')) {
        imported = parseLocalJson(text);
      } else {
        imported = parseLocalCsv(text);
      }
      setPreviews(prev => [...prev, ...imported.map(toPreviewItem)]);
      setTextInput('');
    } catch (e: any) {
      addError('解析失败：' + (e.message || '格式错误'));
    } finally {
      setIsParsing(false);
    }
  };

  const parseUrls = async () => {
    const urls = textInput.split(/\r?\n/).map(u => u.trim()).filter(Boolean);
    if (urls.length === 0) {
      addError('请输入 URL');
      return;
    }
    setIsParsing(true);
    try {
      const response = await fetchMetadata(urls);
      const newPreviews: PreviewItem[] = response.data.map(meta => ({
        id: generateId(),
        type: 'clip',
        title: meta.title || meta.url,
        url: meta.url,
        domain: meta.domain,
        excerpt: meta.excerpt,
        error: meta.error,
      }));
      setPreviews(prev => [...prev, ...newPreviews]);
      setTextInput('');
    } catch (e: any) {
      addError('抓取失败：' + (e.message || '网络错误'));
    } finally {
      setIsParsing(false);
    }
  };

  const removePreview = (id: string) => {
    setPreviews(prev => prev.filter(p => p.id !== id));
  };

  const clearPreviews = () => {
    setPreviews([]);
    setResult(null);
  };

  const handleImport = async () => {
    if (previews.length === 0) return;
    setIsImporting(true);
    setResult(null);
    let success = 0;
    let failed = 0;
    try {
      if (notePreviews.length > 0) {
        const items: NoteCreateData[] = notePreviews.map(p => ({
          title: p.title || '未命名',
          content: p.content || '',
          brain_side: 'personal',
          tags: Array.isArray(p.tags) ? p.tags : undefined,
        }));
        const res = await batchCreateNotes({ items });
        success += res.data.success_count;
        failed += res.data.failed_count;
      }
      if (clipPreviews.length > 0) {
        const items: ClipCreateData[] = clipPreviews
          .filter(p => p.url?.trim())
          .map(p => ({
            title: p.title || '未命名',
            url: p.url!.trim(),
            domain: p.domain?.trim() || 'unknown',
            excerpt: p.excerpt,
            brain_side: 'network',
          }));
        const res = await batchCreateClips({ items });
        success += res.data.success_count;
        failed += res.data.failed_count;
      }
      setResult({ success, failed });
      setPreviews([]);
    } catch (e: any) {
      addError('导入失败：' + (e.message || '未知错误'));
    } finally {
      setIsImporting(false);
    }
  };

  const tabs = [
    { id: 'markdown' as ImportTab, label: 'Markdown / TXT', icon: FileText },
    { id: 'jsoncsv' as ImportTab, label: 'JSON / CSV', icon: FileSpreadsheet },
    { id: 'urls' as ImportTab, label: 'URL 列表', icon: Link2 },
    { id: 'local' as ImportTab, label: '本地导入', icon: HardDrive },
  ];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">批量导入中心</h1>
          <p className="text-sm text-text-secondary mt-1">批量导入笔记、剪藏和链接</p>
        </div>
        <span className="badge-fusion">Fusion</span>
      </div>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex items-center gap-2 px-4 py-3 rounded-[2px] bg-danger/10 border border-danger/30 text-danger text-sm"
          >
            <AlertCircle className="w-4 h-4" />
            {error}
            <button onClick={() => setError(null)} className="ml-auto">
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {result && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 px-4 py-3 rounded-[2px] bg-success/10 border border-success/30 text-success text-sm"
        >
          <Check className="w-4 h-4" />
          导入完成：成功 {result.success} 条，失败 {result.failed} 条
        </motion.div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2 bg-bg-tertiary p-1 rounded-[2px] w-fit">
        {tabs.map(tab => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-[2px] text-sm font-medium transition-all ${
                active
                  ? 'bg-white/[0.08] text-info'
                  : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.03]'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Input Area */}
      <div className="glass-card p-6 space-y-4">
        {activeTab === 'markdown' && (
          <div className="space-y-4">
            <div className="text-sm text-text-secondary">
              选择 Markdown 或 TXT 文件，每个文件将作为一条笔记导入（文件名作为标题）。暂不支持压缩包。
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.txt,.markdown"
              multiple
              onChange={e => handleFiles(e.target.files)}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="btn-secondary flex items-center gap-2"
            >
              <Upload className="w-4 h-4" />
              选择文件
            </button>
          </div>
        )}

        {activeTab === 'jsoncsv' && (
          <div className="space-y-4">
            <div className="text-sm text-text-secondary">
              粘贴 JSON（支持数组或 {'{ notes, clips }'}）或 CSV（首行：title,content,tags 或 title,url,domain,excerpt）。
            </div>
            <textarea
              value={textInput}
              onChange={e => setTextInput(e.target.value)}
              placeholder={`{"notes":[{"title":"示例","content":"内容"}],"clips":[{"title":"示例","url":"https://..."}]}`}
              rows={8}
              className="w-full bg-bg-tertiary border border-white/[0.08] rounded-[2px] px-4 py-3 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-info/50 transition-colors resize-none font-mono"
            />
            <button
              onClick={parseJsonCsv}
              disabled={isParsing}
              className="btn-secondary flex items-center gap-2"
            >
              {isParsing && <Loader2 className="w-4 h-4 animate-spin" />}
              <FileJson className="w-4 h-4" />
              解析数据
            </button>
          </div>
        )}

        {activeTab === 'urls' && (
          <div className="space-y-4">
            <div className="text-sm text-text-secondary">
              粘贴 URL 列表，每行一个。系统将自动抓取标题和摘要，导入为剪藏。
            </div>
            <textarea
              value={textInput}
              onChange={e => setTextInput(e.target.value)}
              placeholder="https://example.com/article-1\nhttps://example.com/article-2"
              rows={8}
              className="w-full bg-bg-tertiary border border-white/[0.08] rounded-[2px] px-4 py-3 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-info/50 transition-colors resize-none font-mono"
            />
            <button
              onClick={parseUrls}
              disabled={isParsing}
              className="btn-secondary flex items-center gap-2"
            >
              {isParsing && <Loader2 className="w-4 h-4 animate-spin" />}
              <Globe className="w-4 h-4" />
              抓取预览
            </button>
          </div>
        )}

        {activeTab === 'local' && (
          <div className="space-y-4">
            <div className="text-sm text-text-secondary">
              从本地选择文件导入。支持浏览器书签 HTML、Markdown/TXT 笔记、JSON 数据包、CSV 表格。
              <span className="text-danger">不会自动扫描，仅导入你主动选择的文件。</span>
            </div>
            <div className="p-4 rounded-[2px] bg-bg-tertiary border border-white/[0.08] space-y-2">
              <div className="text-xs text-text-muted space-y-1">
                <p>• .html / .htm：浏览器书签导出文件 → 导入为剪藏</p>
                <p>• .md / .txt / .markdown → 导入为笔记</p>
                <p>• .json：支持数组或 {'{ notes, clips }'} 结构</p>
                <p>• .csv：首行 title,content,tags 或 title,url,domain,excerpt</p>
              </div>
            </div>
            <input
              ref={localFileInputRef}
              type="file"
              accept=".html,.htm,.json,.csv,.md,.txt,.markdown"
              multiple
              onChange={e => handleLocalFiles(e.target.files)}
              className="hidden"
            />
            <button
              onClick={() => localFileInputRef.current?.click()}
              disabled={isParsing}
              className="btn-secondary flex items-center gap-2"
            >
              {isParsing && <Loader2 className="w-4 h-4 animate-spin" />}
              <HardDrive className="w-4 h-4" />
              选择本地文件
            </button>
          </div>
        )}
      </div>

      {/* Preview */}
      {previews.length > 0 && (
        <div className="glass-card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-text-primary">
              预览（{notePreviews.length} 条笔记 / {clipPreviews.length} 条剪藏）
            </h2>
            <button onClick={clearPreviews} className="text-xs text-danger hover:text-danger/80 transition-colors">
              清空预览
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto space-y-2">
            {previews.map(item => (
              <div
                key={item.id}
                className="flex items-start gap-3 p-3 rounded-[2px] border border-white/[0.08] bg-white/[0.02] hover:border-white/[0.12] transition-colors"
              >
                <div className="mt-0.5">
                  {item.type === 'note' ? <FileText className="w-4 h-4 text-personal-primary" /> : <Globe className="w-4 h-4 text-network-primary" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-text-primary truncate">{item.title}</div>
                  {item.type === 'note' ? (
                    <div className="text-xs text-text-muted line-clamp-2">{item.content}</div>
                  ) : (
                    <div className="text-xs text-text-muted truncate">{item.url}</div>
                  )}
                  {item.error && <div className="text-xs text-danger mt-1">{item.error}</div>}
                </div>
                <button
                  onClick={() => removePreview(item.id)}
                  className="p-1.5 rounded-[2px] hover:bg-white/[0.05] text-text-muted hover:text-danger transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <button
              onClick={handleImport}
              disabled={isImporting}
              className="btn-primary flex items-center gap-2"
            >
              {isImporting && <Loader2 className="w-4 h-4 animate-spin" />}
              <Download className="w-4 h-4" />
              确认导入
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default BatchImportPage;
