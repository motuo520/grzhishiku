import { FC } from 'react';
import { Info, X } from 'lucide-react';
import { useSettings } from '@/store/settings';

/**
 * 自动打标模型提示条（AI 设置页 / 批量导入页共用）。
 * 关闭状态 persist 在 psb-settings（关一次两端都不再出现）。
 * 背景：自动打标默认本地模型（免费档零摩擦），新用户不知道会嫌标签糙——
 * 提前说清楚，并给「标签可改可合并」的出口（08-22 用户：不提示会说东西不好用）。
 */
const AutoTagHint: FC = () => {
  const dismissed = useSettings((s) => s.autotagHintDismissed);
  const setDismissed = useSettings((s) => s.setAutotagHintDismissed);
  if (dismissed) return null;

  return (
    <div className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-[2px] bg-info/5 border border-info/20 text-xs text-text-secondary">
      <Info className="w-3.5 h-3.5 text-info shrink-0 mt-0.5" />
      <div className="flex-1 leading-relaxed">
        自动打标由<strong className="text-text-primary">本机本地模型</strong>完成：免费、离线可用、内容不出机器；
        小模型打的标签偏粗，属于「先粗分、再人工精修」的定位——标签页里可以随时改名、合并、删除。
      </div>
      <button
        onClick={() => setDismissed(true)}
        title="知道了，不再提示"
        className="text-text-muted hover:text-text-primary shrink-0 transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

export default AutoTagHint;
