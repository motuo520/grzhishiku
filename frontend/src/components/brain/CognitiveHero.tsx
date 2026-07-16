import { FC } from 'react';
import { motion } from 'framer-motion';
import { Brain, Sparkles, ScanEye } from 'lucide-react';

interface Props {
  title?: string;
  subtitle?: string;
}

export const CognitiveHero: FC<Props> = ({
  title = '认知镜像',
  subtitle = '让 AI 成为你思维的镜子，照见个人脑与网络脑的全景轮廓',
}) => {
  return (
    <div className="relative overflow-hidden rounded-2xl glass-card p-8 md:p-10 border-fusion-primary/20">
      <div className="absolute top-0 right-0 w-96 h-96 bg-fusion-primary/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
      <div className="absolute bottom-0 left-0 w-72 h-72 bg-info/10 rounded-full blur-3xl translate-y-1/3 -translate-x-1/4" />

      <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
        <div className="space-y-3 max-w-2xl">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-fusion-primary/10 border border-fusion-primary/30 text-fusion-primary text-sm font-medium"
          >
            <Sparkles className="w-4 h-4" />
            <span>双脑认知分析</span>
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="text-3xl md:text-4xl font-extrabold text-text-primary"
          >
            {title}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-text-secondary leading-relaxed"
          >
            {subtitle}
          </motion.p>
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.15 }}
          className="flex-shrink-0"
        >
          <div className="relative w-28 h-28 md:w-36 md:h-36">
            <div className="absolute inset-0 rounded-full border-2 border-dashed border-fusion-primary/30 animate-[spin_12s_linear_infinite]" />
            <div className="absolute inset-3 rounded-full border border-info/20 animate-[spin_8s_linear_infinite_reverse]" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="p-4 rounded-full bg-fusion-primary/10 border border-fusion-primary/30">
                <Brain className="w-10 h-10 md:w-12 md:h-12 text-fusion-primary" />
              </div>
            </div>
            <div className="absolute -top-1 -right-1 p-2 rounded-full bg-info/10 border border-info/30">
              <ScanEye className="w-4 h-4 text-info" />
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default CognitiveHero;
