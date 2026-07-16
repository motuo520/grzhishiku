import { FC, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText, Upload, Trash2, RefreshCw, Loader2, AlertCircle, X, Search,
  File, FileSpreadsheet, Presentation, FileCode, Check, ArrowRightCircle, Eye
} from 'lucide-react';
import { useDocuments } from '@/hooks/useDocuments';
import { useTags } from '@/hooks/useTags';
import type { DocumentItem } from '@/api/document';

const statusOptions = [
  { value: '', label: '全部' },
  { value: 'success', label: '提取成功' },
  { value: 'pending', label: '处理中' },
  { value: 'error', label: '提取失败' },
];

const fileTypeOptions = [
  { value: '', label: '全部格式' },
  { value: 'pdf', label: 'PDF' },
  { value: 'docx', label: 'Word' },
  { value: 'xlsx', label: 'Excel' },
  { value: 'pptx', label: 'PPT' },
  { value: 'txt', label: '文本' },
  { value: 'md', label: 'Markdown' },
  { value: 'html', label: 'HTML' },
];

const fileIcon = (fileType?: string) => {
  const t = (fileType || '').toLowerCase();
  if (t.includes('pdf')) return <FileText className="w-5 h-5 text-danger" />;
  if (t.includes('word') || t.includes('docx') || t.includes('document')) return <FileText className="w-5 h-5 text-info" />;
  if (t.includes('sheet') || t.includes('excel') || t.includes('xlsx')) return <FileSpreadsheet className="w-5 h-5 text-success" />;
  if (t.includes('presentation') || t.includes('pptx') || t.includes('powerpoint')) return <Presentation className="w-5 h-5 text-warning" />;
  if (t.includes('html')) return <FileCode className="w-5 h-5 text-info" />;
  return <File className="w-5 h-5 text-text-muted" />;
};

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const DocumentLibraryPage: FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [detailDoc, setDetailDoc] = useState<DocumentItem | null>(null);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);

  const { documents, isLoading, uploadDocument, reextractDocument, deleteDocument, saveToKnowledge, isUploading, isReextracting, isDeleting, isSavingToKnowledge } =
    useDocuments({ extraction_status: statusFilter || undefined, file_type: typeFilter || undefined, q: query || undefined });
  const { tags } = useTags();

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

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await uploadDocument({ file });
      showSuccess(`已上传 ${file.name}`);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err: any) {
      showError(formatError(err) || '上传失败');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个文档吗？')) return;
    try {
      await deleteDocument(id);
      if (detailDoc?.id === id) setDetailDoc(null);
    } catch (err: any) {
      showError(err?.message || '删除失败');
    }
  };

  const handleReextract = async (id: string) => {
    try {
      const response = await reextractDocument(id);
      showSuccess('重新提取成功');
      const updated = (response as any)?.data;
      if (detailDoc?.id === id && updated) setDetailDoc(updated);
    } catch (err: any) {
      showError(formatError(err) || '重新提取失败');
    }
  };

  const handleSaveToKnowledge = async (id: string) => {
    try {
      await saveToKnowledge({ id, tagIds: selectedTagIds.length ? selectedTagIds : undefined });
      showSuccess('已保存到知识库');
      setSelectedTagIds([]);
    } catch (err: any) {
      showError(formatError(err) || '保存失败');
    }
  };

  const formatError = (err: any): string => {
    return err?.response?.data?.detail || err?.message || '未知错误';
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">文件/文档库</h1>
          <p className="text-sm text-text-secondary mt-1">上传本地文档，提取正文并归档到知识库</p>
        </div>
        <span className="badge-fusion">Fusion</span>
      </div>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex items-center gap-2 px-4 py-3 rounded-xl bg-danger/10 border border-danger/30 text-danger text-sm"
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
            className="flex items-center gap-2 px-4 py-3 rounded-xl bg-success/10 border border-success/30 text-success text-sm"
          >
            <Check className="w-4 h-4" />
            {success}
          </motion.div>
        )}
      </AnimatePresence>

      <div
        onClick={() => fileInputRef.current?.click()}
        className="glass-card p-6 flex flex-col items-center justify-center gap-3 cursor-pointer border-dashed border-2 border-white/[0.12] hover:border-info/30 hover:bg-white/[0.04] transition-colors"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.md,.markdown,.pdf,.docx,.xlsx,.xls,.pptx,.html,.htm"
          onChange={handleFileSelect}
          className="hidden"
        />
        <div className="p-3 rounded-xl bg-info/10 text-info">
          {isUploading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Upload className="w-6 h-6" />}
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-text-primary">点击或拖拽上传文档</p>
          <p className="text-xs text-text-muted mt-1">支持 PDF、Word、Excel、PPT、TXT、Markdown、HTML</p>
        </div>
      </div>

      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0">
          {statusOptions.map(opt => (
            <button
              key={opt.value}
              onClick={() => setStatusFilter(opt.value)}
              className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap transition-colors ${
                statusFilter === opt.value
                  ? 'bg-info/20 text-info border border-info/30'
                  : 'bg-white/[0.03] text-text-secondary border border-white/[0.06] hover:bg-white/[0.06]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0">
          {fileTypeOptions.map(opt => (
            <button
              key={opt.value}
              onClick={() => setTypeFilter(opt.value)}
              className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap transition-colors ${
                typeFilter === opt.value
                  ? 'bg-success/20 text-success border border-success/30'
                  : 'bg-white/[0.03] text-text-secondary border border-white/[0.06] hover:bg-white/[0.06]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 md:max-w-xs md:ml-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜索文档"
            className="w-full bg-bg-tertiary border border-white/[0.08] rounded-xl pl-9 pr-3 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-info/50"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 text-info animate-spin" />
        </div>
      ) : documents?.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-20">
          <FileText className="w-16 h-16 text-text-muted mb-4" />
          <p className="text-text-secondary">暂无文档</p>
          <p className="text-xs text-text-muted mt-1">上传本地文件开始构建文档库</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {documents?.map(doc => (
            <div key={doc.id} className="card group">
              <div className="flex items-start gap-3">
                <div className="p-2.5 rounded-xl bg-white/[0.03] shrink-0">
                  {fileIcon(doc.file_type)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-text-primary truncate">
                    {doc.title || doc.original_name}
                  </div>
                  <div className="text-xs text-text-muted truncate">{doc.original_name}</div>
                  <div className="flex items-center gap-3 mt-2 text-[10px] text-text-muted flex-wrap">
                    <span>{formatSize(doc.file_size)}</span>
                    <span>{formatDate(doc.created_at)}</span>
                    {doc.extraction_status === 'success' && (
                      <span className="px-1.5 py-0.5 rounded-full bg-success/10 text-success">提取成功</span>
                    )}
                    {doc.extraction_status === 'pending' && (
                      <span className="px-1.5 py-0.5 rounded-full bg-warning/10 text-warning">处理中</span>
                    )}
                    {doc.extraction_status === 'error' && (
                      <span className="px-1.5 py-0.5 rounded-full bg-danger/10 text-danger">提取失败</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setDetailDoc(doc)}
                    className="p-1.5 rounded-lg text-text-muted hover:text-info hover:bg-white/[0.05] transition-colors"
                    title="查看"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleReextract(doc.id)}
                    disabled={isReextracting}
                    className="p-1.5 rounded-lg text-text-muted hover:text-info hover:bg-white/[0.05] transition-colors"
                    title="重新提取"
                  >
                    {isReextracting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => handleDelete(doc.id)}
                    disabled={isDeleting}
                    className="p-1.5 rounded-lg text-text-muted hover:text-danger hover:bg-danger/10 transition-colors"
                    title="删除"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {detailDoc && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => setDetailDoc(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={e => e.stopPropagation()}
              className="bg-bg-secondary border border-white/[0.08] rounded-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col"
            >
              <div className="p-4 border-b border-white/[0.08] flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-text-primary truncate">
                    {detailDoc.title || detailDoc.original_name}
                  </h3>
                  <div className="text-xs text-text-muted truncate">{detailDoc.original_name}</div>
                </div>
                <button onClick={() => setDetailDoc(null)} className="p-1 rounded-lg hover:bg-white/[0.05] text-text-muted shrink-0">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-4 overflow-y-auto space-y-4">
                <div className="flex items-center gap-2 text-xs text-text-muted flex-wrap">
                  <span className="px-2 py-1 rounded-lg bg-white/[0.05]">{formatSize(detailDoc.file_size)}</span>
                  <span className="px-2 py-1 rounded-lg bg-white/[0.05]">{detailDoc.file_type || '未知格式'}</span>
                  <span className="px-2 py-1 rounded-lg bg-white/[0.05]">{formatDate(detailDoc.created_at)}</span>
                  {detailDoc.extraction_status === 'error' && detailDoc.extraction_error && (
                    <span className="px-2 py-1 rounded-lg bg-danger/10 text-danger">{detailDoc.extraction_error}</span>
                  )}
                </div>

                {detailDoc.content_text ? (
                  <div>
                    <h4 className="text-xs font-medium text-text-muted mb-1">提取正文</h4>
                    <div className="text-sm text-text-secondary whitespace-pre-wrap max-h-[40vh] overflow-y-auto p-3 rounded-xl bg-bg-tertiary border border-white/[0.06]">
                      {detailDoc.content_text}
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-text-muted">
                    {detailDoc.extraction_status === 'pending'
                      ? '正文提取中，请稍后刷新...'
                      : '暂无提取内容，点击「重新提取」重试'}
                  </div>
                )}

                <div>
                  <h4 className="text-xs font-medium text-text-muted mb-2">保存到知识库（可选标签）</h4>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {tags?.map(tag => (
                      <button
                        key={tag.id}
                        onClick={() => {
                          setSelectedTagIds(prev =>
                            prev.includes(tag.id) ? prev.filter(id => id !== tag.id) : [...prev, tag.id]
                          );
                        }}
                        className={`px-2 py-1 rounded-lg text-xs border transition-colors ${
                          selectedTagIds.includes(tag.id)
                            ? 'text-white border-transparent'
                            : 'bg-white/[0.03] text-text-secondary border-white/[0.08] hover:bg-white/[0.06]'
                        }`}
                        style={selectedTagIds.includes(tag.id) ? { backgroundColor: tag.color } : {}}
                      >
                        {tag.name}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => handleSaveToKnowledge(detailDoc.id)}
                    disabled={isSavingToKnowledge}
                    className="btn-primary flex items-center gap-2 text-xs"
                  >
                    {isSavingToKnowledge && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <ArrowRightCircle className="w-3.5 h-3.5" />
                    保存到知识库
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default DocumentLibraryPage;
