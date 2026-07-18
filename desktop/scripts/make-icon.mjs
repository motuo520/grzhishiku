// 生成桌面端图标：朱砂印章（方印 + 发丝内框 + 衬线"脑"字）→ 512x512 icon.png
// 用法：node scripts/make-icon.mjs（playwright 借用 frontend/node_modules）
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendRequire = createRequire(path.join(here, '..', '..', 'frontend', 'package.json'));
const { chromium } = frontendRequire('@playwright/test');

const out = path.join(here, '..', 'icon.png');

const html = `<!doctype html><html><body style="margin:0;background:#12100e;display:flex;align-items:center;justify-content:center;width:100vh;height:100vh">
  <div style="position:relative;width:400px;height:400px;border-radius:24px;background:#bd4a2e;display:flex;align-items:center;justify-content:center">
    <div style="position:absolute;inset:32px;border:6px solid rgba(246,241,232,0.3);border-radius:12px;pointer-events:none"></div>
    <span style="color:#f6f1e8;font-weight:700;font-size:210px;line-height:1;font-family:'Noto Serif SC','Source Han Serif SC','Songti SC','STZhongsong','SimSun',serif;transform:translateY(-1%)">脑</span>
  </div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
await page.setContent(html);
await page.screenshot({ path: out });
await browser.close();
console.log('icon written to', out);
