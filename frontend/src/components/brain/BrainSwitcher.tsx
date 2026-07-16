import { FC, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, Home, Globe } from 'lucide-react';
import { useBrain } from '@/hooks/useBrain';
import type { BrainSide } from '@/types';

const BrainSwitcher: FC = () => {
  const { status, activeBrain, switchBrain, isSwitching } = useBrain();
  const [isOpen, setIsOpen] = useState(false);

  const brains: { id: BrainSide; label: string; icon: typeof Home; color: string; accentColor: string; bg: string; desc: string }[] = [
    { id: 'personal', label: '个人脑', icon: Home, color: 'text-amber-400', accentColor: '#d29922', bg: 'bg-amber-400/10', desc: '你的想法与记忆' },
    { id: 'network', label: '网络脑', icon: Globe, color: 'text-blue-400', accentColor: '#58a6ff', bg: 'bg-blue-400/10', desc: '外部知识与信息' },
    { id: 'both', label: '双脑融合', icon: Brain, color: 'text-purple-400', accentColor: '#a371f7', bg: 'bg-purple-400/10', desc: '跨脑协作与关联' },
  ];

  const currentIndex = brains.findIndex((b) => b.id === activeBrain);
  const current = brains[currentIndex] || brains[2];

  const handleSwitch = async (targetId: BrainSide) => {
    try {
      await switchBrain(targetId);
    } catch (err: any) {
      console.error('Brain switch failed:', err);
      // Don't show alert for 401 - the interceptor handles redirect
      if (err?.status !== 401) {
        alert('切换失败: ' + (err?.response?.data?.message || err?.message || '请登录后再试'));
      }
    }
    setIsOpen(false);
  };

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'b') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={isSwitching}
        className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-300 glass ${current.color} border-white/[0.08] hover:border-current/30 hover:shadow-[0_0_20px_rgba(88,166,255,0.15)]`}
        title="切换大脑 (Ctrl+B)"
      >
        {isSwitching ? (
          <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
        ) : (
          <current.icon className="w-4 h-4" />
        )}
        <span className="hidden sm:inline">{current.label}</span>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-2 w-72 glass rounded-2xl shadow-2xl p-3 z-50 overflow-hidden"
            style={{ boxShadow: '0 20px 50px rgba(0, 0, 0, 0.5), 0 0 30px rgba(88, 166, 255, 0.1)' }}
          >
            <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2 px-1">
              选择大脑
            </div>
            
            {/* Brain options — simple vertical list, all clearly visible */}
            <div className="space-y-1 mb-2">
              {brains.map((brain) => {
                const isActive = activeBrain === brain.id;
                return (
                  <button
                    key={brain.id}
                    onClick={() => handleSwitch(brain.id)}
                    className={`w-full flex items-center gap-3 p-2.5 rounded-xl text-left transition-all duration-200 ${
                      isActive
                        ? `${brain.bg} ${brain.color} border border-current/20`
                        : 'hover:bg-white/[0.05] text-text-secondary'
                    }`}
                  >
                    <div className={`w-9 h-9 rounded-lg ${brain.bg} flex items-center justify-center flex-shrink-0`}>
                      <brain.icon className={`w-4 h-4 ${brain.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-medium ${isActive ? brain.color : 'text-text-primary'}`}>
                        {brain.label}
                      </div>
                      <div className="text-xs text-text-muted truncate">{brain.desc}</div>
                    </div>
                    {isActive && (
                      <div className={`w-2 h-2 rounded-full ${brain.color.replace('text-', 'bg-')} flex-shrink-0`} />
                    )}
                  </button>
                );
              })}
            </div>
            
            {/* Brain stats preview */}
            {status && (
              <div className="grid grid-cols-3 gap-2 px-1">
                <div className="text-center">
                  <div className="text-xs text-amber-400 font-medium">{status.personal_count}</div>
                  <div className="text-[10px] text-text-muted">个人</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-purple-400 font-medium">{status.both_count}</div>
                  <div className="text-[10px] text-text-muted">关联</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-blue-400 font-medium">{status.network_count}</div>
                  <div className="text-[10px] text-text-muted">网络</div>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default BrainSwitcher;
