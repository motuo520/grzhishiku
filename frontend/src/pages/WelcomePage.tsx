import React, { FC, Suspense, lazy, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Shield,
  Search,
  Github,
  ChevronDown,
  Download,
  Monitor,
  WifiOff,
  CloudCog,
  Sparkles,
} from 'lucide-react';
import { SealMark } from '@/components/common/BrandLogo';
import BrandLogo from '@/components/common/BrandLogo';
import LoginModal from '@/components/auth/LoginModal';
import { useAuth } from '@/hooks/useAuth';

// 湖光背景（底层 WebGL shader）
const MoonlitRipple = lazy(() => import('@/components/backgrounds/MoonlitRipple'));
// 3D 引力球（中层 three.js，可拖拽、鼠标吸引）
const WelcomeNetwork3D = lazy(() => import('@/components/backgrounds/WelcomeNetwork3D'));

const GITHUB_URL = 'https://github.com/motuo520/grzhishiku';

// 桌面端（Electron）判定：桌面端用户已在应用内，不显示下载入口
const isDesktop = !!window.psbDesktop?.isDesktop;

// 背景组件（WebGL/3D）异常时降级为隐藏，避免整个欢迎页白屏
class BgErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

const WelcomePage: FC = () => {
  const navigate = useNavigate();
  // LCP 快赢：three.js 3D 球体（独立大 chunk）延到首屏绘制后再挂载，
  // 避免它在 LCP 窗口内抢占带宽与主线程
  const [load3D, setLoad3D] = useState(false);
  const { isLoggedIn } = useAuth();
  // 未登录用户的唯一入口：欢迎页必须能登录（否则桌面端登出后被永久困在欢迎页）
  const [loginOpen, setLoginOpen] = useState(false);

  // 浏览器空闲时再加载 3D 背景（requestIdleCallback；Safari 不支持则回退 setTimeout）
  useEffect(() => {
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => setLoad3D(true), { timeout: 2000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = setTimeout(() => setLoad3D(true), 1200);
    return () => clearTimeout(t);
  }, []);

  // 登录成功（isLoggedIn 翻 true）后自动进应用
  useEffect(() => {
    if (isLoggedIn) navigate('/app', { replace: true });
  }, [isLoggedIn, navigate]);

  // SEO：/welcome 与首页正文同源，canonical 指首页防重复内容降权（09-28 GEO 审计实捕）
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'canonical';
    link.href = 'https://grzhishiku.com/';
    link.id = 'welcome-canonical';
    document.head.appendChild(link);
    return () => { document.getElementById('welcome-canonical')?.remove(); };
  }, []);

  const handleEnter = () => {
    // 桌面端没有游客演示（无演示账号自动关闭），未登录时点「进入应用/免费试用」
    // 会被 AuthGuard 弹回本页——按钮看似没反应（0.2.78 实锤）。桌面端未登录
    // 直接开登录弹窗（本机注册免邮箱验证码）；网页端照旧进游客演示。
    if (isDesktop && !isLoggedIn) {
      setLoginOpen(true);
      return;
    }
    navigate('/app');
  };

  return (
    <div className="min-h-screen w-full relative overflow-x-hidden bg-black">
      {/* Hero 背景层（湖光 + 引力球，09-27 本人召回） */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <BgErrorBoundary>
          <Suspense fallback={null}>
            <MoonlitRipple />
          </Suspense>
        </BgErrorBoundary>
      </div>
      {load3D && (
        <div className="fixed inset-0 z-[1]">
          <BgErrorBoundary>
            <Suspense fallback={null}>
              <WelcomeNetwork3D />
            </Suspense>
          </BgErrorBoundary>
        </div>
      )}
      <div
        className="fixed inset-0 z-[2] pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at 50% 45%, transparent 20%, rgba(0,0,0,0.65) 100%)',
        }}
      />

      {/* 固定顶部导航（背景 3D 可拖拽：导航容器不吃指针，按钮单独放行） */}
      <header className="fixed top-0 left-0 right-0 z-50 px-6 py-4 flex items-center justify-between pointer-events-none">
        <div className="pointer-events-auto">
          <BrandLogo size={34} dark />
        </div>
        <div className="flex items-center gap-2 pointer-events-auto">
          {!isDesktop && (
            <a
              href="/download/PSB-Setup-0.2.137.exe"
              className="inline-flex items-center gap-2 px-4 py-2 max-sm:min-h-[44px] rounded-[2px] border border-[rgba(232,226,216,0.18)] hover:border-[#bd4a2e]/60 text-[#e8e2d8] text-sm font-medium transition-colors duration-200"
            >
              <Download className="w-4 h-4" />
              下载桌面端
            </a>
          )}
          {!isLoggedIn && (
            <button
              onClick={() => setLoginOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 max-sm:min-h-[44px] rounded-[2px] border border-[rgba(232,226,216,0.18)] hover:border-[#bd4a2e]/60 text-[#e8e2d8] text-sm font-medium transition-colors duration-200"
            >
              登录
            </button>
          )}
          <button
            onClick={handleEnter}
            className="group inline-flex items-center gap-2 px-4 py-2 max-sm:min-h-[44px] rounded-[2px] bg-[#bd4a2e] hover:bg-[#a83c22] text-[#f6ece6] text-sm font-medium transition-colors duration-200"
          >
            进入应用
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </button>
        </div>
      </header>

      {/* 登录/注册弹窗（欢迎页是未登录用户的唯一落点，必须能从这里登录） */}
      <LoginModal isOpen={loginOpen} onClose={() => setLoginOpen(false)} />

      {/* Hero 首屏（section 不吃指针让 3D 球可拖拽，按钮行单独放行） */}
      <section className="relative z-10 min-h-screen flex flex-col items-center justify-center px-6 text-center pointer-events-none">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-center mb-6">
            <SealMark size={80} />
          </div>

          <h1 className="text-4xl sm:text-6xl font-bold text-[#f0ebe2] tracking-[0.04em] mb-5 leading-tight">
            用你自己的资料
            <br />
            <span className="text-[#e0704f]">回答你自己</span>
          </h1>

          <p className="text-lg sm:text-xl text-[#b8b0a4] leading-relaxed mb-8 max-w-2xl mx-auto">
            开源、可自托管、数据不出本机的 AI 知识库。
            <br className="hidden sm:block" />
            剪藏 → 整理 → 提问，每一步都带引用出处。
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 mb-10 text-sm">
            <span className="inline-flex items-center gap-2 px-4 py-2 rounded-[2px] border border-[rgba(232,226,216,0.14)] text-[#b8b0a4]">
              <Shield className="w-4 h-4 text-[#e0704f]" />
              桌面端离线可用
            </span>
            <span className="inline-flex items-center gap-2 px-4 py-2 rounded-[2px] border border-[rgba(232,226,216,0.14)] text-[#b8b0a4]">
              <Search className="w-4 h-4 text-[#e0704f]" />
              回答带原文出处
            </span>
            <span className="inline-flex items-center gap-2 px-4 py-2 rounded-[2px] border border-[rgba(232,226,216,0.14)] text-[#b8b0a4]">
              <Sparkles className="w-4 h-4 text-[#e0704f]" />
              智能体替你跑腿查证
            </span>
          </div>

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
        </div>
      </section>

      {/* 桌面端 */}
      <section id="download" className="relative z-10 bg-[#161311]/95 border-t border-[rgba(232,226,216,0.06)]">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <div className="text-center mb-12">
            <p className="text-[11px] tracking-[0.3em] uppercase text-[#e0704f] mb-3">桌面端</p>
            <h2 className="text-3xl sm:text-4xl font-bold text-[#f0ebe2] mb-5">真桌面端，不是套壳网页</h2>
            <p className="text-[#b8b0a4] leading-relaxed max-w-3xl mx-auto">
              安装包内嵌完整后端服务，打开就在你自己的电脑上启动——不连我们的服务器，断网也照常用。
              需要备份时再绑定云端账号：传不传、传什么，你说了算。
            </p>
            {!isDesktop && (
              <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
                <a
                  href="/download/PSB-Setup-0.2.137.exe"
                  className="group inline-flex items-center gap-2 px-7 py-3.5 rounded-[2px] bg-[#bd4a2e] hover:bg-[#a83c22] text-[#f6ece6] text-base font-medium transition-colors duration-200"
                >
                  <Download className="w-5 h-5" />
                  下载 Windows 桌面端
                </a>
                <a
                  href="/download/PSB-Portable-0.2.137.exe"
                  className="inline-flex items-center gap-2 px-5 py-3 max-sm:min-h-[44px] rounded-[2px] border border-[rgba(232,226,216,0.18)] hover:border-[#bd4a2e]/60 text-[#e8e2d8] text-sm transition-colors duration-200"
                >
                  便携版（免安装）
                </a>
              </div>
            )}
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { icon: Monitor, title: '内嵌完整后端', desc: '无需装 Python、Docker 或任何环境，双击即用。' },
              { icon: WifiOff, title: '数据只在你电脑上', desc: '本地 SQLite 存储，拔了网线照样记、照样问。' },
              { icon: CloudCog, title: '可选云端备份', desc: '绑定网页端账号后可打包备份到云端，随时恢复。' },
            ].map((item) => (
              <div key={item.title} className="bg-[#1b1815] border border-[rgba(232,226,216,0.08)] rounded-[2px] p-7">
                <div className="w-10 h-10 rounded-[2px] bg-[#bd4a2e]/10 flex items-center justify-center mb-4">
                  <item.icon className="w-5 h-5 text-[#e0704f]" />
                </div>
                <h4 className="text-base font-bold text-[#f0ebe2] mb-2">{item.title}</h4>
                <p className="text-sm text-[#9a9286]">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 价格（与现行商业化口径一致：免费层 / Pro 三档同权 / 云端按量） */}
      <section id="pricing" className="relative z-10 bg-[#161311]/90 border-t border-[rgba(232,226,216,0.06)]">
        <div className="max-w-5xl mx-auto px-6 py-20">
          <div className="text-center mb-12">
            <p className="text-[11px] tracking-[0.3em] uppercase text-[#e0704f] mb-3">定价</p>
            <h2 className="text-3xl sm:text-4xl font-bold text-[#f0ebe2]">本地免费，付费的是会员与云端模型</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                name: '免费版',
                price: '永久免费',
                desc: '本地注册即用，功能全开。',
                features: ['本地模型问答', 'RAG 检索 + 引用溯源', '剪藏 / 笔记 / 知识地图', '条数不限，100MB 储存护栏'],
                highlight: false,
              },
              {
                name: 'Pro 会员',
                price: '¥9.9 / 月 · ¥99 / 年',
                desc: '三档同权，功能完全一致。',
                features: ['模型管家与 BYOK 自填 key', '云端同步与备份', '年付档每月返 ¥3 按量余额', '本地免费版的全部功能'],
                highlight: true,
              },
              {
                name: '云端模型',
                price: '按量计费',
                desc: '平台模型随用随付。',
                features: ['有余额即可用，不需 Pro', 'DeepSeek / GLM / 通义等', '小额起充，用多少算多少', '与本地模型自由切换'],
                highlight: false,
              },
            ].map((tier) => (
              <div
                key={tier.name}
                className={`bg-[#1b1815] border rounded-[2px] p-7 flex flex-col ${tier.highlight ? 'border-[#bd4a2e]/60' : 'border-[rgba(232,226,216,0.08)]'}`}
              >
                <h3 className="text-lg font-bold text-[#f0ebe2] mb-2">{tier.name}</h3>
                <div className="text-xl font-bold text-[#e0704f] mb-3">{tier.price}</div>
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
                  className={`w-full py-2.5 max-sm:min-h-[44px] rounded-[2px] text-sm font-medium transition-colors ${
                    tier.highlight
                      ? 'bg-[#bd4a2e] hover:bg-[#a83c22] text-[#f6ece6]'
                      : 'border border-[rgba(232,226,216,0.14)] hover:border-[#bd4a2e]/60 text-[#e8e2d8]'
                  }`}
                >
                  {tier.price === '永久免费' ? '立即开始' : '查看详情'}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 常见问题 */}
      <section className="relative z-10 bg-[#161311]/95 border-t border-[rgba(232,226,216,0.06)]">
        <div className="max-w-4xl mx-auto px-6 py-20">
          <div className="text-center mb-10">
            <p className="text-[11px] tracking-[0.3em] uppercase text-[#e0704f] mb-3">FAQ</p>
            <h2 className="text-3xl sm:text-4xl font-bold text-[#f0ebe2]">常见问题</h2>
          </div>
          <div className="space-y-4">
            {[
              {
                q: 'Molore 是什么？',
                a: '本地优先的个人 AI 知识库：笔记、剪藏、文档存进本机，AI 问答只检索你自己的资料，每句回答带原文出处。支持桌面端离线使用、Docker 一键自托管。',
              },
              {
                q: '数据不出本机是真的吗？',
                a: '真的。桌面端内嵌完整后端，本地模型 + 本地 SQLite 检索，断网也能记、也能问。云端备份是可选项，打包上传由你手动发起。',
              },
              {
                q: '用 Molore 要花钱吗？',
                a: '本地使用永久免费（本地注册+本地模型，条数不限）。Pro 会员 ¥9.9/月、¥99/年（模型管家、BYOK、云同步）。云端平台模型按量计费，有余额即可用。',
              },
              {
                q: '支持哪些 AI 模型？',
                a: '本地 Ollama 模型（免费离线）；BYOK 自填 key 走自己的厂商账户；云端平台模型按量计费。自动生成类链路只走本地模型，不花一分钱。',
              },
            ].map((f) => (
              <details key={f.q} className="bg-[#1b1815] border border-[rgba(232,226,216,0.08)] rounded-[2px] p-6 group">
                <summary className="flex items-center justify-between gap-4 cursor-pointer list-none text-base font-bold text-[#f0ebe2] [&::-webkit-details-marker]:hidden">
                  <span>Q：{f.q}</span>
                  <ChevronDown className="w-4 h-4 text-[#9a9286] shrink-0 transition-transform duration-200 group-open:rotate-180" />
                </summary>
                <p className="text-sm text-[#9a9286] leading-relaxed mt-3">A：{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Footer：品牌锚文本 + 站内内链（产品/学习/资源三列，SEO 基本盘）+ 版权 */}
      <footer className="relative z-10 bg-[#161311] border-t border-[rgba(232,226,216,0.06)]">
        <div className="max-w-6xl mx-auto px-6 py-12">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-10">
            <div className="col-span-2 md:col-span-1">
              <div className="flex items-center gap-2 mb-3">
                <BrandLogo size={22} dark withWordmark={false} />
                <span className="text-sm font-bold text-[#f0ebe2]">Molore</span>
              </div>
              <p className="text-xs text-[#6b655c] leading-relaxed">
                本地优先的个人 AI 知识库：笔记、网页剪藏、知识图谱与 AI 问答都在你自己的设备上运行，数据不出机器。开源免费，可自托管。
              </p>
            </div>
            <nav aria-label="产品">
              <h3 className="text-xs font-bold text-[#9a9286] uppercase tracking-wider mb-3">产品</h3>
              <ul className="space-y-2 text-xs text-[#6b655c]">
                <li><a href="#download" className="hover:text-[#f0ebe2] transition-colors">下载桌面端（Windows）</a></li>
                <li><a href="/app" className="hover:text-[#f0ebe2] transition-colors">在线体验（游客免注册）</a></li>
                <li><a href="#pricing" className="hover:text-[#f0ebe2] transition-colors">价格方案</a></li>
              </ul>
            </nav>
            <nav aria-label="学习指南">
              <h3 className="text-xs font-bold text-[#9a9286] uppercase tracking-wider mb-3">学习指南</h3>
              <ul className="space-y-2 text-xs text-[#6b655c]">
                <li><a href="/learn" className="hover:text-[#f0ebe2] transition-colors">知识管理专栏</a></li>
                <li><a href="/learn/what-is-second-brain" className="hover:text-[#f0ebe2] transition-colors">什么是第二大脑</a></li>
                <li><a href="/learn/ai-rag-knowledge-base" className="hover:text-[#f0ebe2] transition-colors">AI 知识库与 RAG 通俗解读</a></li>
                <li><a href="/learn/qianji-vs-notion-obsidian" className="hover:text-[#f0ebe2] transition-colors">Molore vs Notion vs Obsidian</a></li>
                <li><a href="/learn/local-ai-knowledge-base-guide" className="hover:text-[#f0ebe2] transition-colors">本地知识库搭建指南</a></li>
              </ul>
            </nav>
            <nav aria-label="资源">
              <h3 className="text-xs font-bold text-[#9a9286] uppercase tracking-wider mb-3">资源</h3>
              <ul className="space-y-2 text-xs text-[#6b655c]">
                <li><a href="/docs" target="_blank" rel="noreferrer" className="hover:text-[#f0ebe2] transition-colors">使用文档</a></li>
                <li><a href={GITHUB_URL} target="_blank" rel="noreferrer" className="hover:text-[#f0ebe2] transition-colors">GitHub 开源仓库</a></li>
                <li><a href="/sitemap.xml" className="hover:text-[#f0ebe2] transition-colors">站点地图</a></li>
              </ul>
            </nav>
          </div>
          <div className="pt-6 border-t border-[rgba(232,226,216,0.06)] flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[#6b655c]">
            <span>© 2026 Molore · 本地优先的个人 AI 知识库</span>
            <span>开源协议：AGPL-3.0 · grzhishiku.com</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default WelcomePage;
