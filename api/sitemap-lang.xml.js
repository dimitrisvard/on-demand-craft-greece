// API route to serve language-specific sitemaps from Supabase Storage
// Accessible at: https://www.micronshub.eu/sitemap-en.xml, /sitemap-de.xml, etc.

export default async function handler(req, res) {
  // Set proper headers for XML sitemap
  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  
  // Extract language from the URL path (e.g., /sitemap-en.xml -> en)
  const url = req.url || '';
  const match = url.match(/sitemap-([a-z]{2})\.xml/i);
  const lang = match ? match[1].toLowerCase() : 'en';
  
  // Valid language codes
  const validLangs = ['en', 'de', 'fr', 'es', 'it', 'nl', 'pl', 'sv', 'da', 'fi', 'cs', 'hu', 'pt', 'nb'];
  
  if (!validLangs.includes(lang)) {
    return res.status(404).send('Sitemap not found');
  }
  
  try {
    const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://cfjrtmtaitwzggzpkhxi.supabase.co';
    const sitemapUrl = `${supabaseUrl}/storage/v1/object/public/sitemaps/sitemap-${lang}.xml`;
    
    const response = await fetch(sitemapUrl, {
      headers: {
        'Accept': 'application/xml',
      },
    });

    if (!response.ok) {
      console.error(`Failed to fetch sitemap-${lang}: ${response.status} ${response.statusText}`);
      return res.status(404).send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
</urlset>`);
    }

    const xml = await response.text();
    res.status(200).send(xml);
  } catch (error) {
    console.error(`Error serving sitemap-${lang}:`, error);
    res.status(404).send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
</urlset>`);
  }
}

