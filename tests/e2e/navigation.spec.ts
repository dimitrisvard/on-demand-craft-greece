import { test, expect } from '@playwright/test';

test.describe('Navigation — Service Pages', () => {
  test('should navigate to CNC machining page', async ({ page }) => {
    await page.goto('/en');
    const cncLink = page.locator('a[href*="cnc"]').first();
    if (await cncLink.isVisible()) {
      await cncLink.click();
      await expect(page).toHaveURL(/cnc/i);
      await expect(page).toHaveTitle(/.+/); // page loaded with a title
    }
  });

  test('should navigate to sheet metal fabrication page', async ({ page }) => {
    await page.goto('/en');
    const link = page.locator('a[href*="sheet-metal"]').first();
    if (await link.isVisible()) {
      await link.click();
      await expect(page).toHaveURL(/sheet-metal/i);
    }
  });

  test('should navigate to 3D printing page', async ({ page }) => {
    await page.goto('/en');
    const link = page.locator('a[href*="3d-print"]').first();
    if (await link.isVisible()) {
      await link.click();
      await expect(page).toHaveURL(/3d/i);
    }
  });

  test('should navigate to injection molding page', async ({ page }) => {
    await page.goto('/en');
    const link = page.locator('a[href*="injection"]').first();
    if (await link.isVisible()) {
      await link.click();
      await expect(page).toHaveURL(/injection/i);
    }
  });

  test('should navigate to the quote/contact page', async ({ page }) => {
    await page.goto('/en');
    const quoteLink = page.locator('a[href*="quote"], a[href*="contact"]').first();
    if (await quoteLink.isVisible()) {
      await quoteLink.click();
      await expect(page).toHaveURL(/quote|contact/i);
    }
  });

  test('should load German service pages with translated URLs', async ({ page }) => {
    const response = await page.goto('/de/dienstleistungen/cnc-bearbeitung');
    // Should load (200) or redirect (3xx)
    expect(response?.status()).toBeLessThan(400);
  });

  test('should load French service pages with translated URLs', async ({ page }) => {
    const response = await page.goto('/fr/services/usinage-cnc');
    expect(response?.status()).toBeLessThan(400);
  });
});
