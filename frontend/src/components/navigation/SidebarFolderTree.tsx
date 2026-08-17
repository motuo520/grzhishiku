import { FC, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  ChevronDown, ChevronRight, Folder as FolderIcon, FolderPlus, MoreHorizontal, Inbox,
} from 'lucide-react';
import type { Folder } from '@/api/folders';
import { useFolders } from '@/hooks/useFolders';

// 全局左侧边栏的文件夹树（紧凑版，无标题栏）：
// 当前脑=personal/network 显示一棵；both 分「个人脑」「网络脑」两组。
// 点节点跳 /folders/:id，「未归档」跳 /folders/none（按当前脑）。
interface SidebarFolderTreeProps {
  brainSide: string;
}

interface FolderNode extends Folder {
  children: FolderNode[];
}

// 后端返回 flat 列表，这里按 parent_id 组装成树
function buildTree(folders: Folder[]): FolderNode[] {
  const map = new Map<string, FolderNode>();
  folders.forEach((f) => map.set(f.id, { ...f, children: [] }));
  const roots: FolderNode[] = [];
  map.forEach((node) => {
    if (node.parent_id && map.has(node.parent_id)) {
      map.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}

const SidebarFolderTree: FC<SidebarFolderTreeProps> = ({ brainSide }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { personalFolders, networkFolders, createFolder, updateFolder, removeFolder } = useFolders(brainSide);
  // 默认全部展开，记录被收起的节点 id
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [menuFor, setMenuFor] = useState<string | null>(null);

  // 当前路由命中的文件夹 id（/folders/:id），用于高亮
  const routeMatch = location.pathname.match(/^\/folders\/([^/]+)$/);
  const activeId = routeMatch ? decodeURIComponent(routeMatch[1]) : null;

  const toggleCollapsed = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreate = async (side: string, parentId: string | null) => {
    const name = window.prompt(parentId ? '子文件夹名称：' : '文件夹名称：');
    if (!name || !name.trim()) return;
    try {
      await createFolder({ name: name.trim(), brain_side: side, parent_id: parentId });
    } catch (e: any) {
      window.alert(e?.response?.data?.detail || e.message || '创建失败');
    }
  };

  const handleRename = async (folder: Folder) => {
    const name = window.prompt('重命名文件夹：', folder.name);
    if (!name || !name.trim() || name.trim() === folder.name) return;
    try {
      await updateFolder({ id: folder.id, data: { name: name.trim() } });
    } catch (e: any) {
      window.alert(e?.response?.data?.detail || e.message || '重命名失败');
    }
  };

  const handleDelete = async (folder: Folder) => {
    if (!window.confirm(`确定删除文件夹「${folder.name}」吗？其中的子文件夹和内容将上移到上一级。`)) return;
    try {
      await removeFolder(folder.id);
      // 删除的正是当前查看的夹时回到笔记列表，避免停在已消失的文件夹页
      if (activeId === folder.id) navigate('/ingest/notes');
    } catch (e: any) {
      window.alert(e?.response?.data?.detail || e.message || '删除失败');
    }
  };

  const renderNode = (node: FolderNode, side: string, depth: number) => {
    const hasChildren = node.children.length > 0;
    const isCollapsed = collapsed.has(node.id);
    const isActive = activeId === node.id;
    return (
      <div key={node.id}>
        <div
          className={`group relative flex items-center gap-1 py-1 pr-1 rounded-[2px] cursor-pointer text-xs transition-colors ${
            isActive ? 'bg-info/15 text-info' : 'text-text-secondary hover:bg-white/[0.05] hover:text-text-primary'
          }`}
          style={{ paddingLeft: `${4 + depth * 12}px` }}
          onClick={() => navigate(`/folders/${node.id}`)}
        >
          {hasChildren ? (
            <button
              onClick={(e) => { e.stopPropagation(); toggleCollapsed(node.id); }}
              className="p-0.5 text-text-muted hover:text-text-primary"
            >
              {isCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          ) : (
            <span className="w-4" />
          )}
          <FolderIcon className="w-3.5 h-3.5 shrink-0" />
          <span className="flex-1 min-w-0 truncate">{node.name}</span>
          {/* 总内容数 = 直属笔记 + 直属知识单元 */}
          <span className="text-[10px] text-text-muted">{node.note_count + node.knowledge_count}</span>
          <button
            onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === node.id ? null : node.id); }}
            className="p-0.5 rounded-[2px] text-text-muted hover:text-text-primary opacity-0 group-hover:opacity-100 transition-opacity"
            title="更多操作"
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>
          {menuFor === node.id && (
            <>
              <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setMenuFor(null); }} />
              <div className="absolute right-0 top-full z-50 w-28 bg-bg-secondary border border-border-color rounded-[2px] py-1 shadow-lg">
                <button
                  onClick={(e) => { e.stopPropagation(); setMenuFor(null); handleCreate(side, node.id); }}
                  className="w-full text-left px-3 py-1.5 text-xs text-text-secondary hover:bg-white/[0.05] hover:text-text-primary"
                >
                  新建子文件夹
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setMenuFor(null); handleRename(node); }}
                  className="w-full text-left px-3 py-1.5 text-xs text-text-secondary hover:bg-white/[0.05] hover:text-text-primary"
                >
                  重命名
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setMenuFor(null); handleDelete(node); }}
                  className="w-full text-left px-3 py-1.5 text-xs text-danger hover:bg-danger/10"
                >
                  删除
                </button>
              </div>
            </>
          )}
        </div>
        {hasChildren && !isCollapsed && node.children.map((child) => renderNode(child, side, depth + 1))}
      </div>
    );
  };

  // 一棵脑的树；both 模式下作为分组渲染（组头带新建按钮）
  const renderGroup = (title: string | null, side: string, folders: Folder[] | undefined) => (
    <div>
      {title && (
        <div className="flex items-center justify-between px-1 pt-1.5 pb-0.5">
          <span className="text-[10px] uppercase tracking-wide text-text-muted">{title}</span>
          <button
            onClick={() => handleCreate(side, null)}
            className="p-0.5 rounded-[2px] text-text-muted hover:text-info transition-colors"
            title={`在${title}下新建文件夹`}
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {(!folders || folders.length === 0) ? (
        <p className="px-1 py-0.5 text-[10px] text-text-muted">暂无文件夹</p>
      ) : (
        buildTree(folders).map((node) => renderNode(node, side, 0))
      )}
    </div>
  );

  const newRootSide = brainSide === 'network' ? 'network' : 'personal';

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1 px-1">
        <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">文件夹</span>
        {brainSide !== 'both' && (
          <button
            onClick={() => handleCreate(newRootSide, null)}
            className="p-0.5 rounded-[2px] text-text-muted hover:text-info transition-colors"
            title="新建文件夹"
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <div
        className={`flex items-center gap-1.5 px-2 py-1 rounded-[2px] cursor-pointer text-xs transition-colors ${
          activeId === 'none' ? 'bg-info/15 text-info' : 'text-text-secondary hover:bg-white/[0.05] hover:text-text-primary'
        }`}
        onClick={() => navigate('/folders/none')}
      >
        <Inbox className="w-3.5 h-3.5" />
        未归档
      </div>
      {brainSide === 'both' ? (
        <>
          {renderGroup('个人脑', 'personal', personalFolders)}
          {renderGroup('网络脑', 'network', networkFolders)}
        </>
      ) : brainSide === 'network' ? (
        renderGroup(null, 'network', networkFolders)
      ) : (
        renderGroup(null, 'personal', personalFolders)
      )}
    </div>
  );
};

export default SidebarFolderTree;
