// 生成桌面端图标：问墨品牌印章（朱砂方印 + 内框 + 衬线"墨"字）→ 512x512 icon.png
// 用法：node scripts/make-icon.mjs（playwright 借用 frontend/node_modules）
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendRequire = createRequire(path.join(here, '..', '..', 'frontend', 'package.json'));
const { chromium } = frontendRequire('@playwright/test');

const out = path.join(here, '..', 'icon.png');

const html = `<!doctype html><html><body style="margin:0;background:#bd4a2e;display:flex;align-items:center;justify-content:center;width:100vh;height:100vh">
  <div style="position:relative;width:512px;height:512px;background:#bd4a2e;display:flex;align-items:center;justify-content:center">
    <div style="position:absolute;inset:52px;border:5px solid rgba(246,241,232,0.28);border-radius:8px;pointer-events:none"></div>
    <span style="color:#f6f1e8;font-weight:700;font-size:246px;line-height:1;font-family:'Noto Serif SC','Source Han Serif SC','Songti SC','STZhongsong','SimSun',serif;transform:translateY(-1%)">墨</span>
  </div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
await page.setContent(html);
await page.screenshot({ path: out });
await browser.close();
console.log('icon written to', out);
