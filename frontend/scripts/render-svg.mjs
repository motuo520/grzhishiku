import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const outDir = path.dirname(__filename);

const source = fs.readFileSync(
  path.join(outDir, '../src/components/mascot/MascotWidget.tsx'),
  'utf-8'
);

// Extract SVG content from CuteGirlSvg (handle nested tags)
const startIdx = source.indexOf('<svg');
const endIdx = source.indexOf('</svg>');
if (startIdx === -1 || endIdx === -1) {
  console.error('SVG not found');
  process.exit(1);
}
let svg = source.slice(startIdx, endIdx + 6);

// Convert JSX comments to HTML comments
svg = svg.replace(/\{\/\*([\s\S]*?)\*\/\}/g, '<!--$1-->');
// Remove group fill="none" for preview
svg = svg.replace(/viewBox="0 0 120 120"/, 'viewBox="0 0 120 120" width="200" height="200"');
// Convert JSX attributes to HTML/SVG attributes
svg = svg.replace(/stopColor/g, 'stop-color')
         .replace(/fillOpacity/g, 'fill-opacity')
         .replace(/strokeWidth/g, 'stroke-width')
         .replace(/strokeLinecap/g, 'stroke-linecap')
         .replace(/strokeLinejoin/g, 'stroke-linejoin')
         .replace(/strokeOpacity/g, 'stroke-opacity')
         .replace(/className=/g, 'class=')
         .replace(/class=\{className\}/g, 'class="mascot"');

const html = `<!doctype html>
<html><head><style>
body{margin:0;background:#f0f0f0;display:flex;align-items:center;justify-content:center;height:100vh}
.box{background:#fff;border-radius:50%;padding:20px;box-shadow:0 10px 30px rgba(0,0,0,0.1)}
</style></head><body>
<div class="box">${svg}</div>
</body></html>`;

fs.writeFileSync(path.join(outDir, 'mascot-preview.html'), html);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 300, height: 300 } });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.screenshot({ path: path.join(outDir, 'mascot-svg-render.png') });
await browser.close();
console.log('svg render saved');
