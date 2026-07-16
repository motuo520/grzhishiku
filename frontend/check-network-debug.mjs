import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (err) => { errors.push(err.message); console.error('PAGE ERROR:', err.message); });
page.on('console', (msg) => { if (msg.type() === 'error') console.error('CONSOLE ERROR:', msg.text()); });
await page.goto('http://127.0.0.1:3001/graph/network?layout=circular', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(3000);
const hasError = await page.locator('text=页面出现错误').count() > 0;
console.log('Has error page:', hasError);
console.log('Page errors:', errors);
if (hasError) {
  const details = await page.locator('text=查看技术详情').first();
  if (await details.count() > 0) {
    await details.click();
    await page.waitForTimeout(500);
    const detailText = await page.locator('.text-xs, pre, code').first().innerText().catch(() => '');
    console.log('Detail:', detailText.slice(0, 1000));
  }
}
await browser.close();
