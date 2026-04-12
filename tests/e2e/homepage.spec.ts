import { test, expect } from '@playwright/test';

const LANGUAGES = ['en', 'de', 'fr', 'es', 'it', 'nl', 'pl', 'pt', 'sv', 'da', 'fi', 'nb', 'hu', 'cs'];

test.describe('Homepage — Multilingual Rendering', () => {
  test('should load the English homepage with manufacturing content', async ({ page }) => {
    await page.goto('/en');
    await expect(page).toHaveTitle(/Microns Hub/i);
    await expect(page.locator('body')).toContainText(/manufacturing|CNC|3D printing/i);
  });

  for (const lang of LANGUAGES) {
    test(`should load homepage in ${lang} with 200 status`, async ({ page }) => {
      const response = await page.goto(`/${lang}`);
      expect(response?.status()).toBe(200);
      await expect(page).toHaveTitle(/Microns Hub/i);
    });
  }

  test('should display navigation menu with service links', async ({ page }) => {
    await page.goto('/en');
    const nav = page.locator('nav, header');
    await expect(nav.first()).toBeVisible();
  });

  test('should be responsive at mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/en');
    await expect(page).toHaveTitle(/Microns Hub/i);
    // Page should not have horizontal overflow
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375 + 20); // small tolerance
  });
});
