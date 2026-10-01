import { FC, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { settingsApi } from '@/api/settings';
import { notesApi } from '@/api/notes';
import { capsulesApi } from '@/api/capsules';
import { clipsApi } from '@/api/clips';
import { knowledgeApi } from '@/api/knowledge';
import { obsidianApi, ObsidianImportResult, MarkdownExportResult } from '@/api/obsidian';
import { detectFullExport } from '@/utils/importParsers';
import { Download, Upload, Trash2, AlertTriangle, Check, Loader2, FileJson, FileText, FolderInput, FolderOutput } from 'lucide-react';
import { downloadBlob, filenameFromDisposition } from '@/utils/download';
import { invalidateContentQueries } from '@/utils/invalidateContent';

// 桌面端（Electron）判定：浏览器中 window.psbDesktop 为 undefined
const isDesktop = !!window.psbDesktop?.isDesktop;

interface ImportPreviewItem {
  type: 'note' | 'capsule' | 'clip' | 'knowledge';
  title?: string;
  content?: string;
  error?: string;
}

const DataSettings: FC = () => {
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [showClearCacheConfirm, setShowClearCacheConfirm] = useState(false);
  const [preview, setPreview] = useState<ImportPreviewItem[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Obsidian 导入 / Markdown 导出（仅桌面端）
  const [vaultPath, setVaultPath] = useState('');
  const [obsidianResult, setObsidianResult] = useState<ObsidianImportResult | null>(null);
  const [exportDir, setExportDir] = useState('');
  const [mdExportResult, setMdExportResult] = useState<MarkdownExportResult | null>(null);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const exportMutation = useMutation({
    mutationFn: () => settingsApi.exportData(),
    onSuccess: (res) => {
      const disposition = (res.headers?.['content-disposition'] as string) || '';
      const filename = filenameFromDisposition(disposition) || `second-brain-export-${Date.now()}.json`;
      downloadBlob(new Blob([res.data], { type: 'application/json' }), filename);
      showToast('数据已导出，开始下载', 'success');
    },
    onError: (error: any) => showToast(error?.message || '导出失败', 'error'),
  });

  const clearCache = () => {
    try {
      // 保留登录 token 和所有 psb- 前缀的应用设置
      const keysToKeep = new Set(['access_token']);
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && !keysToKeep.has(key) && !key.startsWith('psb-')) {
          localStorage.removeItem(key);
        }
      }
      showToast('本地缓存已清除，页面即将刷新', 'success');
      setTimeout(() => window.location.reload(), 1200);
    } catch (error: any) {
      showToast(error?.message || '清除缓存失败', 'error');
    }
  };

  const inferType = (item: any): ImportPreviewItem['type'] => {
    if (item.url || item.domain) return 'clip';
    if (item.unlock_type || item.sealed_at) return 'capsule';
    if (item.content_raw || item.source_url) return 'knowledge';
    return 'note';
  };

  const parseImportFile = (file: File): Promise<ImportPreviewItem[]> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result || '');
        const items: ImportPreviewItem[] = [];
        try {
          const parsed = JSON.parse(text);
          if (Array.isArray(parsed)) {
            parsed.forEach((item: any) => {
              const type = item.type || inferType(item);
              items.push({
                type,
                title: item.title || item.source_title || item.url || '未命名',
                content: item.content || item.content_body || item.content_raw || item.full_text || item.excerpt || '',
              });
            });
          } else if (parsed.notes || parsed.capsules || parsed.clips || parsed.knowledge) {
            (parsed.notes || []).forEach((n: any) => items.push({ type: 'note', title: n.title, content: n.content }));
            (parsed.capsules || []).forEach((c: any) => items.push({ type: 'capsule', title: c.content_type, content: c.content_body }));
            (parsed.clips || []).forEach((c: any) => items.push({ type: 'clip', title: c.title, content: c.url }));
            (parsed.knowledge || []).forEach((k: any) => items.push({ type: 'knowledge', title: k.source_title, content: k.content_raw }));
          } else {
            // Single markdown/text fallback
            items.push({ type: 'note', title: file.name.replace(/\.[^/.]+$/, ''), content: text });
          }
        } catch {
          // Treat as plain markdown/text note
          items.push({ type: 'note', title: file.name.replace(/\.[^/.]+$/, ''), content: text });
        }
        resolve(items);
      };
      reader.onerror = () => reject(new Error('读取文件失败'));
      reader.readAsText(file);
    });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportLoading(true);
    try {
      // 全量数据包（/me/export 产物）优先识别：走 merge 导入，不拆条目预览
      const text = await file.text();
      let fe = null;
      try {
        fe = detectFullExport(JSON.parse(text));
      } catch { /* 不是 JSON，走逐条预览 */ }
      if (fe) {
        const res = await settingsApi.importData(fe.payload);
        invalidateContentQueries(queryClient);
        showToast(`数据包合并完成：新增 ${res.data.inserted} 条，更新 ${res.data.updated} 条，跳过 ${res.data.skipped} 条`, 'success');
        return;
      }
      const items = await parseImportFile(file);
      setPreview(items);
    } catch (error: any) {
      showToast(error?.message || '解析文件失败', 'error');
    } finally {
      setImportLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const obsidianImportMutation = useMutation({
    mutationFn: (path: string) => obsidianApi.importVault(path),
    onSuccess: async (res) => {
      setObsidianResult(res.data);
      invalidateContentQueries(queryClient);
      showToast('Obsidian 库导入完成，已转入笔记列表', 'success');
      navigate('/ingest/notes');
    },
    onError: (error: any) => {
      setObsidianResult(null);
      showToast(error?.response?.data?.detail || error?.message || '导入失败', 'error');
    },
  });

  const markdownExportMutation = useMutation({
    mutationFn: (dir: string) => obsidianApi.exportMarkdown(dir),
    onSuccess: (res) => {
      setMdExportResult(res.data);
      showToast('Markdown 导出完成', 'success');
    },
    onError: (error: any) => {
      setMdExportResult(null);
      showToast(error?.response?.data?.detail || error?.message || '导出失败', 'error');
    },
  });

  const handleImport = async () => {
    if (!preview || preview.length === 0) return;
    setImportLoading(true);
    let success = 0;
    let failed = 0;    for (const item of preview) {
      try {
        if (item.type === 'note') {
          await notesApi.create({ title: item.title || '导入笔记', content: item.content || '' });
        } else if (item.type === 'capsule') {
          await capsulesApi.create({
            content_type: item.title || 'text',
            content_body: item.content || '',
            unlock_type: 'none',
            unlock_config: {},
          });
        } else if (item.type === 'clip') {
          await clipsApi.create({
            title: item.title || '导入剪藏',
            url: item.content || '',
            domain: 'unknown',
          });
        } else if (item.type === 'knowledge') {
          await knowledgeApi.create({ content_raw: item.content || '' });
        }
        success++;
      } catch {
        failed++;
      }
    }
    invalidateContentQueries(queryClient);
    setImportLoading(false);
    setPreview(null);
    showToast(`导入完成：成功 ${success} 条，失败 ${failed} 条`, failed === 0 ? 'success' : 'error');
    // 单一类型且全部成功时，自动跳到产物所在列表页，不用猜东西去哪了
    if (failed === 0 && success > 0 && preview) {
      const typePaths: Record<string, string> = {
        note: '/ingest/notes',
        capsule: '/capsules/my',
        clip: '/ingest/clipper',
        knowledge: '/knowledge/network',
      };
      const types = new Set(preview.map((item) => item.type));
      if (types.size === 1) {
        const path = typePaths[preview[0].type];
        if (path) navigate(path);
      }
    }
  };

  return (
    <div className="space-y-6">
      {toast && createPortal(
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-[2px] border ${
          toast.type === 'success'
            ? 'bg-success/20 border-success/30 text-success'
            : 'bg-danger/20 border-danger/30 text-danger'
        }`}>
          <div className="flex items-center gap-2">
            {toast.type === 'success' ? <Check size={16} /> : <AlertTriangle size={16} />}
            <span className="text-sm">{toast.message}</span>
          </div>
        </div>,
        document.body
      )}

      {/* Export */}
      <section className="glass-card p-6">
        <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <Download size={18} className="text-info" />
          数据导出
        </h2>
        <p className="text-sm text-text-muted mb-4">
          导出您的笔记、胶囊、剪藏、知识单元、便签、标签、稍后读、RSS 和文档为 JSON 文件，点击后立即下载。
        </p>
        <button
          onClick={() => exportMutation.mutate()}
          disabled={exportMutation.isPending}
          className="btn-secondary flex items-center gap-2"
        >
          {exportMutation.isPending && <Loader2 size={16} className="animate-spin" />}
          <Download size={16} />
          导出我的数据
        </button>
      </section>

      {/* Import */}
      <section className="glass-card p-6">
        <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <Upload size={18} className="text-personal-primary" />
          数据导入
        </h2>
        <p className="text-sm text-text-muted mb-4">
          选择 JSON 或 Markdown 文件批量导入为笔记、胶囊、剪藏或知识单元。
        </p>
        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.md,.txt,.markdown"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importLoading}
            className="btn-secondary flex items-center gap-2"
          >
            {importLoading && <Loader2 size={16} className="animate-spin" />}
            <FileJson size={16} />
            选择文件
          </button>
        </div>

        {preview && (
          <div className="mt-4 space-y-3">
            <div className="text-sm text-text-muted">
              解析到 {preview.length} 条数据，确认后导入：
            </div>
            <div className="max-h-64 overflow-y-auto space-y-2 rounded-[2px] border border-white/[0.08] p-2">
              {preview.map((item, idx) => (
                <div key={idx} className="flex items-center gap-3 p-2 rounded-[2px] bg-white/[0.03]">
                  {item.type === 'note' && <FileText size={16} className="text-info" />}
                  {item.type === 'capsule' && <span className="text-personal-primary text-xs font-bold">CAP</span>}
                  {item.type === 'clip' && <span className="text-network-primary text-xs font-bold">CLIP</span>}
                  {item.type === 'knowledge' && <span className="text-success text-xs font-bold">KNOW</span>}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-text-primary truncate">{item.title}</div>
                    <div className="text-xs text-text-muted truncate">{item.content?.slice(0, 60)}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleImport}
                disabled={importLoading}
                className="btn-primary flex items-center gap-2"
              >
                {importLoading && <Loader2 size={16} className="animate-spin" />}
                <Upload size={16} />
                确认导入
              </button>
              <button
                onClick={() => setPreview(null)}
                className="btn-secondary"
              >
                取消
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Obsidian Import */}
      <section className="glass-card p-6">
        <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <FolderInput size={18} className="text-personal-primary" />
          连接 Obsidian 库
        </h2>
        {!isDesktop ? (
          <p className="text-sm text-text-muted">此功能在桌面端可用。</p>
        ) : (
          <>
            <p className="text-sm text-text-muted mb-4">
              选择本地 Obsidian 库（vault）文件夹，把其中的 Markdown 笔记导入 Molore，wiki 链接会同步生成知识图谱边。重复导入即为增量同步。
            </p>
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={vaultPath}
                readOnly
                placeholder="点击「选择文件夹」定位 Obsidian 库"
                className="flex-1 bg-bg-tertiary border border-border-color rounded-[2px] px-3 py-2 text-sm text-text-primary placeholder-text-secondary focus:outline-none cursor-default"
              />
              <button
                onClick={async () => {
                  const p = await window.psbDesktop?.pickDirectory('选择 Obsidian 库文件夹');
                  if (p) setVaultPath(p);
                }}
                className="btn-secondary flex items-center gap-2 shrink-0"
              >
                <FolderInput size={16} />
                选择文件夹
              </button>
              <button
                onClick={() => vaultPath.trim() && obsidianImportMutation.mutate(vaultPath.trim())}
                disabled={obsidianImportMutation.isPending || !vaultPath.trim()}
                className="btn-secondary flex items-center gap-2"
              >
                {obsidianImportMutation.isPending && <Loader2 size={16} className="animate-spin" />}
                导入
              </button>
            </div>
            {obsidianResult && (
              <div className="mt-4 text-sm text-text-muted space-y-1">
                <div>扫描文件 {obsidianResult.files} 个，新建笔记 {obsidianResult.notes_created} 条，更新 {obsidianResult.notes_updated} 条</div>
                <div>生成图谱边 {obsidianResult.edges_created} 条，悬空链接 {obsidianResult.unresolved_links} 条，跳过文件 {obsidianResult.skipped_files} 个</div>
              </div>
            )}
          </>
        )}
      </section>

      {/* Markdown Export */}
      <section className="glass-card p-6">
        <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <FolderOutput size={18} className="text-info" />
          导出为 Markdown
        </h2>
        {!isDesktop ? (
          <p className="text-sm text-text-muted">此功能在桌面端可用。</p>
        ) : (
          <>
            <p className="text-sm text-text-muted mb-4">
              把全部笔记和知识单元导出为带 frontmatter 的 Markdown 文件（可直接放入 Obsidian 库），图谱边会回写为「相关」wiki 链接。
            </p>
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={exportDir}
                readOnly
                placeholder="点击「选择文件夹」定位导出目录"
                className="flex-1 bg-bg-tertiary border border-border-color rounded-[2px] px-3 py-2 text-sm text-text-primary placeholder-text-secondary focus:outline-none cursor-default"
              />
              <button
                onClick={async () => {
                  const p = await window.psbDesktop?.pickDirectory('选择 Markdown 导出目录');
                  if (p) setExportDir(p);
                }}
                className="btn-secondary flex items-center gap-2 shrink-0"
              >
                <FolderOutput size={16} />
                选择文件夹
              </button>
              <button
                onClick={() => exportDir.trim() && markdownExportMutation.mutate(exportDir.trim())}
                disabled={markdownExportMutation.isPending || !exportDir.trim()}
                className="btn-secondary flex items-center gap-2"
              >
                {markdownExportMutation.isPending && <Loader2 size={16} className="animate-spin" />}
                导出
              </button>
            </div>
            {mdExportResult && (
              <div className="mt-4 text-sm text-text-muted space-y-1">
                <div>导出笔记 {mdExportResult.exported_notes} 条，知识单元 {mdExportResult.exported_knowledge} 条</div>
                <div className="truncate">目录：{mdExportResult.target_dir}</div>
              </div>
            )}
          </>
        )}
      </section>

      {/* Clear Cache */}
      <section className="glass-card p-6 border-danger/20">
        <h2 className="text-lg font-semibold text-danger mb-4 flex items-center gap-2">
          <Trash2 size={18} />
          清除本地缓存
        </h2>
        <p className="text-sm text-text-muted mb-4">
          清除浏览器本地缓存（保留登录状态），用于解决本地数据异常或界面显示问题。
        </p>
        {!showClearCacheConfirm ? (
          <button
            onClick={() => setShowClearCacheConfirm(true)}
            className="px-5 py-2.5 bg-danger/10 text-danger border border-danger/30 rounded-[2px] font-medium transition-all hover:bg-danger/20 flex items-center gap-2"
          >
            <Trash2 size={16} />
            清除本地缓存
          </button>
        ) : (
          <div className="space-y-4 max-w-md">
            <div className="p-3 bg-danger/10 border border-danger/20 rounded-[2px] text-sm text-danger">
              确定要清除本地缓存吗？登录信息会被保留。
            </div>
            <div className="flex gap-3">
              <button
                onClick={clearCache}
                className="px-5 py-2.5 bg-danger text-white rounded-[2px] font-medium transition-all flex items-center gap-2"
              >
                <Trash2 size={16} />
                确认清除
              </button>
              <button
                onClick={() => setShowClearCacheConfirm(false)}
                className="btn-secondary"
              >
                取消
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};

export default DataSettings;
