import { FC, ReactNode, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, X } from 'lucide-react';

// Electron renderer 不支持 window.prompt / window.confirm / window.alert，
// 这里提供受控的内联替代组件（网页/桌面双端通用）：
// InlinePrompt = 文本输入行（Enter 提交 / Esc 取消），InlineConfirm = 危险操作确认行。

interface InlinePromptProps {
  placeholder?: string;
  initialValue?: string;
  submitText?: string;
  /** 提交失败的错误文本，显示在输入行下方 */
  error?: string | null;
  /** 提交中：禁用输入与按钮并显示加载态 */
  busy?: boolean;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

export const InlinePrompt: FC<InlinePromptProps> = ({
  placeholder,
  initialValue = '',
  submitText = '确定',
  error,
  busy = false,
  onSubmit,
  onCancel,
}) => {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    onSubmit(trimmed);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
    >
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          type="text"
          value={value}
          disabled={busy}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onCancel();
            }
          }}
          className="flex-1 min-w-0 bg-white/[0.03] border border-border-color rounded-[2px] px-2 py-1 text-xs text-text-primary placeholder-text-muted focus:outline-none focus:border-info disabled:opacity-50"
        />
        <button
          onClick={submit}
          disabled={busy || !value.trim()}
          title={submitText}
          className="p-1 rounded-[2px] text-info hover:bg-info/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {busy ? (
            <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
          ) : (
            <Check className="w-3.5 h-3.5" />
          )}
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          title="取消"
          className="p-1 rounded-[2px] text-text-muted hover:text-text-primary hover:bg-white/[0.05] disabled:opacity-40 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {error && <div className="mt-1 text-[11px] text-danger leading-snug">{error}</div>}
    </motion.div>
  );
};

interface InlineConfirmProps {
  /** 确认文案（删除后果说明等） */
  text: ReactNode;
  confirmText?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const InlineConfirm: FC<InlineConfirmProps> = ({
  text,
  confirmText = '确认',
  busy = false,
  onConfirm,
  onCancel,
}) => (
  <motion.div
    initial={{ opacity: 0, y: -4 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.15 }}
    className="rounded-[2px] border border-danger/25 bg-danger/10 px-2 py-1.5"
  >
    <div className="text-[11px] text-text-secondary leading-snug mb-1.5">{text}</div>
    <div className="flex items-center gap-1.5">
      <button
        onClick={onConfirm}
        disabled={busy}
        className="px-2 py-0.5 rounded-[2px] text-[11px] bg-danger/20 text-danger border border-danger/30 hover:bg-danger/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {busy ? (
          <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
        ) : (
          confirmText
        )}
      </button>
      <button
        onClick={onCancel}
        disabled={busy}
        className="px-2 py-0.5 rounded-[2px] text-[11px] text-text-secondary border border-border-color hover:text-text-primary hover:bg-white/[0.05] disabled:opacity-50 transition-colors"
      >
        取消
      </button>
    </div>
  </motion.div>
);

export default InlinePrompt;
