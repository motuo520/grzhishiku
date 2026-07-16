import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

const errors = [];
page.on('pageerror', (err) => {
  errors.push({ type: 'pageerror', message: err.message });
  console.error('PAGE ERROR:', err.message);
});
page.on('console', (msg) => {
  if (msg.type() === 'error' && !msg.text().includes('localhost:8000')) {
    errors.push({ type: 'console.error', text: msg.text() });
    console.error('CONSOLE ERROR:', msg.text());
  }
});

console.log('Navigating to http://127.0.0.1:3001/graph/network?layout=3d-force ...');
await page.goto('http://127.0.0.1:3001/graph/network?layout=3d-force', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(5000);

const title = await page.title();
console.log('Page title:', title);

const rootText = await page.locator('#root').innerText({ timeout: 5000 }).catch(() => '');
console.log('Root text snippet:', rootText.slice(0, 400));

if (errors.length === 0) {
  console.log('No runtime errors detected.');
} else {
  console.log('Total errors:', errors.length);
}

await page.screenshot({ path: 'check-demo3d.png', fullPage: true });
console.log('Screenshot saved to check-demo3d.png');

await browser.close();
