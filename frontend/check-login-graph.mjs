import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:3002';
const API = 'http://127.0.0.1:8000';

const email = `test${Date.now()}@example.com`;
const password = 'Test1234!';
const name = 'TestUser';

// Register / login via backend API directly
async function getToken() {
  let res = await fetch(`${API}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });
  if (!res.ok && res.status === 400) {
    // maybe already exists, try login
    res = await fetch(`${API}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Auth failed: ${res.status} ${body}`);
  }
  const data = await res.json();
  return data.access_token;
}

const token = await getToken();
console.log('Got token');

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

const apiCalls = [];
page.on('response', async (res) => {
  const url = res.url();
  if (url.includes('/api/v1/')) {
    apiCalls.push({ url: url.split('?')[0], status: res.status() });
  }
});
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('console.error:', msg.text());
});

await page.goto(BASE + '/graph/network?layout=circular', { waitUntil: 'networkidle' });
await page.evaluate((t) => {
  localStorage.setItem('access_token', t);
}, token);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

const text = await page.locator('#root').innerText({ timeout: 5000 }).catch(() => '');
const hasError = text.includes('页面出现错误');
const hasDemo = text.includes('演示数据');
console.log('Logged in (guest notice detached):', !text.includes('你当前以游客身份浏览'));
console.log('Has page error:', hasError);
console.log('Showing demo data:', hasDemo);
console.log('API calls:', JSON.stringify(apiCalls.filter(c => c.url.includes('/graph/') || c.url.includes('/brain/')), null, 2));

await page.screenshot({ path: 'check-login-graph.png', fullPage: true });
console.log('Screenshot saved to check-login-graph.png');
await browser.close();
