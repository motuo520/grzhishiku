import { FC, useState, useRef, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload, FileText, Link2, FileJson, Trash2, AlertCircle, Check, Loader2,
  X, Download, Globe, FileSpreadsheet, HardDrive, BookOpen, Rss, Brain
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useNotes } from '@/hooks/useNotes';
import { useClips } from '@/hooks/useClips';
import { invalidateContentQueries } from '@/utils/invalidateContent';
import { settingsApi } from '@/api/settings';
import { readLaterApi } from '@/api/readLater';
import { rssApi } from '@/api/rss';
import { knowledgeApi } from '@/api/knowledge';
import type { NoteCreateData } from '@/api/notes';
import type { ClipCreateData } from '@/api/clips';
import { getDomainFromUrl, parseBookmarksHtml, parseLocalJson, parseLocalCsv, detectFullExport, FULL_EXPORT_TABLE_LABELS, type FullExportDetection } from '@/utils/importParsers';
import AutoTagHint from '@/components/AutoTagHint';

type ImportTab = 'markdown' | 'jsoncsv' | 'urls' | 'local';
type PreviewType = 'note' | 'clip';
// 导入目标类型：note/knowledge 消费文本类条目，clip/readlater/rss 消费 URL 类条目
type TargetType = 'note' | 'clip' | 'readlater' | 'rss' | 'knowledge';
const TARGET_ACCEPTS: Record<TargetType, PreviewType> = {
  note: 'note',
  knowledge: 'note',
  clip: 'clip',
  readlater: 'clip',
  rss: 'clip',
};
const TARGET_LABELS: Record<TargetType, string> = {
  note: '笔记',
  clip: '剪藏',
  readlater: '稍后读',
  rss: 'RSS 源',
  knowledge: '知识单元',
};

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
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<ImportTab>(() => {
    const type = searchParams.get('type');
    if (type === 'notes') return 'markdown';
    if (type === 'clips') return 'urls';
    if (type === 'local') return 'local';
    return 'markdown';
  });
  const [previews, setPreviews] = useState<PreviewItem[]>([]);
  // 前置选择：本批导入目标类型，非目标消费的条目类型将被跳过
  const [targetType, setTargetType] = useState<TargetType>(() => {
    const type = searchParams.get('type');
    return type === 'clips' ? 'clip' : 'note';
  });
  // 导入脑侧：笔记/知识默认个人脑、剪藏默认网络脑，用户可改（read_later/rss 无脑侧字段不生效）
  const [brainChoice, setBrainChoice] = useState<'personal' | 'network'>(
    searchParams.get('type') === 'clips' ? 'network' : 'personal'
  );
  const [fullExport, setFullExport] = useState<FullExportDetection | null>(null);
  const [exportResult, setExportResult] = useState<{ inserted: number; updated: number; skipped: number } | null>(null);
  const [textInput, setTextInput] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<{ success: number; failed: number; skipped?: number; deduped?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const localFileInputRef = useRef<HTMLInputElement>(null);

  const { batchCreateNotes } = useNotes();
  const { batchCreateClips, fetchMetadata } = useClips();
  const queryClient = useQueryClient();

  const notePreviews = useMemo(() => previews.filter(p => p.type === 'note'), [previews]);
  const clipPreviews = useMemo(() => previews.filter(p => p.type === 'clip'), [previews]);
  // 目标类型消费的条目才参与导入，其余保留在预览里（可切换目标后再导）
  const selectedPreviews = useMemo(
    () => previews.filter(p => p.type === TARGET_ACCEPTS[targetType]),
    [targetType, previews]
  );
  const skippedCount = previews.length - selectedPreviews.length;

  useEffect(() => {
    setResult(null);
    setError(null);
    setFullExport(null);
    setExportResult(null);
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
          // 全量数据包（/me/export 产物）优先识别：走 merge 导入，不拆条目
          try {
            const fe = detectFullExport(JSON.parse(text));
            if (fe) {
              setFullExport(fe);
              setExportResult(null);
              continue;
            }
          } catch { /* 不是合法 JSON，交给逐条解析报错 */ }
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
        // 全量数据包优先识别
        if (text.startsWith('{')) {
          try {
            const fe = detectFullExport(JSON.parse(text));
            if (fe) {
              setFullExport(fe);
              setExportResult(null);
              setTextInput('');
              return;
            }
          } catch { /* 落到逐条解析 */ }
        }
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
    // 全量数据包：直接走合并导入，不拆条目
    if (fullExport) {
      setIsImporting(true);
      setExportResult(null);
      try {
        const res = await settingsApi.importData(fullExport.payload);
        setExportResult(res.data);
        setFullExport(null);
        invalidateContentQueries(queryClient);
      } catch (e: any) {
        addError('数据包导入失败：' + (e?.response?.data?.detail || e.message || '未知错误'));
      } finally {
        setIsImporting(false);
      }
      return;
    }
    if (previews.length === 0 || selectedPreviews.length === 0) return;
    setIsImporting(true);
    setResult(null);
    let success = 0;
    let failed = 0;
    let deduped = 0;
    try {
      if (targetType === 'note') {
        const items: NoteCreateData[] = notePreviews.map(p => ({
          title: p.title || '未命名',
          content: p.content || '',
          brain_side: brainChoice,
          tags: Array.isArray(p.tags) ? p.tags : undefined,
        }));
        const res = await batchCreateNotes({ items });
        success += res.data.success_count;
        failed += res.data.failed_count;
        deduped += res.data.skipped_count || 0;
      } else if (targetType === 'clip') {
        const items: ClipCreateData[] = clipPreviews
          .filter(p => p.url?.trim())
          .map(p => ({
            title: p.title || '未命名',
            url: p.url!.trim(),
            domain: p.domain?.trim() || 'unknown',
            excerpt: p.excerpt,
            brain_side: brainChoice,
          }));
        const res = await batchCreateClips({ items });
        success += res.data.success_count;
        failed += res.data.failed_count;
        deduped += res.data.skipped_count || 0;
      } else if (targetType === 'readlater') {
        // 稍后读：无批量端点，逐条创建（URL 类条目）；409 = 同 URL 已存在，计跳过
        for (const p of clipPreviews.filter(p => p.url?.trim())) {
          try {
            await readLaterApi.create({
              url: p.url!.trim(),
              title: p.title || undefined,
              excerpt: p.excerpt,
              source: 'batch-import',
            });
            success++;
          } catch (e: any) {
            if (e?.response?.status === 409) deduped++;
            else failed++;
          }
        }
      } else if (targetType === 'rss') {
        // RSS 源：逐条添加（每个源后端会抓取校验一次，速度较慢属正常）
        for (const p of clipPreviews.filter(p => p.url?.trim())) {
          try {
            await rssApi.createFeed({ url: p.url!.trim(), title: p.title || undefined });
            success++;
          } catch {
            failed++;
          }
        }
      } else {
        // 知识单元：逐条创建（文本类条目）
        for (const p of notePreviews) {
          try {
            await knowledgeApi.create({
              content_raw: p.content || p.title || '',
              source_title: p.title || undefined,
              brain_side: brainChoice,
            });
            success++;
          } catch {
            failed++;
          }
        }
      }
      setResult({ success, failed, skipped: skippedCount, deduped });
      // 导入完成后全局失效内容查询，列表页与聚合视图（管线/素材池/统计）即时刷新
      invalidateContentQueries(queryClient);
      // 只清掉已导入类型，跳过的条目留在预览里（切换目标类型后可继续导）
      setPreviews(prev => prev.filter(p => p.type !== TARGET_ACCEPTS[targetType]));
      if (failed === 0 && success > 0) {
        // 全部成功：素材已就位，自动进入管线原始素材页衔接后续生产。
        // 先把 pipeline 数据拉进缓存再跳转，落地即见新素材（不等挂载后再拉）
        await queryClient.refetchQueries({ queryKey: ['pipeline'] });
        navigate('/pipeline/raw');
      }
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
          <p className="text-sm text-text-secondary mt-1">批量导入笔记、剪藏、稍后读、RSS 源和知识单元</p>
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
          {result.deduped ? `，跳过重复 ${result.deduped} 条（已存在的相同内容/链接）` : ''}
          {result.skipped ? `，跳过 ${result.skipped} 条非所选类型（仍保留在预览中）` : ''}
          {/* 刚导入的批次在时间轴里会聚成一簇，直接跳过去看 */}
          <Link to="/ingest/timeline" className="ml-auto underline underline-offset-2 hover:opacity-80 whitespace-nowrap">
            按时间轴查看 →
          </Link>
        </motion.div>
      )}

      {exportResult && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 px-4 py-3 rounded-[2px] bg-success/10 border border-success/30 text-success text-sm"
        >
          <Check className="w-4 h-4" />
          数据包合并完成：新增 {exportResult.inserted} 条，更新 {exportResult.updated} 条，跳过 {exportResult.skipped} 条（已按类型归入笔记/剪藏/知识单元等各自列表）
        </motion.div>
      )}

      {/* 全量数据包识别卡 */}
      {fullExport && (
        <div className="glass-card p-6 space-y-4 border-info/30">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-text-primary">检测到完整数据包（共 {fullExport.total} 条）</h2>
            <button onClick={() => setFullExport(null)} className="text-xs text-danger hover:text-danger/80 transition-colors">
              移除
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(fullExport.counts).map(([key, count]) => (
              <span key={key} className="px-2.5 py-1 rounded-[2px] text-xs bg-info/10 text-info border border-info/25">
                {FULL_EXPORT_TABLE_LABELS[key] || key} {count}
              </span>
            ))}
          </div>
          <p className="text-xs text-text-muted">
            数据包按 id 合并导入：已存在的条目以较新者为准，不会删除本地数据，可重复导入。
          </p>
          <div className="flex justify-end">
            <button
              onClick={handleImport}
              disabled={isImporting}
              className="btn-primary flex items-center gap-2"
            >
              {isImporting && <Loader2 className="w-4 h-4 animate-spin" />}
              <Download className="w-4 h-4" />
              合并导入数据包
            </button>
          </div>
        </div>
      )}

      {/* 导入即触发自动打标：提前说清是本地模型打的、偏粗可精修（可关闭，关后不再提示） */}
      <AutoTagHint />

      {/* 前置选择：本批导入目标类型，非目标消费的条目类型导入时跳过 */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm text-text-secondary">导入目标：</span>
        <div className="flex items-center gap-1 bg-bg-tertiary p-1 rounded-[2px]">
          {([
            { id: 'note' as TargetType, label: TARGET_LABELS.note, icon: FileText, tab: 'markdown' as ImportTab },
            { id: 'clip' as TargetType, label: TARGET_LABELS.clip, icon: Globe, tab: 'urls' as ImportTab },
            { id: 'readlater' as TargetType, label: TARGET_LABELS.readlater, icon: BookOpen, tab: 'urls' as ImportTab },
            { id: 'rss' as TargetType, label: TARGET_LABELS.rss, icon: Rss, tab: 'urls' as ImportTab },
            { id: 'knowledge' as TargetType, label: TARGET_LABELS.knowledge, icon: Brain, tab: 'jsoncsv' as ImportTab },
          ]).map(t => {
            const Icon = t.icon;
            const active = targetType === t.id;
            return (
              <button
                key={t.id}
                onClick={() => {
                  setTargetType(t.id);
                  setActiveTab(t.tab);
                  setBrainChoice(t.id === 'clip' ? 'network' : 'personal');
                }}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-[2px] text-sm transition-all ${
                  active
                    ? 'bg-white/[0.08] text-info font-medium'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>
        <span className="text-xs text-text-muted">先选类型再添加内容；不属于所选类型的条目会被跳过</span>
        {['note', 'clip', 'knowledge'].includes(targetType) && (
          <div className="flex items-center gap-1 bg-bg-tertiary p-1 rounded-[2px]">
            <span className="text-xs text-text-muted px-1.5">存入</span>
            {([
              { id: 'personal' as const, label: '个人脑' },
              { id: 'network' as const, label: '网络脑' },
            ]).map(b => (
              <button
                key={b.id}
                onClick={() => setBrainChoice(b.id)}
                className={`px-3 py-1.5 rounded-[2px] text-xs transition-all ${
                  brainChoice === b.id
                    ? 'bg-white/[0.08] text-info font-medium'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                {b.label}
              </button>
            ))}
          </div>
        )}
      </div>

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
                <p>• .json：数组、{'{ notes, clips }'} 结构，或「数据导出」产生的完整数据包（自动识别，按 id 合并导入）</p>
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
              预览（将导入 {selectedPreviews.length} 条{TARGET_LABELS[targetType]}
              {skippedCount > 0 && `，跳过 ${skippedCount} 条`}）
            </h2>
            <button onClick={clearPreviews} className="text-xs text-danger hover:text-danger/80 transition-colors">
              清空预览
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto space-y-2">
            {previews.map(item => {
              const willSkip = item.type !== TARGET_ACCEPTS[targetType];
              return (
              <div
                key={item.id}
                className={`flex items-start gap-3 p-3 rounded-[2px] border transition-colors ${
                  willSkip
                    ? 'border-white/[0.04] bg-white/[0.01] opacity-50'
                    : 'border-white/[0.08] bg-white/[0.02] hover:border-white/[0.12]'
                }`}
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
                {willSkip && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-[2px] bg-bg-tertiary text-text-muted shrink-0 mt-0.5">
                    跳过
                  </span>
                )}
                <button
                  onClick={() => removePreview(item.id)}
                  className="p-1.5 rounded-[2px] hover:bg-white/[0.05] text-text-muted hover:text-danger transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              );
            })}
          </div>
          <div className="flex justify-end">
            <button
              onClick={handleImport}
              disabled={isImporting || selectedPreviews.length === 0}
              className="btn-primary flex items-center gap-2"
            >
              {isImporting && <Loader2 className="w-4 h-4 animate-spin" />}
              <Download className="w-4 h-4" />
              确认导入 {selectedPreviews.length} 条{TARGET_LABELS[targetType]}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default BatchImportPage;
