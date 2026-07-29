import { FC, Suspense, lazy, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  Shield,
  Search,
  FolderOpen,
  Lock,
  Server,
  Cloud,
  Github,
  Terminal,
  ChevronDown,
  Sparkles,
  Eye,
  Building2,
  Briefcase,
} from 'lucide-react';
import { SealMark } from '@/components/common/BrandLogo';
import BrandLogo from '@/components/common/BrandLogo';

// 湖光背景（底层 WebGL shader）
const MoonlitRipple = lazy(() => import('@/components/backgrounds/MoonlitRipple'));
// 3D 引力球（中层 three.js，可拖拽、鼠标吸引）
const WelcomeNetwork3D = lazy(() => import('@/components/backgrounds/WelcomeNetwork3D'));

const GITHUB_URL = 'https://github.com/motuo/grzhishiku';
const DOCKER_CMD = 'docker-compose up -d';

const fadeInUp = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0 },
};

const WelcomePage: FC = () => {
  const navigate = useNavigate();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleEnter = () => {
    navigate('/app');
  };

  const scrollToContent = () => {
    document.getElementById('problem')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen w-full relative overflow-x-hidden bg-black">
      {/* Hero 背景层 */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <Suspense fallback={null}>
          <MoonlitRipple />
        </Suspense>
      </div>
      <div className="fixed inset-0 z-[1]">
        <Suspense fallback={null}>
          <WelcomeNetwork3D />
        </Suspense>
      </div>
      <div
        className="fixed inset-0 z-[2] pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at 50% 45%, transparent 20%, rgba(0,0,0,0.65) 100%)',
        }}
      />

      {/* 固定顶部导航 */}
      <header className="fixed top-0 left-0 right-0 z-50 px-6 py-4 flex items-center justify-between pointer-events-none">
        <div className="pointer-events-auto">
          <BrandLogo size={34} dark />
        </div>
        <button
          onClick={handleEnter}
          className="pointer-events-auto group inline-flex items-center gap-2 px-4 py-2 rounded-[2px] bg-[#bd4a2e] hover:bg-[#a83c22] text-[#f6ece6] text-sm font-medium transition-colors duration-200"
        >
          进入应用
          <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
        </button>
      </header>

      {/* Hero 首屏 */}
      <section className="relative z-10 min-h-screen flex flex-col items-center justify-center px-6 text-center pointer-events-none">
        <motion.div
          initial="hidden"
          animate={mounted ? 'visible' : 'hidden'}
          variants={fadeInUp}
          transition={{ duration: 0.9, ease: [0.4, 0, 0.2, 1] }}
          className="max-w-3xl mx-auto"
        >
          <div className="flex items-center justify-center mb-6">
            <SealMark size={80} />
          </div>

          <p className="text-[11px] sm:text-xs text-[#9a9286] tracking-[0.35em] uppercase mb-4">
            Open Source · Self-Hosted · Private AI
          </p>

          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-bold text-[#f0ebe2] tracking-[0.04em] mb-5 leading-tight">
            用你自己的资料
            <br />
            <span className="text-[#e0704f]">回答你自己</span>
          </h1>

          <p className="text-lg sm:text-xl text-[#b8b0a4] leading-relaxed mb-8 max-w-2xl mx-auto">
            开源、可自托管、数据不出本机的 AI 知识库。
            <br className="hidden sm:block" />
            剪藏 → 整理 → 提问，每一步都带引用出处。
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pointer-events-auto">
            <button
              onClick={handleEnter}
              className="group inline-flex items-center gap-2 px-7 py-3.5 rounded-[2px] bg-[#bd4a2e] hover:bg-[#a83c22] text-[#f6ece6] text-base font-medium transition-colors duration-200"
            >
              免费试用
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </button>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 px-7 py-3.5 rounded-[2px] border border-[rgba(232,226,216,0.18)] hover:border-[#bd4a2e]/60 text-[#e8e2d8] text-base font-medium transition-colors duration-200"
            >
              <Github className="w-5 h-5" />
              GitHub
            </a>
          </div>
        </motion.div>

        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: mounted ? 1 : 0 }}
          transition={{ duration: 0.9, delay: 0.5 }}
          onClick={scrollToContent}
          className="absolute bottom-8 text-[#6b655c] hover:text-[#9a9286] text-xs flex flex-col items-center gap-1 pointer-events-auto transition-colors"
        >
          了解更多
          <ChevronDown className="w-4 h-4 animate-bounce" />
        </motion.button>
      </section>

      {/* 问题与解决 */}
      <section id="problem" className="relative z-10 bg-[#161311]/90 backdrop-blur-sm border-t border-[rgba(232,226,216,0.08)]">
        <div className="max-w-6xl mx-auto px-6 py-24">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <p className="text-[11px] tracking-[0.3em] uppercase text-[#e0704f] mb-3">问题</p>
              <h2 className="text-3xl sm:text-4xl font-bold text-[#f0ebe2] mb-6 leading-snug">
                资料存了一堆，
                <br />
                用的时候找不到
              </h2>
              <ul className="space-y-4 text-[#b8b0a4]">
                <li className="flex items-start gap-3">
                  <Cloud className="w-5 h-5 text-[#e0704f] mt-0.5 shrink-0" />
                  <span>不敢把笔记、病历、合同交给云端大模型</span>
                </li>
                <li className="flex items-start gap-3">
                  <Search className="w-5 h-5 text-[#e0704f] mt-0.5 shrink-0" />
                  <span>收藏即冷藏，再问只能凭印象搜索关键词</span>
                </li>
                <li className="flex items-start gap-3">
                  <Sparkles className="w-5 h-5 text-[#e0704f] mt-0.5 shrink-0" />
                  <span>ChatGPT 能聊天，但读不到你的私有资料</span>
                </li>
              </ul>
            </div>
            <div className="glass-card p-8">
              <p className="text-[11px] tracking-[0.3em] uppercase text-[#e0704f] mb-3">解法</p>
              <h3 className="text-2xl font-bold text-[#f0ebe2] mb-4">RAG 问答 + 本地模型 + 引用溯源</h3>
              <p className="text-[#b8b0a4] leading-relaxed mb-6">
                把资料存进本地知识库，提问时 AI 只在你的笔记里检索，回答的每一句话都标注来源，点击即可跳回原笔记。
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-[#1b1815] border border-[rgba(232,226,216,0.08)] p-3 rounded-[2px] text-center">
                  <FolderOpen className="w-5 h-5 text-[#e0704f] mx-auto mb-2" />
                  <div className="text-xs text-[#e8e2d8]">存进来</div>
                </div>
                <div className="bg-[#1b1815] border border-[rgba(232,226,216,0.08)] p-3 rounded-[2px] text-center">
                  <Server className="w-5 h-5 text-[#e0704f] mx-auto mb-2" />
                  <div className="text-xs text-[#e8e2d8]">自动理好</div>
                </div>
                <div className="bg-[#1b1815] border border-[rgba(232,226,216,0.08)] p-3 rounded-[2px] text-center">
                  <Search className="w-5 h-5 text-[#e0704f] mx-auto mb-2" />
                  <div className="text-xs text-[#e8e2d8]">一句话问出来</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 目标人群 */}
      <section className="relative z-10 bg-[#161311]/95 border-t border-[rgba(232,226,216,0.06)]">
        <div className="max-w-6xl mx-auto px-6 py-24">
          <div className="text-center mb-14">
            <p className="text-[11px] tracking-[0.3em] uppercase text-[#e0704f] mb-3">写给谁</p>
            <h2 className="text-3xl sm:text-4xl font-bold text-[#f0ebe2]">三类人最需要它</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                icon: Shield,
                title: '隐私敏感专业人群',
                desc: '律师、医生、咨询师、记者。资料不敢上云，本地模型 + 端到端加密同步才是刚需。',
              },
              {
                icon: Server,
                title: '自托管 / 开源爱好者',
                desc: '代码可审计、数据不出本机、Docker 一键启动。GitHub 基本盘，也是最好的传播者。',
              },
              {
                icon: Building2,
                title: '20–200 人小企业',
                desc: '客服知识库、产品手册问答、SOP 查询。私有化部署，新人三天上手。',
              },
            ].map((item, i) => (
              <motion.div
                key={item.title}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-50px' }}
                variants={fadeInUp}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="glass-card p-7"
              >
                <item.icon className="w-8 h-8 text-[#e0704f] mb-5" />
                <h3 className="text-xl font-bold text-[#f0ebe2] mb-3">{item.title}</h3>
                <p className="text-sm text-[#9a9286] leading-relaxed">{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* 信任卖点 */}
      <section className="relative z-10 bg-[#161311]/90 border-t border-[rgba(232,226,216,0.06)]">
        <div className="max-w-6xl mx-auto px-6 py-24">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div className="order-2 md:order-1 glass-card p-8">
              <div className="space-y-6">
                {[
                  { icon: Lock, title: '数据不出本机', desc: '本地 Ollama 模型可离线运行，笔记永不离开你的设备。' },
                  { icon: Eye, title: '每次回答都带出处', desc: 'RAG 检索结果直接嵌入回答，脚注即原文，拒绝编造。' },
                  { icon: Briefcase, title: '端到端加密同步', desc: '云同步层存的是密文，服务器也读不懂你的笔记。' },
                ].map((item) => (
                  <div key={item.title} className="flex gap-4">
                    <div className="w-10 h-10 rounded-[2px] bg-[#bd4a2e]/10 flex items-center justify-center shrink-0">
                      <item.icon className="w-5 h-5 text-[#e0704f]" />
                    </div>
                    <div>
                      <h4 className="text-base font-bold text-[#f0ebe2] mb-1">{item.title}</h4>
                      <p className="text-sm text-[#9a9286]">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="order-1 md:order-2">
              <p className="text-[11px] tracking-[0.3em] uppercase text-[#e0704f] mb-3">差异</p>
              <h2 className="text-3xl sm:text-4xl font-bold text-[#f0ebe2] mb-6 leading-snug">
                不是又一个笔记 App，
                <br />
                是你的私有 AI 资料库
              </h2>
              <p className="text-[#b8b0a4] leading-relaxed mb-6">
                Obsidian 的笔记很强，但 AI 是插件；Notion AI 很方便，但数据必须上云。问墨把"可自托管"和"AI 原生"做在同一个架构里。
              </p>
              <p className="text-[#b8b0a4] leading-relaxed">
                这是 ChatGPT 做不到的事：让它读你的病历、合同、私人文档，并告诉你答案来自哪一页。
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 价格 */}
      <section className="relative z-10 bg-[#161311]/95 border-t border-[rgba(232,226,216,0.06)]">
        <div className="max-w-5xl mx-auto px-6 py-24">
          <div className="text-center mb-14">
            <p className="text-[11px] tracking-[0.3em] uppercase text-[#e0704f] mb-3">定价</p>
            <h2 className="text-3xl sm:text-4xl font-bold text-[#f0ebe2]">开源核心免费，付费的是同步与云</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                name: 'L1 开源核心',
                price: '免费',
                desc: '笔记、知识库、本地模型问答、Docker 自托管。',
                features: ['本地 Ollama 模型', 'RAG 问答 + 引用', '剪藏与导入', '无限笔记'],
                highlight: false,
              },
              {
                name: 'L2 云同步',
                price: '¥15–30 / 月',
                desc: '多设备同步、端到端加密、自动备份。',
                features: ['多端实时同步', '端到端加密', '历史版本', '优先支持'],
                highlight: true,
              },
              {
                name: 'L3 云端模型包',
                price: '按量计费',
                desc: '外出或手机端使用顶级云端模型。',
                features: ['DeepSeek / Kimi / OpenAI', '免配 key，开箱即用', '用多少算多少，小额起充', '与本地模型自由切换'],
                highlight: false,
              },
            ].map((tier) => (
              <div
                key={tier.name}
                className={`glass-card p-7 flex flex-col ${tier.highlight ? 'border-[#bd4a2e]/50' : ''}`}
              >
                <h3 className="text-lg font-bold text-[#f0ebe2] mb-2">{tier.name}</h3>
                <div className="text-2xl font-bold text-[#e0704f] mb-3">{tier.price}</div>
                <p className="text-sm text-[#9a9286] mb-5">{tier.desc}</p>
                <ul className="space-y-2 mb-6 flex-1">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm text-[#b8b0a4]">
                      <div className="w-1 h-1 rounded-full bg-[#e0704f]" />
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={handleEnter}
                  className={`w-full py-2.5 rounded-[2px] text-sm font-medium transition-colors ${
                    tier.highlight
                      ? 'bg-[#bd4a2e] hover:bg-[#a83c22] text-[#f6ece6]'
                      : 'border border-[rgba(232,226,216,0.14)] hover:border-[#bd4a2e]/60 text-[#e8e2d8]'
                  }`}
                >
                  {tier.price === '免费' ? '立即开始' : '查看详情'}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 快速开始 */}
      <section className="relative z-10 bg-[#161311]/90 border-t border-[rgba(232,226,216,0.06)]">
        <div className="max-w-4xl mx-auto px-6 py-24 text-center">
          <p className="text-[11px] tracking-[0.3em] uppercase text-[#e0704f] mb-3">开始</p>
          <h2 className="text-3xl sm:text-4xl font-bold text-[#f0ebe2] mb-6">一行命令跑起来</h2>
          <p className="text-[#b8b0a4] mb-8 max-w-2xl mx-auto">
            克隆仓库，执行 docker-compose，30 秒后你就能导入示例大脑并问出第一个问题。
          </p>

          <div className="glass-card p-4 mb-8 text-left overflow-x-auto">
            <div className="flex items-center gap-2 mb-3 pb-3 border-b border-[rgba(232,226,216,0.08)]">
              <Terminal className="w-4 h-4 text-[#e0704f]" />
              <span className="text-xs text-[#9a9286]">Terminal</span>
            </div>
            <code className="text-sm text-[#e8e2d8] font-mono whitespace-nowrap">
              git clone {GITHUB_URL}.git && cd grzhishiku && {DOCKER_CMD}
            </code>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 px-7 py-3.5 rounded-[2px] bg-[#bd4a2e] hover:bg-[#a83c22] text-[#f6ece6] text-base font-medium transition-colors duration-200"
            >
              <Github className="w-5 h-5" />
              访问 GitHub
            </a>
            <button
              onClick={handleEnter}
              className="inline-flex items-center gap-2 px-7 py-3.5 rounded-[2px] border border-[rgba(232,226,216,0.18)] hover:border-[#bd4a2e]/60 text-[#e8e2d8] text-base font-medium transition-colors duration-200"
            >
              进入在线演示
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 bg-[#161311] border-t border-[rgba(232,226,216,0.06)]">
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#6b655c]">
          <div className="flex items-center gap-2">
            <BrandLogo size={22} dark withWordmark={false} />
            <span>问墨 · grzhishiku.com</span>
          </div>
          <div className="flex items-center gap-6">
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="hover:text-[#9a9286] transition-colors">
              GitHub
            </a>
            <span>开源协议：AGPL-3.0</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default WelcomePage;
