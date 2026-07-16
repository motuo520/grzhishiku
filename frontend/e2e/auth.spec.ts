import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('user can login and see dashboard', async ({ page }) => {
    await page.goto('/');
    // Wait for login form (if unauthenticated redirect to login)
    await page.waitForSelector('input[type="email"]', { timeout: 5000 }).catch(() => {});
    const emailInput = await page.$('input[type="email"]');
    if (emailInput) {
      await page.fill('input[type="email"]', 'user@test.com');
      await page.fill('input[type="password"]', '__TEST_USER_PASSWORD__');
      await page.click('button[type="submit"]');
      await page.waitForURL('**/dashboard', { timeout: 10000 });
    }
    // Verify dashboard visible
    await expect(page.locator('text=Dashboard')).toBeVisible({ timeout: 10000 });
  });

  test('admin can login and access admin dashboard', async ({ page }) => {
    await page.goto('/admin/login');
    await page.fill('input[type="email"]', 'admin@test.com');
    await page.fill('input[type="password"]', '__TEST_ADMIN_PASSWORD__');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/admin', { timeout: 10000 });
    await expect(page.locator('text=Admin Dashboard')).toBeVisible({ timeout: 10000 });
  });
});
