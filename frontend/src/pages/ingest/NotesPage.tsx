import { FC, useState, useMemo, useEffect, memo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText, Plus, Search, Trash2, Edit3, X, Save, AlertCircle, Loader2, Tag,
  Clock, Filter, Upload, Download, Square, CheckSquare, LayoutGrid, List, Folder as FolderIcon,
} from 'lucide-react';
import { useNotes } from '@/hooks/useNotes';
import { useTags } from '@/hooks/useTags';
import { useFolders } from '@/hooks/useFolders';
import { useNavigation } from '@/store/navigation';
import TagSelector from '@/components/TagSelector';
import type { Note } from '@/api/notes';
import type { Folder } from '@/api/folders';

const VIEW_MODES = [
  { key: 'grid', icon: LayoutGrid, label: '网格' },
  { key: 'list', icon: List, label: '列表' },
];

const MOTION_THRESHOLD = 20;

// 文件夹下拉选项（flat，按树深度缩进；both 模式下带脑侧前缀）
interface FolderOption {
  id: string;
  label: string;
}

const NotesPage: FC = () => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [showTagFilter, setShowTagFilter] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [formTitle, setFormTitle] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formTags, setFormTags] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // 服务端分页上限（无 total 返回，靠「返回数达到 limit」判断可能还有更多）；上限与后端 le=1000 对齐
  const [limit, setLimit] = useState(200);
  // 文件夹过滤来自 URL query（?folder_id=xxx / none），树上移全局侧边栏后页内不再放面板
  const [searchParams, setSearchParams] = useSearchParams();
  const folderParam = searchParams.get('folder_id');

  const tagIdsParam = useMemo(() => {
    if (selectedTagIds.length === 0) return undefined;
    return selectedTagIds.join(',');
  }, [selectedTagIds]);

  // 跟随侧边栏全局脑侧：个人脑只看个人脑笔记、网络脑只看网络脑笔记、整合脑（both）不过滤
  const { brainSide } = useNavigation();
  // 切换脑侧时清除 URL 上的文件夹过滤（夹属另一个脑，过滤随之失效）
  useEffect(() => {
    if (searchParams.get('folder_id')) {
      const next = new URLSearchParams(searchParams);
      next.delete('folder_id');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brainSide]);

  const {
    notes,
    isLoading,
    createNote,
    updateNote,
    deleteNote,
    batchDeleteNotes,
    batchUpdateTags,
    isCreating,
    isUpdating,
    isDeleting,
    isBatchDeleting,
    isBatchUpdatingTags,
  } = useNotes({
    q: searchQuery || undefined,
    tag_ids: tagIdsParam,
    brain_side: brainSide === 'both' ? undefined : brainSide,
    folder_id: folderParam || undefined,
    limit,
  });
  const { tags: allTags, isLoading: isTagsLoading } = useTags();
  const { personalFolders, networkFolders } = useFolders(brainSide);

  // 「移动到文件夹」下拉的选项：当前脑文件夹 flat 列表（both 模式两脑合并、带前缀）
  const moveOptions = useMemo<FolderOption[]>(() => {
    const sides: { label: string; folders?: Folder[] }[] =
      brainSide === 'both'
        ? [{ label: '个人', folders: personalFolders }, { label: '网络', folders: networkFolders }]
        : brainSide === 'network'
          ? [{ label: '', folders: networkFolders }]
          : [{ label: '', folders: personalFolders }];
    const out: FolderOption[] = [];
    for (const side of sides) {
      if (!side.folders) continue;
      const idSet = new Set(side.folders.map((f) => f.id));
      const childrenOf = new Map<string | null, Folder[]>();
      for (const f of side.folders) {
        // 父级不在本列表（异常数据）时按根级处理
        const key = f.parent_id && idSet.has(f.parent_id) ? f.parent_id : null;
        if (!childrenOf.has(key)) childrenOf.set(key, []);
        childrenOf.get(key)!.push(f);
      }
      const walk = (parentKey: string | null, depth: number) => {
        for (const f of childrenOf.get(parentKey) || []) {
          out.push({
            id: f.id,
            label: `${side.label ? `[${side.label}] ` : ''}${'　'.repeat(depth)}${f.name}`,
          });
          walk(f.id, depth + 1);
        }
      };
      walk(null, 0);
    }
    return out;
  }, [brainSide, personalFolders, networkFolders]);

  // 移动笔记到文件夹（folderId 为 null = 未归档）；更新后由 useNotes 的失效逻辑刷新列表与计数
  const moveNotesToFolder = async (ids: string[], folderId: string | null) => {
    try {
      await Promise.all(ids.map((id) => updateNote({ id, data: { folder_id: folderId } })));
      setSelectedIds(new Set());
    } catch (err: any) {
      setError(err.message || '移动到文件夹失败');
    }
  };

  const handleMoveNote = (id: string, folderId: string | null) => moveNotesToFolder([id], folderId);

  const filteredNotes = useMemo(() => notes || [], [notes]);

  // 不再做客户端截断：拉取上限由 limit 状态控制（「加载更多」每次 +200），
  // 避免一次性挂载几千个 DOM 节点的诉求由服务端 limit 天然保证
  const displayNotes = filteredNotes;
  const hasMore = filteredNotes.length >= limit;
  const useMotion = displayNotes.length <= MOTION_THRESHOLD;

  // Pre-format expensive fields once instead of inside every row render.
  const preparedNotes = useMemo(() => {
    return displayNotes.map((note) => ({
      ...note,
      excerpt: getExcerpt(note.content),
      updatedText: formatDate(note.updated_at),
    }));
  }, [displayNotes]);

  const openCreate = () => {
    navigate('/ingest/notes/new');
  };

  const openEdit = (note: Note) => {
    navigate(`/ingest/notes/${note.id}`);
  };

  const openQuickEditor = (note: Note) => {
    setEditingNote(note);
    setFormTitle(note.title);
    setFormContent(note.content);
    setFormTags(note.tags.map((t) => t.id || t.name));
    setError(null);
    setIsEditorOpen(true);
  };

  const openCreateQuick = () => {
    setEditingNote(null);
    setFormTitle('');
    setFormContent('');
    setFormTags([]);
    setError(null);
    setIsEditorOpen(true);
  };

  const closeEditor = () => {
    setIsEditorOpen(false);
    setEditingNote(null);
    setError(null);
  };

  const handleSave = async () => {
    if (!formTitle.trim() || !formContent.trim()) {
      setError('标题和内容不能为空');
      return;
    }
    try {
      setError(null);
      if (editingNote) {
        await updateNote({
          id: editingNote.id,
          data: { title: formTitle.trim(), content: formContent.trim(), tags: formTags },
        });
      } else {
        await createNote({ title: formTitle.trim(), content: formContent.trim(), tags: formTags });
      }
      closeEditor();
    } catch (err: any) {
      setError(err.message || '保存失败，请重试');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这条笔记吗？')) return;
    try {
      await deleteNote(id);
      // 删除后同步清理选中态，避免批量操作作用于已删除项
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (err: any) {
      setError(err.message || '删除失败，请重试');
    }
  };

  const toggleTagFilter = (tagId: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    );
  };

  // 筛选/列表变化时裁剪选中项，避免批量操作作用于不可见或已删除笔记
  useEffect(() => {
    setSelectedIds(prev => {
      const visible = new Set(displayNotes.map(n => n.id));
      const next = new Set([...prev].filter(id => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [displayNotes]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === displayNotes.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(displayNotes.map(n => n.id)));
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`确定要删除选中的 ${selectedIds.size} 条笔记吗？`)) return;
    try {
      await batchDeleteNotes(Array.from(selectedIds));
      setSelectedIds(new Set());
    } catch (err: any) {
      setError(err.message || '批量删除失败');
    }
  };

  const handleBatchTag = async (tags: string[]) => {
    if (selectedIds.size === 0) return;
    try {
      await batchUpdateTags({ ids: Array.from(selectedIds), tags });
      setSelectedIds(new Set());
    } catch (err: any) {
      setError(err.message || '批量打标签失败');
    }
  };

  const handleBatchExport = () => {
    if (!notes || selectedIds.size === 0) return;
    const selected = notes.filter(n => selectedIds.has(n.id));
    const data = {
      notes: selected.map(n => ({
        title: n.title,
        content: n.content,
        brain_side: n.brain_side,
        tags: n.tags.map(t => t.name),
        created_at: n.created_at,
        updated_at: n.updated_at,
      })),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `notes-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Hoisted function declarations (not const arrow fns): preparedNotes' useMemo above
  // calls these during first render, and const arrow fns would be in the temporal dead
  // zone (ReferenceError: Cannot access before initialization).
  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function getExcerpt(content: string, maxLen = 120) {
    const plain = content.replace(/[#*`[\]()]/g, '').replace(/\s+/g, ' ').trim();
    return plain.length > maxLen ? plain.slice(0, maxLen) + '...' : plain;
  }

  const isSaving = isCreating || isUpdating;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">笔记管理</h1>
          <p className="text-sm text-text-secondary mt-1">记录灵感、整理思绪、建立知识连接</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="badge-personal">Personal Brain</span>
          <button
            onClick={() => navigate('/ingest/batch-import?type=notes')}
            className="btn-secondary flex items-center gap-2"
          >
            <Upload className="w-4 h-4" />
            批量导入
          </button>
          <button onClick={openCreate} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" />
            新建笔记
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

      {/* Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索笔记标题、内容..."
            className="w-full bg-bg-secondary border border-border-color rounded-[2px] pl-10 pr-4 py-2.5 text-sm text-text-primary placeholder-text-secondary focus:outline-none focus:border-info/50 transition-colors"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowTagFilter((v) => !v)}
            className={`btn-secondary flex items-center gap-2 ${showTagFilter || selectedTagIds.length > 0 ? 'border-info/50 text-info' : ''}`}
          >
            <Filter className="w-4 h-4" />
            标签筛选
            {selectedTagIds.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-info/20 text-info text-[10px]">{selectedTagIds.length}</span>
            )}
          </button>
          <div className="flex items-center gap-1 bg-bg-secondary border border-border-color rounded-[2px] p-1">
            {VIEW_MODES.map((m) => {
              const Icon = m.icon;
              return (
                <button
                  key={m.key}
                  onClick={() => setViewMode(m.key as 'grid' | 'list')}
                  className={`p-2 rounded-[2px] transition-colors ${viewMode === m.key ? 'bg-white/[0.05] text-info' : 'text-text-muted hover:text-text-primary'}`}
                  title={m.label}
                >
                  <Icon className="w-4 h-4" />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Tag Filter Bar */}
      <AnimatePresence>
        {showTagFilter && allTags && allTags.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-2 flex-wrap bg-bg-secondary border border-border-color rounded-[2px] p-3">
              {allTags.map((tag) => {
                const isSelected = selectedTagIds.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    onClick={() => toggleTagFilter(tag.id)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border transition-colors ${
                      isSelected ? 'text-text-primary' : 'hover:bg-white/[0.05] text-text-muted'
                    }`}
                    style={{
                      borderColor: isSelected ? (tag.color || '#8b949e') : `${tag.color || '#8b949e'}33`,
                      color: isSelected ? (tag.color || '#8b949e') : undefined,
                    }}
                  >
                    <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: tag.color || '#8b949e' }} />
                    {tag.name}
                    {isSelected && <X className="w-3 h-3" />}
                  </button>
                );
              })}
              {selectedTagIds.length > 0 && (
                <button
                  onClick={() => setSelectedTagIds([])}
                  className="text-[10px] text-text-muted hover:text-danger transition-colors ml-auto"
                >
                  清除筛选
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 文件夹过滤提示（来自 URL ?folder_id=，树在全局侧边栏；此处仅作提示与清除） */}
      {folderParam && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-text-muted">当前文件夹：</span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border border-info/40 bg-info/10 text-info">
            <FolderIcon className="w-3 h-3" />
            {folderParam === 'none'
              ? '未归档'
              : [...(personalFolders || []), ...(networkFolders || [])].find((f) => f.id === folderParam)?.name || '文件夹'}
            <button onClick={() => {
              const next = new URLSearchParams(searchParams);
              next.delete('folder_id');
              setSearchParams(next, { replace: true });
            }}>
              <X className="w-3 h-3" />
            </button>
          </span>
        </div>
      )}

      {/* Active filters */}
      {selectedTagIds.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-text-muted">当前筛选：</span>
          {selectedTagIds.map((id) => {
            const tag = allTags?.find((t) => t.id === id);
            if (!tag) return null;
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border"
                style={{ borderColor: tag.color + '40', backgroundColor: tag.color + '15', color: tag.color }}
              >
                {tag.name}
                <button onClick={() => setSelectedTagIds((prev) => prev.filter((x) => x !== id))}>
                  <X className="w-3 h-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Batch Toolbar */}
      {filteredNotes.length > 0 && (
        <div className="flex items-center justify-between bg-bg-secondary border border-border-color rounded-[2px] px-4 py-2.5">
          <div className="flex items-center gap-3">
            <button
              onClick={toggleSelectAll}
              className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
            >
              {selectedIds.size === filteredNotes.length ? (
                <CheckSquare className="w-4 h-4 text-info" />
              ) : (
                <Square className="w-4 h-4" />
              )}
              全选
            </button>
            {selectedIds.size > 0 && (
              <span className="text-xs text-info">已选 {selectedIds.size} 条</span>
            )}
          </div>
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2">
              <select
                value="__move"
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '__move') return;
                  moveNotesToFolder(Array.from(selectedIds), v === '' ? null : v);
                }}
                className="bg-bg-secondary border border-border-color rounded-[2px] text-xs text-text-secondary py-1.5 px-2"
                title="移动到文件夹"
              >
                <option value="__move">移动到文件夹...</option>
                <option value="">未归档</option>
                {moveOptions.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
              <TagSelector
                availableTags={allTags || []}
                value={[]}
                onChange={(tags) => { handleBatchTag(tags); }}
                disabled={isBatchUpdatingTags}
                isLoading={isTagsLoading}
                placeholder="批量打标签..."
              />
              <button
                onClick={handleBatchExport}
                className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                导出
              </button>
              <button
                onClick={handleBatchDelete}
                disabled={isBatchDeleting}
                className="px-3 py-1.5 bg-danger/10 text-danger border border-danger/30 rounded-[2px] text-xs font-medium transition-all hover:bg-danger/20 flex items-center gap-1.5 disabled:opacity-60"
              >
                {isBatchDeleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <Trash2 className="w-3.5 h-3.5" />
                删除
              </button>
            </div>
          )}
        </div>
      )}

      {/* Load more：服务端按 limit 截断，返回数达到 limit 说明可能还有 */}
      {hasMore && (
        limit < 1000 ? (
          <button
            onClick={() => setLimit((l) => Math.min(l + 200, 1000))}
            className="w-full px-4 py-2.5 rounded-[2px] border border-border-color text-xs text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
          >
            加载更多（已显示 {preparedNotes.length} 条）
          </button>
        ) : (
          <div className="px-4 py-2.5 rounded-[2px] bg-warning/10 border border-warning/30 text-warning text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            已达上限，请使用搜索或标签筛选缩小范围。
          </div>
        )
      )}

      {/* Loading */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 text-info animate-spin" />
        </div>
      ) : preparedNotes.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-20">
          <FileText className="w-16 h-16 text-text-muted mb-4" />
          <p className="text-text-secondary">暂无笔记</p>
          <p className="text-xs text-text-muted mt-2">点击右上角「新建笔记」或「快速新建」开始记录</p>
          <button onClick={openCreateQuick} className="btn-primary mt-4 flex items-center gap-2 text-xs">
            <Plus className="w-3.5 h-3.5" />
            快速新建
          </button>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {useMotion ? (
            <AnimatePresence>
              {preparedNotes.map((note) => (
                <motion.div
                  key={note.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className={`card flex flex-col justify-between group ${selectedIds.has(note.id) ? 'border-info/40 bg-info/5' : ''}`}
                >
                  <NoteGridContent note={note} selectedIds={selectedIds} toggleSelect={toggleSelect} openEdit={openEdit} openQuickEditor={openQuickEditor} handleDelete={handleDelete} isDeleting={isDeleting} moveOptions={moveOptions} onMoveNote={handleMoveNote} />
                </motion.div>
              ))}
            </AnimatePresence>
          ) : (
            preparedNotes.map((note) => (
              <div
                key={note.id}
                className={`card flex flex-col justify-between group ${selectedIds.has(note.id) ? 'border-info/40 bg-info/5' : ''}`}
              >
                <NoteGridContent note={note} selectedIds={selectedIds} toggleSelect={toggleSelect} openEdit={openEdit} openQuickEditor={openQuickEditor} handleDelete={handleDelete} isDeleting={isDeleting} moveOptions={moveOptions} onMoveNote={handleMoveNote} />
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {useMotion ? (
            <AnimatePresence>
              {preparedNotes.map((note) => (
                <motion.div
                  key={note.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className={`card flex items-center gap-4 group ${selectedIds.has(note.id) ? 'border-info/40 bg-info/5' : ''}`}
                >
                  <NoteListContent note={note} selectedIds={selectedIds} toggleSelect={toggleSelect} openEdit={openEdit} openQuickEditor={openQuickEditor} handleDelete={handleDelete} isDeleting={isDeleting} moveOptions={moveOptions} onMoveNote={handleMoveNote} />
                </motion.div>
              ))}
            </AnimatePresence>
          ) : (
            preparedNotes.map((note) => (
              <div
                key={note.id}
                className={`card flex items-center gap-4 group ${selectedIds.has(note.id) ? 'border-info/40 bg-info/5' : ''}`}
              >
                <NoteListContent note={note} selectedIds={selectedIds} toggleSelect={toggleSelect} openEdit={openEdit} openQuickEditor={openQuickEditor} handleDelete={handleDelete} isDeleting={isDeleting} moveOptions={moveOptions} onMoveNote={handleMoveNote} />
              </div>
            ))
          )}
        </div>
      )}

      {/* Quick Editor Modal */}
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
                <h3 className="text-sm font-medium text-text-primary">
                  {editingNote ? '快速编辑' : '快速新建'}
                </h3>
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
                    placeholder="输入笔记标题..."
                    className="w-full bg-bg-primary border border-border-color rounded-[2px] px-4 py-2.5 text-sm text-text-primary placeholder-text-secondary focus:outline-none focus:border-info/50 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1.5">标签</label>
                  <TagSelector
                    availableTags={allTags || []}
                    value={formTags}
                    onChange={setFormTags}
                    isLoading={isTagsLoading}
                    placeholder="输入标签，回车或逗号分隔..."
                  />
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1.5">内容</label>
                  <textarea
                    value={formContent}
                    onChange={(e) => setFormContent(e.target.value)}
                    placeholder="在这里输入笔记内容..."
                    rows={10}
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

export default NotesPage;

interface PreparedNote extends Note {
  excerpt: string;
  updatedText: string;
}

// 单条笔记的「移动到文件夹」下拉（网格/列表两种视图共用同一份选项）
const NoteMoveSelect: FC<{
  note: Note;
  moveOptions: FolderOption[];
  onMoveNote: (id: string, folderId: string | null) => void;
}> = ({ note, moveOptions, onMoveNote }) => (
  <select
    value="__keep"
    onChange={(e) => {
      const v = e.target.value;
      if (v === '__keep') return;
      onMoveNote(note.id, v === '' ? null : v);
    }}
    onClick={(e) => e.stopPropagation()}
    className="bg-transparent border border-border-color rounded-[2px] text-[10px] text-text-muted py-1 px-1 opacity-0 group-hover:opacity-100 transition-opacity"
    title="移动到文件夹"
  >
    <option value="__keep">移动到...</option>
    <option value="">未归档</option>
    {moveOptions.map((o) => (
      <option key={o.id} value={o.id}>{o.label}</option>
    ))}
  </select>
);

const NoteGridContent: FC<{
  note: PreparedNote;
  selectedIds: Set<string>;
  toggleSelect: (id: string) => void;
  openEdit: (note: Note) => void;
  openQuickEditor: (note: Note) => void;
  handleDelete: (id: string) => void;
  isDeleting: boolean;
  moveOptions: FolderOption[];
  onMoveNote: (id: string, folderId: string | null) => void;
}> = memo(({ note, selectedIds, toggleSelect, openEdit, openQuickEditor, handleDelete, isDeleting, moveOptions, onMoveNote }) => (
  <>
    <div className="flex items-start justify-between mb-2">
      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => openEdit(note)}>
        <div className="text-sm font-medium text-text-primary truncate hover:text-info transition-colors">
          {note.title}
        </div>
      </div>
      <input
        type="checkbox"
        checked={selectedIds.has(note.id)}
        onChange={() => toggleSelect(note.id)}
        className="accent-info ml-2 mt-0.5 cursor-pointer"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => openEdit(note)}>
      <div className="text-xs text-text-secondary line-clamp-3 leading-relaxed">
        {note.excerpt}
      </div>
      {note.tags && note.tags.length > 0 && (
        <div className="flex items-center gap-1 mt-3 flex-wrap">
          {note.tags.slice(0, 4).map((tag) => (
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
          {note.tags.length > 4 && (
            <span className="text-[10px] text-text-muted">+{note.tags.length - 4}</span>
          )}
        </div>
      )}
    </div>
    <div className="flex items-center justify-between mt-4 pt-3 border-t border-border-color">
      <div className="flex items-center gap-1 text-xs text-text-muted">
        <Clock className="w-3 h-3" />
        {note.updatedText}
      </div>
      <div className="flex items-center gap-1">
        <NoteMoveSelect note={note} moveOptions={moveOptions} onMoveNote={onMoveNote} />
        <button
          onClick={() => openQuickEditor(note)}
          className="p-1.5 rounded-[2px] hover:bg-white/[0.05] text-text-muted hover:text-info transition-colors"
          title="快速编辑"
        >
          <Edit3 className="w-4 h-4" />
        </button>
        <button
          onClick={() => handleDelete(note.id)}
          disabled={isDeleting}
          className="p-1.5 rounded-[2px] hover:bg-white/[0.05] text-text-muted hover:text-danger transition-colors disabled:opacity-50"
          title="删除"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  </>
));

const NoteListContent: FC<{
  note: PreparedNote;
  selectedIds: Set<string>;
  toggleSelect: (id: string) => void;
  openEdit: (note: Note) => void;
  openQuickEditor: (note: Note) => void;
  handleDelete: (id: string) => void;
  isDeleting: boolean;
  moveOptions: FolderOption[];
  onMoveNote: (id: string, folderId: string | null) => void;
}> = memo(({ note, selectedIds, toggleSelect, openEdit, openQuickEditor, handleDelete, isDeleting, moveOptions, onMoveNote }) => (
  <>
    <input
      type="checkbox"
      checked={selectedIds.has(note.id)}
      onChange={() => toggleSelect(note.id)}
      className="accent-info cursor-pointer"
    />
    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => openEdit(note)}>
      <div className="text-sm font-medium text-text-primary hover:text-info transition-colors">
        {note.title}
      </div>
      <div className="text-xs text-text-secondary line-clamp-1 mt-0.5">
        {note.excerpt}
      </div>
    </div>
    {note.tags && note.tags.length > 0 && (
      <div className="hidden md:flex items-center gap-1 flex-wrap">
        {note.tags.slice(0, 3).map((tag) => (
          <span
            key={tag.id}
            className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full border"
            style={{
              borderColor: `${tag.color}33`,
              color: tag.color,
              backgroundColor: `${tag.color}11`,
            }}
          >
            {tag.name}
          </span>
        ))}
      </div>
    )}
    <div className="text-xs text-text-muted whitespace-nowrap">{note.updatedText}</div>
    <div className="flex items-center gap-1">
      <NoteMoveSelect note={note} moveOptions={moveOptions} onMoveNote={onMoveNote} />
      <button
        onClick={() => openQuickEditor(note)}
        className="p-1.5 rounded-[2px] hover:bg-white/[0.05] text-text-muted hover:text-info transition-colors"
        title="快速编辑"
      >
        <Edit3 className="w-4 h-4" />
      </button>
      <button
        onClick={() => handleDelete(note.id)}
        disabled={isDeleting}
        className="p-1.5 rounded-[2px] hover:bg-white/[0.05] text-text-muted hover:text-danger transition-colors disabled:opacity-50"
        title="删除"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  </>
));
