import { FC, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText, Upload, Trash2, RefreshCw, Loader2, AlertCircle, X, Search,
  File, FileSpreadsheet, Presentation, FileCode, Check, ArrowRightCircle, Eye, Tag, Pencil
} from 'lucide-react';
import { useDocuments } from '@/hooks/useDocuments';
import { useTags } from '@/hooks/useTags';
import FolderPicker from '@/components/folders/FolderPicker';
import type { DocumentItem } from '@/api/document';
import { useConfirm } from '@/components/common/dialogContext';

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

// 文本类文档（md/txt）才开放在线编辑，与后端 is_text_document 同口径
// （file_type 落库可能是后缀也可能是 MIME，两种都认，大小写不敏感）
const isTextDocument = (fileType?: string) => {
  const t = (fileType || '').trim().toLowerCase();
  return ['.md', '.markdown', '.txt', 'md', 'markdown', 'txt', 'text/plain', 'text/markdown', 'text/x-markdown'].includes(t);
};

const DocumentLibraryPage: FC = () => {
  const askConfirm = useConfirm();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [detailDoc, setDetailDoc] = useState<DocumentItem | null>(null);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  // 在线编辑弹窗（仅文本类文档）：标题 + 正文（content_text 文本层）
  const [editingDoc, setEditingDoc] = useState<DocumentItem | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  // 服务端分页上限（无 total 返回，靠「返回数达到 limit」判断可能还有更多）；上限与后端 le=1000 对齐
  const [limit, setLimit] = useState(200);
  // 上传时的仓库模式勾选（index_only 走 query 参数）：勾选后后续上传均生效
  const [uploadIndexOnly, setUploadIndexOnly] = useState(false);

  const { documents, isLoading, uploadDocument, reextractDocument, deleteDocument, saveToKnowledge, updateDocument, isUploading, isReextracting, isDeleting, isSavingToKnowledge } =
    useDocuments({ extraction_status: statusFilter || undefined, file_type: typeFilter || undefined, q: query || undefined, limit });
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
      await uploadDocument({ file, indexOnly: uploadIndexOnly });
      showSuccess(`已上传 ${file.name}`);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err: any) {
      showError(formatError(err) || '上传失败');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (id: string) => {
    if (!(await askConfirm('确定要删除这个文档吗？'))) return;
    try {
      await deleteDocument(id);
      if (detailDoc?.id === id) setDetailDoc(null);
    } catch (err: any) {
      showError(err?.message || '删除失败');
    }
  };

  // 手动归档（行内 FolderPicker，点击展开/外部点击关闭，血泪 #23 禁 hover 下拉）
  const handleFileDoc = async (id: string, folderId: string) => {
    try {
      await updateDocument({ id, data: { folder_id: folderId } });
      showSuccess('已归档到文件夹');
    } catch (err: any) {
      showError(formatError(err) || '归档失败');
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

  const openEdit = (doc: DocumentItem) => {
    setEditingDoc(doc);
    setEditTitle(doc.title || doc.original_name);
    setEditContent(doc.content_text || '');
  };

  const handleSaveEdit = async () => {
    if (!editingDoc) return;
    const title = editTitle.trim();
    if (!title) {
      showError('标题不能为空');
      return;
    }
    setIsSavingEdit(true);
    try {
      const response = await updateDocument({ id: editingDoc.id, data: { title, content: editContent } });
      showSuccess('已保存，重新索引中');
      const updated = (response as any)?.data;
      // 刷新详情弹窗与编辑态引用的文档（列表由 updateMutation 的 invalidate 刷新）
      if (updated) {
        if (detailDoc?.id === editingDoc.id) setDetailDoc(updated);
        setEditingDoc(null);
      }
    } catch (err: any) {
      showError(formatError(err) || '保存失败');
    } finally {
      setIsSavingEdit(false);
    }
  };

  // 详情弹窗里切换仓库模式（PUT index_only，不传的字段不变）
  const handleToggleIndexOnly = async (doc: DocumentItem, value: boolean) => {
    try {
      const response = await updateDocument({ id: doc.id, data: { index_only: value } });
      const updated = (response as any)?.data;
      if (updated && detailDoc?.id === doc.id) setDetailDoc(updated);
      showSuccess(value ? '已切换为仅入库检索' : '已退出仓库模式');
    } catch (err: any) {
      showError(formatError(err) || '切换失败');
    }
  };

  const handleSaveToKnowledge = async (id: string) => {
    try {
      await saveToKnowledge({ id, tagIds: selectedTagIds.length ? selectedTagIds : undefined });
      showSuccess('已保存到 知识库 · 网络脑知识');
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
        <span className="badge-fusion">整合脑</span>
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
          accept=".txt,.md,.markdown,.pdf,.docx,.xlsx,.xls,.pptx,.html,.htm,.jpg,.jpeg,.png,.webp,.bmp"
          onChange={handleFileSelect}
          className="hidden"
        />
        <div className="p-3 rounded-xl bg-info/10 text-info">
          {isUploading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Upload className="w-6 h-6" />}
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-text-primary">点击或拖拽上传文档</p>
          <p className="text-xs text-text-muted mt-1">支持 PDF、Word、Excel、PPT、TXT、Markdown、HTML、图片（JPG/PNG/WebP/BMP，OCR 提取文字）</p>
        </div>
        {/* 仓库模式：勾选后上传走 index_only=true（query 参数），只进检索层不进语义加工层 */}
        <label
          onClick={e => e.stopPropagation()}
          className="flex items-center gap-2 cursor-pointer select-none"
        >
          <input
            type="checkbox"
            checked={uploadIndexOnly}
            onChange={e => setUploadIndexOnly(e.target.checked)}
            className="accent-info cursor-pointer"
          />
          <span className="text-xs text-text-secondary">仅入库检索（存档材料）</span>
        </label>
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
                    {doc.index_only && (
                      <span className="badge-archive ml-1.5 align-middle" title="仓库模式：只进检索层，不进图谱/百科/打标/复盘">存档</span>
                    )}
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
                  {/* 标签徽章（09-11 文档纳入自动打标）：样式与笔记列表同口径，最多摆 4 个 */}
                  {doc.tags && doc.tags.length > 0 && (
                    <div className="flex items-center gap-1 mt-2 flex-wrap">
                      {doc.tags.slice(0, 4).map((tag) => (
                        <span
                          key={tag.id}
                          className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full border"
                          style={{
                            borderColor: `${tag.color}33`,
                            color: tag.color,
                            backgroundColor: `${tag.color}11`,
                          }}
                        >
                          <Tag className="w-3 h-3" />
                          {tag.name}
                        </span>
                      ))}
                      {doc.tags.length > 4 && (
                        <span className="text-[10px] text-text-muted">+{doc.tags.length - 4}</span>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <FolderPicker brainSide={doc.brain_side || 'personal'} onPick={(fid) => handleFileDoc(doc.id, fid)} />
                  <button
                    onClick={() => setDetailDoc(doc)}
                    className="p-1.5 rounded-lg text-text-muted hover:text-info hover:bg-white/[0.05] transition-colors"
                    title="查看"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  {isTextDocument(doc.file_type) && (
                    <button
                      onClick={() => openEdit(doc)}
                      className="p-1.5 rounded-lg text-text-muted hover:text-info hover:bg-white/[0.05] transition-colors"
                      title="编辑"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => handleReextract(doc.id)}
                    disabled={isReextracting}
                    className="p-1.5 rounded-lg text-text-muted hover:text-info hover:bg-white/[0.05] transition-colors"
                    title="重新提取"
                  >
                    {isReextracting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  </button>                  <button
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
          {(documents?.length ?? 0) >= limit && (
            limit < 1000 ? (
              <button
                onClick={() => setLimit((l) => Math.min(l + 200, 1000))}
                className="w-full py-2.5 rounded-xl border border-white/[0.08] text-xs text-text-secondary hover:text-text-primary hover:bg-white/[0.04] transition-colors"
              >
                加载更多（已显示 {documents?.length ?? 0} 条）
              </button>
            ) : (
              <p className="text-center text-xs text-text-muted py-2">
                已达上限，请用搜索或状态筛选缩小范围
              </p>
            )
          )}
        </div>
      )}

      <AnimatePresence>
        {detailDoc && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
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
                <div className="flex items-center gap-1 shrink-0">
                  {isTextDocument(detailDoc.file_type) && (
                    <button
                      onClick={() => openEdit(detailDoc)}
                      className="p-1 rounded-lg hover:bg-white/[0.05] text-text-muted"
                      title="编辑"
                    >
                      <Pencil className="w-5 h-5" />
                    </button>
                  )}
                  <button onClick={() => setDetailDoc(null)} className="p-1 rounded-lg hover:bg-white/[0.05] text-text-muted">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="p-4 overflow-y-auto space-y-4">
                <div className="flex items-center gap-2 text-xs text-text-muted flex-wrap">
                  <span className="px-2 py-1 rounded-lg bg-white/[0.05]">{formatSize(detailDoc.file_size)}</span>
                  <span className="px-2 py-1 rounded-lg bg-white/[0.05]">{detailDoc.file_type || '未知格式'}</span>
                  <span className="px-2 py-1 rounded-lg bg-white/[0.05]">{formatDate(detailDoc.created_at)}</span>
                  {detailDoc.index_only && <span className="badge-archive">存档</span>}
                  {detailDoc.extraction_status === 'error' && detailDoc.extraction_error && (
                    <span className="px-2 py-1 rounded-lg bg-danger/10 text-danger">{detailDoc.extraction_error}</span>
                  )}
                </div>

                {/* 仓库模式切换：PUT index_only，只进检索层不进语义加工层 */}
                <div>
                  <label className="flex items-center gap-2 cursor-pointer w-fit">
                    <input
                      type="checkbox"
                      checked={Boolean(detailDoc.index_only)}
                      onChange={e => handleToggleIndexOnly(detailDoc, e.target.checked)}
                      className="accent-info cursor-pointer"
                    />
                    <span className="text-xs text-text-primary">仅入库检索（存档材料）</span>
                  </label>
                  <p className="text-[10px] text-text-muted mt-1">只进检索层：AI 问答仍可检索到，但不进图谱/百科/打标/复盘</p>
                </div>

                {detailDoc.tags && detailDoc.tags.length > 0 && (
                  <div>
                    <h4 className="text-xs font-medium text-text-muted mb-1">标签</h4>
                    <div className="flex items-center gap-1 flex-wrap">
                      {detailDoc.tags.map((tag) => (
                        <span
                          key={tag.id}
                          className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full border"
                          style={{
                            borderColor: `${tag.color}33`,
                            color: tag.color,
                            backgroundColor: `${tag.color}11`,
                          }}
                        >
                          <Tag className="w-3 h-3" />
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

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

      {/* 在线编辑弹窗（仅文本类文档）：改的是标题 + content_text 文本层，原始上传文件不动 */}
      <AnimatePresence>
        {editingDoc && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={() => setEditingDoc(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={e => e.stopPropagation()}
              className="bg-bg-secondary border border-white/[0.08] rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col"
            >
              <div className="p-4 border-b border-white/[0.08] flex items-center justify-between gap-3">
                <h3 className="text-base font-semibold text-text-primary truncate">编辑文档</h3>
                <button onClick={() => setEditingDoc(null)} className="p-1 rounded-lg hover:bg-white/[0.05] text-text-muted shrink-0">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-4 overflow-y-auto space-y-4 flex-1">
                <div>
                  <h4 className="text-xs font-medium text-text-muted mb-1">标题</h4>
                  <input
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                    maxLength={200}
                    className="w-full bg-bg-tertiary border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-info/50"
                  />
                </div>
                <div className="flex flex-col">
                  <h4 className="text-xs font-medium text-text-muted mb-1">正文（文本层）</h4>
                  <textarea
                    value={editContent}
                    onChange={e => setEditContent(e.target.value)}
                    rows={16}
                    className="w-full bg-bg-tertiary border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-text-primary whitespace-pre-wrap focus:outline-none focus:border-info/50 resize-y min-h-[40vh]"
                  />
                  <p className="text-[10px] text-text-muted mt-1">保存后按新正文重建索引；原始上传文件不会被修改</p>
                </div>
              </div>

              <div className="p-4 border-t border-white/[0.08] flex justify-end gap-2">
                <button
                  onClick={() => setEditingDoc(null)}
                  className="px-4 py-2 rounded-xl text-xs text-text-secondary border border-white/[0.08] hover:bg-white/[0.05] transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={isSavingEdit}
                  className="btn-primary flex items-center gap-2 text-xs"
                >
                  {isSavingEdit && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <Check className="w-3.5 h-3.5" />
                  保存
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
};

export default DocumentLibraryPage;
