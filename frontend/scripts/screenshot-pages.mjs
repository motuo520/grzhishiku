import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const outDir = path.dirname(__filename);

const urls = [
  'http://127.0.0.1:3002/',
  'http://127.0.0.1:3002/app',
  'http://127.0.0.1:3002/ingest',
  'http://127.0.0.1:3002/knowledge',
  'http://127.0.0.1:3002/graph/network',
  'http://127.0.0.1:3002/attention/dashboard',
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();

for (const url of urls) {
  const name = url.replace(/http:\/\/127\.0\.0\.1:3002\//, '').replace(/\//g, '_') || 'welcome';
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(outDir, `page-${name}.png`), fullPage: true });
    console.log('ok', url);
  } catch (e) {
    console.log('err', url, e.message);
  }
}

await browser.close();
