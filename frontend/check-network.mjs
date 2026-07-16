import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const layouts = ['circular', 'hierarchical', 'cluster', '3d-force'];
for (const layout of layouts) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push({ type: 'pageerror', message: err.message, stack: err.stack }));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push({ type: 'console.error', text: msg.text() });
  });
  const url = `http://127.0.0.1:3001/graph/network?layout=${layout}`;
  console.log(`\nChecking ${url}`);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(4000);
  const text = await page.locator('#root').innerText({ timeout: 5000 }).catch(() => '');
  const hasError = text.includes('页面出现错误') || errors.some(e => e.type === 'pageerror');
  console.log(layout, hasError ? 'ERROR' : 'OK', 'page errors:', errors.filter(e => e.type === 'pageerror').length);
  await page.screenshot({ path: `check-network-${layout}.png`, fullPage: true });
  console.log(`Saved check-network-${layout}.png`);
  await page.close();
}
await browser.close();
