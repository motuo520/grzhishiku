import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const logs = [];
page.on('console', (msg) => {
  logs.push(`${msg.type()}: ${msg.text()}`);
});
page.on('pageerror', (err) => {
  logs.push(`pageerror: ${err.message}`);
});

await page.goto('http://127.0.0.1:3002/app/dashboard', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(3000);

console.log(logs.join('\n'));
console.log(`\nTotal logs: ${logs.length}`);

await browser.close();
