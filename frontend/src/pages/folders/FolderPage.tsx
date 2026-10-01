import { FC, useMemo, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Folder as FolderIcon, Inbox, FileText, BookOpen, Loader2, FolderMinus, Search, Globe, File,
} from 'lucide-react';
import { useNavigation } from '@/store/navigation';
import { useFolders } from '@/hooks/useFolders';
import { useNotes } from '@/hooks/useNotes';
import { useUpdateKnowledgeUnit } from '@/hooks/useKnowledge';
import { knowledgeApi } from '@/api/knowledge';
import { clipsApi, type Clip } from '@/api/clips';
import { documentApi, type DocumentItem } from '@/api/document';
import FolderPicker from '@/components/folders/FolderPicker';
import { invalidateContentQueries } from '@/utils/invalidateContent';
import type { KnowledgeUnit } from '@/types';

// 文件夹内容页：/folders/:id（:id 为 "none" 时=未归档，按 ?brain= 或当前脑，both 兜底个人脑）
const FolderPage: FC = () => {
  const { id = '' } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { brainSide } = useNavigation();
  const isNone = id === 'none';

  // 两脑的文件夹都拉，按 id 定位（具体夹的脑侧以文件夹自身为准）
  const { personalFolders, networkFolders, isLoading: isFoldersLoading } = useFolders('both');
  const folder = useMemo(
    () => [...(personalFolders || []), ...(networkFolders || [])].find((f) => f.id === id) || null,
    [personalFolders, networkFolders, id]
  );

  // 未归档视图的脑侧：URL ?brain= 优先，其次当前脑，both 时按个人脑（与后端默认口径一致）
  const brain = useMemo(() => {
    if (folder) return folder.brain_side;
    const q = searchParams.get('brain');
    if (q === 'personal' || q === 'network') return q;
    return brainSide === 'personal' || brainSide === 'network' ? brainSide : 'personal';
  }, [folder, searchParams, brainSide]);

  const brainLabel = brain === 'network' ? '网络脑' : '个人脑';
  const title = folder ? folder.name : `未归档 · ${brainLabel}`;

  const listParams = {
    folder_id: id,
    // 具体夹由归属规则约束脑侧，无需再传；未归档必须带脑侧
    brain_side: isNone ? brain : undefined,
  };
  // 单夹笔记一次拉全（后端上限已放宽至 1000，个人库规模无压力）
  const { notes, isLoading: isNotesLoading, updateNote } = useNotes({ ...listParams, limit: 1000 });
  const { data: units, isLoading: isUnitsLoading } = useQuery<KnowledgeUnit[]>({
    queryKey: ['knowledge', 'folder', id, brain],
    queryFn: async () => (await knowledgeApi.list(listParams)).data,
    staleTime: 60 * 1000,
  });
  // 剪藏进树（08-22）：文件夹页带剪藏分区
  const { data: clips, isLoading: isClipsLoading } = useQuery<Clip[]>({
    queryKey: ['clips', 'folder', id, brain],
    queryFn: async () => (await clipsApi.list({ ...listParams, limit: 1000 })).data,
    staleTime: 60 * 1000,
  });
  // 文档进树（09-10 口径B 手动归档）：文件夹页带文档分区
  const { data: docs, isLoading: isDocsLoading } = useQuery<DocumentItem[]>({
    queryKey: ['documents', 'folder', id, brain],
    queryFn: async () => (await documentApi.list({ ...listParams, limit: 1000 })).data,
    staleTime: 60 * 1000,
  });
  const queryClient = useQueryClient();
  const { mutateAsync: updateUnit } = useUpdateKnowledgeUnit();
  const [searchQuery, setSearchQuery] = useState('');

  // 手动归档（行内 FolderPicker）：三类内容同口径
  const handleFileNote = async (noteId: string, folderId: string) => {
    try {
      await updateNote({ id: noteId, data: { folder_id: folderId } });
    } catch (e: any) {
      window.alert(e?.response?.data?.detail || e.message || '归档失败');
    }
  };
  const handleFileUnit = async (unitId: string, folderId: string) => {
    try {
      await updateUnit({ id: unitId, data: { folder_id: folderId } });
    } catch (e: any) {
      window.alert(e?.response?.data?.detail || e.message || '归档失败');
    }
  };
  const handleFileClip = async (clipId: string, folderId: string) => {
    try {
      await clipsApi.update(clipId, { folder_id: folderId });
      invalidateContentQueries(queryClient);
    } catch (e: any) {
      window.alert(e?.response?.data?.detail || e.message || '归档失败');
    }
  };
  const handleFileDoc = async (docId: string, folderId: string) => {
    try {
      await documentApi.update(docId, { folder_id: folderId });
      invalidateContentQueries(queryClient);
    } catch (e: any) {
      window.alert(e?.response?.data?.detail || e.message || '归档失败');
    }
  };

  // 页内检索：客户端过滤当前文件夹的笔记标题/正文与知识正文
  const filteredNotes = useMemo(() => {
    const all = notes || [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return all;
    return all.filter((n) => n.title?.toLowerCase().includes(q) || n.content?.toLowerCase().includes(q));
  }, [notes, searchQuery]);

  const filteredUnits = useMemo(() => {
    const all = units || [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return all;
    return all.filter((u) => u.content_raw?.toLowerCase().includes(q) || u.source_title?.toLowerCase().includes(q));
  }, [units, searchQuery]);

  const filteredClips = useMemo(() => {
    const all = clips || [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return all;
    return all.filter((c) => c.title?.toLowerCase().includes(q) || c.excerpt?.toLowerCase().includes(q));
  }, [clips, searchQuery]);

  const filteredDocs = useMemo(() => {
    const all = docs || [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return all;
    return all.filter((d) => d.title?.toLowerCase().includes(q) || d.original_name?.toLowerCase().includes(q));
  }, [docs, searchQuery]);

  const handleRemoveNote = async (noteId: string) => {
    try {
      await updateNote({ id: noteId, data: { folder_id: null } });
    } catch (e: any) {
      window.alert(e?.response?.data?.detail || e.message || '移出失败');
    }
  };

  const handleRemoveUnit = async (unitId: string) => {
    try {
      await updateUnit({ id: unitId, data: { folder_id: null } });
    } catch (e: any) {
      window.alert(e?.response?.data?.detail || e.message || '移出失败');
    }
  };

  const handleRemoveClip = async (clipId: string) => {
    try {
      await clipsApi.update(clipId, { folder_id: null });
      invalidateContentQueries(queryClient);
    } catch (e: any) {
      window.alert(e?.response?.data?.detail || e.message || '移出失败');
    }
  };

  const handleRemoveDoc = async (docId: string) => {
    try {
      await documentApi.update(docId, { folder_id: null });
      invalidateContentQueries(queryClient);
    } catch (e: any) {
      window.alert(e?.response?.data?.detail || e.message || '移出失败');
    }
  };

  const getExcerpt = (content: string, maxLen = 120) => {
    const plain = content.replace(/[#*`[\]()]/g, '').replace(/\s+/g, ' ').trim();
    return plain.length > maxLen ? plain.slice(0, maxLen) + '...' : plain;
  };

  const isLoading = isFoldersLoading || isNotesLoading || isUnitsLoading || isClipsLoading || isDocsLoading;

  // 类型大选项卡（08-22 用户：分区堆叠不显眼，找不到碰撞/抽取产物）
  type TypeTab = 'all' | 'note' | 'knowledge' | 'clip' | 'document';
  const [typeTab, setTypeTab] = useState<TypeTab>('all');
  const TYPE_TABS: { id: TypeTab; label: string; count: number }[] = [
    { id: 'all', label: '全部', count: filteredNotes.length + filteredUnits.length + filteredClips.length + filteredDocs.length },
    { id: 'note', label: '笔记', count: filteredNotes.length },
    { id: 'knowledge', label: '知识卡片', count: filteredUnits.length },
    { id: 'clip', label: '剪藏', count: filteredClips.length },
    { id: 'document', label: '文档', count: filteredDocs.length },
  ];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="btn-secondary flex items-center gap-1.5 text-xs py-1.5 px-3"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          返回
        </button>
        <div className="flex items-center gap-2 min-w-0">
          {folder ? (
            <FolderIcon className="w-5 h-5 text-info shrink-0" />
          ) : (
            <Inbox className="w-5 h-5 text-info shrink-0" />
          )}
          <h1 className="text-xl font-bold text-text-primary truncate">{title}</h1>
          <span className={brain === 'network' ? 'badge-network' : 'badge-personal'}>{brainLabel}</span>
        </div>
      </div>

      {/* 类型大选项卡：全部/笔记/知识卡片/剪藏 */}
      {!isLoading && (
        <div className="flex items-center gap-1 border-b border-border-color pb-2">
          {TYPE_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setTypeTab(tab.id)}
              className={`px-3 py-1.5 rounded-[2px] text-xs font-medium transition-colors ${
                typeTab === tab.id
                  ? 'bg-bg-secondary text-info border border-border-color'
                  : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary border border-transparent'
              }`}
            >
              {tab.label}
              <span className="ml-1 text-[10px] text-text-muted">{tab.count}</span>
            </button>
          ))}
        </div>
      )}

      {/* 页内搜索 */}
      {!isLoading && (
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索本文件夹的笔记与知识..."
            className="w-full bg-bg-secondary border border-border-color rounded-[2px] pl-10 pr-4 py-2 text-sm text-text-primary placeholder-text-secondary focus:outline-none focus:border-info/50 transition-colors"
          />
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 text-info animate-spin" />
        </div>
      ) : (
        <>
          {/* 笔记分区 */}
          {(typeTab === 'all' || typeTab === 'note') && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-text-secondary flex items-center gap-1.5">
              <FileText className="w-4 h-4" />
              笔记
              <span className="text-[10px] text-text-muted">{filteredNotes.length}</span>
            </h2>
            {filteredNotes.length === 0 ? (
              <div className="card py-8 text-center text-xs text-text-muted">{searchQuery.trim() ? '没有匹配的笔记' : '此文件夹下暂无笔记'}</div>
            ) : (
              <div className="space-y-2">
                {filteredNotes.map((note) => (
                  <div key={note.id} className="card flex items-center gap-4 group">
                    <div
                      className="flex-1 min-w-0 cursor-pointer"
                      onClick={() => navigate(`/ingest/notes/${note.id}`)}
                    >
                      <div className="text-sm font-medium text-text-primary hover:text-info transition-colors truncate">
                        {note.title}
                      </div>
                      <div className="text-xs text-text-secondary line-clamp-1 mt-0.5">
                        {getExcerpt(note.content)}
                      </div>
                      {/* 标签直接露出：建档归类时一眼看到（08-22） */}
                      {note.tags && note.tags.length > 0 && (
                        <div className="flex items-center gap-1 mt-1 flex-wrap">
                          {note.tags.slice(0, 4).map((t) => (
                            <span key={t.id} className="px-1.5 py-0.5 rounded text-[10px] bg-info/10 text-info border border-info/20">{t.name}</span>
                          ))}
                          {note.tags.length > 4 && <span className="text-[10px] text-text-muted">+{note.tags.length - 4}</span>}
                        </div>
                      )}
                    </div>
                    <FolderPicker brainSide={note.brain_side} onPick={(fid) => handleFileNote(note.id, fid)} />
                    <button
                      onClick={() => handleRemoveNote(note.id)}
                      className="p-1.5 rounded-[2px] text-text-muted hover:text-warning hover:bg-white/[0.05] transition-colors opacity-0 group-hover:opacity-100"
                      title="移出文件夹"
                    >
                      <FolderMinus className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
          )}

          {/* 知识卡片分区 */}
          {(typeTab === 'all' || typeTab === 'knowledge') && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-text-secondary flex items-center gap-1.5">
              <BookOpen className="w-4 h-4" />
              知识卡片
              <span className="text-[10px] text-text-muted">{filteredUnits.length}</span>
            </h2>
            {filteredUnits.length === 0 ? (
              <div className="card py-8 text-center text-xs text-text-muted">{searchQuery.trim() ? '没有匹配的知识卡片' : '此文件夹下暂无知识卡片'}</div>
            ) : (
              <div className="space-y-2">
                {filteredUnits.map((unit) => (
                  <div key={unit.id} className="card flex items-center gap-4 group">
                    <div
                      className="flex-1 min-w-0 cursor-pointer"
                      onClick={() => navigate(`/knowledge/${unit.id}`)}
                    >
                      <div className="text-sm font-medium text-text-primary hover:text-info transition-colors truncate flex items-center gap-1.5">
                        <span className="truncate">{unit.source_title || getExcerpt(unit.content_raw, 40)}</span>
                        {/* 产物徽章：一眼认出抽取/碰撞产物（08-22 用户找不到它们） */}
                        {unit.content_subtype === 'concept' && (
                          <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] bg-success/10 text-success border border-success/20">概念卡</span>
                        )}
                        {unit.content_subtype === 'collision_result' && (
                          <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] bg-warning/10 text-warning border border-warning/20">碰撞火花</span>
                        )}
                      </div>
                      <div className="text-xs text-text-secondary line-clamp-1 mt-0.5">
                        {getExcerpt(unit.content_raw)}
                      </div>
                      {unit.tags && unit.tags.length > 0 && (
                        <div className="flex items-center gap-1 mt-1 flex-wrap">
                          {unit.tags.slice(0, 4).map((t) => (
                            <span key={t.id} className="px-1.5 py-0.5 rounded text-[10px] bg-info/10 text-info border border-info/20">{t.name}</span>
                          ))}
                          {unit.tags.length > 4 && <span className="text-[10px] text-text-muted">+{unit.tags.length - 4}</span>}
                        </div>
                      )}
                    </div>
                    <FolderPicker brainSide={unit.brain_side} onPick={(fid) => handleFileUnit(unit.id, fid)} />
                    <button
                      onClick={() => handleRemoveUnit(unit.id)}
                      className="p-1.5 rounded-[2px] text-text-muted hover:text-warning hover:bg-white/[0.05] transition-colors opacity-0 group-hover:opacity-100"
                      title="移出文件夹"
                    >
                      <FolderMinus className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
          )}

          {/* 剪藏分区 */}
          {(typeTab === 'all' || typeTab === 'clip') && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-text-secondary flex items-center gap-1.5">
              <Globe className="w-4 h-4" />
              剪藏
              <span className="text-[10px] text-text-muted">{filteredClips.length}</span>
            </h2>
            {filteredClips.length === 0 ? (
              <div className="card py-8 text-center text-xs text-text-muted">{searchQuery.trim() ? '没有匹配的剪藏' : '此文件夹下暂无剪藏'}</div>
            ) : (
              <div className="space-y-2">
                {filteredClips.map((clip) => (
                  <div key={clip.id} className="card flex items-center gap-4 group">
                    <div
                      className="flex-1 min-w-0 cursor-pointer"
                      onClick={() => navigate(`/ingest/clipper?highlight=${encodeURIComponent(clip.id)}`)}
                    >
                      <div className="text-sm font-medium text-text-primary hover:text-info transition-colors truncate">
                        {clip.title}
                      </div>
                      <div className="text-xs text-text-secondary line-clamp-1 mt-0.5">
                        {clip.domain}{clip.excerpt ? ` · ${getExcerpt(clip.excerpt, 80)}` : ''}
                      </div>
                      {clip.tags && clip.tags.length > 0 && (
                        <div className="flex items-center gap-1 mt-1 flex-wrap">
                          {clip.tags.slice(0, 4).map((t) => (
                            <span key={t.id} className="px-1.5 py-0.5 rounded text-[10px] bg-info/10 text-info border border-info/20">{t.name}</span>
                          ))}
                          {clip.tags.length > 4 && <span className="text-[10px] text-text-muted">+{clip.tags.length - 4}</span>}
                        </div>
                      )}
                    </div>
                    <FolderPicker brainSide={clip.brain_side} onPick={(fid) => handleFileClip(clip.id, fid)} />
                    <button
                      onClick={() => handleRemoveClip(clip.id)}
                      className="p-1.5 rounded-[2px] text-text-muted hover:text-warning hover:bg-white/[0.05] transition-colors opacity-0 group-hover:opacity-100"
                      title="移出文件夹"
                    >
                      <FolderMinus className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
          )}

          {/* 文档分区（09-10 口径B：手动归档进树） */}
          {(typeTab === 'all' || typeTab === 'document') && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-text-secondary flex items-center gap-1.5">
              <File className="w-4 h-4" />
              文档
              <span className="text-[10px] text-text-muted">{filteredDocs.length}</span>
            </h2>
            {filteredDocs.length === 0 ? (
              <div className="card py-8 text-center text-xs text-text-muted">{searchQuery.trim() ? '没有匹配的文档' : '此文件夹下暂无文档'}</div>
            ) : (
              <div className="space-y-2">
                {filteredDocs.map((doc) => (
                  <div key={doc.id} className="card flex items-center gap-4 group">
                    <div
                      className="flex-1 min-w-0 cursor-pointer"
                      onClick={() => navigate('/ingest/documents')}
                    >
                      <div className="text-sm font-medium text-text-primary hover:text-info transition-colors truncate">
                        {doc.title || doc.original_name}
                      </div>
                      <div className="text-xs text-text-secondary line-clamp-1 mt-0.5">
                        {doc.original_name}
                      </div>
                    </div>
                    <FolderPicker brainSide={doc.brain_side || 'personal'} onPick={(fid) => handleFileDoc(doc.id, fid)} />
                    <button
                      onClick={() => handleRemoveDoc(doc.id)}
                      className="p-1.5 rounded-[2px] text-text-muted hover:text-warning hover:bg-white/[0.05] transition-colors opacity-0 group-hover:opacity-100"
                      title="移出文件夹"
                    >
                      <FolderMinus className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
          )}
        </>
      )}
    </div>
  );
};

export default FolderPage;
