/**
 * Complete sitemap — same as sitemap.xml but with longer cache
 * Accessible at: https://www.micronshub.eu/sitemap-complete.xml
 *
 * Previously fetched from Supabase Storage (which was often empty).
 * Now delegates to the programmatic sitemap.xml handler.
 */

// Re-use the main sitemap handler
import sitemapHandler from './sitemap.xml.js';

export default async function handler(req, res) {
  // Use a longer cache for the "complete" sitemap
  res.setHeader('Cache-Control', 'public, max-age=7200, s-maxage=7200');
  return sitemapHandler(req, res);
}
