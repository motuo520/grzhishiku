import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:3002/graph/network?layout=circular', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1000);
const navText = await page.locator('header nav').innerText({ timeout: 5000 }).catch(() => '');
console.log('Top nav text:', navText.replace(/\n/g, ' | '));

await page.click('button:has-text("更多")');
await page.waitForTimeout(500);
const moreText = await page.locator('header nav .absolute').first().innerText({ timeout: 3000 }).catch(() => '');
console.log('More dropdown text:', moreText.replace(/\n/g, ' | '));

await page.screenshot({ path: 'check-topnav.png', fullPage: false });
console.log('Screenshot saved to check-topnav.png');
await browser.close();
