import { FC } from 'react';
import { Monitor, Download, Package, Shield, Zap, HardDrive } from 'lucide-react';

const DOWNLOADS = [
  {
    id: 'setup',
    label: '安装版',
    file: 'PSB-Setup-0.1.2.exe',
    size: '约 139 MB',
    desc: '推荐。向导安装，自动创建桌面与开始菜单快捷方式。',
    primary: true,
  },
  {
    id: 'portable',
    label: '便携版',
    file: 'PSB-Portable-0.1.2.exe',
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

const DesktopSettings: FC = () => {
  return (
    <div className="space-y-6">
      {/* 头部 */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-[2px] bg-accent/10 flex items-center justify-center text-accent">
          <Monitor className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-text-primary">桌面端</h2>
          <p className="text-xs text-text-secondary">Windows 客户端 · v0.1.0 · 数据不出本机</p>
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
};

export default DesktopSettings;
