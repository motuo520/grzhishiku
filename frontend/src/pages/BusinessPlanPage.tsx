import { FC } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  Crown, Users, CreditCard, TrendingUp, Shield, Zap, Lock, Globe,
  Brain, GitBranch, Target, Award, CheckCircle2, XCircle, Sparkles
} from 'lucide-react';

/* ──── Animation variants ──── */
const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};
const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
};
/* ──── Section Title ──── */
const SectionTitle: FC<{ icon: React.ElementType; title: string; subtitle: string }> = ({ icon: Icon, title, subtitle }) => (
  <motion.div variants={fadeUp} className="mb-6">
    <div className="flex items-center gap-3 mb-2">
      <div className="w-10 h-10 rounded-[2px] bg-accent flex items-center justify-center">
        <Icon className="w-5 h-5 text-white" />
      </div>
      <h2 className="text-xl font-bold text-text-primary">{title}</h2>
    </div>
    <p className="text-sm text-text-muted ml-13">{subtitle}</p>
  </motion.div>
);

/* ──── Glow card wrapper ──── */
const GlowCard: FC<{ children: React.ReactNode; className?: string; delay?: number }> = ({ children, className = '', delay = 0 }) => (
  <motion.div
    variants={fadeUp}
    whileHover="hover"
    initial="rest"
    animate="rest"
    transition={{ delay: delay * 0.05 }}
    className={`relative group rounded-[2px] border border-white/[0.06] bg-white/[0.02] overflow-hidden ${className}`}
  >
    {/* Glow border on hover */}
    <div className="absolute inset-0 rounded-[2px] opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
      style={{ boxShadow: 'inset 0 0 0 1px var(--accent)' }}
    />
    {/* Subtle gradient overlay */}
    <div className="absolute inset-0 bg-info/[0.03]" />
    <div className="relative p-5">{children}</div>
  </motion.div>
);

/* ═══════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════ */
const BusinessPlanPage: FC = () => {
  const navigate = useNavigate();
  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="max-w-5xl mx-auto pb-12"
    >
      {/* ═══════ HEADER ═══════ */}
      <motion.div variants={fadeUp} className="text-center mb-10 pt-4">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-[2px] bg-info/10 border border-info/20 text-info text-xs font-semibold mb-4">
          <Sparkles className="w-3.5 h-3.5" />
          问墨 商业计划书
        </div>
        <h1 className="text-3xl md:text-4xl font-black text-text-primary mb-3">
          开源建立信任，免费获客，云端与 AI 收费
        </h1>
        <p className="text-text-muted max-w-2xl mx-auto leading-relaxed">
          问墨（Wenmo）是一款面向知识工作者的本地优先 + 云端增强的
          知识管理工具，采用 Freemium 免费增值 + 订阅制 + 开源核心 的三层商业模式。
        </p>
      </motion.div>

      {/* ═══════ 1. BUSINESS MODEL ═══════ */}
      <SectionTitle icon={Crown} title="商业模式" subtitle="三层架构：开源建立信任 → 免费本地版获客 → 云端/AI付费" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
        {/* Card 1: Open Source */}
        <GlowCard>
          <div className="w-12 h-12 rounded-[2px] bg-success/10 flex items-center justify-center mb-4">
            <GitBranch className="w-6 h-6 text-success" />
          </div>
          <h3 className="text-lg font-bold text-text-primary mb-2">开源核心</h3>
          <p className="text-sm text-text-muted leading-relaxed mb-4">
            核心代码（本地知识引擎、数据存储、基础 UI）以 MIT 协议开源，建立社区信任与开发者生态。
          </p>
          <div className="space-y-2">
            {['GitHub 星标获客', '开发者社区贡献', 'Bug 修复免费', '品牌信任背书'].map((t) => (
              <div key={t} className="flex items-center gap-2 text-xs text-text-secondary">
                <CheckCircle2 className="w-3.5 h-3.5 text-success" />
                {t}
              </div>
            ))}
          </div>
        </GlowCard>

        {/* Card 2: Freemium */}
        <GlowCard delay={1}>
          <div className="w-12 h-12 rounded-[2px] bg-network-primary/10 flex items-center justify-center mb-4">
            <Zap className="w-6 h-6 text-network-primary" />
          </div>
          <h3 className="text-lg font-bold text-text-primary mb-2">免费增值</h3>
          <p className="text-sm text-text-muted leading-relaxed mb-4">
            免费版功能完整（无限本地笔记 + 本地 Ollama AI），用户零门槛上手，自然产生数据依赖。
          </p>
          <div className="space-y-2">
            {['无限本地知识单元', '本地 Ollama LLM 聊天', '5 个时间胶囊', '基础认知镜像'].map((t) => (
              <div key={t} className="flex items-center gap-2 text-xs text-text-secondary">
                <CheckCircle2 className="w-3.5 h-3.5 text-network-primary" />
                {t}
              </div>
            ))}
          </div>
        </GlowCard>

        {/* Card 3: Subscription */}
        <GlowCard delay={2}>
          <div className="w-12 h-12 rounded-[2px] bg-warning/10 flex items-center justify-center mb-4">
            <CreditCard className="w-6 h-6 text-warning" />
          </div>
          <h3 className="text-lg font-bold text-text-primary mb-2">订阅变现</h3>
          <p className="text-sm text-text-muted leading-relaxed mb-4">
            为便利（云端同步）和效率（高级 AI）付费，Pro ¥29/月 个人用户，Team ¥99/人/月 协作场景。
          </p>
          <div className="space-y-2">
            {['自动跨设备同步', 'DeepSeek / Kimi / OpenCode 路由', '无限时间胶囊', '高级认知审计'].map((t) => (
              <div key={t} className="flex items-center gap-2 text-xs text-text-secondary">
                <CheckCircle2 className="w-3.5 h-3.5 text-warning" />
                {t}
              </div>
            ))}
          </div>
        </GlowCard>
      </div>

      {/* ═══════ 2. PRICING TABLE ═══════ */}
      <SectionTitle icon={CreditCard} title="定价策略" subtitle="三档定价：免费版体验 → Pro 个人效率 → Team 协作" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
        {/* Free Tier */}
        <motion.div variants={fadeUp} className="rounded-[2px] border border-white/[0.06] bg-white/[0.02] p-6 relative">
          <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Free</div>
          <div className="text-3xl font-black text-text-primary mb-1">¥0</div>
          <div className="text-xs text-text-muted mb-4">永久免费</div>
          <div className="h-px bg-white/[0.06] mb-4" />
          <div className="space-y-3">
            {[
              '无限本地知识单元',
              '本地 Ollama AI 助手',
              '5 个时间胶囊',
              '基础认知镜像',
              '个人知识图谱（本地）',
            ].map((f) => (
              <div key={f} className="flex items-center gap-2 text-sm text-text-secondary">
                <CheckCircle2 className="w-4 h-4 text-success flex-shrink-0" />
                {f}
              </div>
            ))}
            {['云端同步', '多 LLM 路由', '高级认知审计', '团队协作'].map((f) => (
              <div key={f} className="flex items-center gap-2 text-sm text-text-muted/50">
                <XCircle className="w-4 h-4 text-text-muted/20 flex-shrink-0" />
                <span className="line-through">{f}</span>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Pro Tier — Highlighted */}
        <motion.div variants={fadeUp} className="rounded-[2px] border border-info/30 bg-info/5 p-6 relative">
          <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-[2px] bg-accent text-white text-xs font-bold">
            推荐
          </div>
          <div className="text-xs font-semibold text-info uppercase tracking-wider mb-2">Pro</div>
          <div className="text-3xl font-black text-text-primary mb-1">¥29<span className="text-lg font-medium text-text-muted">/月</span></div>
          <div className="text-xs text-text-muted mb-4">年付 ¥290/年（省 ¥58）</div>
          <div className="h-px bg-white/[0.06] mb-4" />
          <div className="space-y-3">
            {[
              '包含 Free 全部功能',
              '自动跨设备同步',
              'DeepSeek / Kimi / OpenCode 多 LLM 路由',
              '无限时间胶囊',
              '高级认知审计 & 决策回溯',
              '优先客服支持',
            ].map((f) => (
              <div key={f} className="flex items-center gap-2 text-sm text-text-secondary">
                <CheckCircle2 className="w-4 h-4 text-info flex-shrink-0" />
                {f}
              </div>
            ))}
          </div>
          <button
            onClick={() => navigate('/payment')}
            className="w-full mt-6 py-2.5 rounded-[2px] bg-accent text-white font-semibold text-sm hover:bg-[var(--accent-hover)] transition-colors"
          >
            升级到 Pro
          </button>
        </motion.div>

        {/* Team Tier */}
        <motion.div variants={fadeUp} className="rounded-[2px] border border-white/[0.06] bg-white/[0.02] p-6 relative">
          <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Team</div>
          <div className="text-3xl font-black text-text-primary mb-1">¥99<span className="text-lg font-medium text-text-muted">/人/月</span></div>
          <div className="text-xs text-text-muted mb-4">年付 ¥990/人/年（省 ¥198）</div>
          <div className="h-px bg-white/[0.06] mb-4" />
          <div className="space-y-3">
            {[
              '包含 Pro 全部功能',
              '协作编辑 & 评论',
              '共享知识图谱空间',
              '团队管理后台',
              '私有部署（可选）',
              '专属客户经理',
            ].map((f) => (
              <div key={f} className="flex items-center gap-2 text-sm text-text-secondary">
                <CheckCircle2 className="w-4 h-4 text-warning flex-shrink-0" />
                {f}
              </div>
            ))}
          </div>
          <button className="w-full mt-6 py-2.5 rounded-[2px] border border-warning/30 text-warning font-semibold text-sm hover:bg-warning/10 transition-colors">
            联系销售
          </button>
        </motion.div>
      </div>

      {/* ═══════ 3. TARGET USERS ═══════ */}
      <SectionTitle icon={Users} title="目标用户画像" subtitle="4 个核心角色，从个人到团队，覆盖完整知识工作场景" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-12">
        {[
          {
            icon: Brain, color: 'bg-network-primary', glow: '',
            name: '研究员阿明', role: '博士生 / 科研人员', age: '26 岁',
            pain: '论文资料散落各处，Zotero 和笔记软件割裂，跨文献推理靠记忆',
            value: '知识图谱自动关联文献，多 LLM 验证假设，认知审计发现思维盲区',
            arpu: '高（可报销）', channel: '学术社区、GitHub、导师推荐',
          },
          {
            icon: Zap, color: 'bg-success', glow: '',
            name: '开发者小林', role: '大厂 P7 / 独立开发者', age: '32 岁',
            pain: '技术文档、代码片段、博客收藏分散在 5+ 个工具中，搜索效率低',
            value: '统一知识库 + 本地优先（数据隐私）+ AI 辅助代码理解',
            arpu: '高（¥29 = 一顿饭）', channel: 'V2EX、知乎、技术公众号',
          },
          {
            icon: Target, color: 'bg-danger', glow: '',
            name: '写作者苏苏', role: '自媒体 / 专栏作家', age: '28 岁',
            pain: '素材积累无体系，写作时找不到三个月前收藏的灵感',
            value: '时间胶囊封存灵感，涌现工作室跨域联想，双向链接构建写作网络',
            arpu: '中', channel: '小红书、即刻、创作者社群',
          },
          {
            icon: Award, color: 'bg-fusion-primary', glow: '',
            name: '学生小赵', role: '研究生 / 终身学习者', age: '24 岁',
            pain: '课程笔记、读书笔记、项目文档格式混乱，复习效率低',
            value: '免费版完整功能 + 认知镜像提升学习效率，3 年后进入职场自然付费',
            arpu: '低 → 高（3 年后转化）', channel: '校园、B站、知乎',
          },
        ].map((user, i) => (
          <GlowCard key={user.name} delay={i}>
            <div className="flex items-start gap-4">
              <div className={`w-14 h-14 rounded-[2px] ${user.color} flex items-center justify-center ${user.glow} flex-shrink-0`}>
                <user.icon className="w-7 h-7 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-base font-bold text-text-primary">{user.name}</h3>
                  <span className="text-[10px] px-2 py-0.5 rounded-[2px] bg-white/[0.05] text-text-muted border border-white/[0.06]">
                    {user.age}
                  </span>
                </div>
                <div className="text-xs text-info font-medium mb-2">{user.role}</div>
                <div className="space-y-2">
                  <div>
                    <div className="text-[10px] text-text-muted uppercase tracking-wider mb-0.5">痛点</div>
                    <div className="text-xs text-text-secondary leading-relaxed">{user.pain}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-text-muted uppercase tracking-wider mb-0.5">产品价值</div>
                    <div className="text-xs text-text-secondary leading-relaxed">{user.value}</div>
                  </div>
                  <div className="flex items-center gap-4 pt-1">
                    <div>
                      <div className="text-[10px] text-text-muted">付费意愿</div>
                      <div className="text-xs font-medium text-success">{user.arpu}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-text-muted">获客渠道</div>
                      <div className="text-xs font-medium text-info">{user.channel}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </GlowCard>
        ))}
      </div>

      {/* ═══════ 4. KEY METRICS ═══════ */}
      <SectionTitle icon={TrendingUp} title="关键财务指标" subtitle="3 年增长目标与盈亏平衡分析" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { label: '盈亏平衡用户', value: '2,860', sub: 'Pro 订阅', color: 'bg-network-primary' },
          { label: 'LTV / CAC', value: '5.2~10.4', sub: '健康 SaaS 指标', color: 'bg-success' },
          { label: '3 年 ARR 目标', value: '¥460万', sub: '保守估计', color: 'bg-warning' },
          { label: '毛利率', value: '70~75%', sub: 'SaaS 标准', color: 'bg-fusion-primary' },
        ].map((metric) => (
          <motion.div key={metric.label} variants={fadeUp} className="rounded-[2px] border border-white/[0.06] bg-white/[0.02] p-5 text-center relative overflow-hidden group">
            <div className={`absolute inset-0 ${metric.color} opacity-0 group-hover:opacity-[0.06] transition-opacity duration-500`} />
            <div className="text-2xl md:text-3xl font-black text-text-primary mb-1">
              {metric.value}
            </div>
            <div className="text-xs font-medium text-text-primary mb-0.5">{metric.label}</div>
            <div className="text-[10px] text-text-muted">{metric.sub}</div>
          </motion.div>
        ))}
      </div>

      {/* Revenue model mini-table */}
      <motion.div variants={fadeUp} className="rounded-[2px] border border-white/[0.06] bg-white/[0.02] overflow-hidden mb-12">
        <div className="px-5 py-3 border-b border-white/[0.06] flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-info" />
          <span className="text-sm font-bold text-text-primary">3 年收入预测</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-text-muted border-b border-white/[0.06]">
                <th className="text-left px-5 py-3 font-medium">年份</th>
                <th className="text-right px-5 py-3 font-medium">用户总数</th>
                <th className="text-right px-5 py-3 font-medium">Pro 付费</th>
                <th className="text-right px-5 py-3 font-medium">Team 席位</th>
                <th className="text-right px-5 py-3 font-medium">ARR</th>
              </tr>
            </thead>
            <tbody>
              {[
                { year: 'Year 1', total: '8,000', pro: '400', team: '10', arr: '¥15.8万' },
                { year: 'Year 2', total: '25,000', pro: '1,800', team: '60', arr: '¥93.6万' },
                { year: 'Year 3', total: '60,000', pro: '4,500', team: '180', arr: '¥460万' },
              ].map((row) => (
                <tr key={row.year} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                  <td className="px-5 py-3 font-medium text-text-primary">{row.year}</td>
                  <td className="px-5 py-3 text-right text-text-secondary">{row.total}</td>
                  <td className="px-5 py-3 text-right text-success">{row.pro}</td>
                  <td className="px-5 py-3 text-right text-warning">{row.team}</td>
                  <td className="px-5 py-3 text-right font-bold text-info">{row.arr}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>

      {/* ═══════ 5. CORE STRATEGY ═══════ */}
      <SectionTitle icon={Shield} title="核心策略" subtitle="数据驱动增长，数据锁定留存" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-12">
        <GlowCard>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-[2px] bg-accent flex items-center justify-center">
              <Lock className="w-5 h-5 text-white" />
            </div>
            <h3 className="text-base font-bold text-text-primary">数据锁定策略</h3>
          </div>
          <p className="text-sm text-text-muted leading-relaxed mb-3">
            免费版功能完整，用户积累大量本地知识数据后，为<strong className="text-text-primary">便利（跨设备同步）</strong>
            和<strong className="text-text-primary">效率（高级 AI）</strong>自然付费。
          </p>
          <div className="text-xs text-text-secondary space-y-1">
            <div>• 知识图谱数据结构复杂，迁移成本高</div>
            <div>• 时间胶囊的「未来解锁」具有情感粘性</div>
            <div>• 认知镜像的审计历史不可迁移</div>
          </div>
        </GlowCard>

        <GlowCard delay={1}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-[2px] bg-success flex items-center justify-center">
              <Globe className="w-5 h-5 text-white" />
            </div>
            <h3 className="text-base font-bold text-text-primary">获客飞轮</h3>
          </div>
          <p className="text-sm text-text-muted leading-relaxed mb-3">
            开源建立技术信任，内容营销建立品牌信任，产品口碑驱动自然增长。
          </p>
          <div className="text-xs text-text-secondary space-y-1">
            <div>• GitHub 开源 → 开发者试用 → 团队推荐</div>
            <div>• 知识管理方法论内容 → 目标用户认知 → 产品使用</div>
            <div>• 免费版完整功能 → 口碑传播 → 付费转化</div>
          </div>
        </GlowCard>
      </div>

      {/* ═══════ FOOTER ═══════ */}
      <motion.div variants={fadeUp} className="text-center pt-8 border-t border-white/[0.06]">
        <p className="text-xs text-text-muted">
          问墨（Wenmo）· 让知识为你所用
        </p>
        <p className="text-[10px] text-text-muted/50 mt-1">
          商业计划书 v1.0 · 2026年 · 机密文件
        </p>
      </motion.div>
    </motion.div>
  );
};

export default BusinessPlanPage;
