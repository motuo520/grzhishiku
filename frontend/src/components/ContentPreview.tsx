import { FC, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { notesApi } from '@/api/notes';
import { clipsApi } from '@/api/clips';
import { knowledgeApi } from '@/api/knowledge';
import { documentApi } from '@/api/document';

interface ContentPreviewProps {
  type: string;
  id: string;
  onBack: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  note: '笔记',
  clip: '剪藏',
  knowledge: '知识',
  document: '文档',
  capsule: '胶囊',
};

// 剥 markdown 符号保持可读（口径同 ManualLinkModal.getExcerpt 的剥符号正则），
// 但全文展示不截断、保留换行（摘要口径会 collapse 空白，正文不能那么干）
const stripMarkdown = (s: string) =>
  s.replace(/[#*`[\]()]/g, '').replace(/\n{3,}/g, '\n\n').trim();

// 统一口径：四类内容全部按需拉详情（单一代码路径、永远拿最新；
// 搜索列表里虽已有 content_raw 等字段，但可能是列表拉取时刻的旧值）
const fetchDetail = async (type: string, id: string): Promise<{ title: string; body: string }> => {
  if (type === 'note') {
    const n = (await notesApi.get(id)).data;
    return { title: n.title || '无标题笔记', body: n.content || '' };
  }
  if (type === 'clip') {
    const c = (await clipsApi.get(id)).data;
    return { title: c.title || c.url || '未命名剪藏', body: c.full_text || c.excerpt || '' };
  }
  if (type === 'knowledge') {
    const u = (await knowledgeApi.get(id)).data;
    return { title: (u as any).title || u.source_title || '知识单元', body: u.content_raw || '' };
  }
  if (type === 'document') {
    const d = (await documentApi.get(id)).data;
    return { title: d.title || d.original_name || '未命名文档', body: d.content_text || '' };
  }
  throw new Error('该类型暂不支持原文预览');
};

// 原文预览（09-16）：嵌入选择弹窗的就地全文视图——「返回选择」回列表，
// 宿主弹窗的勾选/选中/搜索状态原地保留。seq 防竞态：快速连点两条时后到响应覆盖先到
// （同 ManualLinkModal 的 searchSeq 模式）。
const ContentPreview: FC<ContentPreviewProps> = ({ type, id, onBack }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const seq = useRef(0);

  const load = useCallback(async () => {
    const s = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const d = await fetchDetail(type, id);
      if (s !== seq.current) return; // 后到响应才让落地
      setTitle(d.title);
      setBody(d.body);
      setLoading(false);
    } catch (e: any) {
      if (s !== seq.current) return;
      setError(e?.response?.data?.detail || e.message || '原文加载失败');
      setLoading(false);
    }
  }, [type, id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-2 pb-2 border-b border-border-light shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-xs text-info hover:underline shrink-0"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          返回选择
        </button>
        <span className="flex-1 min-w-0 text-xs text-text-primary truncate">{title || '加载中…'}</span>
        <span className="px-1.5 py-0.5 rounded-md text-[10px] border shrink-0 bg-white/[0.03] text-text-secondary border-white/[0.08]">
          {TYPE_LABELS[type] || type}
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto mt-2">
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-info" />
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-[2px] bg-danger/10 border border-danger/30 text-danger text-xs">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <button
              type="button"
              onClick={load}
              className="flex items-center gap-1 px-2 py-1 rounded-[2px] border border-danger/30 hover:bg-danger/20 transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              重试
            </button>
          </div>
        ) : (
          <p className="text-xs text-text-secondary whitespace-pre-wrap leading-relaxed">
            {stripMarkdown(body) || '（无正文）'}
          </p>
        )}
      </div>
    </div>
  );
};

export default ContentPreview;
