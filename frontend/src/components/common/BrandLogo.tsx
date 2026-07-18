import { FC } from 'react';

interface BrandLogoProps {
  /** 图标尺寸（px），默认 32 */
  size?: number;
  /** 是否显示文字标，默认 true */
  withWordmark?: boolean;
}

/**
 * 品牌印章：朱砂方印 + 发丝内框 + 衬线"脑"字。
 * 取中式印章的形制——方正、克制、一眼可辨。
 */
export const SealMark: FC<{ size?: number }> = ({ size = 32 }) => {
  return (
    <div
      className="relative flex items-center justify-center rounded-[3px] bg-accent"
      style={{ width: size, height: size }}
    >
      {/* 印章内框发丝线 */}
      <div className="absolute inset-[8%] border border-[#f6f1e8]/30 rounded-[2px] pointer-events-none" />
      <span
        className="text-[#f6f1e8] font-bold leading-none select-none"
        style={{
          fontSize: size * 0.52,
          fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', 'STZhongsong', 'SimSun', serif",
          transform: 'translateY(-1%)',
        }}
      >
        脑
      </span>
    </div>
  );
};

/**
 * 品牌 Logo：印章 + 中文刊头（第二大脑）+ 英文小字（宽字距）。
 * 中文为主、英文为辅，杂志刊头式排版。
 */
const BrandLogo: FC<BrandLogoProps> = ({ size = 32, withWordmark = true }) => {
  return (
    <div className="flex items-center gap-2.5">
      <SealMark size={size} />
      {withWordmark && (
        <div className="flex flex-col leading-none">
          <span
            className="text-[15px] font-bold tracking-[0.14em] text-text-primary"
            style={{ fontFamily: "'Noto Serif SC', 'Songti SC', 'STZhongsong', 'SimSun', serif" }}
          >
            第二大脑
          </span>
          <span className="text-[9px] font-medium text-text-muted tracking-[0.22em] mt-1 uppercase">
            Personal Second Brain
          </span>
        </div>
      )}
    </div>
  );
};

export default BrandLogo;
