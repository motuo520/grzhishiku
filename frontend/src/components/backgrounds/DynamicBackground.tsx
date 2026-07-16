import { Suspense, lazy, useMemo } from 'react';

const MoonlitRipple = lazy(() => import('./MoonlitRipple'));
const FlowField = lazy(() => import('./FlowField'));
const RainOnGlass = lazy(() => import('./RainOnGlass'));

export type BackgroundMode = 'moonlit' | 'silk' | 'rain' | 'solid';

interface DynamicBackgroundProps {
  mode?: BackgroundMode;
  solidColor?: string;
  className?: string;
}

export const BACKGROUND_OPTIONS = [
  { id: 'moonlit' as BackgroundMode, label: '月夜涟漪' },
  { id: 'silk' as BackgroundMode, label: '丝绸流场' },
  { id: 'rain' as BackgroundMode, label: '雨落寒窗' },
  { id: 'solid' as BackgroundMode, label: '纯色' },
];

export const SOLID_COLORS = [
  { color: '#0a0c10', label: '墨黑' },
  { color: '#1a1a2e', label: '深蓝' },
  { color: '#1a1308', label: '棕褐' },
  { color: '#f5f5f5', label: '素白' },
];

export default function DynamicBackground({
  mode = 'moonlit',
  solidColor = '#0a0c10',
  className = '',
}: DynamicBackgroundProps) {
  const style = useMemo(() => {
    if (mode === 'solid') {
      return { backgroundColor: solidColor };
    }
    return undefined;
  }, [mode, solidColor]);

  return (
    <div className={`fixed inset-0 ${className}`} style={{ zIndex: 0, ...style }}>
      <Suspense fallback={null}>
        {mode === 'moonlit' && <MoonlitRipple />}
        {mode === 'silk' && <FlowField />}
        {mode === 'rain' && <RainOnGlass />}
      </Suspense>
    </div>
  );
}
