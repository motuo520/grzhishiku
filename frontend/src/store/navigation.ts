import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useSettings } from './settings';

export type BrainSide = 'personal' | 'network' | 'both' | 'unknown';

// ── 两套菜单的模块 ID ──
// 简化版：开源版收敛为三个动作 + 设置/社区
export type SimpleMenuId =
  | 'ingest'
  | 'pipeline'
  | 'ask'
  | 'community'
  | 'settings';

// 经典版：旧版完整 12 模块
export type ClassicMenuId =
  | 'ingest'
  | 'graph'
  | 'cognitive'
  | 'emergence'
  | 'attention'
  | 'capsules'
  | 'knowledge'
  | 'pipeline'
  | 'social-brain'
  | 'embodied-cognition'
  | 'community'
  | 'settings';

export type MenuId = SimpleMenuId | ClassicMenuId;

export type SimpleTopNavBucketId = 'collect' | 'process' | 'ask';
export type ClassicTopNavBucketId = 'inbox' | 'process' | 'knowledge' | 'social';
export type TopNavBucketId = SimpleTopNavBucketId | ClassicTopNavBucketId;

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

// ================================================================
// 简化版菜单（三动作）
// ================================================================

// ── 顶部导航：只保留"存进来 / 自动理好 / 一句话问出来"三个动作 ──
export const TOP_NAV_BUCKETS_SIMPLE: TopNavBucket[] = [
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

export const MENU_DATA_SIMPLE: Record<SimpleMenuId, MenuData> = {
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
      { id: 'desktop', label: '桌面端', description: 'Windows 客户端下载，数据不出本机', icon: 'Monitor', path: '/settings/desktop', brainSide: 'both' },
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

export const QUICK_ACTIONS_SIMPLE: Pick<SubMenuItem, 'id' | 'label' | 'icon' | 'path' | 'brainSide'>[] = [
  { id: 'new-note', label: '新建笔记', icon: 'FileText', path: '/ingest/notes', brainSide: 'personal' },
  { id: 'new-clip', label: '剪藏网页', icon: 'Globe', path: '/ingest/clipper', brainSide: 'network' },
  { id: 'ai-query', label: 'AI 问答', icon: 'Sparkles', path: '/graph/query', brainSide: 'both' },
  { id: 'knowledge', label: '知识网络', icon: 'Network', path: '/graph/network', brainSide: 'both' },
];

// ================================================================
// 经典版菜单（旧版完整 12 模块，4 个一级导航桶）
// ================================================================

// ── 一级导航桶：把 12+ 个模块收敛成 4 个可理解的入口 ──
// “我/设置/会员/账单”统一放在左侧边栏底部菜单，不再占用顶部导航
export const TOP_NAV_BUCKETS_CLASSIC: TopNavBucket[] = [
  {
    id: 'inbox',
    label: '素材采集',
    icon: 'Download',
    description: '所有输入入口：笔记、剪藏、邮件、RSS、社交、稍后读、文档',
    primaryModuleId: 'ingest',
    moduleIds: ['ingest'],
  },
  {
    id: 'process',
    label: '素材加工',
    icon: 'Workflow',
    description: '对内容进行抽取、碰撞、创意和深度工作',
    primaryModuleId: 'pipeline',
    moduleIds: ['pipeline', 'attention', 'emergence'],
  },
  {
    id: 'knowledge',
    label: '知识库',
    icon: 'Shield',
    description: '沉淀下来的知识资产、关系图谱与时间胶囊',
    primaryModuleId: 'knowledge',
    moduleIds: ['knowledge', 'graph', 'capsules'],
  },
  {
    id: 'social',
    label: '社会大脑',
    icon: 'Users',
    description: '个人成长、社交、身体与情绪相关的工具',
    primaryModuleId: 'social-brain',
    moduleIds: ['social-brain', 'embodied-cognition', 'cognitive', 'community'],
  },
];

export const MENU_DATA_CLASSIC: Record<ClassicMenuId, MenuData> = {
  ingest: {
    id: 'ingest',
    label: '采集',
    icon: 'Download',
    description: '从网络和个人来源收集信息',
    defaultBrainSide: 'network',
    items: [
      { id: 'sticky-notes', label: '便签墙', description: '随手记、提醒与彩色便签', icon: 'StickyNote', path: '/ingest/sticky-notes', brainSide: 'personal' },
      { id: 'clipper', label: '浏览器剪藏', description: '一键保存网页内容', icon: 'Globe', path: '/ingest/clipper', brainSide: 'network' },
      { id: 'bookmarks', label: '浏览器书签', description: '导入浏览器书签 HTML', icon: 'Bookmark', path: '/ingest/bookmarks', brainSide: 'network' },
      { id: 'notes', label: '笔记管理', description: '个人想法与记录', icon: 'FileText', path: '/ingest/notes', brainSide: 'personal' },
      { id: 'batch-import', label: '批量导入', description: '批量导入笔记、剪藏和链接', icon: 'Upload', path: '/ingest/batch-import', brainSide: 'both' },
      { id: 'rss', label: 'RSS 聚合', description: '订阅源自动采集', icon: 'Rss', path: '/ingest/rss', brainSide: 'network' },
      { id: 'tags', label: '标签系统', description: '多维度内容组织', icon: 'Tags', path: '/ingest/tags', brainSide: 'both' },
      { id: 'email', label: '邮件集成', description: '邮件内容自动归档', icon: 'Mail', path: '/ingest/email', brainSide: 'network' },
      { id: 'social', label: '社交聚合', description: '社交媒体内容追踪', icon: 'MessageCircle', path: '/ingest/social', brainSide: 'network' },
      { id: 'read-later', label: '稍后读', description: '收藏链接，稍后阅读', icon: 'BookOpen', path: '/ingest/read-later', brainSide: 'network' },
      { id: 'documents', label: '文件/文档库', description: '本地文档提取与管理', icon: 'FolderOpen', path: '/ingest/documents', brainSide: 'both' },
    ],
  },
  graph: {
    id: 'graph',
    label: '图谱',
    icon: 'Network',
    description: '知识网络与关系可视化',
    defaultBrainSide: 'both',
    items: [
      { id: 'network', label: '知识网络', description: '全局关系图谱', icon: 'Network', path: '/graph/network', brainSide: 'both' },
      { id: 'query', label: '智能查询', description: '用自然语言查询知识图谱', icon: 'Sparkles', path: '/graph/query', brainSide: 'both' },
      { id: 'path', label: '路径探索', description: '发现知识路径', icon: 'Route', path: '/graph/path', brainSide: 'both' },
      { id: 'report', label: '图谱报告', description: '知识网络的统计与结构概览', icon: 'FileText', path: '/graph/report', brainSide: 'both' },
      { id: 'bridges', label: '跨脑桥梁', description: '连接个人脑与网络脑的关键关联', icon: 'GitMerge', path: '/graph/bridges', brainSide: 'both' },
      { id: 'tags', label: '标签图谱', description: '标签共现关系网络', icon: 'Tag', path: '/graph/tags', brainSide: 'both' },
      { id: 'timeline', label: '时间轴', description: '按时间回顾知识积累', icon: 'Clock', path: '/graph/timeline', brainSide: 'both' },
    ],
  },
  cognitive: {
    id: 'cognitive',
    label: '认知镜像',
    icon: 'Brain',
    description: '理解你的思维模式和认知偏差',
    defaultBrainSide: 'personal',
    items: [
      { id: 'fingerprint', label: '思维指纹', description: '个人思维特征分析', icon: 'Fingerprint', path: '/cognitive/fingerprint', brainSide: 'both' },
      { id: 'bias', label: '认知偏差', description: '识别思维盲区', icon: 'AlertTriangle', path: '/cognitive/bias', brainSide: 'both' },
      { id: 'conflict', label: '脑侧冲突', description: '个人脑与网络脑的张力', icon: 'Scale', path: '/cognitive/conflict', brainSide: 'both' },
      { id: 'audit', label: '决策审计', description: '追踪决策过程', icon: 'ClipboardCheck', path: '/cognitive/audit', brainSide: 'personal' },
      { id: 'simulate', label: '未来模拟', description: '决策结果预测', icon: 'GitBranch', path: '/cognitive/simulate', brainSide: 'personal' },
      { id: 'challenge', label: '认知挑战', description: '每日思维训练打卡', icon: 'Gamepad2', path: '/cognitive/challenge', brainSide: 'both' },
      { id: 'weekly-report', label: '认知周报', description: '每周认知健康报告', icon: 'FileText', path: '/cognitive/weekly-report', brainSide: 'both' },
    ],
  },
  emergence: {
    id: 'emergence',
    label: '涌现工作室',
    icon: 'Sparkles',
    description: '激发跨域创意与知识碰撞',
    defaultBrainSide: 'both',
    items: [
      { id: 'source-pool', label: '素材池', description: '跨工具共享的灵感素材', icon: 'Database', path: '/emergence/sources', brainSide: 'both' },
      { id: 'association', label: '跨域联想', description: '不同领域知识连接', icon: 'Shuffle', path: '/emergence/associate', brainSide: 'both' },
      { id: 'collision', label: '创意碰撞', description: '多角度观点碰撞', icon: 'Zap', path: '/emergence/collision', brainSide: 'both' },
      { id: 'hybrid', label: '概念杂交', description: '融合生成新概念', icon: 'Combine', path: '/emergence/hybrid', brainSide: 'both' },
      { id: 'counterfactual', label: '反事实探索', description: '假设情景推演', icon: 'HelpCircle', path: '/emergence/counterfactual', brainSide: 'both' },
      { id: 'canvas', label: '涌现画布', description: '拖拽组合创意想法', icon: 'Network', path: '/emergence/canvas', brainSide: 'both' },
      { id: 'library', label: '成果库', description: '保存与转化创意成果', icon: 'BookOpen', path: '/emergence/library', brainSide: 'both' },
    ],
  },
  attention: {
    id: 'attention',
    label: '注意力管家',
    icon: 'Target',
    description: '管理你的注意力资源',
    defaultBrainSide: 'both',
    items: [
      { id: 'dashboard', label: '仪表盘', description: '双脑注意力总览', icon: 'PieChart', path: '/attention/dashboard', brainSide: 'both' },
      { id: 'deep-work', label: '深度工作', description: '个人脑专注时段管理', icon: 'Timer', path: '/attention/deep-work', brainSide: 'personal' },
      { id: 'budget', label: '时间预算', description: '个人脑时间投入规划', icon: 'Wallet', path: '/attention/budget', brainSide: 'personal' },
      { id: 'guardian', label: '干扰守门员', description: '网络脑入口控制', icon: 'Shield', path: '/attention/guardian', brainSide: 'network' },
      { id: 'ration', label: '信息流配给', description: '网络脑内容消费限额', icon: 'Newspaper', path: '/attention/ration', brainSide: 'network' },
      { id: 'stats', label: '统计分析', description: '跨脑侧注意力模式洞察', icon: 'TrendingUp', path: '/attention/stats', brainSide: 'both' },
    ],
  },
  capsules: {
    id: 'capsules',
    label: '时间胶囊',
    icon: 'Package',
    description: '封存记忆，未来开启',
    defaultBrainSide: 'both',
    items: [
      { id: 'my-capsules', label: '我的胶囊', description: '个人创建与收藏的胶囊', icon: 'List', path: '/capsules/my', brainSide: 'personal' },
      { id: 'create', label: '创建胶囊', description: '封存新的记忆', icon: 'Plus', path: '/capsules/create', brainSide: 'personal' },
      { id: 'dialogue', label: '时光对话', description: '与过去自己的跨时空对话', icon: 'MessageCircle', path: '/capsules/dialogue', brainSide: 'personal' },
      { id: 'plaza', label: '胶囊广场', description: '公开与共享的胶囊广场', icon: 'Globe', path: '/capsules/plaza', brainSide: 'network' },
      { id: 'schedule', label: '解锁日程', description: '按时间线查看待解锁胶囊', icon: 'Calendar', path: '/capsules/schedule', brainSide: 'both' },
      { id: 'stats', label: '胶囊统计', description: '双脑胶囊数据分析', icon: 'BarChart2', path: '/capsules/stats', brainSide: 'both' },
    ],
  },
  knowledge: {
    id: 'knowledge',
    label: '反脆弱知识库',
    icon: 'Shield',
    description: '可验证、可追溯、可进化的知识体系',
    defaultBrainSide: 'both',
    items: [
      { id: 'network', label: '网络脑知识', description: '从外部采集的可验证知识', icon: 'Globe', path: '/knowledge/network', brainSide: 'network' },
      { id: 'personal', label: '个人脑知识', description: '个人思考与沉淀的知识单元', icon: 'User', path: '/knowledge/personal', brainSide: 'personal' },
      { id: 'verify', label: '验证中心', description: '多模型验证与共识裁决', icon: 'CheckCircle', path: '/knowledge/verify', brainSide: 'both' },
      { id: 'sources', label: '来源追溯', description: '按域名聚合的来源可信度', icon: 'GitCommit', path: '/knowledge/sources', brainSide: 'both' },
      { id: 'counter', label: '反证墙', description: '争议与证伪知识的集中审查', icon: 'XCircle', path: '/knowledge/counter', brainSide: 'both' },
      { id: 'credibility', label: '可信度地图', description: '来源域名的可信度分布', icon: 'Map', path: '/knowledge/credibility', brainSide: 'both' },
      { id: 'timeliness', label: '时效性监测', description: '知识过期与半衰期追踪', icon: 'Clock', path: '/knowledge/timeliness', brainSide: 'both' },
      { id: 'stats', label: '统计洞察', description: '双脑知识健康度分析', icon: 'Activity', path: '/knowledge/stats', brainSide: 'both' },
    ],
  },
  pipeline: {
    id: 'pipeline',
    label: '认知生产管线',
    icon: 'Workflow',
    description: '知识不是仓库，是一条阶段化生产线',
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
  'social-brain': {
    id: 'social-brain',
    label: '社会大脑',
    icon: 'Users',
    description: '个体认知与群体智慧的连接',
    defaultBrainSide: 'both',
    items: [
      { id: 'ai-context', label: 'AI全知上下文', description: '让AI基于引导文件理解你的知识库', icon: 'BrainCircuit', path: '/social-brain/ai-context', brainSide: 'both', preferredBrainSide: 'both' },
      { id: 'cognitive-potential', label: '认知势能', description: '能下沉、能产出、能变现的认知资产', icon: 'Zap', path: '/social-brain/cognitive-potential', brainSide: 'both', preferredBrainSide: 'both' },
      { id: 'experimenter', label: '实验者心态', description: '每次只控制一个变量，用反馈迭代', icon: 'FlaskConical', path: '/social-brain/experimenter', brainSide: 'both', preferredBrainSide: 'both' },
      { id: 'daily-review', label: '每日复盘', description: '回顾今日输入，发现行为差距', icon: 'Calendar', path: '/social-brain/daily-review', brainSide: 'both', preferredBrainSide: 'both' },
      { id: 'knowledge-health', label: '知识健康', description: '查看知识体系进化分布', icon: 'HeartPulse', path: '/social-brain/knowledge-health', brainSide: 'both', preferredBrainSide: 'both' },
      { id: 'practice-records', label: '实操记录', description: '记录知识落地与验证', icon: 'Dumbbell', path: '/social-brain/practice-records', brainSide: 'both', preferredBrainSide: 'both' },
      { id: 'evolution-track', label: '进化轨迹', description: '追踪知识从收集到内化', icon: 'TrendingUp', path: '/social-brain/evolution-track', brainSide: 'both', preferredBrainSide: 'both' },
      { id: 'relevance-check', label: '关我屁事', description: '判断外部内容与你是否相关', icon: 'Filter', path: '/social-brain/relevance-check', brainSide: 'network', preferredBrainSide: 'network' },
      { id: 'invocation-track', label: '调用追踪', description: '统计知识被调用与践行次数', icon: 'Activity', path: '/social-brain/invocation-track', brainSide: 'both', preferredBrainSide: 'both' },
    ],
  },
  'embodied-cognition': {
    id: 'embodied-cognition',
    label: '具身认知',
    icon: 'Heart',
    description: '身体、情绪与环境作为记忆载体',
    defaultBrainSide: 'personal',
    items: [
      { id: 'depth-check', label: '内容深度检查', description: '保存时自动评估内容深度；可切换 AI 深度评估', icon: 'ShieldAlert', path: '/embodied-cognition/depth-check', brainSide: 'both' },
      { id: 'true-evolution', label: '真进化 vs 伪成熟', description: '进化=摩擦+痛苦后的喜悦', icon: 'TrendingUp', path: '/embodied-cognition/true-evolution', brainSide: 'both' },
      { id: 'mood-location', label: '情绪与环境', description: '胶囊中的mood、location、身体状态', icon: 'MapPin', path: '/embodied-cognition/mood-location', brainSide: 'both' },
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
      { id: 'desktop', label: '桌面端', description: 'Windows 客户端下载，数据不出本机', icon: 'Monitor', path: '/settings/desktop', brainSide: 'both' },
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

export const QUICK_ACTIONS_CLASSIC: Pick<SubMenuItem, 'id' | 'label' | 'icon' | 'path' | 'brainSide'>[] = [
  { id: 'new-note', label: '新建笔记', icon: 'FileText', path: '/ingest/notes', brainSide: 'personal' },
  { id: 'new-capsule', label: '创建胶囊', icon: 'Package', path: '/capsules/create', brainSide: 'personal' },
  { id: 'start-focus', label: '深度工作', icon: 'Target', path: '/attention/deep-work', brainSide: 'personal' },
  { id: 'new-clip', label: '剪藏网页', icon: 'Globe', path: '/ingest/clipper', brainSide: 'network' },
  { id: 'knowledge', label: '知识库', icon: 'BookOpen', path: '/knowledge/network', brainSide: 'network' },
  { id: 'verify', label: '验证中心', icon: 'CheckCircle', path: '/knowledge/verify', brainSide: 'both' },
];

// ================================================================
// 模式无关的兼容导出与工具函数
// ================================================================

// 合并查找表：仅供按 ID 查模块元数据（如 defaultBrainSide），不用于渲染导航
export const MENU_DATA: Record<MenuId, MenuData> = {
  ...MENU_DATA_CLASSIC,
  ...MENU_DATA_SIMPLE,
};

/** 按当前界面版本返回导航数据（渲染导航一律用这个 hook） */
export function useMenuData() {
  const uiMode = useSettings((s) => s.uiMode);
  if (uiMode === 'classic') {
    return {
      menuData: MENU_DATA_CLASSIC as Record<MenuId, MenuData>,
      topNavBuckets: TOP_NAV_BUCKETS_CLASSIC,
      quickActions: QUICK_ACTIONS_CLASSIC,
    };
  }
  return {
    menuData: MENU_DATA_SIMPLE as Record<MenuId, MenuData>,
    topNavBuckets: TOP_NAV_BUCKETS_SIMPLE,
    quickActions: QUICK_ACTIONS_SIMPLE,
  };
}

// ── 设置菜单：Sidebar 和 SettingsPage 共用（两版一致） ──
export const SETTINGS_ITEMS: Pick<SubMenuItem, 'id' | 'label' | 'icon' | 'path'>[] = [
  { id: 'desktop', label: '桌面端', icon: 'Monitor', path: '/settings/desktop' },
  { id: 'account', label: '账户', icon: 'User', path: '/settings/account' },
  { id: 'privacy', label: '隐私', icon: 'Lock', path: '/settings/privacy' },
  { id: 'ai', label: 'AI 设置', icon: 'Cpu', path: '/settings/ai' },
  { id: 'sync', label: '同步', icon: 'RefreshCw', path: '/settings/sync' },
  { id: 'storage', label: '存储', icon: 'HardDrive', path: '/settings/storage' },
  { id: 'plugins', label: '插件', icon: 'Puzzle', path: '/settings/plugins' },
  { id: 'data', label: '数据', icon: 'Database', path: '/settings/data' },
  { id: 'appearance', label: '外观', icon: 'Palette', path: '/settings/appearance' },
];

// ── 路径 → 模块 ID（menuData 传当前模式的菜单表；默认合并表） ──
export function getMenuIdByPath(
  pathname: string,
  menuData: Record<string, MenuData> = MENU_DATA
): MenuId | null {
  const segments = pathname.toLowerCase().split('/').filter(Boolean);
  const first = segments[0] as MenuId | string;
  if (menuData[first as MenuId]) return first as MenuId;
  // 个人中心相关独立页面统一归入 settings 桶
  if (['payment', 'topup', 'billing', 'business-plan'].includes(first)) return 'settings';
  return null;
}

// ── 模块 ID → 一级导航桶（buckets 传当前模式的桶列表；默认经典版） ──
export function getBucketByMenuId(
  menuId: MenuId | null,
  buckets: TopNavBucket[] = TOP_NAV_BUCKETS_CLASSIC
): TopNavBucket | undefined {
  if (!menuId) return undefined;
  return buckets.find((b) => b.moduleIds.includes(menuId));
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
