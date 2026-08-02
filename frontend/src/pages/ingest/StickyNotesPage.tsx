import { FC, useState, useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Pin, Trash2, Archive, Clock, X, Check, StickyNote as StickyNoteIcon,
  Bell, RotateCcw, Square, SquareCheck, FileText,
} from 'lucide-react';
import { useStickyNotes, useCreateStickyNote, useUpdateStickyNote, useDeleteStickyNote, useConvertStickyNoteToNote } from '@/hooks/useStickyNotes';
import { useReminders, useCreateReminder, useUpdateReminder, useDeleteReminder } from '@/hooks/useReminders';
import { useAuth } from '@/hooks/useAuth';
import type { StickyNote } from '@/api/stickyNotes';
import type { Reminder } from '@/api/reminders';

const COLORS = [
  { value: '#f59e0b', label: '琥珀' },
  { value: '#ef4444', label: '珊瑚' },
  { value: '#10b981', label: '薄荷' },
  { value: '#3b82f6', label: '天蓝' },
  { value: '#8b5cf6', label: '紫藤' },
  { value: '#ec4899', label: '桃粉' },
  { value: '#6b7280', label: '石墨' },
];

const formatTime = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
};

interface NoteCardProps {
  note: StickyNote;
  onUpdate: (id: string, data: Partial<StickyNote>) => void;
  onDelete: (id: string) => void;
  onConvertToNote: (id: string) => void;
}

const NoteCard: FC<NoteCardProps> = ({ note, onUpdate, onDelete, onConvertToNote }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(note.content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.selectionStart = textareaRef.current.value.length;
    }
  }, [isEditing]);

  const save = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (trimmed !== note.content) {
      onUpdate(note.id, { content: trimmed });
    }
    setIsEditing(false);
  };

  const isConverted = !!note.converted_to_note_id;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className={`rounded-[2px] p-4 border border-white/10 flex flex-col relative group ${note.is_archived ? 'opacity-60' : ''} ${note.is_completed ? 'opacity-50' : ''}`}
      style={{
        backgroundColor: `${note.color}20`,
        borderLeft: `4px solid ${note.color}`,
        minHeight: note.height,
        width: note.width,
      }}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onUpdate(note.id, { is_pinned: !note.is_pinned })}
            className={`p-1 rounded-[2px] transition-colors ${note.is_pinned ? 'text-warning bg-warning/15' : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'}`}
            title={note.is_pinned ? '取消置顶' : '置顶'}
          >
            <Pin className="w-3.5 h-3.5" />
          </button>
          {note.is_todo && (
            <button
              onClick={() => onUpdate(note.id, { is_completed: !note.is_completed })}
              className={`p-1 rounded-[2px] transition-colors ${note.is_completed ? 'text-success bg-success/15' : 'text-text-muted hover:text-success hover:bg-success/10'}`}
              title={note.is_completed ? '标记未完成' : '标记完成'}
            >
              {note.is_completed ? <SquareCheck className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
            </button>
          )}
          {note.remind_at && (
            <span className="flex items-center gap-1 text-[10px] text-text-muted bg-bg-secondary px-1.5 py-0.5 rounded">
              <Clock className="w-3 h-3" />
              {formatTime(note.remind_at)}
            </span>
          )}
          {isConverted && (
            <span className="text-[10px] text-success bg-success/10 px-1.5 py-0.5 rounded">已转笔记</span>
          )}
        </div>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {!isConverted && !note.is_archived && (
            <>
              <button
                onClick={() => onUpdate(note.id, { is_todo: !note.is_todo })}
                className={`p-1.5 rounded-[2px] transition-colors ${note.is_todo ? 'text-success bg-success/10' : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'}`}
                title={note.is_todo ? '取消待办' : '设为待办'}
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => {
                  if (confirm('确定将这条便签转为笔记吗？')) onConvertToNote(note.id);
                }}
                className="p-1.5 rounded-[2px] text-text-muted hover:text-info hover:bg-info/10"
                title="转为笔记"
              >
                <FileText className="w-3.5 h-3.5" />
              </button>
            </>
          )}
          <button
            onClick={() => onUpdate(note.id, { is_archived: !note.is_archived })}
            className="p-1.5 rounded-[2px] text-text-muted hover:text-text-primary hover:bg-bg-hover"
            title={note.is_archived ? '恢复' : '归档'}
          >
            {note.is_archived ? <RotateCcw className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => {
              if (confirm('确定删除这条便签吗？')) onDelete(note.id);
            }}
            className="p-1.5 rounded-[2px] text-text-muted hover:text-danger hover:bg-danger/10"
            title="删除"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {isEditing ? (
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.metaKey) save();
            if (e.key === 'Escape') {
              setDraft(note.content);
              setIsEditing(false);
            }
          }}
          className="flex-1 bg-transparent text-sm text-text-primary outline-none resize-none leading-relaxed"
          style={{ minHeight: 80 }}
        />
      ) : (
        <div
          onClick={() => !isConverted && setIsEditing(true)}
          className={`flex-1 text-sm text-text-primary whitespace-pre-wrap leading-relaxed ${isConverted ? '' : 'cursor-text'}`}
        >
          {note.content}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-1">
          {COLORS.map((c) => (
            <button
              key={c.value}
              onClick={() => onUpdate(note.id, { color: c.value })}
              className={`w-4 h-4 rounded-full border-2 transition-transform hover:scale-110 ${note.color === c.value ? 'border-text-primary' : 'border-transparent'}`}
              style={{ backgroundColor: c.value }}
              title={c.label}
            />
          ))}
        </div>
        <span className="text-[10px] text-text-muted">{formatTime(note.updated_at)}</span>
      </div>
    </motion.div>
  );
};

interface ReminderItemProps {
  reminder: Reminder;
  onToggle: (id: string, completed: boolean) => void;
  onDelete: (id: string) => void;
}

const ReminderItem: FC<ReminderItemProps> = ({ reminder, onToggle, onDelete }) => {
  return (
    <div className={`flex items-start gap-2 p-2 rounded-[2px] ${reminder.is_completed ? 'opacity-50' : 'bg-bg-secondary/50'}`}>
      <button
        onClick={() => onToggle(reminder.id, !reminder.is_completed)}
        className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center ${reminder.is_completed ? 'bg-success border-success text-white' : 'border-text-muted'}`}
      >
        {reminder.is_completed && <Check className="w-3 h-3" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className={`text-sm ${reminder.is_completed ? 'line-through text-text-muted' : 'text-text-primary'}`}>{reminder.title}</div>
        {reminder.content && <div className="text-xs text-text-secondary truncate">{reminder.content}</div>}
        <div className="text-[10px] text-info mt-0.5">{formatTime(reminder.remind_at)}</div>
      </div>
      <button onClick={() => onDelete(reminder.id)} className="text-text-muted hover:text-danger">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

const StickyNotesPage: FC = () => {
  const { isLoggedIn } = useAuth();
  const [showArchived, setShowArchived] = useState(false);
  const [showTodosOnly, setShowTodosOnly] = useState(false);
  const [quickContent, setQuickContent] = useState('');
  const [quickColor, setQuickColor] = useState('#f59e0b');
  const [quickReminder, setQuickReminder] = useState('');
  const [quickIsTodo, setQuickIsTodo] = useState(false);
  const [showReminderPanel, setShowReminderPanel] = useState(false);
  const [reminderTitle, setReminderTitle] = useState('');
  const [reminderTime, setReminderTime] = useState('');

  const { notes, isLoading } = useStickyNotes(showArchived);
  const { reminders } = useReminders(false, 168);

  const createNoteMutation = useCreateStickyNote();
  const updateNoteMutation = useUpdateStickyNote();
  const deleteNoteMutation = useDeleteStickyNote();
  const convertToNoteMutation = useConvertStickyNoteToNote();
  const createReminderMutation = useCreateReminder();
  const updateReminderMutation = useUpdateReminder();
  const deleteReminderMutation = useDeleteReminder();

  const sortedNotes = useMemo(() => {
    let filtered = [...notes];
    if (showTodosOnly) {
      filtered = filtered.filter((n) => n.is_todo);
    }
    return filtered.sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
  }, [notes, showTodosOnly]);

  const handleQuickAdd = () => {
    if (!quickContent.trim()) return;
    createNoteMutation.mutate({
      content: quickContent.trim(),
      color: quickColor,
      is_todo: quickIsTodo,
      remind_at: quickReminder || undefined,
    }, {
      onSuccess: () => {
        setQuickContent('');
        setQuickReminder('');
        setQuickIsTodo(false);
      },
    });
  };

  const handleAddReminder = () => {
    if (!reminderTitle.trim() || !reminderTime) return;
    createReminderMutation.mutate({
      title: reminderTitle.trim(),
      remind_at: new Date(reminderTime).toISOString(),
      source: 'sticky_board',
    }, {
      onSuccess: () => {
        setReminderTitle('');
        setReminderTime('');
      },
    });
  };

  if (!isLoggedIn) {
    return (
      <div className="min-h-[calc(100vh-64px)] flex items-center justify-center p-6">
        <div className="glass-card rounded-[2px] p-8 text-center max-w-md">
          <StickyNoteIcon className="w-12 h-12 text-warning mx-auto mb-4" />
          <h2 className="text-lg font-bold text-text-primary mb-2">登录后使用便签</h2>
          <p className="text-sm text-text-secondary">便签和提醒会保存在你的账户中，方便随时查看。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-64px)] p-4 sm:p-6 overflow-y-auto">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[2px] bg-warning/15 flex items-center justify-center">
              <StickyNoteIcon className="w-5 h-5 text-warning" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-text-primary">便签墙</h1>
              <p className="text-xs text-text-secondary">随手记、置顶提醒、多彩标记</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowTodosOnly((v) => !v)}
              className={`px-3 py-1.5 text-xs rounded-[2px] border transition-colors flex items-center gap-1 ${showTodosOnly ? 'bg-bg-secondary border-success text-success' : 'border-border-color text-text-secondary hover:text-text-primary'}`}
            >
              <Check className="w-3.5 h-3.5" />
              {showTodosOnly ? '全部' : '待办'}
            </button>
            <button
              onClick={() => setShowArchived((v) => !v)}
              className={`px-3 py-1.5 text-xs rounded-[2px] border transition-colors ${showArchived ? 'bg-bg-secondary border-info text-info' : 'border-border-color text-text-secondary hover:text-text-primary'}`}
            >
              {showArchived ? '隐藏归档' : '显示归档'}
            </button>
            <button
              onClick={() => setShowReminderPanel((v) => !v)}
              className={`px-3 py-1.5 text-xs rounded-[2px] border transition-colors flex items-center gap-1.5 ${showReminderPanel ? 'bg-bg-secondary border-info text-info' : 'border-border-color text-text-secondary hover:text-text-primary'}`}
            >
              <Bell className="w-3.5 h-3.5" />
              提醒 ({reminders.length})
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Notes board */}
          <div className="lg:col-span-2 space-y-4">
            {/* Quick add */}
            <div className="glass-card rounded-[2px] p-4 space-y-3">
              <textarea
                value={quickContent}
                onChange={(e) => setQuickContent(e.target.value)}
                placeholder="写点什么... 支持 Ctrl+Enter 快速保存"
                rows={3}
                className="w-full bg-bg-secondary border border-border-color rounded-[2px] p-3 text-sm text-text-primary placeholder-text-muted outline-none resize-none focus:border-warning/40 transition-colors"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.ctrlKey) handleQuickAdd();
                }}
              />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    {COLORS.map((c) => (
                      <button
                        key={c.value}
                        onClick={() => setQuickColor(c.value)}
                        className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 ${quickColor === c.value ? 'border-text-primary' : 'border-transparent'}`}
                        style={{ backgroundColor: c.value }}
                        title={c.label}
                      />
                    ))}
                  </div>
                  <input
                    type="datetime-local"
                    value={quickReminder}
                    onChange={(e) => setQuickReminder(e.target.value)}
                    className="bg-bg-secondary border border-border-color rounded-[2px] px-2 py-1 text-xs text-text-primary outline-none focus:border-warning/40"
                  />
                  <button
                    onClick={() => setQuickIsTodo((v) => !v)}
                    className={`px-2 py-1 text-xs rounded-[2px] border transition-colors flex items-center gap-1 ${quickIsTodo ? 'border-success text-success bg-success/10' : 'border-border-color text-text-muted hover:text-text-primary'}`}
                    title={quickIsTodo ? '取消设为待办' : '设为待办'}
                  >
                    <Check className="w-3 h-3" />
                    待办
                  </button>
                </div>
                <button
                  onClick={handleQuickAdd}
                  disabled={!quickContent.trim() || createNoteMutation.isPending}
                  className="btn-primary flex items-center gap-1.5 text-xs py-2 px-4 disabled:opacity-50"
                >
                  {createNoteMutation.isPending ? (
                    <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Plus className="w-3.5 h-3.5" />
                  )}
                  添加便签
                </button>
              </div>
            </div>

            {/* Notes grid */}
            {isLoading ? (
              <div className="flex items-center justify-center py-20">
                <div className="w-8 h-8 border-2 border-warning border-t-transparent rounded-full animate-spin" />
              </div>
            ) : sortedNotes.length === 0 ? (
              <div className="glass-card rounded-[2px] p-12 text-center">
                <StickyNoteIcon className="w-12 h-12 text-text-muted mx-auto mb-3" />
                <p className="text-sm text-text-secondary">还没有便签，写一条吧</p>
              </div>
            ) : (
              <div className="flex flex-wrap gap-4 content-start">
                <AnimatePresence mode="popLayout">
                  {sortedNotes.map((note) => (
                    <NoteCard
                      key={note.id}
                      note={note}
                      onUpdate={(id, data) => updateNoteMutation.mutate({ id, data })}
                      onDelete={(id) => deleteNoteMutation.mutate(id)}
                      onConvertToNote={(id) => convertToNoteMutation.mutate(id)}
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>

          {/* Reminder panel */}
          <div className={`space-y-4 ${showReminderPanel ? '' : 'hidden lg:block'}`}>
            <div className="glass-card rounded-[2px] p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
                <Bell className="w-4 h-4 text-info" />
                新建提醒
              </div>
              <input
                type="text"
                value={reminderTitle}
                onChange={(e) => setReminderTitle(e.target.value)}
                placeholder="提醒内容..."
                className="w-full bg-bg-secondary border border-border-color rounded-[2px] px-3 py-2 text-sm text-text-primary placeholder-text-muted outline-none focus:border-info/40"
              />
              <input
                type="datetime-local"
                value={reminderTime}
                onChange={(e) => setReminderTime(e.target.value)}
                className="w-full bg-bg-secondary border border-border-color rounded-[2px] px-3 py-2 text-sm text-text-primary outline-none focus:border-info/40"
              />
              <button
                onClick={handleAddReminder}
                disabled={!reminderTitle.trim() || !reminderTime || createReminderMutation.isPending}
                className="w-full btn-primary text-xs py-2 disabled:opacity-50"
              >
                设置提醒
              </button>
            </div>

            <div className="glass-card rounded-[2px] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-text-primary"> upcoming </span>
                <span className="text-xs text-text-muted">{reminders.filter((r) => !r.is_completed).length} 待办</span>
              </div>
              <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                {reminders.length === 0 ? (
                  <p className="text-xs text-text-secondary text-center py-4">暂无提醒</p>
                ) : (
                  reminders.map((reminder) => (
                    <ReminderItem
                      key={reminder.id}
                      reminder={reminder}
                      onToggle={(id, completed) => updateReminderMutation.mutate({ id, data: { is_completed: completed } })}
                      onDelete={(id) => deleteReminderMutation.mutate(id)}
                    />
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StickyNotesPage;
