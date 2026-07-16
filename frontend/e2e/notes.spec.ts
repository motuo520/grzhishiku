import { test, expect } from '@playwright/test';

test.describe('Notes', () => {
  test('create a new note and see it in list', async ({ page }) => {
    await page.goto('/ingest/notes');
    // Wait for page load
    await page.waitForSelector('text=笔记管理', { timeout: 10000 });
    // Click new note
    await page.click('text=新建笔记');
    await page.waitForURL('**/ingest/notes/new', { timeout: 10000 });
    // Fill form
    await page.fill('input[placeholder*="标题"]', 'E2E Test Note');
    await page.fill('textarea[placeholder*="内容"]', 'This is an end-to-end test note.');
    await page.click('text=保存');
    // Return to list and verify
    await page.goto('/ingest/notes');
    await expect(page.locator('text=E2E Test Note')).toBeVisible({ timeout: 10000 });
  });
});
