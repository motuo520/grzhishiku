import { FC, ReactNode, useEffect } from 'react';
import { useSettings } from '@/store/settings';

interface ThemeProviderProps {
  children: ReactNode;
}

const ThemeProvider: FC<ThemeProviderProps> = ({ children }) => {
  const theme = useSettings((state) => state.theme);
  const setTheme = useSettings((state) => state.setTheme);

  useEffect(() => {
    const root = document.documentElement;
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const effectiveTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

    if (effectiveTheme === 'light') {
      root.classList.add('light');
      root.classList.remove('dark');
    } else {
      root.classList.add('dark');
      root.classList.remove('light');
    }
  }, [theme]);

  useEffect(() => {
    if (theme !== 'system') return;
    const listener = (e: MediaQueryListEvent) => {
      const root = document.documentElement;
      if (e.matches) {
        root.classList.add('dark');
        root.classList.remove('light');
      } else {
        root.classList.add('light');
        root.classList.remove('dark');
      }
    };
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', listener);
    return () => mq.removeEventListener('change', listener);
  }, [theme]);

  // Listen for cross-tab theme sync
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === 'psb-settings') {
        try {
          const parsed = JSON.parse(e.newValue || '{}');
          if (parsed.state?.theme && parsed.state.theme !== theme) {
            setTheme(parsed.state.theme);
          }
        } catch {
          // ignore
        }
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [theme, setTheme]);

  return <>{children}</>;
};

export default ThemeProvider;
