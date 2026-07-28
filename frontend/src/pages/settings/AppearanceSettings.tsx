import { FC, useState, useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { settingsApi, UserSettings } from '@/api/settings';
import { useSettings } from '@/store/settings';
import { Palette, Type, Monitor, Sun, Moon, Check, Loader2, AlertTriangle, LayoutGrid } from 'lucide-react';

type Theme = 'dark' | 'light' | 'system';
type FontSize = 'small' | 'medium' | 'large';

const AppearanceSettings: FC = () => {
  const [theme, setTheme] = useState<Theme>('system');
  const [fontSize, setFontSize] = useState<FontSize>('medium');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const storeSetTheme = useSettings(s => s.setTheme);
  const storeSetFontSize = useSettings(s => s.setFontSize);
  const mascotVisible = useSettings(s => s.mascotVisible);
  const setMascotVisible = useSettings(s => s.setMascotVisible);
  const uiMode = useSettings(s => s.uiMode);
  const setUiMode = useSettings(s => s.setUiMode);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings', 'appearance'],
    queryFn: () => settingsApi.getSettings().then(r => r.data),
  });

  useEffect(() => {
    if (settings?.appearance) {
      setTheme(settings.appearance.theme ?? 'system');
      setFontSize(settings.appearance.fontSize ?? 'medium');
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: (data: Partial<UserSettings>) => settingsApi.updateSettings(data),
    onSuccess: () => showToast('外观设置已保存', 'success'),
    onError: (error: any) => showToast(error?.message || '保存失败', 'error'),
  });

  const applyTheme = (value: Theme) => {
    storeSetTheme(value);
    const root = document.documentElement;
    root.classList.remove('dark', 'light');
    if (value === 'dark') {
      root.classList.add('dark');
    } else if (value === 'light') {
      root.classList.add('light');
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.add(prefersDark ? 'dark' : 'light');
    }
  };

  const applyFontSize = (value: FontSize) => {
    storeSetFontSize(value);
    const sizeMap: Record<FontSize, string> = {
      small: '14px',
      medium: '16px',
      large: '18px',
    };
    document.documentElement.style.fontSize = sizeMap[value];
  };

  const handleThemeChange = (value: Theme) => {
    setTheme(value);
    applyTheme(value);
  };

  const handleFontSizeChange = (value: FontSize) => {
    setFontSize(value);
    applyFontSize(value);
  };

  const handleSave = () => {
    saveMutation.mutate({
      appearance: {
        theme,
        fontSize,
      },
    });
  };

  if (isLoading) {
    return (
      <div className="glass-card p-8 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-info" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-[2px] border ${
          toast.type === 'success'
            ? 'bg-success/20 border-success/30 text-success'
            : 'bg-danger/20 border-danger/30 text-danger'
        }`}>
          <div className="flex items-center gap-2">
            {toast.type === 'success' ? <Check size={16} /> : <AlertTriangle size={16} />}
            <span className="text-sm">{toast.message}</span>
          </div>
        </div>
      )}

      {/* Theme */}
      <section className="glass-card p-6">
        <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <Palette size={18} className="text-info" />
          主题
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {([
            { value: 'light' as Theme, label: '浅色', icon: Sun },
            { value: 'dark' as Theme, label: '深色', icon: Moon },
            { value: 'system' as Theme, label: '跟随系统', icon: Monitor },
          ]).map(opt => {
            const Icon = opt.icon;
            const selected = theme === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => handleThemeChange(opt.value)}
                className={`flex items-center gap-3 p-4 rounded-[2px] border text-left transition-all ${
                  selected
                    ? 'border-info/40 bg-info/10 text-info'
                    : 'border-white/[0.08] hover:border-white/[0.15] text-text-secondary'
                }`}
              >
                <Icon size={20} />
                <span className="text-sm font-medium">{opt.label}</span>
                {selected && <Check size={16} className="ml-auto" />}
              </button>
            );
          })}
        </div>
      </section>

      {/* Font Size */}
      <section className="glass-card p-6">
        <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <Type size={18} className="text-personal-primary" />
          字体大小
        </h2>
        <div className="space-y-2">
          {([
            { value: 'small' as FontSize, label: '小', sample: 'Aa', desc: '14px' },
            { value: 'medium' as FontSize, label: '中', sample: 'Aa', desc: '16px' },
            { value: 'large' as FontSize, label: '大', sample: 'Aa', desc: '18px' },
          ]).map(opt => {
            const selected = fontSize === opt.value;
            return (
              <label
                key={opt.value}
                className={`flex items-center gap-4 p-3 rounded-[2px] border cursor-pointer transition-all ${
                  selected
                    ? 'border-personal-primary/40 bg-personal-primary/5'
                    : 'border-white/[0.08] hover:border-white/[0.15]'
                }`}
              >
                <input
                  type="radio"
                  name="fontSize"
                  value={opt.value}
                  checked={selected}
                  onChange={() => handleFontSizeChange(opt.value)}
                  className="accent-personal-primary"
                />
                <span
                  className="font-medium text-text-primary"
                  style={{ fontSize: opt.desc }}
                >
                  {opt.sample}
                </span>
                <div className="flex-1">
                  <div className="text-sm font-medium text-text-primary">{opt.label}</div>
                  <div className="text-xs text-text-muted">{opt.desc}</div>
                </div>
                {selected && <Check size={16} className="text-personal-primary" />}
              </label>
            );
          })}
        </div>
      </section>

      {/* Mascot */}
      <section className="glass-card p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">显示小助手</h2>
            <p className="text-xs text-text-secondary mt-1">右下角的脑形小助手，可快速记便签和设提醒；关闭后随时可在此重新开启</p>
          </div>
          <button
            onClick={() => setMascotVisible(!mascotVisible)}
            className={`relative w-12 h-6 rounded-full transition-colors shrink-0 ${mascotVisible ? 'bg-fusion-primary' : 'bg-bg-tertiary'}`}
          >
            <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${mascotVisible ? 'translate-x-6' : ''}`} />
          </button>
        </div>
      </section>

      {/* UI Version */}
      <section className="glass-card p-6">
        <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <LayoutGrid size={18} className="text-info" />
          界面版本
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {([
            { value: 'classic' as const, label: '经典版', desc: '旧版完整功能：全部 12 个模块' },
            { value: 'simple' as const, label: '简化版', desc: '只保留三个动作：存进来 / 自动理好 / 问出来' },
          ]).map(opt => {
            const selected = uiMode === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => setUiMode(opt.value)}
                className={`flex items-center gap-3 p-4 rounded-[2px] border text-left transition-all ${
                  selected
                    ? 'border-info/40 bg-info/10 text-info'
                    : 'border-white/[0.08] hover:border-white/[0.15] text-text-secondary'
                }`}
              >
                <div className="flex-1">
                  <div className="text-sm font-medium">{opt.label}</div>
                  <div className="text-xs text-text-muted mt-0.5">{opt.desc}</div>
                </div>
                {selected && <Check size={16} className="shrink-0" />}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-text-muted mt-3">切换即时生效并自动记住，也可以随时点顶栏的版本图标切换。</p>
      </section>

      {/* Save */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saveMutation.isPending}
          className="btn-primary flex items-center gap-2"
        >
          {saveMutation.isPending && <Loader2 size={16} className="animate-spin" />}
          <Check size={16} />
          保存外观设置
        </button>
      </div>
    </div>
  );
};

export default AppearanceSettings;
