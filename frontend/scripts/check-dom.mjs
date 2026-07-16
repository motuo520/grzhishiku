import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

await page.goto('http://127.0.0.1:3002/app/dashboard', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(3000);

const html = await page.$eval('main', (el) => el.innerHTML.substring(0, 2000));
console.log('MAIN HTML:', html);

const mainHeight = await page.$eval('main', (el) => el.offsetHeight);
const outlet = await page.$('main [class*="overflow-auto"]');
const outletHtml = outlet ? await outlet.evaluate((el) => el.innerHTML.substring(0, 2000)) : 'not found';
console.log('MAIN HEIGHT:', mainHeight);
console.log('OUTLET HTML:', outletHtml);

await browser.close();
