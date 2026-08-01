import { FC } from 'react';
import { Monitor, Download, Package, Shield, Zap, HardDrive, Cloud, Laptop, KeyRound, RefreshCw, Keyboard } from 'lucide-react';
import { isDesktop } from '@/api/unifiedSync';

const APP_VERSION = '0.2.0';

const DOWNLOADS = [
  {
    id: 'setup',
    label: '安装版',
    file: `PSB-Setup-${APP_VERSION}.exe`,
    size: '约 139 MB',
    desc: '推荐。向导安装，自动创建桌面与开始菜单快捷方式。',
    primary: true,
  },
  {
    id: 'portable',
    label: '便携版',
    file: `PSB-Portable-${APP_VERSION}.exe`,
    size: '约 139 MB',
    desc: '免安装，下载即用，可放 U 盘随身携带。',
    primary: false,
  },
];

const FEATURES = [
  { icon: Shield, text: '数据完全存在本机，不上传任何服务器' },
  { icon: Zap, text: '内嵌后端一键启动，无需配置环境' },
  { icon: HardDrive, text: '托盘常驻 + Ctrl+Shift+N 全局快记' },
];

/** 桌面端应用内：使用指南（账号区别 + 上手示例） */
const DesktopGuide: FC = () => (
  <div className="space-y-6">
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-[2px] bg-accent/10 flex items-center justify-center text-accent">
        <Monitor className="w-5 h-5" />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-text-primary">你正在使用桌面端</h2>
        <p className="text-xs text-text-secondary">问墨 Windows 客户端 · v{APP_VERSION} · 数据不出本机</p>
      </div>
    </div>

    {/* 两种账号讲清楚 */}
    <div className="grid sm:grid-cols-2 gap-4">
      <div className="card !p-5 space-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
          <Laptop className="w-4 h-4 text-info" />
          本机账号
        </div>
        <p className="text-xs text-text-secondary leading-relaxed">
          只存在这台电脑的本地数据库里，<span className="text-text-primary">不能</span>用于
          grzhishiku.com 网页端登录。适合纯本地、不打算同步的使用方式。
        </p>
      </div>
      <div className="card !p-5 space-y-2 border-accent/40">
        <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
          <Cloud className="w-4 h-4 text-accent" />
          云端账号（推荐）
        </div>
        <p className="text-xs text-text-secondary leading-relaxed">
          用网页端账号登录桌面端，数据仍存在本机，但可通过端到端加密快照与网页端互通——服务器只存密文。
        </p>
      </div>
    </div>

    {/* 本地模型环境 */}
    <div className="card !p-5 space-y-3 border-info/30">
      <div className="text-sm font-semibold text-text-primary">本地模型环境（一次性准备）</div>
      <p className="text-xs text-text-secondary leading-relaxed">
        桌面端的本地模型依赖你电脑上的 Ollama。装好后保持 Ollama 运行，并拉取两个模型：
      </p>
      <div className="bg-bg-secondary rounded-[2px] px-3 py-2.5 font-mono text-[11px] text-text-secondary space-y-1">
        <div>ollama pull qwen2.5:0.5b <span className="text-text-muted"># 对话模型</span></div>
        <div>ollama pull nomic-embed-text <span className="text-text-muted"># 向量模型（检索用，缺了会静默降级）</span></div>
      </div>
      <p className="text-[11px] text-text-muted">
        没装 Ollama？到 ollama.com 下载安装即可。不配也能用桌面端，只是 AI 问答需改用云端模型。
      </p>
    </div>

    {/* 上手示例 */}
    <div className="card !p-5 space-y-4">
      <div className="text-sm font-semibold text-text-primary">上手四步</div>
      {[
        { icon: Cloud, title: '登录', desc: '登录框选「用云端账号登录」，填 grzhishiku.com + 网页端邮箱密码，首次自动开通本地会话。' },
        { icon: KeyRound, title: '设同步密码', desc: '到「设置 → 同步」设一个同步密码——它只存在你手里，用于加密快照，丢失无法找回。' },
        { icon: RefreshCw, title: '推一拉一', desc: '「立即上传快照」把本机内容加密推上云；在网页端「从云端恢复」即可拿到（反向同理）。' },
        { icon: Keyboard, title: '全局快记', desc: '任意界面按 Ctrl+Shift+N 唤起快记；关窗不退出，在系统托盘常驻。' },
      ].map((s, i) => (
        <div key={s.title} className="flex gap-3">
          <div className="w-7 h-7 rounded-[2px] bg-accent/10 flex items-center justify-center text-accent shrink-0 text-xs font-bold">
            {i + 1}
          </div>
          <div>
            <div className="text-sm font-medium text-text-primary flex items-center gap-1.5">
              <s.icon className="w-3.5 h-3.5 text-accent" />
              {s.title}
            </div>
            <p className="text-xs text-text-secondary mt-0.5 leading-relaxed">{s.desc}</p>
          </div>
        </div>
      ))}
    </div>

    <p className="text-[11px] text-text-muted leading-relaxed">
      想推荐给朋友？让 TA 打开 grzhishiku.com ，首页即可下载桌面端。
    </p>
  </div>
);

/** 网页端：下载卡片 */
const DesktopDownload: FC = () => (
  <div className="space-y-6">
    {/* 头部 */}
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-[2px] bg-accent/10 flex items-center justify-center text-accent">
        <Monitor className="w-5 h-5" />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-text-primary">桌面端</h2>
        <p className="text-xs text-text-secondary">Windows 客户端 · v{APP_VERSION} · 数据不出本机</p>
      </div>
    </div>

    {/* 下载卡片 */}
    <div className="grid sm:grid-cols-2 gap-4">
      {DOWNLOADS.map((d) => (
        <a
          key={d.id}
          href={`/download/${d.file}`}
          className={`card group flex flex-col gap-3 !p-5 transition-colors ${
            d.primary ? 'border-accent/40 hover:border-accent/70' : 'hover:border-border-color'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package className={`w-4 h-4 ${d.primary ? 'text-accent' : 'text-text-secondary'}`} />
              <span className="text-sm font-semibold text-text-primary">{d.label}</span>
              {d.primary && (
                <span className="px-1.5 py-0.5 rounded-[2px] bg-accent/10 text-accent text-[10px] font-medium">推荐</span>
              )}
            </div>
            <span className="text-[11px] text-text-muted">{d.size}</span>
          </div>
          <p className="text-xs text-text-secondary leading-relaxed">{d.desc}</p>
          <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${
            d.primary ? 'text-accent' : 'text-text-secondary group-hover:text-text-primary'
          }`}>
            <Download className="w-3.5 h-3.5" />
            下载 {d.file}
          </span>
        </a>
      ))}
    </div>

    {/* 特性 */}
    <div className="card !p-5 space-y-3">
      <div className="text-sm font-semibold text-text-primary">为什么用桌面端</div>
      {FEATURES.map((f) => (
        <div key={f.text} className="flex items-center gap-2.5 text-xs text-text-secondary">
          <f.icon className="w-3.5 h-3.5 text-accent shrink-0" />
          {f.text}
        </div>
      ))}
    </div>

    <p className="text-[11px] text-text-muted leading-relaxed">
      系统要求：Windows 10 / 11（64 位）。首次启动 Windows 可能提示 SmartScreen，选择「仍要运行」即可（安装包未购买代码签名证书）。
    </p>
  </div>
);

const DesktopSettings: FC = () => (isDesktop() ? <DesktopGuide /> : <DesktopDownload />);

export default DesktopSettings;
