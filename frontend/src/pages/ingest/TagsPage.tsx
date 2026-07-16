import { FC, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Tag,
  Plus,
  Edit3,
  Trash2,
  X,
  Save,
  AlertCircle,
  Loader2,
  Cloud,
  LayoutList,
  Search,
  Merge,
  Eraser,
  Eye,
  FileText,
  Scissors,
  BookOpen,
  ExternalLink,
} from 'lucide-react';
import { useTags, useTagAssociations } from '@/hooks/useTags';
import type { Tag as TagType } from '@/api/tags';

const PRESET_COLORS = [
  { key: 'amber', value: '#d29922' },
  { key: 'red', value: '#f85149' },
  { key: 'blue', value: '#58a6ff' },
  { key: 'green', value: '#3fb950' },
  { key: 'purple', value: '#a371f7' },
  { key: 'pink', value: '#f778ba' },
  { key: 'cyan', value: '#39c5cf' },
  { key: 'gray', value: '#8b949e' },
];

const TagsPage: FC = () => {
  const { tags, isLoading, createTag, updateTag, deleteTag, mergeTags, cleanupOrphanedTags, isCreating, isUpdating, isDeleting, isMerging, isCleaningUp } = useTags();
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'cloud'>('list');
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<TagType | null>(null);
  const [formName, setFormName] = useState('');
  const [formColor, setFormColor] = useState('#8b949e');
  const [formDesc, setFormDesc] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirmTag, setDeleteConfirmTag] = useState<TagType | null>(null);
  const [mergeSourceTag, setMergeSourceTag] = useState<TagType | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [associationsTag, setAssociationsTag] = useState<TagType | null>(null);

  const { data: associations, isLoading: isAssociationsLoading } = useTagAssociations(associationsTag?.id || null);

  const filteredTags = useMemo(() => {
    if (!tags) return [];
    if (!searchQuery.trim()) return tags;
    const q = searchQuery.toLowerCase();
    return tags.filter((t) => t.name.toLowerCase().includes(q) || (t.description && t.description.toLowerCase().includes(q)));
  }, [tags, searchQuery]);

  const sortedTags = useMemo(() => {
    return [...filteredTags].sort((a, b) => b.usage_count - a.usage_count);
  }, [filteredTags]);

  const openCreate = () => {
    setEditingTag(null);
    setFormName('');
    setFormColor('#8b949e');
    setFormDesc('');
    setError(null);
    setIsEditorOpen(true);
  };

  const openEdit = (tag: TagType) => {
    setEditingTag(tag);
    setFormName(tag.name);
    setFormColor(tag.color || '#8b949e');
    setFormDesc(tag.description || '');
    setError(null);
    setIsEditorOpen(true);
  };

  const closeEditor = () => {
    setIsEditorOpen(false);
    setEditingTag(null);
    setError(null);
  };

  const handleSave = async () => {
    if (!formName.trim()) {
      setError('标签名称不能为空');
      return;
    }
    try {
      setError(null);
      if (editingTag) {
        await updateTag({
          id: editingTag.id,
          data: { name: formName.trim(), color: formColor, description: formDesc.trim() || undefined },
        });
      } else {
        await createTag({ name: formName.trim(), color: formColor, description: formDesc.trim() || undefined });
      }
      closeEditor();
    } catch (err: any) {
      setError(err.message || '保存失败，请重试');
    }
  };

  const handleDelete = async (tag: TagType) => {
    try {
      await deleteTag(tag.id);
      setDeleteConfirmTag(null);
    } catch (err: any) {
      setError(err.message || '删除失败');
    }
  };

  const handleMerge = async () => {
    if (!mergeSourceTag || !mergeTargetId) return;
    if (mergeSourceTag.id === mergeTargetId) {
      setError('不能合并到自身');
      return;
    }
    try {
      setError(null);
      await mergeTags({ id: mergeSourceTag.id, targetTagId: mergeTargetId });
      setMergeSourceTag(null);
      setMergeTargetId('');
    } catch (err: any) {
      setError(err.message || '合并失败');
    }
  };

  const handleCleanup = async () => {
    if (!confirm('确定删除所有未使用的空标签吗？此操作不可恢复。')) return;
    try {
      setError(null);
      const res = await cleanupOrphanedTags();
      alert(`已清理 ${res.data.deleted_count} 个空标签`);
    } catch (err: any) {
      setError(err.message || '清理失败');
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  const getUsageBreakdownText = (tag: TagType) => {
    const b = tag.usage_breakdown || {};
    const parts = [];
    if (b.note) parts.push(`笔记 ${b.note}`);
    if (b.clip) parts.push(`剪藏 ${b.clip}`);
    if (b.knowledge) parts.push(`知识 ${b.knowledge}`);
    return parts.length > 0 ? parts.join(' / ') : '未使用';
  };

  const renderAssociationItem = (item: { id: string; title: string; type: string; url?: string }) => {
    const icon = item.type === 'note' ? <FileText className="w-3.5 h-3.5" />
      : item.type === 'clip' ? <Scissors className="w-3.5 h-3.5" />
      : <BookOpen className="w-3.5 h-3.5" />;
    return (
      <div key={item.id} className="flex items-center gap-2 py-1.5 text-sm text-text-primary">
        <span className="text-text-muted">{icon}</span>
        <span className="truncate flex-1">{item.title}</span>
        {item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-text-muted hover:text-info"
            title="打开原文"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </div>
    );
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">标签管理</h1>
          <p className="text-sm text-text-secondary mt-1">多维度知识组织与跨实体标签关联</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="badge-fusion">Fusion</span>
          <button
            onClick={handleCleanup}
            disabled={isCleaningUp}
            className="btn-secondary flex items-center gap-2 text-xs disabled:opacity-50"
            title="清理空标签"
          >
            {isCleaningUp ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eraser className="w-4 h-4" />}
            清理空标签
          </button>
          <button onClick={openCreate} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" />
            新建标签
          </button>
        </div>
      </div>

      {/* Error Banner */}
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
      </AnimatePresence>

      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索标签..."
            className="w-full bg-bg-secondary border border-border-color rounded-xl pl-10 pr-4 py-2.5 text-sm text-text-primary placeholder-text-secondary focus:outline-none focus:border-info/50 transition-colors"
          />
        </div>
        <div className="flex items-center gap-1 bg-bg-secondary border border-border-color rounded-xl p-1">
          <button
            onClick={() => setViewMode('list')}
            className={`p-2 rounded-lg transition-colors ${viewMode === 'list' ? 'bg-bg-hover text-info' : 'text-text-muted hover:text-text-primary'}`}
          >
            <LayoutList className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('cloud')}
            className={`p-2 rounded-lg transition-colors ${viewMode === 'cloud' ? 'bg-bg-hover text-info' : 'text-text-muted hover:text-text-primary'}`}
          >
            <Cloud className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Loading */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 text-info animate-spin" />
        </div>
      ) : viewMode === 'cloud' ? (
        <div className="card min-h-[300px] flex flex-wrap items-center justify-center gap-3 p-8">
          {sortedTags.length === 0 ? (
            <div className="text-text-secondary text-sm">暂无标签</div>
          ) : (
            sortedTags.map((tag, index) => {
              const size = Math.max(0.75, Math.min(1.5, 1 + tag.usage_count * 0.05));
              return (
                <motion.div
                  key={tag.id}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: index * 0.03 }}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border cursor-pointer transition-transform hover:scale-105"
                  style={{ borderColor: tag.color + '40', backgroundColor: tag.color + '15', fontSize: `${size}rem`, color: tag.color }}
                  onClick={() => openEdit(tag)}
                >
                  <Tag className="w-3.5 h-3.5" />
                  <span>{tag.name}</span>
                  <span className="text-[10px] opacity-70">({tag.usage_count})</span>
                </motion.div>
              );
            })
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <AnimatePresence>
            {sortedTags.map((tag) => (
              <motion.div
                key={tag.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="card flex flex-col justify-between group"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: tag.color }} />
                    <div className="text-sm font-medium text-text-primary truncate">{tag.name}</div>
                  </div>
                  {tag.description && (
                    <div className="text-xs text-text-secondary leading-relaxed line-clamp-2 mb-3">{tag.description}</div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full border"
                      style={{ borderColor: tag.color + '40', backgroundColor: tag.color + '15', color: tag.color }}
                    >
                      <Tag className="w-3 h-3" />
                      使用 {tag.usage_count} 次
                    </span>
                    <span className="text-[10px] text-text-muted">{getUsageBreakdownText(tag)}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-border-color">
                  <div className="text-xs text-text-muted">{formatDate(tag.updated_at)}</div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setAssociationsTag(tag)}
                      className="p-1.5 rounded-lg hover:bg-bg-hover text-text-muted hover:text-info transition-colors"
                      title="查看关联"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => { setMergeSourceTag(tag); setMergeTargetId(''); setError(null); }}
                      className="p-1.5 rounded-lg hover:bg-bg-hover text-text-muted hover:text-success transition-colors"
                      title="合并"
                    >
                      <Merge className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => openEdit(tag)}
                      className="p-1.5 rounded-lg hover:bg-bg-hover text-text-muted hover:text-info transition-colors"
                      title="编辑"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setDeleteConfirmTag(tag)}
                      className="p-1.5 rounded-lg hover:bg-bg-hover text-text-muted hover:text-danger transition-colors"
                      title="删除"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {!isLoading && sortedTags.length === 0 && viewMode === 'list' && (
        <div className="card flex flex-col items-center justify-center py-20">
          <Tag className="w-16 h-16 text-text-muted mb-4" />
          <p className="text-text-secondary">暂无标签</p>
          <p className="text-xs text-text-muted mt-2">点击右上角「新建标签」开始创建</p>
        </div>
      )}

      {/* Editor Modal */}
      <AnimatePresence>
        {isEditorOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-bg-primary/60 backdrop-blur-sm p-4"
            onClick={closeEditor}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg bg-bg-secondary border border-border-color rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-border-color">
                <h3 className="text-sm font-medium text-text-primary">
                  {editingTag ? '编辑标签' : '新建标签'}
                </h3>
                <button onClick={closeEditor} className="p-1 rounded-lg hover:bg-bg-hover text-text-muted">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="block text-xs text-text-muted mb-1.5">名称</label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="输入标签名称..."
                    className="w-full bg-bg-primary border border-border-color rounded-xl px-4 py-2.5 text-sm text-text-primary placeholder-text-secondary focus:outline-none focus:border-info/50 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1.5">颜色</label>
                  <div className="flex items-center gap-2 flex-wrap">
                    {PRESET_COLORS.map((c) => (
                      <button
                        key={c.key}
                        onClick={() => setFormColor(c.value)}
                        className={`w-8 h-8 rounded-lg border-2 transition-transform hover:scale-110 ${formColor === c.value ? 'border-text-primary scale-110' : 'border-transparent'}`}
                        style={{ backgroundColor: c.value }}
                        title={c.key}
                      />
                    ))}
                    <input
                      type="color"
                      value={formColor}
                      onChange={(e) => setFormColor(e.target.value)}
                      className="w-8 h-8 rounded-lg cursor-pointer border-0 p-0 bg-transparent"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1.5">描述（可选）</label>
                  <input
                    type="text"
                    value={formDesc}
                    onChange={(e) => setFormDesc(e.target.value)}
                    placeholder="输入标签描述..."
                    className="w-full bg-bg-primary border border-border-color rounded-xl px-4 py-2.5 text-sm text-text-primary placeholder-text-secondary focus:outline-none focus:border-info/50 transition-colors"
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border-color">
                <button onClick={closeEditor} className="btn-secondary text-xs py-2 px-4">
                  取消
                </button>
                <button
                  onClick={handleSave}
                  disabled={isCreating || isUpdating}
                  className="btn-primary flex items-center gap-2 text-xs py-2 px-4 disabled:opacity-60"
                >
                  {isCreating || isUpdating ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  保存
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Confirm Modal */}
      <AnimatePresence>
        {deleteConfirmTag && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-bg-primary/60 backdrop-blur-sm p-4"
            onClick={() => setDeleteConfirmTag(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm bg-bg-secondary border border-border-color rounded-2xl shadow-2xl p-5"
            >
              <h3 className="text-sm font-medium text-text-primary mb-2">确认删除标签</h3>
              <p className="text-xs text-text-secondary mb-4">
                标签「{deleteConfirmTag.name}」当前关联了 {deleteConfirmTag.usage_count} 个内容。确定要删除吗？
              </p>
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => setDeleteConfirmTag(null)} className="btn-secondary text-xs py-2 px-4">
                  取消
                </button>
                <button
                  onClick={() => handleDelete(deleteConfirmTag)}
                  disabled={isDeleting}
                  className="btn-danger flex items-center gap-2 text-xs py-2 px-4 disabled:opacity-60"
                >
                  {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  删除
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Merge Modal */}
      <AnimatePresence>
        {mergeSourceTag && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-bg-primary/60 backdrop-blur-sm p-4"
            onClick={() => setMergeSourceTag(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm bg-bg-secondary border border-border-color rounded-2xl shadow-2xl p-5"
            >
              <h3 className="text-sm font-medium text-text-primary mb-2">合并标签</h3>
              <p className="text-xs text-text-secondary mb-4">
                把「{mergeSourceTag.name}」合并到以下目标标签，所有关联内容都会迁移到目标标签。
              </p>
              <select
                value={mergeTargetId}
                onChange={(e) => setMergeTargetId(e.target.value)}
                className="w-full bg-bg-primary border border-border-color rounded-xl px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:border-info/50"
              >
                <option value="">选择目标标签</option>
                {(tags || [])
                  .filter((t) => t.id !== mergeSourceTag.id)
                  .map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
              </select>
              <div className="flex items-center justify-end gap-2 mt-5">
                <button onClick={() => setMergeSourceTag(null)} className="btn-secondary text-xs py-2 px-4">
                  取消
                </button>
                <button
                  onClick={handleMerge}
                  disabled={isMerging || !mergeTargetId}
                  className="btn-primary flex items-center gap-2 text-xs py-2 px-4 disabled:opacity-60"
                >
                  {isMerging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Merge className="w-3.5 h-3.5" />}
                  合并
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Associations Modal */}
      <AnimatePresence>
        {associationsTag && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-bg-primary/60 backdrop-blur-sm p-4"
            onClick={() => setAssociationsTag(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg bg-bg-secondary border border-border-color rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-border-color">
                <h3 className="text-sm font-medium text-text-primary">
                  「{associationsTag.name}」关联内容
                </h3>
                <button onClick={() => setAssociationsTag(null)} className="p-1 rounded-lg hover:bg-bg-hover text-text-muted">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-5 max-h-[60vh] overflow-y-auto">
                {isAssociationsLoading ? (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 className="w-6 h-6 text-info animate-spin" />
                  </div>
                ) : !associations ? (
                  <div className="text-sm text-text-secondary">加载失败</div>
                ) : (
                  <div className="space-y-4">
                    {associations.note.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 text-xs text-text-muted mb-1.5">
                          <FileText className="w-3.5 h-3.5" /> 笔记 ({associations.note.length})
                        </div>
                        <div className="space-y-1">
                          {associations.note.map(renderAssociationItem)}
                        </div>
                      </div>
                    )}
                    {associations.clip.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 text-xs text-text-muted mb-1.5">
                          <Scissors className="w-3.5 h-3.5" /> 剪藏 ({associations.clip.length})
                        </div>
                        <div className="space-y-1">
                          {associations.clip.map(renderAssociationItem)}
                        </div>
                      </div>
                    )}
                    {associations.knowledge.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 text-xs text-text-muted mb-1.5">
                          <BookOpen className="w-3.5 h-3.5" /> 知识单元 ({associations.knowledge.length})
                        </div>
                        <div className="space-y-1">
                          {associations.knowledge.map(renderAssociationItem)}
                        </div>
                      </div>
                    )}
                    {associations.note.length === 0 && associations.clip.length === 0 && associations.knowledge.length === 0 && (
                      <div className="text-sm text-text-secondary text-center py-6">暂无关联内容</div>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default TagsPage;
