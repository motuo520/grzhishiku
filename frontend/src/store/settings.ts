import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { setActiveProvider as setActiveProviderApi } from '@/api/llm';
import { LLM_MODEL_MAP, getModelIdByProviderModel } from '@/config/llmModels';

interface ModelInfo {
  id: string;
  name: string;
  available: boolean;
  features: string[];
  context_window: number;
  latency_hint: string;
}

interface SettingsState {
  theme: 'dark' | 'light' | 'system';
  fontSize: 'small' | 'medium' | 'large';
  density: 'compact' | 'comfortable';
  /** 界面版本：classic=旧版完整功能，simple=简化版五动作 */
  uiMode: 'classic' | 'simple';

  defaultLLM: string;
  localLLMEnabled: boolean;
  externalLLMEnabled: boolean;
  ollamaUrl: string;
  ollamaModel: string;
  ollamaEmbedModel: string;
  apiKeys: Record<string, string>;
  modelList: ModelInfo[];
  activeProvider: string;
  activeModel: string;

  autoSync: boolean;
  syncInterval: number;
  encryptNotes: boolean;
  autoLockMinutes: number;
  mascotVisible: boolean;

  setTheme: (theme: 'dark' | 'light' | 'system') => void;
  setUiMode: (mode: 'classic' | 'simple') => void;
  setFontSize: (size: 'small' | 'medium' | 'large') => void;
  setDefaultLLM: (llm: string) => Promise<void>;
  setOllamaUrl: (url: string) => void;
  setOllamaModel: (model: string) => void;
  setOllamaEmbedModel: (model: string) => void;
  setApiKey: (provider: string, key: string) => void;
  setModelList: (list: ModelInfo[]) => void;
  setAutoSync: (enabled: boolean) => void;
  setEncryptNotes: (enabled: boolean) => void;
  setMascotVisible: (visible: boolean) => void;
  setActiveProvider: (provider: string, model: string) => Promise<void>;
  syncActiveProvider: (provider: string, model: string) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      fontSize: 'medium',
      density: 'comfortable',
      uiMode: 'simple',
      defaultLLM: 'ollama',
      localLLMEnabled: true,
      externalLLMEnabled: false,
      ollamaUrl: 'http://localhost:11434',
      ollamaModel: 'qwen2.5',
      ollamaEmbedModel: 'nomic-embed-text',
      apiKeys: {},
      modelList: [],
      activeProvider: 'ollama',
      activeModel: 'qwen2.5:0.5b',
      autoSync: true,
      syncInterval: 5,
      encryptNotes: false,
      autoLockMinutes: 30,
      mascotVisible: true,

      setTheme: (theme) => set({ theme }),
      setUiMode: (uiMode) => set({ uiMode }),
      setFontSize: (fontSize) => set({ fontSize }),
      setDefaultLLM: async (defaultLLM) => {
        const config = LLM_MODEL_MAP[defaultLLM];
        if (config) {
          await get().setActiveProvider(config.provider, config.model);
        } else {
          set({ defaultLLM });
        }
      },
      setOllamaUrl: (ollamaUrl) => set({ ollamaUrl }),
      setOllamaModel: (ollamaModel) => set({ ollamaModel }),
      setOllamaEmbedModel: (ollamaEmbedModel) => set({ ollamaEmbedModel }),
      setApiKey: (provider, key) =>
        set((state) => ({ apiKeys: { ...state.apiKeys, [provider]: key } })),
      setModelList: (modelList) => set({ modelList }),
      setAutoSync: (autoSync) => set({ autoSync }),
      setEncryptNotes: (encryptNotes) => set({ encryptNotes }),
      setMascotVisible: (mascotVisible) => set({ mascotVisible }),
      setActiveProvider: async (provider, model) => {
        await setActiveProviderApi(provider, model);
        const defaultLLM = getModelIdByProviderModel(provider, model);
        const update: Partial<SettingsState> = {
          activeProvider: provider,
          activeModel: model,
          defaultLLM,
        };
        if (provider.toLowerCase() === 'ollama') {
          update.ollamaModel = model;
        }
        set(update);
      },
      syncActiveProvider: (provider, model) => {
        const defaultLLM = getModelIdByProviderModel(provider, model);
        const update: Partial<SettingsState> = {
          activeProvider: provider,
          activeModel: model,
          defaultLLM,
        };
        if (provider.toLowerCase() === 'ollama') {
          update.ollamaModel = model;
        }
        set(update);
      },
    }),
    {
      name: 'psb-settings',
      partialize: (state) => ({
        theme: state.theme,
        fontSize: state.fontSize,
        density: state.density,
        uiMode: state.uiMode,
        defaultLLM: state.defaultLLM,
        localLLMEnabled: state.localLLMEnabled,
        externalLLMEnabled: state.externalLLMEnabled,
        ollamaUrl: state.ollamaUrl,
        ollamaModel: state.ollamaModel,
        ollamaEmbedModel: state.ollamaEmbedModel,
        apiKeys: state.apiKeys,
        activeProvider: state.activeProvider,
        activeModel: state.activeModel,
        autoSync: state.autoSync,
        syncInterval: state.syncInterval,
        encryptNotes: state.encryptNotes,
        autoLockMinutes: state.autoLockMinutes,
        mascotVisible: state.mascotVisible,
      }),
    }
  )
);
