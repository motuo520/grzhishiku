import { FC, useState, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Scissors, Search, Trash2, ExternalLink, Globe, ChevronDown, ChevronUp, AlertCircle, X, Loader2,
  Clock, Plus, Save, HardDrive, Check, Copy, Pencil, BookOpen, Tag, Sparkles, Hash
} from 'lucide-react';
import { useClips } from '@/hooks/useClips';
import { useTags } from '@/hooks/useTags';
import TagSelector from '@/components/TagSelector';
import ModelSelector from '@/components/llm/ModelSelector';
import { summarizeText, extractTags } from '@/api/llm';
import type { ClipCreateData, ClipUpdateData } from '@/api/clips';
import type { Clip } from '@/api/clips';
import { getDomainFromUrl, parseBookmarksHtml, parseLocalJson, parseLocalCsv, type ImportItem } from '@/utils/importParsers';

const ClipperPage: FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [expandedClip, setExpandedClip] = useState<string | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingClip, setEditingClip] = useState<Clip | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formDomain, setFormDomain] = useState('');
  const [formExcerpt, setFormExcerpt] = useState('');
  const [formFullText, setFormFullText] = useState('');
  const [formTags, setFormTags] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isImporting, setIsImporting] = useState(false);
  const [isTagFilterOpen, setIsTagFilterOpen] = useState(false);
  const [isBatchTagOpen, setIsBatchTagOpen] = useState(false);
  const [batchTagValue, setBatchTagValue] = useState<string[]>([]);
  const [modelId, setModelId] = useState('');
  const [aiLoadingId, setAiLoadingId] = useState<string | null>(null);
  const [aiLoadingAction, setAiLoadingAction] = useState<'summary' | 'tags' | null>(null);
  const [aiSummaries, setAiSummaries] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { tags: availableTags, isLoading: isTagsLoading } = useTags();
  const {
    clips,
    isLoading,
    createClip,
    deleteClip,
    batchCreateClips,
    updateClip,
    saveToKnowledge,
    batchUpdateTags,
    isCreating,
    isDeleting,
    isBatchCreating,
    isUpdating,
    isSavingToKnowledge,
    isBatchUpdatingTags,
  } = useClips({ q: searchQuery || undefined, tag_ids: selectedTagIds });

  const filteredClips = useMemo(() => clips || [], [clips]);
  const allSelected = filteredClips.length > 0 && filteredClips.every(c => selectedIds.has(c.id));

  const showError = (message: string) => {
    setError(message);
    setSuccess(null);
    setTimeout(() => setError(null), 4000);
  };

  const showSuccess = (message: string) => {
    setSuccess(message);
    setError(null);
    setTimeout(() => setSuccess(null), 3000);
  };

  const resetForm = () => {
    setFormTitle('');
    setFormUrl('');
    setFormDomain('');
    setFormExcerpt('');
    setFormFullText('');
    setFormTags([]);
    setEditingClip(null);
    setError(null);
  };

  const openCreate = () => {
    resetForm();
    setIsEditorOpen(true);
  };

  const openEdit = (clip: Clip) => {
    setEditingClip(clip);
    setFormTitle(clip.title);
    setFormUrl(clip.url);
    setFormDomain(clip.domain);
    setFormExcerpt(clip.excerpt || '');
    setFormFullText(clip.full_text || '');
    setFormTags(clip.tags?.map((t) => t.id || t.name) || []);
    setError(null);
    setIsEditorOpen(true);
  };

  const closeEditor = () => {
    setIsEditorOpen(false);
    resetForm();
  };

  const handleSave = async () => {
    if (!formTitle.trim() || !formUrl.trim() || !formDomain.trim()) {
      setError('标题、URL 和域名不能为空');
      return;
    }
    try {
      setError(null);
      if (editingClip) {
        const data: ClipUpdateData = {
          title: formTitle.trim(),
          url: formUrl.trim(),
          domain: formDomain.trim(),
          excerpt: formExcerpt.trim() || undefined,
          full_text: formFullText.trim() || undefined,
          tags: formTags,
        };
        await updateClip({ id: editingClip.id, data });
        showSuccess('剪藏更新成功');
      } else {
        const data: ClipCreateData = {
          title: formTitle.trim(),
          url: formUrl.trim(),
          domain: formDomain.trim(),
          excerpt: formExcerpt.trim() || undefined,
          full_text: formFullText.trim() || undefined,
          tags: formTags,
          brain_side: 'network',
        };
        await createClip(data);
        showSuccess('剪藏创建成功');
      }
      closeEditor();
    } catch (err: any) {
      showError(err.message || '保存失败，请重试');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这条剪藏吗？')) return;
    try {
      await deleteClip(id);
      showSuccess('剪藏已删除');
    } catch (err: any) {
      showError(err.message || '删除失败，请重试');
    }
  };

  const handleCopyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      showSuccess('链接已复制到剪贴板');
    } catch {
      showError('复制失败，请手动复制');
    }
  };

  const handleAISummary = async (clip: Clip) => {
    const text = clip.full_text || clip.excerpt || clip.title;
    if (!text || text.trim().length < 10) {
      showError('内容太短，无法生成摘要');
      return;
    }
    setAiLoadingId(clip.id);
    setAiLoadingAction('summary');
    try {
      const result = await summarizeText({
        text: `${clip.title}\n\n${text}`,
        length: 'short',
        model: modelId || undefined,
      });
      setAiSummaries((prev) => ({ ...prev, [clip.id]: result.summary }));
      showSuccess('AI 摘要已生成');
    } catch (e: any) {
      showError(e?.response?.data?.detail || e.message || '摘要生成失败');
    } finally {
      setAiLoadingId(null);
      setAiLoadingAction(null);
    }
  };

  const handleAIExtractTags = async (clip: Clip) => {
    const text = clip.full_text || clip.excerpt || clip.title;
    if (!text || text.trim().length < 5) {
      showError('内容太短，无法提取标签');
      return;
    }
    setAiLoadingId(clip.id);
    setAiLoadingAction('tags');
    try {
      const result = await extractTags({
        text: `${clip.title}\n\n${text}`,
        max_tags: 8,
        model: modelId || undefined,
      });
      const newTags = result.tags || [];
      if (newTags.length === 0) {
        showError('未提取到有效标签');
        return;
      }
      const existingTagIds = (clip.tags || []).map((t) => t.id);
      const tagNamesToAdd = newTags.filter(
        (name) => !(clip.tags || []).some((t) => t.name.toLowerCase() === name.toLowerCase())
      );
      if (tagNamesToAdd.length === 0) {
        showSuccess('标签已存在');
        return;
      }
      // Add tags by name if not in availableTags, otherwise use id
      const payloadTags = [...existingTagIds, ...tagNamesToAdd];
      await updateClip({
        id: clip.id,
        data: {
          title: clip.title,
          url: clip.url,
          domain: clip.domain,
          tags: payloadTags,
        },
      });
      showSuccess(`已提取 ${tagNamesToAdd.length} 个标签`);
    } catch (e: any) {
      showError(e?.response?.data?.detail || e.message || '标签提取失败');
    } finally {
      setAiLoadingId(null);
      setAiLoadingAction(null);
    }
  };

  const handleSaveToKnowledge = async (clip: Clip) => {
    if (!confirm(`确定把「${clip.title}」保存到知识库吗？`)) return;
    try {
      await saveToKnowledge(clip.id);
      showSuccess('已保存到 知识库 · 网络脑知识');
    } catch (err: any) {
      showError(err.message || '保存失败');
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredClips.map(c => c.id)));
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) {
      showError('请先选择要删除的剪藏');
      return;
    }
    const count = selectedIds.size;
    if (!confirm(`确定要删除选中的 ${count} 条剪藏吗？`)) return;
    try {
      for (const id of selectedIds) {
        await deleteClip(id);
      }
      setSelectedIds(new Set());
      setBatchMode(false);
      showSuccess(`已删除 ${count} 条剪藏`);
    } catch (err: any) {
      showError(err.message || '批量删除失败');
    }
  };

  const handleBatchTag = async () => {
    if (selectedIds.size === 0) {
      showError('请先选择要打标签的剪藏');
      return;
    }
    setBatchTagValue([]);
    setIsBatchTagOpen(true);
  };

  const confirmBatchTag = async () => {
    try {
      await batchUpdateTags({ ids: Array.from(selectedIds), tags: batchTagValue });
      setIsBatchTagOpen(false);
      setSelectedIds(new Set());
      setBatchMode(false);
      showSuccess('批量打标签成功');
    } catch (err: any) {
      showError(err.message || '批量打标签失败');
    }
  };

  const convertImportItemToClip = (item: ImportItem): ClipCreateData => ({
    title: item.title,
    url: item.url || '',
    domain: item.domain || getDomainFromUrl(item.url || ''),
    excerpt: item.excerpt || undefined,
    full_text: item.content || undefined,
    brain_side: 'network',
    tags: item.tags,
  });

  const handleLocalFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsImporting(true);
    const items: ClipCreateData[] = [];

    for (const file of Array.from(files)) {
      try {
        const text = await file.text();
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        const baseName = file.name.replace(/\.[^/.]+$/, '');

        let imported: ImportItem[] = [];
        if (ext === 'html' || ext === 'htm') {
          imported = parseBookmarksHtml(text);
        } else if (ext === 'json') {
          imported = parseLocalJson(text, baseName);
        } else if (ext === 'csv') {
          imported = parseLocalCsv(text);
        } else {
          showError(`不支持的文件格式：${file.name}，仅支持 .html/.json/.csv`);
          continue;
        }

        if (imported.length === 0) {
          showError(`未从 ${file.name} 解析出有效数据`);
          continue;
        }
        items.push(...imported.filter((i) => i.type === 'clip' && i.url).map(convertImportItemToClip));
      } catch (e: any) {
        showError(`读取文件 ${file.name} 失败：${e.message || '未知错误'}`);
      }
    }

    if (items.length === 0) {
      setIsImporting(false);
      return;
    }

    try {
      const res = await batchCreateClips({ items });
      showSuccess(`本地导入完成：成功 ${res.data.success_count} 条，失败 ${res.data.failed_count} 条`);
    } catch (e: any) {
      showError(e.message || '批量导入失败');
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const isSaving = isCreating || isUpdating;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">浏览器剪藏</h1>
          <p className="text-sm text-text-secondary mt-1">收集网页精华，构建外部知识库</p>
        </div>
        <div className="flex items-center gap-3">
          <ModelSelector value={modelId} onChange={setModelId} taskType="analysis" className="w-48" />
          <span className="badge-network">Network Brain</span>
          {batchMode ? (
            <>
              <button onClick={() => { setBatchMode(false); setSelectedIds(new Set()); }} className="btn-secondary text-xs">
                取消
              </button>
              <button onClick={handleSelectAll} className="btn-secondary text-xs">
                {allSelected ? '取消全选' : '全选'}
              </button>
              <button
                onClick={handleBatchTag}
                disabled={isBatchUpdatingTags || selectedIds.size === 0}
                className="btn-primary text-xs flex items-center gap-1 disabled:opacity-50"
              >
                {isBatchUpdatingTags && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <Tag className="w-3.5 h-3.5" />
                打标签 ({selectedIds.size})
              </button>
              <button
                onClick={handleBatchDelete}
                disabled={isDeleting || selectedIds.size === 0}
                className="btn-danger text-xs flex items-center gap-1"
              >
                {isDeleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <Trash2 className="w-3.5 h-3.5" />
                删除选中 ({selectedIds.size})
              </button>
            </>
          ) : (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".html,.htm,.json,.csv"
                multiple
                onChange={e => handleLocalFiles(e.target.files)}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isImporting}
                className="btn-secondary flex items-center gap-2"
              >
                {isImporting || isBatchCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <HardDrive className="w-4 h-4" />}
                本地导入
              </button>
              <button
                onClick={() => setBatchMode(true)}
                className="btn-secondary flex items-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                批量删除
              </button>
              <button onClick={openCreate} className="btn-primary flex items-center gap-2">
                <Plus className="w-4 h-4" />
                新建剪藏
              </button>
            </>
          )}
        </div>
      </div>

      {/* Banners */}
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
        {success && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex items-center gap-2 px-4 py-3 rounded-[2px] bg-success/10 border border-success/30 text-success text-sm"
          >
            <Check className="w-4 h-4" />
            {success}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Search & Tag Filter */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索剪藏标题、摘要或域名..."
            className="w-full bg-bg-secondary border border-border-color rounded-[2px] pl-10 pr-4 py-2.5 text-sm text-text-primary placeholder-text-secondary focus:outline-none focus:border-info/50 transition-colors"
          />
        </div>
        <div className="relative">
          <button
            onClick={() => setIsTagFilterOpen(!isTagFilterOpen)}
            className={`btn-secondary flex items-center gap-2 ${selectedTagIds.length > 0 ? 'border-info/50 text-info' : ''}`}
          >
            <Tag className="w-4 h-4" />
            标签筛选
            {selectedTagIds.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-[10px] rounded-full bg-info/20 text-info">
                {selectedTagIds.length}
              </span>
            )}
          </button>
          {isTagFilterOpen && (
            <div className="absolute right-0 top-full mt-2 w-64 bg-bg-secondary border border-border-color rounded-[2px] p-3 z-20">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-text-muted">按标签筛选</span>
                {selectedTagIds.length > 0 && (
                  <button
                    onClick={() => setSelectedTagIds([])}
                    className="text-[10px] text-info hover:underline"
                  >
                    清除
                  </button>
                )}
              </div>
              {isTagsLoading ? (
                <Loader2 className="w-5 h-5 animate-spin text-text-muted" />
              ) : (availableTags || []).length === 0 ? (
                <div className="text-xs text-text-secondary">暂无标签</div>
              ) : (
                <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto">
                  {(availableTags || []).map((tag) => {
                    const selected = selectedTagIds.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        onClick={() => {
                          setSelectedTagIds(prev =>
                            selected ? prev.filter(id => id !== tag.id) : [...prev, tag.id]
                          );
                        }}
                        className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full border transition-colors ${
                          selected ? 'border-info bg-info/20 text-info' : 'hover:bg-white/[0.05]'
                        }`}
                        style={selected ? {} : { borderColor: tag.color + '40', color: tag.color, backgroundColor: tag.color + '15' }}
                      >
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Active tag filters */}
      {selectedTagIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-text-muted">当前筛选：</span>
          {selectedTagIds.map((id) => {
            const tag = (availableTags || []).find((t) => t.id === id);
            if (!tag) return null;
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border"
                style={{ borderColor: tag.color + '40', backgroundColor: tag.color + '15', color: tag.color }}
              >
                {tag.name}
                <button onClick={() => setSelectedTagIds(prev => prev.filter(x => x !== id))}>
                  <X className="w-3 h-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Loading */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 text-info animate-spin" />
        </div>
      ) : filteredClips.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-20">
          <Scissors className="w-16 h-16 text-text-muted mb-4" />
          <p className="text-text-secondary">暂无剪藏</p>
          <p className="text-xs text-text-muted mt-2">点击右上角「新建剪藏」手动添加，或使用「本地导入」批量导入</p>
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence>
            {filteredClips.map((clip) => (
              <motion.div
                key={clip.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                onClick={() => batchMode && toggleSelect(clip.id)}
                className={`card ${batchMode ? 'cursor-pointer' : ''}`}
              >
                <div className="flex items-start gap-3">
                  {batchMode && (
                    <input
                      type="checkbox"
                      checked={selectedIds.has(clip.id)}
                      onChange={() => toggleSelect(clip.id)}
                      onClick={e => e.stopPropagation()}
                      className="mt-1 w-4 h-4 accent-info shrink-0"
                    />
                  )}
                  <div className="mt-0.5 p-1.5 rounded-[2px] bg-bg-tertiary text-text-secondary shrink-0">
                    <Globe className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-medium text-text-primary truncate">{clip.title}</div>
                      <a
                        href={clip.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 text-text-muted hover:text-info transition-colors"
                        title="打开原文"
                        onClick={e => e.stopPropagation()}
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-text-muted mt-1.5">
                      <span className="flex items-center gap-1">
                        <Globe className="w-3 h-3" />
                        {clip.domain}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDate(clip.created_at)}
                      </span>
                    </div>
                    {clip.tags && clip.tags.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        {clip.tags.map((tag) => (
                          <button
                            key={tag.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!selectedTagIds.includes(tag.id)) {
                                setSelectedTagIds(prev => [...prev, tag.id]);
                              }
                            }}
                            className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full border hover:opacity-80 transition-opacity"
                            style={{ borderColor: tag.color + '40', backgroundColor: tag.color + '15', color: tag.color }}
                          >
                            <Tag className="w-3 h-3" />
                            {tag.name}
                          </button>
                        ))}
                      </div>
                    )}
                    {clip.excerpt && (
                      <p className="text-xs text-text-secondary mt-2 line-clamp-2 leading-relaxed">
                        {clip.excerpt}
                      </p>
                    )}
                    {aiSummaries[clip.id] && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="mt-2 pt-2 border-t border-white/[0.06]">
                          <div className="flex items-center gap-1.5 text-xs text-warning mb-1">
                            <Sparkles className="w-3 h-3" />
                            <span>AI 摘要</span>
                          </div>
                          <p className="text-xs text-text-secondary leading-relaxed">{aiSummaries[clip.id]}</p>
                        </div>
                      </motion.div>
                    )}
                  </div>
                  {!batchMode && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleCopyUrl(clip.url)}
                        className="p-1.5 rounded-[2px] hover:bg-white/[0.05] text-text-muted hover:text-info transition-colors"
                        title="复制链接"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => openEdit(clip)}
                        className="p-1.5 rounded-[2px] hover:bg-white/[0.05] text-text-muted hover:text-warning transition-colors"
                        title="编辑"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleSaveToKnowledge(clip)}
                        disabled={isSavingToKnowledge}
                        className="p-1.5 rounded-[2px] hover:bg-white/[0.05] text-text-muted hover:text-success transition-colors disabled:opacity-50"
                        title="保存到知识库"
                      >
                        {isSavingToKnowledge ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookOpen className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => handleAISummary(clip)}
                        disabled={aiLoadingId === clip.id}
                        className="p-1.5 rounded-[2px] hover:bg-white/[0.05] text-text-muted hover:text-warning transition-colors disabled:opacity-50"
                        title="AI 生成摘要"
                      >
                        {aiLoadingId === clip.id && aiLoadingAction === 'summary' ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Sparkles className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        onClick={() => handleAIExtractTags(clip)}
                        disabled={aiLoadingId === clip.id}
                        className="p-1.5 rounded-[2px] hover:bg-white/[0.05] text-text-muted hover:text-info transition-colors disabled:opacity-50"
                        title="AI 提取标签"
                      >
                        {aiLoadingId === clip.id && aiLoadingAction === 'tags' ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Hash className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        onClick={() => setExpandedClip(expandedClip === clip.id ? null : clip.id)}
                        className="p-1.5 rounded-[2px] hover:bg-white/[0.05] text-text-muted hover:text-info transition-colors"
                        title={expandedClip === clip.id ? '收起' : '展开详情'}
                      >
                        {expandedClip === clip.id ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        onClick={() => handleDelete(clip.id)}
                        disabled={isDeleting}
                        className="p-1.5 rounded-[2px] hover:bg-white/[0.05] text-text-muted hover:text-danger transition-colors disabled:opacity-50"
                        title="删除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Expanded full_text */}
                <AnimatePresence>
                  {expandedClip === clip.id && clip.full_text && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="border-t border-border-color mt-3 pt-3">
                        <div className="text-xs text-text-muted mb-1.5">完整内容</div>
                        <div className="text-sm text-text-primary whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto pr-2">
                          {clip.full_text}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Create/Edit Modal */}
      <AnimatePresence>
        {isEditorOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={closeEditor}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-2xl bg-bg-secondary border border-border-color rounded-[2px] overflow-hidden"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-border-color">
                <h3 className="text-sm font-medium text-text-primary">{editingClip ? '编辑剪藏' : '新建剪藏'}</h3>
                <button onClick={closeEditor} className="p-1 rounded-[2px] hover:bg-white/[0.05] text-text-muted">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="block text-xs text-text-muted mb-1.5">标题</label>
                  <input
                    type="text"
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    placeholder="网页标题..."
                    className="w-full bg-bg-primary border border-border-color rounded-[2px] px-4 py-2.5 text-sm text-text-primary placeholder-text-secondary focus:outline-none focus:border-info/50 transition-colors"
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-text-muted mb-1.5">URL</label>
                    <input
                      type="text"
                      value={formUrl}
                      onChange={(e) => setFormUrl(e.target.value)}
                      onBlur={() => {
                        if (!editingClip && !formDomain.trim() && formUrl.trim()) {
                          setFormDomain(getDomainFromUrl(formUrl.trim()));
                        }
                      }}
                      placeholder="https://..."
                      className="w-full bg-bg-primary border border-border-color rounded-[2px] px-4 py-2.5 text-sm text-text-primary placeholder-text-secondary focus:outline-none focus:border-info/50 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-text-muted mb-1.5">域名</label>
                    <input
                      type="text"
                      value={formDomain}
                      onChange={(e) => setFormDomain(e.target.value)}
                      placeholder="example.com"
                      className="w-full bg-bg-primary border border-border-color rounded-[2px] px-4 py-2.5 text-sm text-text-primary placeholder-text-secondary focus:outline-none focus:border-info/50 transition-colors"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1.5">标签</label>
                  <TagSelector
                    availableTags={availableTags || []}
                    value={formTags}
                    onChange={setFormTags}
                    isLoading={isTagsLoading}
                    placeholder="输入标签，回车或逗号分隔..."
                  />
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1.5">摘要</label>
                  <textarea
                    value={formExcerpt}
                    onChange={(e) => setFormExcerpt(e.target.value)}
                    placeholder="简短摘要..."
                    rows={3}
                    className="w-full bg-bg-primary border border-border-color rounded-[2px] px-4 py-3 text-sm text-text-primary placeholder-text-secondary focus:outline-none focus:border-info/50 transition-colors resize-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1.5">完整内容</label>
                  <textarea
                    value={formFullText}
                    onChange={(e) => setFormFullText(e.target.value)}
                    placeholder="网页全文内容..."
                    rows={6}
                    className="w-full bg-bg-primary border border-border-color rounded-[2px] px-4 py-3 text-sm text-text-primary placeholder-text-secondary focus:outline-none focus:border-info/50 transition-colors resize-none"
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border-color">
                <button onClick={closeEditor} className="btn-secondary text-xs py-2 px-4">
                  取消
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="btn-primary flex items-center gap-2 text-xs py-2 px-4 disabled:opacity-60"
                >
                  {isSaving ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  {editingClip ? '更新' : '保存'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Batch Tag Modal */}
      <AnimatePresence>
        {isBatchTagOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={() => setIsBatchTagOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg bg-bg-secondary border border-border-color rounded-[2px] p-5"
            >
              <h3 className="text-sm font-medium text-text-primary mb-2">
                批量打标签 ({selectedIds.size} 条剪藏)
              </h3>
              <p className="text-xs text-text-secondary mb-4">
                选中的剪藏将被设置为以下标签，原有标签会被替换。
              </p>
              <TagSelector
                availableTags={availableTags || []}
                value={batchTagValue}
                onChange={setBatchTagValue}
                isLoading={isTagsLoading}
                placeholder="输入标签..."
              />
              <div className="flex items-center justify-end gap-2 mt-5">
                <button onClick={() => setIsBatchTagOpen(false)} className="btn-secondary text-xs py-2 px-4">
                  取消
                </button>
                <button
                  onClick={confirmBatchTag}
                  disabled={isBatchUpdatingTags}
                  className="btn-primary flex items-center gap-2 text-xs py-2 px-4 disabled:opacity-60"
                >
                  {isBatchUpdatingTags && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  确认
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ClipperPage;
