import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

for (const url of ['http://127.0.0.1:3002/app', 'http://127.0.0.1:3002/ingest', 'http://127.0.0.1:3002/knowledge']) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  const html = await page.$eval('main [class*="overflow-auto"]', (el) => el.innerHTML.substring(0, 500));
  console.log(url, '->', html || '(empty)');
}

await browser.close();
