import { FC, useState } from 'react';
import { useNavigation } from '@/store/navigation';
import {
  useContextGuides,
  useCreateContextGuide,
  useUpdateContextGuide,
  useDeleteContextGuide,
  useGenerateContextGuide,
} from '@/hooks/useJianghu';
import ModelSelector from '@/components/llm/ModelSelector';
import {
  BrainCircuit, Plus, Loader2, Trash2, Edit3, CheckCircle2, XCircle,
  Save, Sparkles, Eye, FileText, Home, Globe, Brain
} from 'lucide-react';
import type { ContextGuide } from '@/api/jianghu';

const SCOPE_OPTIONS: { value: ContextGuide['scope']; label: string; icon: React.ElementType; color: string }[] = [
  { value: 'personal', label: '个人脑', icon: Home, color: 'text-personal-primary' },
  { value: 'network', label: '网络脑', icon: Globe, color: 'text-network-primary' },
  { value: 'both', label: '双脑', icon: Brain, color: 'text-fusion-primary' },
];

const EMPTY_FORM = {
  title: '',
  content: '',
  scope: 'both' as ContextGuide['scope'],
  is_active: true,
};

// 行内解析：**粗体** 与 `行内代码`，返回 React 节点（不使用 dangerouslySetInnerHTML）
const renderInline = (text: string): React.ReactNode[] => {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*([^*]+)\*\*|`([^`]+)`)/g;
  let lastIndex = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    if (match[2] !== undefined) {
      parts.push(
        <strong key={key++} className="text-text-primary font-medium">
          {match[2]}
        </strong>
      );
    } else {
      parts.push(
        <code key={key++} className="px-1 py-0.5 rounded bg-white/[0.06] text-xs font-mono text-info">
          {match[3]}
        </code>
      );
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
};

// 轻量 markdown 渲染：按行解析，支持 #/##/### 标题、-/* 无序列表、空行分段，行内走 renderInline
const renderMarkdown = (content: string): React.ReactNode[] => {
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  let para: string[] = [];
  let key = 0;

  const flushList = () => {
    if (list.length > 0) {
      const items = list;
      blocks.push(
        <ul key={key++} className="list-disc pl-5 space-y-0.5">
          {items.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ul>
      );
      list = [];
    }
  };
  const flushPara = () => {
    if (para.length > 0) {
      const text = para.join(' ');
      blocks.push(<p key={key++}>{renderInline(text)}</p>);
      para = [];
    }
  };

  for (const raw of content.split('\n')) {
    const line = raw.trimEnd();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const listItem = /^[-*]\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      flushList();
      const level = heading[1].length;
      const text = heading[2];
      if (level === 1) {
        blocks.push(<h3 key={key++} className="text-base font-semibold text-text-primary mt-2">{renderInline(text)}</h3>);
      } else if (level === 2) {
        blocks.push(<h4 key={key++} className="text-sm font-semibold text-text-primary mt-2">{renderInline(text)}</h4>);
      } else {
        blocks.push(<h5 key={key++} className="text-sm font-medium text-text-primary mt-1">{renderInline(text)}</h5>);
      }
    } else if (listItem) {
      flushPara();
      list.push(listItem[1]);
    } else if (line.trim() === '') {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return blocks;
};

const AiContextPage: FC = () => {
  const { brainSide } = useNavigation();
  const { data: guides, isLoading, isError, error } = useContextGuides();
  const create = useCreateContextGuide();
  const update = useUpdateContextGuide();
  const remove = useDeleteContextGuide();
  const generate = useGenerateContextGuide();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [modelId, setModelId] = useState<string>();
  const [previewId, setPreviewId] = useState<string | null>(null);

  const startNew = () => {
    setEditingId('new');
    setForm({
      ...EMPTY_FORM,
      scope: brainSide === 'personal' ? 'personal' : brainSide === 'network' ? 'network' : 'both',
    });
  };

  const startEdit = (guide: ContextGuide) => {
    setEditingId(guide.id);
    setForm({
      title: guide.title,
      content: guide.content,
      scope: guide.scope,
      is_active: guide.is_active,
    });
    setPreviewId(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setPreviewId(null);
  };

  const handleSave = () => {
    if (!form.title.trim() || !form.content.trim()) return;
    if (editingId === 'new') {
      create.mutate(form, { onSuccess: cancelEdit });
    } else if (editingId) {
      update.mutate({ id: editingId, data: form }, { onSuccess: cancelEdit });
    }
  };

  const handleDelete = (id: string) => {
    if (confirm('确定删除这条上下文引导文件？')) {
      remove.mutate(id, {
        onSuccess: () => {
          // 删除的正是当前预览项时，清空 previewId，避免预览区引用已删项
          if (previewId === id) setPreviewId(null);
        },
      });
    }
  };

  const handleGenerate = () => {
    const sideLabel = brainSide === 'personal' ? '个人脑' : brainSide === 'network' ? '网络脑' : '双脑';
    generate.mutate(
      {
        brain_side: brainSide === 'unknown' ? 'both' : brainSide,
        preferred_model: modelId,
        title: `AI 全知上下文 · ${sideLabel} · ${new Date().toLocaleString('zh-CN')}`,
      },
      {
        onSuccess: (guide) => {
          startEdit(guide);
        },
      }
    );
  };

  const toggleActive = (guide: ContextGuide) => {
    update.mutate({ id: guide.id, data: { is_active: !guide.is_active } });
  };

  const previewGuide = guides?.find((g) => g.id === previewId);

  return (
    <div className="p-6 max-w-6xl mx-auto h-full overflow-auto">
      <div className="flex items-start justify-between flex-wrap gap-4 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-text-primary flex items-center gap-2">
            <BrainCircuit className="w-5 h-5 text-info" />
            AI 全知上下文
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            通过引导文件让 AI 理解你的知识库结构，使每次对话都建立在前一天的认知之上。
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-end gap-1.5">
            <ModelSelector value={modelId} onChange={setModelId} taskType="analysis" className="w-48" />
          </div>
          <button
            onClick={handleGenerate}
            disabled={generate.isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-[2px] bg-info/10 text-info hover:bg-info/20 transition-colors disabled:opacity-50"
          >
            {generate.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            AI 生成
          </button>
          <button
            onClick={startNew}
            className="flex items-center gap-2 px-4 py-2 rounded-[2px] bg-success/10 text-success hover:bg-success/20 transition-colors"
          >
            <Plus className="w-4 h-4" />
            新建
          </button>
        </div>
      </div>

      {(generate.isError || create.isError || update.isError || remove.isError) && (
        <div className="mb-4">
          <div className="p-3 rounded-[2px] bg-danger/10 border border-danger/30 text-sm text-danger">
            {((generate.error || create.error || update.error || remove.error) as any)?.message || '操作失败'}
          </div>
        </div>
      )}

      {isError && (
        <div className="mb-4">
          <div className="p-3 rounded-[2px] bg-danger/10 border border-danger/30 text-sm text-danger">
            {(error as any)?.message || '操作失败'}
          </div>
        </div>
      )}

      {editingId && (
        <div className="rounded-[2px] border border-white/[0.06] bg-bg-secondary p-4 mb-6 space-y-3">
          <div className="flex items-center gap-3">
            <FileText className="w-4 h-4 text-text-muted" />
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="引导文件标题"
              className="flex-1 px-3 py-2 rounded-[2px] bg-bg-primary border border-white/[0.06] text-sm text-text-primary"
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {SCOPE_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setForm({ ...form, scope: opt.value })}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[2px] text-xs border transition-all ${
                    form.scope === opt.value
                      ? `${opt.color} border-current bg-white/[0.05]`
                      : 'text-text-secondary border-white/[0.06] hover:bg-white/[0.03]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {opt.label}
                </button>
              );
            })}
            <label className="flex items-center gap-2 ml-2 text-xs text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                className="rounded border-white/[0.06] bg-bg-primary text-info"
              />
              启用
            </label>
          </div>
          <textarea
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
            placeholder="在这里输入或编辑 markdown 格式的 AI 引导文件..."
            className="w-full px-3 py-2 rounded-[2px] bg-bg-primary border border-white/[0.06] text-sm text-text-primary min-h-[300px] font-mono leading-relaxed"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={cancelEdit}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[2px] text-xs text-text-secondary hover:bg-white/[0.04] transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={create.isPending || update.isPending || !form.title.trim() || !form.content.trim()}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-[2px] bg-info/10 text-info hover:bg-info/20 transition-colors disabled:opacity-50 text-xs"
            >
              {create.isPending || update.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              保存
            </button>
          </div>
        </div>
      )}

      {previewGuide && !editingId && (
        <div className="rounded-[2px] border border-white/[0.06] bg-bg-secondary p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
              <Eye className="w-4 h-4 text-info" />
              {previewGuide.title}
            </h3>
            <button onClick={() => setPreviewId(null)} className="text-xs text-text-secondary hover:text-text-primary">
              关闭预览
            </button>
          </div>
          <div className="text-sm text-text-secondary space-y-1">
            {renderMarkdown(previewGuide.content)}
          </div>
        </div>
      )}

      {isLoading && (
        <div className="text-sm text-text-secondary flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          加载中...
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {guides?.map((guide) => {
          const scopeMeta = SCOPE_OPTIONS.find((s) => s.value === guide.scope) || SCOPE_OPTIONS[2];
          const ScopeIcon = scopeMeta.icon;
          return (
            <div
              key={guide.id}
              className={`rounded-[2px] border p-4 transition-all ${
                guide.is_active ? 'border-white/[0.06] bg-bg-secondary' : 'border-white/[0.04] bg-bg-secondary/50 opacity-70'
              }`}
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${scopeMeta.color} border-current/20 bg-white/[0.03]`}>
                      <ScopeIcon className="w-3 h-3" />
                      {scopeMeta.label}
                    </span>
                    {guide.is_active && (
                      <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-success/30 text-success bg-success/10">
                        <CheckCircle2 className="w-3 h-3" />
                        启用
                      </span>
                    )}
                    {guide.version_tag === 'auto' && (
                      <span className="text-[10px] text-text-muted">AI 生成</span>
                    )}
                  </div>
                  <h3 className="text-sm font-medium text-text-primary truncate">{guide.title}</h3>
                  <p className="text-xs text-text-muted mt-0.5">
                    更新于 {new Date(guide.updated_at).toLocaleString('zh-CN')}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => toggleActive(guide)}
                    title={guide.is_active ? '禁用' : '启用'}
                    className={`p-1.5 rounded-[2px] transition-colors ${guide.is_active ? 'text-success hover:bg-success/10' : 'text-text-muted hover:bg-white/[0.04]'}`}
                  >
                    {guide.is_active ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => setPreviewId(previewId === guide.id ? null : guide.id)}
                    title="预览"
                    className="p-1.5 rounded-[2px] text-text-secondary hover:bg-white/[0.04] hover:text-text-primary transition-colors"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => startEdit(guide)}
                    title="编辑"
                    className="p-1.5 rounded-[2px] text-text-secondary hover:bg-white/[0.04] hover:text-text-primary transition-colors"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(guide.id)}
                    title="删除"
                    className="p-1.5 rounded-[2px] text-danger hover:bg-danger/10 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <p className="text-xs text-text-secondary line-clamp-3 whitespace-pre-wrap">
                {guide.content}
              </p>
            </div>
          );
        })}
      </div>

      {!isLoading && !isError && Array.isArray(guides) && guides.length === 0 && !editingId && (
        <div className="p-8 rounded-[2px] border border-white/[0.06] bg-bg-secondary text-center text-text-secondary">
          <BrainCircuit className="w-10 h-10 mx-auto mb-3 text-text-muted/40" />
          <p className="text-sm">暂无上下文引导文件。</p>
          <p className="text-xs mt-1">点击右上角「AI 生成」让 AI 基于你当前脑侧的内容自动创建，或手动新建。</p>
        </div>
      )}
    </div>
  );
};

export default AiContextPage;
