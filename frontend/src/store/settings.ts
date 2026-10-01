import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { setActiveProvider as setActiveProviderApi } from '@/api/llm';
import { settingsApi } from '@/api/settings';
import { LLM_MODEL_MAP, getModelByProviderModel, normalizeOllamaModelName } from '@/config/llmModels';

// defaultLLM 只记「能精确映射回选择器选项」的选型：静态表精确命中用选项 id，
// 平台通道记 platform:{id}；目录行（sys-/opencode- 等）映射不到就返回空串保留旧值。
// 绝不用 getModelIdByProviderModel——它末尾恒兜底 'ollama'，选一次系统模型就把
// defaultLLM 污染成本地 0.8b，下次聊天页挂载直接拿错模型（09-04 混模型事故根因）
export function defaultLLMForSelection(provider: string, model: string): string {
  if (provider.toLowerCase() === 'platform') return `platform:${model}`;
  return getModelByProviderModel(provider, model)?.id || '';
}

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
  /** 界面版本：simple=简化版五动作（默认，首次访问）, classic=经典版完整功能（persist 存量用户不受影响） */
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
  /** 用户点选写后端的近写时间戳（服务端→store 同步的避让窗口，见 setActiveProvider） */
  lastActiveWriteAt: number;
  /** 用户点选写后端在途标记（在途期间一切 status/启动回读不得覆盖 store） */
  activeWritePending: boolean;

  autoSync: boolean;
  syncInterval: number;
  encryptNotes: boolean;
  autoLockMinutes: number;
  mascotVisible: boolean;
  /** 自动打标模型提示条已关闭（AI 设置页与批量导入页共用，关一次不再出现） */
  autotagHintDismissed: boolean;
  /** 注卡保存后自动触发 LLM 验证（默认关——每条都烧钱，08-21 用户拍板做开关） */
  autoVerifyOnAnnotate: boolean;
  /** 百科页「不看重」标记（09-16）：与服务端 settings.wiki_dismissed 同步，
      标记的主题/条目沉底淡化、不进一键编译；子键值=全量列表 */
  wikiDismissed: { topics: string[]; entries: string[] };

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
  setAutotagHintDismissed: (dismissed: boolean) => void;
  setAutoVerifyOnAnnotate: (enabled: boolean) => void;
  setActiveProvider: (provider: string, model: string) => Promise<void>;
  syncActiveProvider: (provider: string, model: string) => void;
  /** 服务端 → store 水合（WikiPage 挂载时拉 /me/settings 灌入） */
  setWikiDismissed: (value: { topics: string[]; entries: string[] }) => void;
  /** 标记/恢复「不看重」：乐观更新 + PUT 全量子键列表 + 失败回滚（回滚后抛错由调用方提示） */
  toggleWikiDismissed: (kind: 'topics' | 'entries', key: string) => Promise<void>;
}

// 写序号：快速连点时只让最后一次 setActiveProvider 的结果落地（模块级，不入 store）
let activeWriteSeq = 0;

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      theme: 'light',
      fontSize: 'medium',
      density: 'comfortable',
      uiMode: 'simple',
      defaultLLM: 'ollama',
      localLLMEnabled: true,
      externalLLMEnabled: false,
      ollamaUrl: 'http://localhost:11434',
      ollamaModel: 'qwen3.5:0.8b',
      ollamaEmbedModel: 'bge-m3',
      apiKeys: {},
      modelList: [],
      activeProvider: 'ollama',
      activeModel: 'qwen3.5:0.8b',
      lastActiveWriteAt: 0,
      activeWritePending: false,
      autoSync: true,
      syncInterval: 5,
      encryptNotes: false,
      autoLockMinutes: 30,
      mascotVisible: true,
      autotagHintDismissed: false,
      autoVerifyOnAnnotate: false,
      wikiDismissed: { topics: [], entries: [] },

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
      setAutotagHintDismissed: (autotagHintDismissed) => set({ autotagHintDismissed }),
      setAutoVerifyOnAnnotate: (autoVerifyOnAnnotate) => set({ autoVerifyOnAnnotate }),
      setActiveProvider: async (provider, model) => {
        // ollama 模型名归一为冒号形（qwen3.5:0.8b）：历史短横/目录 id 形若直接落库，
        // 各选择点的精确映射与防乒乓守卫会因形态不等失效（点一次不跳、点两次才跳）
        if (provider.toLowerCase() === 'ollama') model = normalizeOllamaModelName(model);
        // 全局写在途/近写标记：服务端→store 的同步（App 启动 getActiveProvider、
        // LLMConnectionStatus 的 status 回读）必须避让本窗口——否则慢一拍的旧 GET
        // 会把刚点的新选择打回（强刷首点被跳回默认模型、每次点击慢一拍"差一层"）。
        // 注：LLMConnectionStatus 组件内的 lastUserActionRef/writePendingRef 只认
        // 右下角自己的点击，管不到 ChatInputBar/AISettings 发起的写，故上移到 store。
        const seq = ++activeWriteSeq;
        set({ lastActiveWriteAt: Date.now(), activeWritePending: true });
        try {
          await setActiveProviderApi(provider, model);
        } catch (e) {
          // 写库失败：放行服务端同步，让旧 status 把本地选型回滚（各点击方另有 UI 回滚）
          set({ activeWritePending: false, lastActiveWriteAt: 0 });
          throw e;
        }
        set({ activeWritePending: false });
        // 快速连点时只落地最后一次点选：旧响应后返回不得覆盖新选择
        if (seq !== activeWriteSeq) return;
        const defaultLLM = defaultLLMForSelection(provider, model);
        const update: Partial<SettingsState> = {
          activeProvider: provider,
          activeModel: model,
        };
        // 目录行（如 sys- 平台模型）映射不到本地配置时保留原 defaultLLM，不覆写成 undefined
        if (defaultLLM) update.defaultLLM = defaultLLM;
        if (provider.toLowerCase() === 'ollama') {
          update.ollamaModel = model;
        }
        set(update);
      },
      setWikiDismissed: (wikiDismissed) => set({
        wikiDismissed: {
          topics: wikiDismissed.topics || [],
          entries: wikiDismissed.entries || [],
        },
      }),
      toggleWikiDismissed: async (kind, key) => {
        const prev = get().wikiDismissed;
        const list = prev[kind];
        const nextList = list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
        const next = { ...prev, [kind]: nextList };
        set({ wikiDismissed: next });  // 乐观更新
        try {
          // 后端 dict 浅合并：发该子键的全量列表（整单替换），另一子键不动
          await settingsApi.updateSettings({ wiki_dismissed: { [kind]: nextList } });
        } catch (err) {
          set({ wikiDismissed: prev });  // 失败回滚
          throw err;
        }
      },
      syncActiveProvider: (provider, model) => {
        // 同 setActiveProvider：入口统一归一 ollama 模型名形态
        if (provider.toLowerCase() === 'ollama') model = normalizeOllamaModelName(model);
        const defaultLLM = defaultLLMForSelection(provider, model);
        const update: Partial<SettingsState> = {
          activeProvider: provider,
          activeModel: model,
        };
        if (defaultLLM) update.defaultLLM = defaultLLM;
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
        wikiDismissed: state.wikiDismissed,
      }),
    }
  )
);
