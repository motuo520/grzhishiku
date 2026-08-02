import {FC, useState, useEffect, useRef, useMemo } from 'react';
import {motion, AnimatePresence } from 'framer-motion';
import {
  X, Plus, Clock, Check, EyeOff, Sun, Moon,
} from 'lucide-react';
import {useStickyNotes, useCreateStickyNote } from '@/hooks/useStickyNotes';
import {useUpcomingReminders, useCreateReminder, useUpdateReminder } from '@/hooks/useReminders';
import {useAuth } from '@/hooks/useAuth';
import {useSettings } from '@/store/settings';

const TIPS = [
  '有什么灵感？我来帮你记下来',
  '设置一个提醒，不会错过重要的事',
  '把想法贴在便签墙上吧',
  '今天有什么小目标？',
  '累了就休息一下吧',
];

const formatTime = (iso: string) => {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
};

interface MascotPalette {
  bg: string; inner: string; ring: string;
  a: string; a2: string; a3: string;
  b: string; c: string; hi: string;
}

const DARK_PALETTE: MascotPalette = {
  bg: '#0d1117', inner: '#161b22', ring: '#30363d',
  a: '#58a6ff', a2: '#3d7bd8', a3: '#1a3a6e',
  b: '#a371f7', c: '#3fb950', hi: '#ffffff',
};

const LIGHT_PALETTE: MascotPalette = {
  bg: '#fffefb', inner: '#f4f0ea', ring: '#d9d2c7',
  a: '#2f6db3', a2: '#2a5f99', a3: '#b8cfe6',
  b: '#7c4dbd', c: '#2e8b45', hi: '#ffffff',
};

const BrainMascotSvg: FC<{className?: string; isDark?: boolean }> = ({className, isDark = true }) => {
  const p = isDark ? DARK_PALETTE : LIGHT_PALETTE;
  return (
  <svg viewBox="0 0 120 120" className={className} xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor={p.a} stopOpacity="1" />
        <stop offset="40%" stopColor={p.a2} stopOpacity="0.8" />
        <stop offset="100%" stopColor={p.a3} stopOpacity="0.4" />
      </radialGradient>
      <linearGradient id="pulseGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor={p.a} stopOpacity="0.9" />
        <stop offset="50%" stopColor={p.b} stopOpacity="0.7" />
        <stop offset="100%" stopColor={p.a} stopOpacity="0.5" />
      </linearGradient>
      <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="3" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <filter id="softGlow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="1.5" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>

    <circle cx="60" cy="60" r="56" fill={p.bg} />
    <circle cx="60" cy="60" r="52" fill={p.inner} stroke={p.ring} strokeWidth="0.5" />

    <g stroke={p.ring} strokeWidth="0.3" fill="none" opacity="0.6">
      <ellipse cx="60" cy="60" rx="48" ry="48" />
      <ellipse cx="60" cy="60" rx="44" ry="44" strokeDasharray="2 4" />
    </g>

    <g stroke={p.a} strokeWidth="0.8" fill="none" filter="url(#softGlow)">
      <path
        d="M36 48 C34 36 40 24 52 20 C58 18 64 20 68 26 C72 32 70 40 66 46 C62 52 56 54 50 52 C44 50 38 52 36 48"
        strokeWidth="1"
      />
      <path d="M42 28 C44 32 48 34 52 32" strokeWidth="0.5" />
      <path d="M38 36 C42 38 46 36 50 34" strokeWidth="0.5" />
      <path d="M44 42 C48 44 52 42 56 40" strokeWidth="0.5" />
      <path d="M50 48 C54 50 58 48 62 46" strokeWidth="0.5" />
      <path d="M56 28 C58 32 60 36 58 40" strokeWidth="0.5" />
      <path d="M62 32 C64 36 66 40 64 44" strokeWidth="0.5" />
    </g>

    <g stroke={p.b} strokeWidth="0.8" fill="none" filter="url(#softGlow)">
      <path
        d="M84 48 C86 36 80 24 68 20 C62 18 56 20 52 26 C48 32 50 40 54 46 C58 52 64 54 70 52 C76 50 82 52 84 48"
        strokeWidth="1"
      />
      <path d="M78 28 C76 32 72 34 68 32" strokeWidth="0.5" />
      <path d="M82 36 C78 38 74 36 70 34" strokeWidth="0.5" />
      <path d="M76 42 C72 44 68 42 64 40" strokeWidth="0.5" />
      <path d="M70 48 C66 50 62 48 58 46" strokeWidth="0.5" />
      <path d="M64 28 C62 32 60 36 62 40" strokeWidth="0.5" />
      <path d="M58 32 C56 36 54 40 56 44" strokeWidth="0.5" />
    </g>

    <g stroke={p.a} strokeWidth="0.6" fill="none" opacity="0.8">
      <path d="M52 30 C54 32 56 34 58 32" />
      <path d="M50 36 C52 38 54 40 56 38" />
      <path d="M48 42 C50 44 52 46 54 44" />
      <path d="M52 48 C54 50 56 52 58 50" />
      <path d="M60 34 C62 36 64 38 66 36" />
      <path d="M62 40 C64 42 66 44 68 42" />
    </g>

    <g filter="url(#glow)">
      <circle cx="60" cy="38" r="4" fill="url(#coreGlow)" stroke="none" />
      <circle cx="60" cy="38" r="2" fill={p.hi} stroke="none" opacity="0.8" />
      <circle cx="44" cy="32" r="2.5" fill={p.a} stroke="none" />
      <circle cx="44" cy="32" r="1" fill={p.hi} stroke="none" opacity="0.6" />
      <circle cx="48" cy="44" r="2" fill={p.a} stroke="none" opacity="0.8" />
      <circle cx="56" cy="50" r="1.5" fill={p.a} stroke="none" opacity="0.7" />
      <circle cx="76" cy="32" r="2.5" fill={p.b} stroke="none" />
      <circle cx="76" cy="32" r="1" fill={p.hi} stroke="none" opacity="0.6" />
      <circle cx="72" cy="44" r="2" fill={p.b} stroke="none" opacity="0.8" />
      <circle cx="64" cy="50" r="1.5" fill={p.b} stroke="none" opacity="0.7" />
      <circle cx="36" cy="40" r="1.5" fill={p.a} stroke="none" opacity="0.5" />
      <circle cx="84" cy="40" r="1.5" fill={p.b} stroke="none" opacity="0.5" />
      <circle cx="40" cy="52" r="1" fill={p.a} stroke="none" opacity="0.4" />
      <circle cx="80" cy="52" r="1" fill={p.b} stroke="none" opacity="0.4" />
    </g>

    <g stroke="url(#pulseGrad)" strokeWidth="0.4" fill="none" opacity="0.7">
      <path d="M56 38 C52 36 48 34 44 32" />
      <path d="M58 40 C54 42 50 44 48 44" />
      <path d="M56 42 C54 46 54 48 56 50" />
      <path d="M64 38 C68 36 72 34 76 32" />
      <path d="M62 40 C66 42 70 44 72 44" />
      <path d="M64 42 C66 46 66 48 64 50" />
      <path d="M44 32 C48 30 52 30 56 32" strokeDasharray="1 2" />
      <path d="M76 32 C72 30 68 30 64 32" strokeDasharray="1 2" />
      <path d="M48 44 C52 42 56 42 60 44" strokeDasharray="2 3" />
      <path d="M72 44 C68 42 64 42 60 44" strokeDasharray="2 3" />
      <path d="M44 32 C40 34 38 38 36 40" strokeWidth="0.3" strokeOpacity="0.5" />
      <path d="M76 32 C80 34 82 38 84 40" strokeWidth="0.3" strokeOpacity="0.5" />
      <path d="M48 44 C44 46 42 50 40 52" strokeWidth="0.3" strokeOpacity="0.4" />
      <path d="M72 44 C76 46 78 50 80 52" strokeWidth="0.3" strokeOpacity="0.4" />
    </g>

    <g stroke={p.c} strokeWidth="0.5" fill="none" opacity="0.6" filter="url(#softGlow)">
      <path d="M60 56 C60 64 58 72 56 80" />
      <path d="M60 56 C62 64 64 72 66 80" />
      <path d="M58 68 C54 72 50 76 46 80" />
      <path d="M56 74 C52 78 48 82 44 86" />
      <path d="M57 66 C54 68 50 70 48 72" />
      <path d="M62 68 C66 72 70 76 74 80" />
      <path d="M64 74 C68 78 72 82 76 86" />
      <path d="M63 66 C66 68 70 70 72 72" />
      <circle cx="46" cy="80" r="1.5" fill={p.c} stroke="none" />
      <circle cx="44" cy="86" r="1" fill={p.c} stroke="none" opacity="0.7" />
      <circle cx="74" cy="80" r="1.5" fill={p.c} stroke="none" />
      <circle cx="76" cy="86" r="1" fill={p.c} stroke="none" opacity="0.7" />
      <circle cx="56" cy="80" r="1.2" fill={p.c} stroke="none" />
      <circle cx="66" cy="80" r="1.2" fill={p.c} stroke="none" />
    </g>

    <ellipse cx="60" cy="88" rx="20" ry="4" fill="none" stroke={p.c} strokeWidth="0.3" opacity="0.3" />
    <ellipse cx="60" cy="88" rx="14" ry="2.5" fill="none" stroke={p.c} strokeWidth="0.2" opacity="0.2" />

    <g fill={p.a} opacity="0.5">
      <circle cx="28" cy="28" r="1" />
      <circle cx="92" cy="24" r="0.8" />
      <circle cx="24" cy="72" r="0.6" />
      <circle cx="96" cy="68" r="0.9" />
      <circle cx="32" cy="92" r="0.7" />
      <circle cx="88" cy="96" r="0.5" />
    </g>
    <g fill={p.b} opacity="0.4">
      <circle cx="20" cy="48" r="0.7" />
      <circle cx="100" cy="52" r="0.6" />
      <circle cx="36" cy="96" r="0.5" />
      <circle cx="84" cy="100" r="0.8" />
    </g>
    <g fill={p.hi} opacity="0.8">
      <circle cx="60" cy="12" r="1" />
      <circle cx="56" cy="14" r="0.5" />
      <circle cx="64" cy="14" r="0.5" />
    </g>
  </svg>
  );
};

const MascotWidget: FC = () => {
  const {isLoggedIn } = useAuth();
  const theme = useSettings((state) => state.theme);
  const setTheme = useSettings((state) => state.setTheme);
  const mascotVisible = useSettings((state) => state.mascotVisible);
  const setMascotVisible = useSettings((state) => state.setMascotVisible);
  const isDark = useMemo(() => {
    if (theme === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return theme === 'dark';
  }, [theme]);
  const [open, setOpen] = useState(false);
  const [bubbleIndex, setBubbleIndex] = useState(0);
  const [showBubble, setShowBubble] = useState(true);
  const [activeTab, setActiveTab] = useState<'note' | 'reminder'>('note');
  const [noteContent, setNoteContent] = useState('');
  const [reminderTitle, setReminderTitle] = useState('');
  const [reminderTime, setReminderTime] = useState('');

  const {notes } = useStickyNotes(false);
  const {data: upcoming } = useUpcomingReminders(15);
  const createNote = useCreateStickyNote();
  const createReminder = useCreateReminder();
  const updateReminder = useUpdateReminder();

  useEffect(() => {
    if (open) {
      setShowBubble(false);
      return;
    }
    const interval = setInterval(() => {
      setShowBubble(false);
      setTimeout(() => {
        setBubbleIndex((i) => (i + 1) % TIPS.length);
        setShowBubble(true);
      }, 300);
    }, 8000);
    return () => clearInterval(interval);
  }, [open]);

  const handleCreateNote = () => {
    if (!noteContent.trim()) return;
    createNote.mutate({content: noteContent.trim() }, {
      onSuccess: () => setNoteContent(''),
    });
  };

  const handleCreateReminder = () => {
    if (!reminderTitle.trim() || !reminderTime) return;
    createReminder.mutate({
      title: reminderTitle.trim(),
      remind_at: new Date(reminderTime).toISOString(),
      source: 'mascot',
    }, {
      onSuccess: () => {
        setReminderTitle('');
        setReminderTime('');
      },
    });
  };

  const isDraggingRef = useRef(false);
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const handleResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const upcomingCount = upcoming?.length ?? 0;

  if (!isLoggedIn || !mascotVisible) return null;

  return (
    <div className="fixed bottom-20 right-6 z-50 flex flex-col items-end gap-3 pointer-events-none">
      <motion.div
        drag
        dragMomentum={false}
        dragElastic={0}
        dragConstraints={{
          left: -viewport.w + 80,
          right: 0,
          top: -viewport.h + 80,
          bottom: 0,
        }}
        onDragStart={() => { isDraggingRef.current = true; }}
        onDragEnd={() => { setTimeout(() => { isDraggingRef.current = false; }, 60); }}
        className="flex flex-col items-end gap-3 pointer-events-auto"
      >
      <AnimatePresence>
        {!open && showBubble && (
          <motion.div
            initial={{opacity: 0, y: 10, scale: 0.9 }}
            animate={{opacity: 1, y: 0, scale: 1 }}
            exit={{opacity: 0, y: 10, scale: 0.9 }}
            className="pointer-events-auto max-w-[220px] glass-card rounded-2xl rounded-br-sm p-3 text-xs text-text-primary shadow-xl border border-border-color mr-2"
          >
            <div className="flex items-start gap-2">
              <span className="text-lg">💡</span>
              <div>
                <p>{TIPS[bubbleIndex]}</p>
                {upcomingCount > 0 && (
                  <p className="mt-1.5 text-info font-medium">你有 {upcomingCount} 个即将到期的提醒</p>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{opacity: 0, scale: 0.9, y: 20 }}
            animate={{opacity: 1, scale: 1, y: 0 }}
            exit={{opacity: 0, scale: 0.9, y: 20 }}
            className="pointer-events-auto w-80 glass-card rounded-2xl shadow-2xl border border-border-color overflow-hidden mb-2"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border-color">
              <span className="text-sm font-medium text-text-primary">小助手</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setTheme(isDark ? 'light' : 'dark')}
                  className="text-text-muted hover:text-text-primary"
                  title="切换明暗主题"
                >
                  {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => { setOpen(false); setMascotVisible(false); }}
                  className="text-text-muted hover:text-text-primary"
                  title="隐藏小助手（可在 设置 → 外观 中重新开启）"
                >
                  <EyeOff className="w-4 h-4" />
                </button>
                <button onClick={() => setOpen(false)} className="text-text-muted hover:text-text-primary">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex border-b border-border-color">
              <button
                onClick={() => setActiveTab('note')}
                className={`flex-1 py-2 text-xs font-medium transition-colors ${activeTab === 'note' ? 'text-warning bg-warning/10' : 'text-text-secondary hover:text-text-primary'}`}
              >
                便签
              </button>
              <button
                onClick={() => setActiveTab('reminder')}
                className={`flex-1 py-2 text-xs font-medium transition-colors ${activeTab === 'reminder' ? 'text-info bg-info/10' : 'text-text-secondary hover:text-text-primary'}`}
              >
                提醒
              </button>
            </div>

            <div className="p-4 space-y-3">
              {activeTab === 'note' ? (
                <>
                  <textarea
                    value={noteContent}
                    onChange={(e) => setNoteContent(e.target.value)}
                    placeholder="快速记录一个想法..."
                    rows={3}
                    className="w-full bg-bg-secondary border border-border-color rounded-xl p-3 text-sm text-text-primary placeholder-text-muted outline-none resize-none focus:border-warning/40"
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-text-muted">已有 {notes.length} 条便签</span>
                    <button
                      onClick={handleCreateNote}
                      disabled={!noteContent.trim() || createNote.isPending}
                      className="btn-primary flex items-center gap-1 text-xs py-1.5 px-3 disabled:opacity-50"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      保存
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <input
                    type="text"
                    value={reminderTitle}
                    onChange={(e) => setReminderTitle(e.target.value)}
                    placeholder="提醒内容..."
                    className="w-full bg-bg-secondary border border-border-color rounded-xl px-3 py-2 text-sm text-text-primary placeholder-text-muted outline-none focus:border-info/40"
                  />
                  <input
                    type="datetime-local"
                    value={reminderTime}
                    onChange={(e) => setReminderTime(e.target.value)}
                    className="w-full bg-bg-secondary border border-border-color rounded-xl px-3 py-2 text-sm text-text-primary outline-none focus:border-info/40"
                  />
                  <button
                    onClick={handleCreateReminder}
                    disabled={!reminderTitle.trim() || !reminderTime || createReminder.isPending}
                    className="w-full btn-primary text-xs py-2 disabled:opacity-50"
                  >
                    设置提醒
                  </button>
                </>
              )}

              {upcoming && upcoming.length > 0 && (
                <div className="pt-2 border-t border-border-color space-y-2">
                  <div className="text-[10px] text-info font-medium flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    即将到期
                  </div>
                  {upcoming.slice(0, 3).map((r) => (
                    <div key={r.id} className="flex items-start gap-2 text-xs">
                      <button
                        onClick={() => updateReminder.mutate({id: r.id, data: {is_completed: true } })}
                        className="mt-0.5 w-3.5 h-3.5 rounded border border-text-muted flex items-center justify-center hover:border-info"
                      >
                        <Check className="w-3 h-3 text-info opacity-0 hover:opacity-100" />
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="text-text-primary truncate">{r.title}</div>
                        <div className="text-[10px] text-text-muted">{formatTime(r.remind_at)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        onClick={() => { if (isDraggingRef.current) return; setOpen((v) => !v); }}
        whileHover={{scale: 1.05 }}
        whileTap={{scale: 0.95 }}
        className="pointer-events-auto w-14 h-14 rounded-full shadow-lg border border-border-color bg-bg-secondary flex items-center justify-center relative hover:scale-105 transition-transform"
        title="小助手"
      >
        <BrainMascotSvg className="w-12 h-12" isDark={isDark} />
        {upcomingCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-info text-white text-[10px] font-bold flex items-center justify-center border-2 border-bg-primary">
            {upcomingCount}
          </span>
        )}
      </motion.button>
      </motion.div>
    </div>
  );
};

export default MascotWidget;
