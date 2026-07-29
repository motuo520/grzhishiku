import { FC } from 'react';

interface BrandLogoProps {
  /** 图标尺寸（px），默认 32 */
  size?: number;
  /** 是否显示文字标，默认 true */
  withWordmark?: boolean;
  /** 暗色背景模式（Welcome 页等黑色背景），默认 false */
  dark?: boolean;
}

/**
 * 品牌印章：朱砂方印 + 双层内框 + 衬线"墨"字。
 * 形制取法中式印章，比例更收敛，线条更锐利，适合深色与浅色两种背景。
 */
export const SealMark: FC<{ size?: number; dark?: boolean }> = ({ size = 32, dark = false }) => {
  const frameColor = dark ? '#f6f1e8' : '#bd4a2e';
  const inkColor = dark ? '#161311' : '#f6f1e8';

  return (
    <div
      className="relative flex items-center justify-center rounded-[3px] overflow-hidden shrink-0"
      style={{ width: size, height: size, backgroundColor: dark ? 'transparent' : '#bd4a2e' }}
    >
      {/* 外框 */}
      <div
        className="absolute inset-0 rounded-[3px] pointer-events-none"
        style={{ border: `1.5px solid ${frameColor}` }}
      />
      {/* 内框 */}
      <div
        className="absolute pointer-events-none"
        style={{
          inset: size * 0.1,
          border: `1px solid ${dark ? 'rgba(246,241,232,0.35)' : 'rgba(246,241,232,0.28)'}`,
          borderRadius: 2,
        }}
      />
      {/* 底色块 */}
      {!dark && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ backgroundColor: '#bd4a2e' }}
        />
      )}
      <span
        className="relative z-10 font-bold leading-none select-none"
        style={{
          fontSize: size * 0.48,
          color: dark ? '#bd4a2e' : inkColor,
          fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', 'STZhongsong', 'SimSun', serif",
          transform: 'translateY(-1%)',
        }}
      >
        墨
      </span>
    </div>
  );
};

/**
 * 品牌 Logo：印章 + 中文刊头 + 英文小字。
 * 中文为主、英文为辅，杂志刊头式排版，字距与行距重新收紧。
 */
const BrandLogo: FC<BrandLogoProps> = ({ size = 32, withWordmark = true, dark = false }) => {
  return (
    <div className="flex items-center gap-2.5">
      <SealMark size={size} dark={dark} />
      {withWordmark && (
        <div className="flex flex-col leading-none">
          <span
            className={`text-[15px] font-bold tracking-[0.12em] ${dark ? 'text-[#f0ebe2]' : 'text-text-primary'}`}
            style={{ fontFamily: "'Noto Serif SC', 'Songti SC', 'STZhongsong', 'SimSun', serif" }}
          >
            问墨
          </span>
          <span
            className={`text-[9px] font-medium tracking-[0.2em] mt-1 uppercase ${
              dark ? 'text-[#9a9286]' : 'text-text-muted'
            }`}
          >
            Wenmo
          </span>
        </div>
      )}
    </div>
  );
};

export default BrandLogo;
