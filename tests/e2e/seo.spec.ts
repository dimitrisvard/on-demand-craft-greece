import { test, expect } from './fixtures/access';

test.describe('SEO & Meta Tags', () => {
  test('should have a proper meta description', async ({ page }) => {
    await page.goto('/en');
    const metaDescription = page.locator('meta[name="description"]');
    await expect(metaDescription).toHaveAttribute('content', /.+/);
  });

  test('should have Open Graph tags', async ({ page }) => {
    await page.goto('/en');
    const ogTitle = page.locator('meta[property="og:title"]');
    await expect(ogTitle).toHaveAttribute('content', /.+/);
  });

  test('should have hreflang tags for multilingual SEO', async ({ page }) => {
    await page.goto('/en');
    const hreflangTags = page.locator('link[hreflang]');
    const count = await hreflangTags.count();
    expect(count).toBeGreaterThan(0);
  });

  test('should have a canonical link', async ({ page }) => {
    await page.goto('/en');
    const canonical = page.locator('link[rel="canonical"]');
    const count = await canonical.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('should return a valid robots.txt', async ({ page }) => {
    const response = await page.goto('/robots.txt');
    expect(response?.status()).toBe(200);
    const body = await response?.text();
    expect(body).toContain('User-agent');
  });

  // /sitemap.xml is a sitemap index (api/sitemap.js:377-389); the URL set is
  // served at /sitemap-complete.xml.
  test('should return a valid sitemap.xml (sitemap index)', async ({ page }) => {
    const response = await page.goto('/sitemap.xml');
    expect(response?.status()).toBe(200);
    const body = await response?.text();
    expect(body).toContain('<sitemapindex');
  });

  test('should return a valid sitemap-complete.xml (URL set)', async ({ page }) => {
    const response = await page.goto('/sitemap-complete.xml');
    expect(response?.status()).toBe(200);
    const body = await response?.text();
    expect(body).toContain('<urlset');
  });

  test('should have structured data (JSON-LD)', async ({ page }) => {
    await page.goto('/en');
    const jsonLd = page.locator('script[type="application/ld+json"]');
    const count = await jsonLd.count();
    expect(count).toBeGreaterThan(0);
  });
});
