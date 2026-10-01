// 桌面端（Electron）桥接类型：浏览器里恒 undefined，所有用法都是可选链。
// 开源版不含桌面壳，但同步自主仓的组件里保留了这个探测点。
interface Window {
  psbDesktop?: {
    isDesktop: boolean;
    pickDirectory: (title?: string) => Promise<string | null>;
    [key: string]: unknown;
  };
}
