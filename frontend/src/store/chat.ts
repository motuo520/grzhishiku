import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// 对话历史：当前活动会话 + 对话面板开合状态。
// panelOpen 放在全局 store 是为了让 /chat 历史页的「继续对话」能跨页面唤起 ChatInputBar。
interface ChatState {
  activeConversationId: string | null;
  panelOpen: boolean;
  setActiveConversationId: (id: string | null) => void;
  setPanelOpen: (open: boolean) => void;
}

export const useChat = create<ChatState>()(
  persist(
    (set) => ({
      activeConversationId: null,
      panelOpen: false,
      setActiveConversationId: (id) => set({ activeConversationId: id }),
      setPanelOpen: (open) => set({ panelOpen: open }),
    }),
    {
      name: 'psb-chat',
      partialize: (state) => ({ activeConversationId: state.activeConversationId }),
    }
  )
);
