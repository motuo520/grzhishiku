import { FC } from 'react';
import {
  BookOpen, Brain, Download, Workflow, Shield, Users,
  Compass, Coins, Lightbulb, HelpCircle, MousePointerClick,
} from 'lucide-react';

interface GuideSection {
  id: string;
  title: string;
  icon: FC<{ className?: string }>;
  blocks: Array<
    | { type: 'p'; text: string }
    | { type: 'h'; text: string }
    | { type: 'list'; items: string[] }
  >;
}

const SECTIONS: GuideSection[] = [
  {
    id: 'intro',
    title: '这是什么',
    icon: BookOpen,
    blocks: [
      { type: 'p', text: '这是一个「钤记」系统：把你看到的内容（网页、书摘、RSS、邮件）和自己的想法（笔记、便签）收进来，经过一条加工流水线变成可复用的知识卡片，再通过碰撞产生新想法，最后沉淀成你自己的知识体系。' },
      { type: 'p', text: '核心理念：知识不是存起来的，是生产出来的。所以站内功能按"采集 → 加工 → 沉淀 → 运用"组织，对应顶部四个一级菜单。' },
      { type: 'h', text: '双脑概念（先理解这个，后面都顺了）' },
      { type: 'list', items: [
        '个人脑：你自己的东西——笔记、便签、践行记录、复盘。',
        '网络脑：外部采集的东西——剪藏、RSS、邮件、书签。',
        '双脑（both）：不区分，全部内容。界面右上或模块内的"脑侧切换"就是控制这个过滤器。',
        '注意：切换脑侧只影响"看到哪些内容"，顶部下拉菜单永远显示全部功能入口。',
      ]},
    ],
  },
  {
    id: 'quickstart',
    title: '新手五步上手',
    icon: Compass,
    blocks: [
      { type: 'p', text: '别从功能列表开始逛，按这个顺序走一遍就懂了：' },
      { type: 'list', items: [
        '第一步 · 收：去「素材采集 → 笔记管理」写一条笔记，或「浏览器剪藏」存一篇文章。随便什么内容都行。',
        '第二步 · 切：去「素材加工 → 认知生产管线」，在"原始素材"里找到刚才的内容，做"卡片化"——把它切成一两张概念卡片。',
        '第三步 · 抽：对卡片做"抽取"，AI 会提炼出核心概念和模型。',
        '第四步 · 碰：选两个概念做"碰撞"，看看能擦出什么新联系。碰撞结果可以保存进成果库。',
        '第五步 · 收：满意的成果去「素材加工 → 注卡」写上你自己的理解和下一步行动——这张卡才真正变成你的知识。',
      ]},
      { type: 'p', text: '走完这五步，你已经用过了站内 80% 的核心价值。剩下的功能都是围绕这条主线的增强。' },
    ],
  },
  {
    id: 'inbox',
    title: '素材采集（一级菜单）',
    icon: Download,
    blocks: [
      { type: 'p', text: '所有输入的入口。目标只有一个：让任何内容进系统都尽量无摩擦。' },
      { type: 'list', items: [
        '便签墙：随手记 + 彩色便签 + 定时提醒。适合一闪而过的念头和待办。',
        '浏览器剪藏：配合浏览器插件，一键保存网页正文。',
        '浏览器书签：导入浏览器导出的书签 HTML 文件。',
        '笔记管理：主力写作区。个人想法、日记、草稿都在这里。',
        '批量导入：一次导入多条笔记/剪藏/链接。',
        'RSS 聚合：添加订阅源，新文章自动进来。',
        '标签系统：给所有内容打标签，跨类型组织。',
        '邮件集成：把重要邮件归档进系统。',
        '社交聚合：追踪社交媒体内容。',
        '稍后读：先存链接，有空再读，读完可转卡片。',
        '文件/文档库：上传本地文档（PDF 等），提取内容管理。',
      ]},
    ],
  },
  {
    id: 'process',
    title: '素材加工（一级菜单）',
    icon: Workflow,
    blocks: [
      { type: 'p', text: '把生材料变成熟知识的地方，包含三个模块：认知生产管线、注意力管家、涌现工作室。' },
      { type: 'h', text: '认知生产管线（核心中的核心）' },
      { type: 'p', text: '五阶段漏斗：原始素材 → 卡片化 → 抽取 → 碰撞 → 注卡。每个阶段是一个三级页面，"管线总览"页能看到每个阶段各有多少内容积压。' },
      { type: 'list', items: [
        '原始素材：刚进来还没处理的内容都在这里排队。',
        '卡片化：把长内容切成原子卡片。一卡一概念，后面才能组合。',
        '抽取：AI 从卡片里提取核心概念/模型/行动建议。',
        '碰撞：把两个概念放在一起让 AI 找联系、找矛盾、找杂交点。可以单个碰撞，也可以选中多个后批量碰撞。',
        '注卡：给卡片写上你自己的语境和行动——不经过这一步，知识永远是别人的。',
      ]},
      { type: 'p', text: '常见卡点：碰撞不了通常是因为选中的卡片还没做过"抽取"，没有可碰撞的概念。先回抽取阶段处理再碰。' },
      { type: 'h', text: '注意力管家' },
      { type: 'list', items: [
        '仪表盘：注意力花在个人脑还是网络脑，一目了然。',
        '深度工作：开启专注时段，配合番茄钟。',
        '时间预算：给各类活动分配时间额度。',
        '干扰守门员 / 信息流配给：控制网络脑输入的量，防止信息过载。',
      ]},
      { type: 'h', text: '涌现工作室' },
      { type: 'list', items: [
        '素材池：跨工具共享的灵感素材中转站。',
        '跨域联想 / 创意碰撞 / 概念杂交 / 反事实探索：四种 AI 创意发生器，玩法不同，都是输入概念输出新组合。',
        '涌现画布：把想法和卡片拖到画布上自由连线组合。',
        '成果库：所有碰撞/杂交产出的保存处，可转化为知识单元。',
      ]},
    ],
  },
  {
    id: 'knowledge',
    title: '知识库（一级菜单）',
    icon: Shield,
    blocks: [
      { type: 'p', text: '沉淀区。经过加工、写过注卡的内容在这里成为长期资产。' },
      { type: 'h', text: '反脆弱知识库' },
      { type: 'list', items: [
        '网络脑知识 / 个人脑知识：按来源浏览知识单元。',
        '验证中心：重要知识让多个 AI 模型交叉验证，标出可信度。',
        '来源追溯 / 可信度地图：按域名统计来源可靠性，分辨哪些网站的内容值得信。',
        '争议裁决：集中审查有争议、可能被证伪的知识。',
        '时效性监测：追踪知识过期，提示该复习或更新。',
        '统计洞察：知识库健康度总览。',
      ]},
      { type: 'h', text: '图谱' },
      { type: 'p', text: '知识网络和关系的可视化：全局图谱、标签图谱、时间轴、双向链接、跨脑桥梁等。适合定期进去"逛"，发现意外联系。' },
      { type: 'h', text: '时间胶囊' },
      { type: 'list', items: [
        '创建胶囊：把当下的想法、预测、情绪封存起来，设定未来开启时间。',
        '时光对话：胶囊开启后，可以和"过去的自己"对话。',
        '胶囊广场：看别人公开的胶囊。',
        '情绪与环境（具身认知模块）：回顾封存时的心情和地点，是复盘的好素材。',
      ]},
    ],
  },
  {
    id: 'social',
    title: '社会大脑（一级菜单）',
    icon: Users,
    blocks: [
      { type: 'p', text: '个人成长、身体情绪和社区。功能多，但常用的就几个：' },
      { type: 'list', items: [
        '每日复盘：每天花 5 分钟回顾今天的输入和产出，AI 帮你找行为差距（建议每天用一次就够）。',
        '知识健康 / 进化轨迹 / 调用追踪：三条线看你的知识是在"收藏"还是在"内化"。',
        '践行记录：知识用了没有、效果如何，记在这里。"实践深度"就是这么积累的。',
        '真进化 vs 伪成熟：记录让你不舒服的事——进化发生在摩擦之后。',
        '认知势能：分析你的内容里哪些能下沉为习惯、能产出为作品、能变现（内容积累多了再用）。',
        '关我屁事：粘贴一段外部内容，AI 判断它和你当前关注点相不相关，帮你做减法。',
        '认知镜像（思维指纹/认知偏差/脑侧冲突）：AI 分析你的思维模式（点按钮才跑，不会自动执行）。',
        'AI 全知上下文：生成一份引导文件，让外部 AI（如 ChatGPT）快速理解你的知识库。',
        '社区：用户交流区。',
      ]},
    ],
  },
  {
    id: 'ai-model',
    title: 'AI 模型',
    icon: Coins,
    blocks: [
      { type: 'p', text: '站内标注"AI"的功能（思维指纹、偏见检测、脑侧冲突、认知势能、每日复盘、关我屁事、验证中心、管线抽取/碰撞、深度检查的"AI 深度评估"模式等）都调用本地 Ollama 模型，完全免费、数据不出本机。' },
      { type: 'list', items: [
        '所有 AI 功能都是"点按钮才跑"，打开页面不会自动执行（思维指纹、认知势能等都是手动触发）。',
        '内容深度检查默认是"规则评估"，不调用模型；想要更准的判断再切到"AI 深度评估"。',
        '右上角 LLM 控制台可以切换默认模型，「设置 → AI 设置」里配置 Ollama 地址与模型。',
      ]},
    ],
  },
  {
    id: 'tips',
    title: '实用技巧',
    icon: Lightbulb,
    blocks: [
      { type: 'list', items: [
        'Cmd/Ctrl + K：全局搜索，找任何内容最快的方式。',
        '小助手：右下角的脑形图标，点开快速记便签、设提醒。可以直接拖动换位置；不想看到它就在面板里点"闭眼"图标，或在「设置 → 外观」关闭。',
        '主题切换：顶栏的太阳/月亮图标，深色/浅色/跟随系统。',
        '便签提醒：便签墙里设了提醒的便签，小助手会在快到期时冒泡提示。',
        '左侧边栏底部菜单：账户、设置、管理员入口都在这里。',
        '脑侧切换：很多页面顶部的"个人脑/网络脑/双脑"切换，只过滤内容，不影响功能入口。',
      ]},
    ],
  },
  {
    id: 'faq',
    title: '常见问题',
    icon: HelpCircle,
    blocks: [
      { type: 'list', items: [
        '碰撞没反应 / 提示"未抽取出可碰撞的概念"：选中的卡片还没做过抽取。先去「抽取」阶段处理。',
        'AI 评估失败、模型返回无效结果：通常是模型临时不稳定，重试一次；连续失败就到 LLM 控制台换个模型。',
        '管理员后台：左侧边栏底部菜单 → 管理员入口（仅管理员账号可见）。',
        '数据在哪：所有笔记、卡片、知识单元都存在服务端数据库，「设置 → 数据」可以导出备份。',
      ]},
    ],
  },
];

const GuidePage: FC = () => {
  return (
    <div className="h-full overflow-auto">
      <div className="max-w-6xl mx-auto p-6 flex gap-6">
        {/* TOC */}
        <aside className="hidden lg:block w-52 shrink-0">
          <div className="sticky top-6 glass-card p-4">
            <div className="text-xs font-semibold text-text-secondary mb-3">目录</div>
            <nav className="space-y-1">
              {SECTIONS.map((s) => (
                <a
                  key={s.id}
                  href={`#guide-${s.id}`}
                  className="block px-2 py-1.5 rounded-lg text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
                >
                  {s.title}
                </a>
              ))}
            </nav>
          </div>
        </aside>

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-6">
          <div>
            <h1 className="text-xl font-semibold text-text-primary flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-info" />
              使用指南
            </h1>
            <p className="text-sm text-text-secondary mt-1">
              从零上手钤记：核心概念、推荐流程、每个功能干什么、哪些要花钱。
            </p>
          </div>

          {SECTIONS.map((section) => {
            const Icon = section.icon;
            return (
              <section key={section.id} id={`guide-${section.id}`} className="glass-card p-6 scroll-mt-6">
                <h2 className="text-base font-semibold text-text-primary flex items-center gap-2 mb-4">
                  <Icon className="w-4 h-4 text-info" />
                  {section.title}
                </h2>
                <div className="space-y-3">
                  {section.blocks.map((block, i) => {
                    if (block.type === 'h') {
                      return (
                        <h3 key={i} className="text-sm font-semibold text-text-primary pt-2 flex items-center gap-1.5">
                          <MousePointerClick className="w-3.5 h-3.5 text-text-muted" />
                          {block.text}
                        </h3>
                      );
                    }
                    if (block.type === 'list') {
                      return (
                        <ul key={i} className="space-y-2">
                          {block.items.map((item, j) => (
                            <li key={j} className="flex items-start gap-2 text-sm text-text-secondary leading-relaxed">
                              <span className="mt-1.5 w-1 h-1 rounded-full bg-info shrink-0" />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      );
                    }
                    return (
                      <p key={i} className="text-sm text-text-secondary leading-relaxed">{block.text}</p>
                    );
                  })}
                </div>
              </section>
            );
          })}

          <div className="text-center text-xs text-text-muted pb-6 flex items-center justify-center gap-1.5">
            <Brain className="w-3.5 h-3.5" />
            指南会持续更新，有疑问欢迎到社区发帖。
          </div>
        </div>
      </div>
    </div>
  );
};

export default GuidePage;
