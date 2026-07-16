import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Palette } from 'lucide-react';
import {
  BackgroundMode,
  BACKGROUND_OPTIONS,
  SOLID_COLORS,
} from './DynamicBackground';

interface BackgroundSwitcherProps {
  mode: BackgroundMode;
  color: string;
  onChangeMode: (mode: BackgroundMode) => void;
  onChangeColor: (color: string) => void;
}

export default function BackgroundSwitcher({
  mode,
  color,
  onChangeMode,
  onChangeColor,
}: BackgroundSwitcherProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="p-2 rounded-xl hover:bg-white/[0.08] text-text-secondary hover:text-warning transition-all duration-300"
        title="切换动态背景"
      >
        <Palette className="w-4 h-4" />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -5, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -5, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 top-full mt-2 w-44 bg-bg-secondary border border-border-color rounded-xl shadow-2xl py-2 z-50"
            >
              {BACKGROUND_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => { onChangeMode(opt.id); if (opt.id !== 'solid') setOpen(false); }}
                  className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                    mode === opt.id
                      ? 'text-text-primary bg-white/[0.06]'
                      : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.03]'
                  }`}
                >
                  {mode === opt.id && <span className="mr-1.5 text-warning">&#183;</span>}
                  {opt.label}
                </button>
              ))}

              {mode === 'solid' && (
                <div className="px-3 py-2 border-t border-border-color mt-1 flex gap-2">
                  {SOLID_COLORS.map((c) => (
                    <button
                      key={c.color}
                      onClick={() => { onChangeColor(c.color); setOpen(false); }}
                      title={c.label}
                      className="w-5 h-5 rounded-full transition-transform hover:scale-110"
                      style={{
                        backgroundColor: c.color,
                        boxShadow: color === c.color ? '0 0 0 1.5px #888' : 'inset 0 0 0 1px rgba(255,255,255,0.15)',
                      }}
                    />
                  ))}
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
