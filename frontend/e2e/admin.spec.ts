import { test, expect } from '@playwright/test';

test.describe('Admin', () => {
  test('admin login and dashboard access', async ({ page }) => {
    await page.goto('/admin/login');
    await page.fill('input[type="email"]', 'admin@test.com');
    await page.fill('input[type="password"]', '__TEST_ADMIN_PASSWORD__');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/admin', { timeout: 10000 });
    await expect(page.locator('text=Dashboard')).toBeVisible({ timeout: 10000 });
    // Navigate to users page
    await page.click('text=Users');
    await expect(page.locator('text=Users')).toBeVisible();
  });
});
