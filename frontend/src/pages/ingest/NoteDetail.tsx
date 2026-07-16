import { FC, useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Save, ArrowLeft, Tag, X, Loader2, AlertCircle, FileText, Eye, EyeOff,
  Bold, Italic, Heading, List, ListOrdered, Code, Quote, Link as LinkIcon,
  Sparkles, PenLine, AlignLeft, Hash, Check, Wand2,
} from 'lucide-react';
import { notesApi } from '@/api/notes';
import { useTags } from '@/hooks/useTags';
import { useNotes } from '@/hooks/useNotes';
import TagSelector from '@/components/TagSelector';
import ModelSelector from '@/components/llm/ModelSelector';
import LLMCostBadge from '@/components/llm/LLMCostBadge';
import { summarizeText, extractTags, completeText } from '@/api/llm';

const NoteDetail: FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const isNew = location.pathname === '/ingest/notes/new' || !id;

  const { tags, isLoading: tagsLoading } = useTags();
  const { notes: allNotes, createNote, updateNote } = useNotes();

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(!isNew);
  const [showPreview, setShowPreview] = useState(false);

  const [linkQuery, setLinkQuery] = useState('');
  const [showLinkDropdown, setShowLinkDropdown] = useState(false);
  const [linkCursorPos, setLinkCursorPos] = useState(0);
  const [modelId, setModelId] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load existing note
  useEffect(() => {
    if (isNew) {
      setTitle('');
      setContent('');
      setSelectedTags([]);
      setIsLoading(false);
      return;
    }
    if (!id) return;

    let cancelled = false;
    notesApi.get(id).then((res) => {
      if (cancelled) return;
      const note = res.data;
      setTitle(note.title);
      setContent(note.content);
      setSelectedTags(note.tags.map((t) => t.id || t.name));
      setIsLoading(false);
    }).catch((err) => {
      if (cancelled) return;
      setError(err.message || '加载笔记失败');
      setIsLoading(false);
    });

    return () => { cancelled = true; };
  }, [id, isNew]);

  const linkCandidates = useMemo(() => {
    if (!allNotes || !linkQuery) return [];
    const q = linkQuery.toLowerCase();
    return allNotes.filter((n) => n.id !== id && n.title.toLowerCase().includes(q)).slice(0, 6);
  }, [allNotes, linkQuery, id]);

  const handleContentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setContent(value);

    const cursor = e.target.selectionStart;
    const before = value.slice(0, cursor);
    const match = before.match(/\[\[([^\]]*)$/);
    if (match) {
      setLinkQuery(match[1]);
      setShowLinkDropdown(true);
      setLinkCursorPos(cursor);
    } else {
      setShowLinkDropdown(false);
      setLinkQuery('');
    }
  }, []);

  const insertAtCursor = (beforeText: string, afterText: string, placeholder = '') => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = content.slice(start, end);
    const newValue = content.slice(0, start) + beforeText + (selected || placeholder) + afterText + content.slice(end);
    setContent(newValue);
    setTimeout(() => {
      const pos = start + beforeText.length + (selected || placeholder).length;
      el.setSelectionRange(pos, pos);
      el.focus();
    }, 0);
  };

  const insertLink = (noteTitle: string) => {
    const before = content.slice(0, linkCursorPos - linkQuery.length - 2);
    const after = content.slice(linkCursorPos);
    const newContent = `${before}[[${noteTitle}]]${after}`;
    setContent(newContent);
    setShowLinkDropdown(false);
    setLinkQuery('');
    setTimeout(() => {
      if (textareaRef.current) {
        const pos = before.length + noteTitle.length + 4;
        textareaRef.current.setSelectionRange(pos, pos);
        textareaRef.current.focus();
      }
    }, 0);
  };

  const getSelectedText = () => {
    const el = textareaRef.current;
    if (!el) return '';
    return content.slice(el.selectionStart, el.selectionEnd);
  };

  const replaceSelectedText = (replacement: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const newContent = content.slice(0, start) + replacement + content.slice(end);
    setContent(newContent);
    setTimeout(() => {
      const pos = start + replacement.length;
      el.setSelectionRange(pos, pos);
      el.focus();
    }, 0);
  };

  const handleAIAction = async (action: 'continue' | 'polish' | 'summarize' | 'tags') => {
    const selected = getSelectedText();
    const context = selected || content;
    if (!context.trim()) {
      setError('请先输入一些内容，或选中一段文字');
      return;
    }
    setAiLoading(true);
    setError(null);
    setAiSuggestion(null);
    try {
      if (action === 'summarize') {
        const result = await summarizeText({ text: context, length: 'medium', model: modelId || undefined });
        setAiSuggestion(result.summary);
      } else if (action === 'tags') {
        const result = await extractTags({ text: context, max_tags: 8, model: modelId || undefined });
        const newTags = result.tags || [];
        const unique = Array.from(new Set([...selectedTags, ...newTags]));
        setSelectedTags(unique);
        setAiSuggestion(null);
      } else {
        const system =
          action === 'continue'
            ? '你是一位写作助手。请根据用户提供的上下文，用相同的风格和语气续写一段内容。只输出续写内容，不要解释。'
            : '你是一位写作助手。请润色用户提供的文字，使其更通顺、清晰、有表达力。保持原意，只输出润色后的内容。';
        const prompt = action === 'continue' ? `请续写以下内容：\n\n${context}` : `请润色以下内容：\n\n${context}`;
        const result = await completeText({ prompt, system_prompt: system, model: modelId || undefined, task_type: 'writing' });
        setAiSuggestion(result.text);
      }
    } catch (e: any) {
      setError(e?.response?.data?.detail || e.message || 'AI 处理失败');
    } finally {
      setAiLoading(false);
    }
  };

  const applySuggestion = () => {
    if (!aiSuggestion) return;
    replaceSelectedText(aiSuggestion);
    setAiSuggestion(null);
  };

  const handleSave = async () => {
    if (!title.trim() || !content.trim()) {
      setError('标题和内容不能为空');
      return;
    }
    try {
      setIsSaving(true);
      setError(null);
      const tagPayload = [...selectedTags];
      if (isNew) {
        await createNote({ title: title.trim(), content: content.trim(), tags: tagPayload });
      } else if (id) {
        await updateNote({ id, data: { title: title.trim(), content: content.trim(), tags: tagPayload } });
      }
      navigate('/ingest/notes');
    } catch (err: any) {
      setError(err.message || '保存失败');
      setIsSaving(false);
    }
  };

  // Simple markdown preview renderer
  const renderMarkdown = (md: string) => {
    return md
      .replace(/^###### (.*$)/gim, '<h6 class="text-sm font-semibold text-text-primary mt-3 mb-1">$1</h6>')
      .replace(/^##### (.*$)/gim, '<h5 class="text-sm font-semibold text-text-primary mt-3 mb-1">$1</h5>')
      .replace(/^#### (.*$)/gim, '<h4 class="text-sm font-semibold text-text-primary mt-3 mb-1">$1</h4>')
      .replace(/^### (.*$)/gim, '<h3 class="text-base font-semibold text-text-primary mt-4 mb-2">$1</h3>')
      .replace(/^## (.*$)/gim, '<h2 class="text-lg font-semibold text-text-primary mt-4 mb-2">$1</h2>')
      .replace(/^# (.*$)/gim, '<h1 class="text-xl font-bold text-text-primary mt-5 mb-3">$1</h1>')
      .replace(/\*\*(.*?)\*\*/g, '<strong class="text-text-primary">$1</strong>')
      .replace(/\*(.*?)\*/g, '<em class="text-text-secondary">$1</em>')
      .replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 bg-bg-tertiary rounded text-info text-xs font-mono">$1</code>')
      .replace(/^\> (.*$)/gim, '<blockquote class="border-l-2 border-[#8b949e] pl-3 my-2 text-text-secondary italic">$1</blockquote>')
      .replace(/^\- (.*$)/gim, '<li class="ml-4 text-text-secondary">$1</li>')
      .replace(/^\d+\. (.*$)/gim, '<li class="ml-4 text-text-secondary list-decimal">$1</li>')
      .replace(/\[\[([^\]]+)\]\]/g, '<span class="text-info bg-[#58a6ff]/10 px-1 rounded cursor-pointer">$1</span>')
      .replace(/\n/g, '<br />');
  };

  if (isLoading) {
    return (
      <div className="p-6 max-w-4xl mx-auto flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 text-info animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/ingest/notes')}
            className="p-2 rounded-xl bg-white/[0.03] border border-white/[0.08] text-text-muted hover:text-text-primary transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-text-primary">{isNew ? '新建笔记' : '编辑笔记'}</h1>
            <p className="text-xs text-text-secondary mt-0.5">{isNew ? '记录一个新的灵感' : '修改并完善笔记内容'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPreview((v) => !v)}
            className={`btn-secondary text-xs py-2 px-3 flex items-center gap-1.5 ${showPreview ? 'border-info/50 text-info' : ''}`}
          >
            {showPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {showPreview ? '编辑' : '预览'}
          </button>
          <button onClick={() => navigate('/ingest/notes')} className="btn-secondary text-xs py-2 px-4">
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="btn-primary flex items-center gap-2 text-xs py-2 px-4 disabled:opacity-60"
          >
            {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            保存
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

      <div className="space-y-4">
        {/* Title */}
        <div>
          <label className="block text-xs text-text-muted mb-1.5">标题</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="输入笔记标题..."
            className="w-full bg-bg-secondary border border-border-color rounded-xl px-4 py-3 text-sm text-text-primary placeholder-text-secondary focus:outline-none focus:border-info/50 transition-colors"
          />
        </div>

        {/* Tags */}
        <div>
          <label className="block text-xs text-text-muted mb-1.5">标签</label>
          <TagSelector
            availableTags={tags || []}
            value={selectedTags}
            onChange={setSelectedTags}
            isLoading={tagsLoading}
            placeholder="输入标签，回车或逗号分隔..."
          />
        </div>

        {/* Toolbar */}
        {!showPreview && (
          <div className="flex items-center gap-1 p-1.5 bg-bg-secondary border border-border-color rounded-xl w-fit">
            <button onClick={() => insertAtCursor('**', '**', '粗体')} className="p-1.5 rounded-lg hover:bg-white/[0.05] text-text-muted hover:text-text-primary" title="粗体">
              <Bold className="w-4 h-4" />
            </button>
            <button onClick={() => insertAtCursor('*', '*', '斜体')} className="p-1.5 rounded-lg hover:bg-white/[0.05] text-text-muted hover:text-text-primary" title="斜体">
              <Italic className="w-4 h-4" />
            </button>
            <button onClick={() => insertAtCursor('\n# ', '')} className="p-1.5 rounded-lg hover:bg-white/[0.05] text-text-muted hover:text-text-primary" title="标题">
              <Heading className="w-4 h-4" />
            </button>
            <button onClick={() => insertAtCursor('\n- ', '')} className="p-1.5 rounded-lg hover:bg-white/[0.05] text-text-muted hover:text-text-primary" title="无序列表">
              <List className="w-4 h-4" />
            </button>
            <button onClick={() => insertAtCursor('\n1. ', '')} className="p-1.5 rounded-lg hover:bg-white/[0.05] text-text-muted hover:text-text-primary" title="有序列表">
              <ListOrdered className="w-4 h-4" />
            </button>
            <button onClick={() => insertAtCursor('`', '`', 'code')} className="p-1.5 rounded-lg hover:bg-white/[0.05] text-text-muted hover:text-text-primary" title="行内代码">
              <Code className="w-4 h-4" />
            </button>
            <button onClick={() => insertAtCursor('\n> ', '')} className="p-1.5 rounded-lg hover:bg-white/[0.05] text-text-muted hover:text-text-primary" title="引用">
              <Quote className="w-4 h-4" />
            </button>
            <button onClick={() => insertAtCursor('[[', ']]', '笔记标题')} className="p-1.5 rounded-lg hover:bg-white/[0.05] text-text-muted hover:text-text-primary" title="双向链接">
              <LinkIcon className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* AI Toolbar */}
        {!showPreview && (
          <div className="flex flex-wrap items-center gap-2 p-2 bg-bg-secondary border border-border-color rounded-xl">
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-text-muted px-1">AI 辅助</span>
              <button
                onClick={() => handleAIAction('continue')}
                disabled={aiLoading}
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-text-muted hover:text-warning hover:bg-white/[0.05] transition-colors disabled:opacity-50"
                title="续写（未选中文字时基于全文）"
              >
                {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PenLine className="w-3.5 h-3.5" />}
                续写
              </button>
              <button
                onClick={() => handleAIAction('polish')}
                disabled={aiLoading}
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-text-muted hover:text-warning hover:bg-white/[0.05] transition-colors disabled:opacity-50"
                title="润色选中的文字"
              >
                <Wand2 className="w-3.5 h-3.5" />
                润色
              </button>
              <button
                onClick={() => handleAIAction('summarize')}
                disabled={aiLoading}
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-text-muted hover:text-warning hover:bg-white/[0.05] transition-colors disabled:opacity-50"
                title="总结选中的文字或全文"
              >
                <AlignLeft className="w-3.5 h-3.5" />
                总结
              </button>
              <button
                onClick={() => handleAIAction('tags')}
                disabled={aiLoading}
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-text-muted hover:text-warning hover:bg-white/[0.05] transition-colors disabled:opacity-50"
                title="从内容提取标签"
              >
                <Hash className="w-3.5 h-3.5" />
                提取标签
              </button>
            </div>
            <div className="w-px h-5 bg-white/[0.08] mx-1" />
            <ModelSelector value={modelId} onChange={setModelId} taskType="creative" className="w-44" />
            <LLMCostBadge modelId={modelId} inputText={content} outputTokenEstimate={200} />
          </div>
        )}

        {/* Content */}
        <div className="relative">
          <label className="block text-xs text-text-muted mb-1.5">
            内容
            <span className="ml-2 text-[10px] text-[#484f58]">支持 Markdown，输入 [[ 可插入双向链接</span>
          </label>
          {showPreview ? (
            <div
              className="w-full min-h-[400px] bg-bg-secondary border border-border-color rounded-xl px-4 py-3 text-sm text-text-primary leading-relaxed overflow-y-auto"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(content) || '<span class="text-text-secondary">暂无内容</span>' }}
            />
          ) : (
            <textarea
              ref={textareaRef}
              value={content}
              onChange={handleContentChange}
              placeholder="在这里输入笔记内容..."
              rows={16}
              className="w-full bg-bg-secondary border border-border-color rounded-xl px-4 py-3 text-sm text-text-primary placeholder-text-secondary focus:outline-none focus:border-info/50 transition-colors resize-none font-mono leading-relaxed"
            />
          )}
          {/* Link Dropdown */}
          <AnimatePresence>
            {showLinkDropdown && linkCandidates.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                className="absolute left-4 right-4 bottom-4 bg-bg-secondary border border-border-color rounded-xl shadow-2xl z-40 overflow-hidden max-h-48 overflow-y-auto"
              >
                {linkCandidates.map((note) => (
                  <button
                    key={note.id}
                    onClick={() => insertLink(note.title)}
                    className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-white/[0.03] text-left transition-colors"
                  >
                    <FileText className="w-4 h-4 text-info" />
                    <span className="text-xs text-text-primary">{note.title}</span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {/* AI Suggestion */}
          <AnimatePresence>
            {aiSuggestion && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                className="mt-3 p-3 rounded-xl bg-warning/5 border border-warning/20"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5 text-xs text-warning">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>AI 生成内容</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setAiSuggestion(null)}
                      className="text-[10px] text-text-muted hover:text-danger"
                    >
                      丢弃
                    </button>
                    <button
                      onClick={applySuggestion}
                      className="text-[10px] flex items-center gap-1 text-emerald-400 hover:text-emerald-300"
                    >
                      <Check className="w-3 h-3" />
                      插入替换
                    </button>
                  </div>
                </div>
                <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap">{aiSuggestion}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

export default NoteDetail;
