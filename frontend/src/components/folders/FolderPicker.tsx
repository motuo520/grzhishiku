import { FC, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FolderInput } from 'lucide-react';
import { useFolders } from '@/hooks/useFolders';
import type { Folder } from '@/api/folders';

interface FolderPickerProps {
  /** 内容所属脑侧：列出该脑的文件夹树（both 内容列个人脑+网络脑两棵） */
  brainSide: string;
  onPick: (folderId: string) => void;
  title?: string;
}

// 手动归档选择器：行内小按钮 + 下拉树（点击展开/外部点击关闭，血泪 #28 不用 hover）。
// 下拉 portal 到 body + fixed 定位：此前 absolute 在 overflow-auto 的内容容器里，
// 靠近底部的行弹层被容器裁剪「点了看不到」（08-22 可信沉淀页实捕）；
// 下方空间不足自动向上翻。手动归档可进任何夹（含带规则的系统车道夹，手动优先）。
const FolderPicker: FC<FolderPickerProps> = ({ brainSide, onPick, title = '归档到文件夹' }) => {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const { personalFolders, networkFolders } = useFolders(brainSide === 'both' ? 'both' : brainSide);

  const items = useMemo(() => {
    const sides: { folders?: Folder[] }[] =
      brainSide === 'network'
        ? [{ folders: networkFolders }]
        : brainSide === 'personal'
          ? [{ folders: personalFolders }]
          : [{ folders: personalFolders }, { folders: networkFolders }];
    const out: { folder: Folder; depth: number }[] = [];
    for (const { folders } of sides) {
      const list = folders || [];
      const byParent = new Map<string | null, Folder[]>();
      list.forEach((f) => {
        const arr = byParent.get(f.parent_id) || [];
        arr.push(f);
        byParent.set(f.parent_id, arr);
      });
      const walk = (parentId: string | null, depth: number) => {
        for (const f of byParent.get(parentId) || []) {
          out.push({ folder: f, depth });
          walk(f.id, depth + 1);
        }
      };
      walk(null, 0);
    }
    return out;
  }, [brainSide, personalFolders, networkFolders]);

  // 弹层 fixed 定位：按钮右对齐，下方不足 260px 就向上翻
  const pos = useMemo(() => {
    if (!open || !btnRef.current) return null;
    const r = btnRef.current.getBoundingClientRect();
    const down = window.innerHeight - r.bottom >= 260;
    return {
      right: Math.max(8, window.innerWidth - r.right),
      ...(down ? { top: r.bottom + 4 } : { bottom: window.innerHeight - r.top + 4 }),
    };
  }, [open]);

  return (
    <span className="relative inline-block">
      <button
        ref={btnRef}
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="p-1.5 rounded-[2px] text-text-muted hover:text-info hover:bg-white/[0.05] transition-colors opacity-0 group-hover:opacity-100"
        title={title}
      >
        <FolderInput className="w-4 h-4" />
      </button>
      {open && pos && createPortal(
        <>
          <div className="fixed inset-0 z-[98]" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
          <div
            className="fixed z-[99] w-44 max-h-64 overflow-y-auto bg-bg-secondary border border-border-color rounded-[2px] py-1 shadow-lg"
            style={pos}
          >
            {items.length === 0 ? (
              <p className="px-3 py-2 text-xs text-text-muted">暂无文件夹</p>
            ) : (
              items.map(({ folder, depth }) => (
                <button
                  key={folder.id}
                  onClick={(e) => { e.stopPropagation(); setOpen(false); onPick(folder.id); }}
                  className="w-full text-left px-3 py-1.5 text-xs text-text-secondary hover:bg-white/[0.05] hover:text-text-primary truncate"
                  style={{ paddingLeft: `${12 + depth * 12}px` }}
                  title={folder.name}
                >
                  {folder.name}
                </button>
              ))
            )}
          </div>
        </>,
        document.body
      )}
    </span>
  );
};

export default FolderPicker;
