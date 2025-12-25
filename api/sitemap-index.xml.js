// API route to serve sitemap-index from Supabase Storage
// Accessible at: https://www.micronshub.eu/sitemap-index.xml

export default async function handler(req, res) {
  // Set proper headers for XML sitemap
  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  
  try {
    const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://cfjrtmtaitwzggzpkhxi.supabase.co';
    const sitemapUrl = `${supabaseUrl}/storage/v1/object/public/sitemaps/sitemap-index.xml`;
    
    const response = await fetch(sitemapUrl, {
      headers: {
        'Accept': 'application/xml',
      },
    });

    if (!response.ok) {
      console.error(`Failed to fetch sitemap-index: ${response.status} ${response.statusText}`);
      // Return empty sitemap index if fetch fails
      return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
</sitemapindex>`);
    }

    const xml = await response.text();
    res.status(200).send(xml);
  } catch (error) {
    console.error('Error serving sitemap-index:', error);
    res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
</sitemapindex>`);
  }
}

