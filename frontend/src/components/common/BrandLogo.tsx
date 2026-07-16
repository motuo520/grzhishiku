import { FC, useId } from 'react';

interface BrandLogoProps {
  /** 图标尺寸（px），默认 32 */
  size?: number;
  /** 是否显示文字标，默认 true */
  withWordmark?: boolean;
}

/**
 * 品牌 Logo：左右两个半脑拼成一个圆——左暖（个人脑）、右冷（网络脑），
 * 中间突触节点相连，呼应产品的双脑架构与知识网络。
 */
const BrandLogo: FC<BrandLogoProps> = ({ size = 32, withWordmark = true }) => {
  const uid = useId();
  const warmId = `brand-warm-${uid}`;
  const coolId = `brand-cool-${uid}`;

  return (
    <div className="flex items-center gap-2.5">
      <div
        className="rounded-xl bg-bg-secondary border border-border-color flex items-center justify-center shadow-[0_0_16px_rgba(210,153,34,0.10)]"
        style={{ width: size, height: size }}
      >
        <svg viewBox="0 0 32 32" width={size * 0.78} height={size * 0.78} aria-label="第二大脑 Logo">
          <defs>
            <linearGradient id={warmId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#e8b45a" />
              <stop offset="1" stopColor="#d29922" />
            </linearGradient>
            <linearGradient id={coolId} x1="1" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#6cb2ff" />
              <stop offset="1" stopColor="#3b82f6" />
            </linearGradient>
          </defs>
          {/* 左半脑：个人脑（暖色） */}
          <path d="M16 4 A12 12 0 0 0 16 28 Z" fill={`url(#${warmId})`} />
          {/* 右半脑：网络脑（冷色） */}
          <path d="M16 4 A12 12 0 0 1 16 28 Z" fill={`url(#${coolId})`} />
          {/* 左右突触连接 */}
          <line x1="16" y1="16" x2="8.5" y2="11.5" stroke="#ffffff" strokeWidth="1.1" opacity="0.65" />
          <line x1="16" y1="16" x2="23.5" y2="11.5" stroke="#ffffff" strokeWidth="1.1" opacity="0.65" />
          <circle cx="8.5" cy="11.5" r="1.4" fill="#ffffff" opacity="0.85" />
          <circle cx="23.5" cy="11.5" r="1.4" fill="#ffffff" opacity="0.85" />
          {/* 中线突触 */}
          <line x1="16" y1="9" x2="16" y2="23.5" stroke="#0d1117" strokeWidth="1" opacity="0.3" />
          <circle cx="16" cy="9" r="1.5" fill="#ffffff" opacity="0.9" />
          <circle cx="16" cy="16" r="1.6" fill="#ffffff" opacity="0.9" />
          <circle cx="16" cy="23.5" r="1.5" fill="#ffffff" opacity="0.9" />
        </svg>
      </div>
      {withWordmark && (
        <div className="flex flex-col leading-none">
          <span className="text-sm font-bold tracking-[0.12em] text-text-primary uppercase">
            Second Brain
          </span>
          <span className="text-[11px] font-medium text-text-muted tracking-wide mt-0.5">第二大脑</span>
        </div>
      )}
    </div>
  );
};

export default BrandLogo;
