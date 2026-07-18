import { test, expect } from '@playwright/test';

// 测试账号密码通过环境变量注入，避免把测试凭证硬编码进仓库。
const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL || 'user@test.com';
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD;
const TEST_ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL || 'admin@test.com';
const TEST_ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD;

if (!TEST_USER_PASSWORD || !TEST_ADMIN_PASSWORD) {
  throw new Error(
    '请在运行 e2e 测试前设置 TEST_USER_PASSWORD 和 TEST_ADMIN_PASSWORD 环境变量。'
  );
}

test.describe('Authentication', () => {
  test('user can login and see dashboard', async ({ page }) => {
    await page.goto('/');
    // Wait for login form (if unauthenticated redirect to login)
    await page.waitForSelector('input[type="email"]', { timeout: 5000 }).catch(() => {});
    const emailInput = await page.$('input[type="email"]');
    if (emailInput) {
      await page.fill('input[type="email"]', TEST_USER_EMAIL);
      await page.fill('input[type="password"]', TEST_USER_PASSWORD);
      await page.click('button[type="submit"]');
      await page.waitForURL('**/dashboard', { timeout: 10000 });
    }
    // Verify dashboard visible
    await expect(page.locator('text=Dashboard')).toBeVisible({ timeout: 10000 });
  });

  test('admin can login and access admin dashboard', async ({ page }) => {
    await page.goto('/admin/login');
    await page.fill('input[type="email"]', TEST_ADMIN_EMAIL);
    await page.fill('input[type="password"]', TEST_ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/admin', { timeout: 10000 });
    await expect(page.locator('text=Admin Dashboard')).toBeVisible({ timeout: 10000 });
  });
});
