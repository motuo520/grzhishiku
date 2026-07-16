import { FC, Suspense, lazy, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Brain, ArrowRight } from 'lucide-react';

// 湖光背景（底层 WebGL shader）
const MoonlitRipple = lazy(() => import('@/components/backgrounds/MoonlitRipple'));
// 3D 引力球（中层 three.js，可拖拽、鼠标吸引）
const WelcomeNetwork3D = lazy(() => import('@/components/backgrounds/WelcomeNetwork3D'));

const WelcomePage: FC = () => {
  const navigate = useNavigate();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleEnter = () => {
    navigate('/app');
  };

  return (
    <div className="h-screen w-full relative overflow-hidden bg-black">

      {/* 底层：湖光 WebGL 背景 —— pointer-events-none 不挡鼠标交互 */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <Suspense fallback={null}>
          <MoonlitRipple />
        </Suspense>
      </div>

      {/* 中层：3D 引力球 —— 可拖拽、鼠标吸引，z-[1] 在内容下层 */}
      <div className="absolute inset-0 z-[1]">
        <Suspense fallback={null}>
          <WelcomeNetwork3D />
        </Suspense>
      </div>

      {/* 暗角遮罩，让中间内容更清晰，pointer-events-none 不挡交互 */}
      <div
        className="absolute inset-0 z-[2] pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at 50% 45%, transparent 20%, rgba(0,0,0,0.65) 100%)',
        }}
      />

      {/* 上层：欢迎内容 —— pointer-events-none 不挡鼠标，按钮单独恢复 */}
      <div className="relative z-10 min-h-screen flex flex-col items-center justify-center px-6 text-center pointer-events-none">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: mounted ? 1 : 0, y: mounted ? 0 : 30 }}
          transition={{ duration: 0.9, ease: [0.4, 0, 0.2, 1] }}
          className="max-w-2xl mx-auto"
        >
          {/* Logo */}
          <div className="flex items-center justify-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-info to-fusion-primary flex items-center justify-center shadow-[0_0_40px_rgba(88,166,255,0.35)]">
              <Brain className="w-9 h-9 text-white" />
            </div>
          </div>

          {/* Title */}
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-[#e8e8e8] tracking-tight mb-2">
            Personal Second Brain
          </h1>

          {/* Tagline */}
          <p className="text-xl sm:text-2xl text-info font-medium tracking-wide mb-6">
            个人知识库
          </p>

          {/* Subtitle */}
          <p className="text-base sm:text-lg text-[#999] leading-relaxed mb-10 max-w-xl mx-auto">
            把记忆、灵感、阅读与思考沉淀成可生长、可验证、可对话的知识网络，
            用 AI 放大你的认知。
          </p>

          {/* Enter button */}
          <button
            onClick={handleEnter}
            className="group inline-flex items-center gap-3 px-8 py-3.5 rounded-2xl bg-white/[0.06] border border-white/[0.12] text-[#e8e8e8] text-base font-medium backdrop-blur-md hover:bg-white/[0.12] hover:border-white/[0.2] hover:shadow-[0_0_40px_rgba(88,166,255,0.25)] transition-all duration-300 pointer-events-auto"
          >
            进入网站
            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </button>
        </motion.div>

        {/* Bottom hint */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: mounted ? 1 : 0 }}
          transition={{ duration: 0.9, delay: 0.4 }}
          className="absolute bottom-8 text-[#555] text-xs"
        >
          Personal Second Brain · AI 增强的个人知识管理系统
        </motion.div>
      </div>

    </div>
  );
};

export default WelcomePage;
