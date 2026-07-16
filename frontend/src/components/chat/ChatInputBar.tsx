import { FC } from 'react';
import { Send, Square } from 'lucide-react';
import { LLM_MODEL_MAP } from '@/config/llmModels';
import ModelSelector from '@/components/llm/ModelSelector';
import LLMCostBadge from '@/components/llm/LLMCostBadge';

interface ChatInputBarProps {
  message: string;
  onMessageChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  isStreaming: boolean;
  disabled?: boolean;
  brainLabel: string;
  messages: Array<{ role: string; content: string }>;
  preferredModel: string;
  onPreferredModelChange: (modelId: string) => void;
}

const ChatInputBar: FC<ChatInputBarProps> = ({
  message,
  onMessageChange,
  onSend,
  onStop,
  isStreaming,
  disabled,
  brainLabel,
  preferredModel,
  onPreferredModelChange,
}) => {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (isStreaming) {
        onStop();
      } else {
        onSend();
      }
    }
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-3">
        <ModelSelector
          value={preferredModel}
          onChange={onPreferredModelChange}
          taskType="chat"
          className="w-56"
          disabled={disabled || isStreaming}
        />
        <div className="hidden sm:block flex-1 min-w-0">
          <LLMCostBadge
            modelId={preferredModel}
            inputText={message}
            outputTokenEstimate={200}
          />
        </div>
      </div>

      {LLM_MODEL_MAP[preferredModel] && (
        <div className="hidden sm:flex items-center gap-1.5 overflow-hidden">
          {LLM_MODEL_MAP[preferredModel].tags.map((tag) => (
            <span
              key={tag}
              className="text-[10px] px-2 py-0.5 rounded-full bg-bg-secondary text-text-secondary border border-border-color whitespace-nowrap"
            >
              {tag}
            </span>
          ))}
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-bg-secondary text-text-secondary border border-border-color whitespace-nowrap">
            上下文 {LLM_MODEL_MAP[preferredModel].context}
          </span>
        </div>
      )}

      <div className="flex items-center gap-2 sm:gap-3">
        <div className="shrink-0 px-2.5 py-1.5 rounded-xl text-xs font-medium border border-purple-400/30 bg-purple-400/10 text-purple-400">
          {brainLabel}
        </div>

        <input
          type="text"
          value={message}
          onChange={(e) => onMessageChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息..."
          disabled={disabled}
          className="flex-1 bg-bg-secondary border border-border-color rounded-xl px-4 py-2.5 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-info/60 focus:bg-bg-secondary transition-all shadow-inner"
        />

        <button
          onClick={isStreaming ? onStop : onSend}
          disabled={disabled || (!isStreaming && !message.trim())}
          className={`shrink-0 p-2.5 rounded-xl transition-all shadow-sm ${
            isStreaming
              ? 'bg-danger hover:bg-danger/80 text-white shadow-danger/20'
              : message.trim()
                ? 'bg-info hover:bg-network-secondary text-white shadow-info/20'
                : 'bg-bg-tertiary text-text-secondary cursor-not-allowed'
          }`}
        >
          {isStreaming ? <Square size={20} /> : <Send size={20} />}
        </button>
      </div>
    </div>
  );
};

export default ChatInputBar;
