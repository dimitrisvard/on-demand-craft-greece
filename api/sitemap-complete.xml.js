// API route to serve sitemap-complete from Supabase Storage
// Accessible at: https://www.micronshub.eu/sitemap-complete.xml

// Hardcode the Supabase URL since VITE_ env vars aren't available in Vercel API routes
const SUPABASE_URL = 'https://cfjrtmtaitwzggzpkhxi.supabase.co';

export default async function handler(req, res) {
  // Set proper headers for XML sitemap
  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600'); // Cache for 1 hour
  
  try {
    // Fetch sitemap from Supabase Storage
    const sitemapUrl = `${SUPABASE_URL}/storage/v1/object/public/sitemaps/sitemap-complete.xml`;
    
    const response = await fetch(sitemapUrl, {
      headers: {
        'Accept': 'application/xml',
      },
    });

    if (!response.ok) {
      console.error(`Failed to fetch sitemap-complete: ${response.status} ${response.statusText}`);
      // Return a basic sitemap structure if fetch fails
      return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://www.micronshub.eu</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>`);
    }

    const xml = await response.text();
    res.status(200).send(xml);
  } catch (error) {
    console.error('Error serving sitemap-complete:', error);
    // Return basic sitemap on error
    res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://www.micronshub.eu</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>`);
  }
}

