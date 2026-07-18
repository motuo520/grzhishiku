import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type BrainSide = 'personal' | 'network' | 'both' | 'unknown';

// 开源版收敛为三个动作 + 设置/社区
export type MenuId =
  | 'ingest'
  | 'pipeline'
  | 'ask'
  | 'community'
  | 'settings';

export type TopNavBucketId = 'collect' | 'process' | 'ask';

export interface SubMenuItem {
  id: string;
  label: string;
  description: string;
  icon: string;
  path: string;
  brainSide?: BrainSide;
  preferredBrainSide?: BrainSide;
}

export interface MenuData {
  id: MenuId;
  label: string;
  icon: string;
  description: string;
  items: SubMenuItem[];
  defaultBrainSide: BrainSide;
}

export interface TopNavBucket {
  id: TopNavBucketId;
  label: string;
  icon: string;
  description: string;
  primaryModuleId: MenuId;
  moduleIds: MenuId[];
}

// ── 顶部导航：只保留"存进来 / 自动理好 / 一句话问出来"三个动作 ──
export const TOP_NAV_BUCKETS: TopNavBucket[] = [
  {
    id: 'collect',
    label: '存进来',
    icon: 'Download',
    description: '笔记、剪藏、RSS、稍后读、文档等所有输入入口',
    primaryModuleId: 'ingest',
    moduleIds: ['ingest'],
  },
  {
    id: 'process',
    label: '自动理好',
    icon: 'Workflow',
    description: '把素材加工成可检索、可复用的知识卡片',
    primaryModuleId: 'pipeline',
    moduleIds: ['pipeline'],
  },
  {
    id: 'ask',
    label: '一句话问出来',
    icon: 'Sparkles',
    description: '向你的知识库提问，答案必须带引用出处',
    primaryModuleId: 'ask',
    moduleIds: ['ask'],
  },
];

export const MENU_DATA: Record<MenuId, MenuData> = {
  ingest: {
    id: 'ingest',
    label: '存进来',
    icon: 'Download',
    description: '把你的资料集中存进来',
    defaultBrainSide: 'both',
    items: [
      { id: 'notes', label: '笔记管理', description: '个人想法与记录', icon: 'FileText', path: '/ingest/notes', brainSide: 'personal' },
      { id: 'sticky-notes', label: '便签墙', description: '随手记、提醒与彩色便签', icon: 'StickyNote', path: '/ingest/sticky-notes', brainSide: 'personal' },
      { id: 'clipper', label: '浏览器剪藏', description: '一键保存网页内容', icon: 'Globe', path: '/ingest/clipper', brainSide: 'network' },
      { id: 'batch-import', label: '批量导入', description: '批量导入笔记、剪藏和链接', icon: 'Upload', path: '/ingest/batch-import', brainSide: 'both' },
      { id: 'rss', label: 'RSS 聚合', description: '订阅源自动采集', icon: 'Rss', path: '/ingest/rss', brainSide: 'network' },
      { id: 'read-later', label: '稍后读', description: '收藏链接，稍后阅读', icon: 'BookOpen', path: '/ingest/read-later', brainSide: 'network' },
      { id: 'documents', label: '文件/文档库', description: '本地文档提取与管理', icon: 'FolderOpen', path: '/ingest/documents', brainSide: 'both' },
      { id: 'sources', label: '素材池', description: '跨工具共享的灵感素材', icon: 'Database', path: '/ingest/sources', brainSide: 'both' },
    ],
  },
  pipeline: {
    id: 'pipeline',
    label: '自动理好',
    icon: 'Workflow',
    description: '把原始素材加工成可用知识',
    defaultBrainSide: 'both',
    items: [
      { id: 'overview', label: '管线总览', description: '原始→卡片→抽取→碰撞→注卡', icon: 'Workflow', path: '/pipeline', brainSide: 'both', preferredBrainSide: 'both' },
      { id: 'raw', label: '原始素材', description: '未经处理的输入、剪藏、书摘', icon: 'Database', path: '/pipeline/raw', brainSide: 'network', preferredBrainSide: 'network' },
      { id: 'cards', label: '卡片化', description: '将素材切割为可复用卡片', icon: 'SquareStack', path: '/pipeline/cards', brainSide: 'both', preferredBrainSide: 'both' },
      { id: 'extract', label: '抽取', description: '提取概念、模型与行动建议', icon: 'Filter', path: '/pipeline/extract', brainSide: 'both', preferredBrainSide: 'both' },
      { id: 'collision', label: '碰撞', description: '跨领域连接与创意杂交', icon: 'Shuffle', path: '/pipeline/collision', brainSide: 'both', preferredBrainSide: 'both' },
      { id: 'annotate', label: '注卡', description: '为卡片注入个人语境与行动', icon: 'Pencil', path: '/pipeline/annotate', brainSide: 'personal', preferredBrainSide: 'personal' },
    ],
  },
  ask: {
    id: 'ask',
    label: '一句话问出来',
    icon: 'Sparkles',
    description: '用 AI 向你的知识库提问',
    defaultBrainSide: 'both',
    items: [
      { id: 'query', label: 'AI 问答', description: '用自然语言提问，答案带引用', icon: 'Sparkles', path: '/graph/query', brainSide: 'both' },
      { id: 'network', label: '知识网络', description: '全局关系图谱', icon: 'Network', path: '/graph/network', brainSide: 'both' },
      { id: 'knowledge-network', label: '网络脑知识', description: '从外部采集的可验证知识', icon: 'Globe', path: '/knowledge/network', brainSide: 'network' },
      { id: 'knowledge-personal', label: '个人脑知识', description: '个人思考与沉淀的知识单元', icon: 'User', path: '/knowledge/personal', brainSide: 'personal' },
      { id: 'verify', label: '做到了没', description: '多模型验证与共识裁决', icon: 'CheckCircle', path: '/knowledge/verify', brainSide: 'both' },
      { id: 'capsules', label: '未来的信', description: '封存记忆，未来开启', icon: 'Package', path: '/capsules/my', brainSide: 'personal' },
      { id: 'daily-review', label: '每日复盘', description: '回顾今日输入，发现行为差距', icon: 'Calendar', path: '/daily-review', brainSide: 'both' },
    ],
  },
  community: {
    id: 'community',
    label: '社区',
    icon: 'MessageSquare',
    description: '用户交流区，登录后可发言',
    defaultBrainSide: 'both',
    items: [
      { id: 'posts', label: '社区动态', description: '浏览和发布社区消息', icon: 'MessageSquare', path: '/community', brainSide: 'both' },
      { id: 'guide', label: '使用指南', description: '从零上手：概念、流程、功能详解', icon: 'BookOpen', path: '/community/guide', brainSide: 'both' },
    ],
  },
  settings: {
    id: 'settings',
    label: '设置',
    icon: 'Settings',
    description: '系统配置与个性化',
    defaultBrainSide: 'both',
    items: [
      { id: 'account', label: '账户', description: '个人信息与密码', icon: 'User', path: '/settings/account', brainSide: 'both' },
      { id: 'privacy', label: '隐私', description: '数据安全设置', icon: 'Lock', path: '/settings/privacy', brainSide: 'both' },
      { id: 'ai', label: 'AI 设置', description: '模型与偏好配置', icon: 'Cpu', path: '/settings/ai', brainSide: 'both' },
      { id: 'sync', label: '同步', description: '数据同步配置', icon: 'RefreshCw', path: '/settings/sync', brainSide: 'both' },
      { id: 'storage', label: '存储', description: '数据打包与网盘备份', icon: 'HardDrive', path: '/settings/storage', brainSide: 'both' },
      { id: 'plugins', label: '插件', description: '扩展管理', icon: 'Puzzle', path: '/settings/plugins', brainSide: 'both' },
      { id: 'data', label: '数据', description: '导入导出与清理', icon: 'Database', path: '/settings/data', brainSide: 'both' },
      { id: 'appearance', label: '外观', description: '主题与显示', icon: 'Palette', path: '/settings/appearance', brainSide: 'both' },
    ],
  },
};

// ── 设置菜单：Sidebar 和 SettingsPage 共用 ──
export const SETTINGS_ITEMS: Pick<SubMenuItem, 'id' | 'label' | 'icon' | 'path'>[] = [
  { id: 'account', label: '账户', icon: 'User', path: '/settings/account' },
  { id: 'privacy', label: '隐私', icon: 'Lock', path: '/settings/privacy' },
  { id: 'ai', label: 'AI 设置', icon: 'Cpu', path: '/settings/ai' },
  { id: 'sync', label: '同步', icon: 'RefreshCw', path: '/settings/sync' },
  { id: 'storage', label: '存储', icon: 'HardDrive', path: '/settings/storage' },
  { id: 'plugins', label: '插件', icon: 'Puzzle', path: '/settings/plugins' },
  { id: 'data', label: '数据', icon: 'Database', path: '/settings/data' },
  { id: 'appearance', label: '外观', icon: 'Palette', path: '/settings/appearance' },
];

// ── 快速操作：Sidebar 用 ──
export const QUICK_ACTIONS: Pick<SubMenuItem, 'id' | 'label' | 'icon' | 'path' | 'brainSide'>[] = [
  { id: 'new-note', label: '新建笔记', icon: 'FileText', path: '/ingest/notes', brainSide: 'personal' },
  { id: 'new-clip', label: '剪藏网页', icon: 'Globe', path: '/ingest/clipper', brainSide: 'network' },
  { id: 'ai-query', label: 'AI 问答', icon: 'Sparkles', path: '/graph/query', brainSide: 'both' },
  { id: 'knowledge', label: '知识网络', icon: 'Network', path: '/graph/network', brainSide: 'both' },
];

// ── 路径 → 模块 ID ──
export function getMenuIdByPath(pathname: string): MenuId | null {
  const segments = pathname.toLowerCase().split('/').filter(Boolean);
  const first = segments[0] as MenuId | string;
  if (MENU_DATA[first as MenuId]) return first as MenuId;
  // 个人中心相关独立页面统一归入 settings 桶
  if (['payment', 'topup', 'billing', 'business-plan'].includes(first)) return 'settings';
  return null;
}

// ── 模块 ID → 一级导航桶 ──
export function getBucketByMenuId(menuId: MenuId | null): TopNavBucket | undefined {
  if (!menuId) return undefined;
  return TOP_NAV_BUCKETS.find((b) => b.moduleIds.includes(menuId));
}

// ── 脑侧过滤通用逻辑 ──
export function getVisibleItems<T extends { brainSide?: BrainSide }>(
  items: T[],
  brainSide: BrainSide
): T[] {
  if (brainSide === 'both' || brainSide === 'unknown' || !brainSide) return items;
  return items.filter((item) => {
    if (!item.brainSide || item.brainSide === 'both') return true;
    return item.brainSide === brainSide;
  });
}

interface NavigationState {
  activeMenu: MenuId | null;
  subMenuOpen: boolean;
  brainSide: BrainSide;
  setActiveMenu: (menu: MenuId | null) => void;
  toggleSubMenu: () => void;
  setBrainSide: (side: BrainSide) => void;
  closeSubMenu: () => void;
}

export const useNavigation = create<NavigationState>()(
  persist(
    (set) => ({
      activeMenu: null,
      subMenuOpen: false,
      brainSide: 'both',
      setActiveMenu: (menu) =>
        set((state) => ({
          activeMenu: menu,
          subMenuOpen: menu !== null ? true : state.subMenuOpen,
          brainSide: menu ? MENU_DATA[menu].defaultBrainSide : state.brainSide,
        })),
      toggleSubMenu: () => set((state) => ({ subMenuOpen: !state.subMenuOpen })),
      setBrainSide: (side) => set({ brainSide: side }),
      closeSubMenu: () => set({ subMenuOpen: false }),
    }),
    {
      name: 'psb-navigation',
      partialize: (state) => ({ brainSide: state.brainSide }),
    }
  )
);
