import { test, expect } from '@playwright/test';

const TEST_ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL || 'admin@test.com';
const TEST_ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD;

if (!TEST_ADMIN_PASSWORD) {
  throw new Error(
    '请在运行 e2e 测试前设置 TEST_ADMIN_PASSWORD 环境变量。'
  );
}

test.describe('Admin', () => {
  test('admin login and dashboard access', async ({ page }) => {
    await page.goto('/admin/login');
    await page.fill('input[type="email"]', TEST_ADMIN_EMAIL);
    await page.fill('input[type="password"]', TEST_ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/admin', { timeout: 10000 });
    await expect(page.locator('text=Dashboard')).toBeVisible({ timeout: 10000 });
    // Navigate to users page
    await page.click('text=Users');
    await expect(page.locator('text=Users')).toBeVisible();
  });
});
