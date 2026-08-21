import { FC, useMemo, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, Folder as FolderIcon, Inbox, FileText, BookOpen, Loader2, FolderMinus, Search,
} from 'lucide-react';
import { useNavigation } from '@/store/navigation';
import { useFolders } from '@/hooks/useFolders';
import { useNotes } from '@/hooks/useNotes';
import { useUpdateKnowledgeUnit } from '@/hooks/useKnowledge';
import { knowledgeApi } from '@/api/knowledge';
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
  const { mutateAsync: updateUnit } = useUpdateKnowledgeUnit();
  const [searchQuery, setSearchQuery] = useState('');

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

  const getExcerpt = (content: string, maxLen = 120) => {
    const plain = content.replace(/[#*`[\]()]/g, '').replace(/\s+/g, ' ').trim();
    return plain.length > maxLen ? plain.slice(0, maxLen) + '...' : plain;
  };

  const isLoading = isFoldersLoading || isNotesLoading || isUnitsLoading;

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

          {/* 知识卡片分区 */}
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
                      <div className="text-sm font-medium text-text-primary hover:text-info transition-colors truncate">
                        {unit.source_title || getExcerpt(unit.content_raw, 40)}
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
        </>
      )}
    </div>
  );
};

export default FolderPage;
