// 风格改造前后对比截图：node scripts/style-shots.mjs <outDir>
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const outDir = process.argv[2] || 'shots-before';
mkdirSync(outDir, { recursive: true });

const pages = [
  ['dashboard', 'http://localhost:3000/app'],
  ['welcome', 'http://localhost:3000/welcome'],
  ['notes', 'http://localhost:3000/ingest/notes'],
  ['search', 'http://localhost:3000/search'],
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
for (const [name, url] of pages) {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${outDir}/${name}.png` });
    console.log('ok', name);
  } catch (e) {
    console.log('fail', name, e.message);
  }
}
await browser.close();
