import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const outDir = path.dirname(__filename);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();

await page.goto('http://127.0.0.1:3002/', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(3000);

// Full page
await page.screenshot({ path: path.join(outDir, 'mascot-full.png'), fullPage: true });

// Mascot area bottom-right
await page.screenshot({
  path: path.join(outDir, 'mascot-crop.png'),
  clip: { x: 1080, y: 620, width: 200, height: 200 },
});

await browser.close();
console.log('screenshots saved');
