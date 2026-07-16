import { useState, useEffect } from 'react';
import { BackgroundMode, BACKGROUND_OPTIONS, SOLID_COLORS } from '@/components/backgrounds/DynamicBackground';

const BG_KEY = 'psb-background-mode';
const BG_COLOR_KEY = 'psb-background-color';

export function useBackgroundMode() {
  const [mode, setMode] = useState<BackgroundMode>(() => {
    const saved = localStorage.getItem(BG_KEY);
    if (saved && BACKGROUND_OPTIONS.some((o) => o.id === saved)) return saved as BackgroundMode;
    return 'moonlit';
  });
  const [color, setColor] = useState(() => localStorage.getItem(BG_COLOR_KEY) || SOLID_COLORS[0].color);

  useEffect(() => {
    localStorage.setItem(BG_KEY, mode);
  }, [mode]);

  useEffect(() => {
    localStorage.setItem(BG_COLOR_KEY, color);
  }, [color]);

  return { mode, color, setMode, setColor };
}
