import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const siteUrl = Deno.env.get("SITE_URL") || "https://www.micronshub.eu";

const supabase = createClient(supabaseUrl!, supabaseServiceKey!);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// All supported languages
const LANGUAGES = ["en", "de", "fr", "es", "it", "nl", "pl", "sv", "da", "fi", "cs", "hu", "pt", "nb"];

// Static pages that exist for all languages
const STATIC_PAGES = [
  { path: "", priority: "1.0", changefreq: "daily" },
  { path: "/services", priority: "0.9", changefreq: "weekly" },
  { path: "/services/cnc-machining", priority: "0.8", changefreq: "weekly" },
  { path: "/services/sheet-metal", priority: "0.8", changefreq: "weekly" },
  { path: "/services/3d-printing", priority: "0.8", changefreq: "weekly" },
  { path: "/services/injection-molding", priority: "0.8", changefreq: "weekly" },
  { path: "/services/surface-finish", priority: "0.8", changefreq: "weekly" },
  { path: "/services/rapid-prototyping", priority: "0.8", changefreq: "weekly" },
  { path: "/about", priority: "0.7", changefreq: "monthly" },
  { path: "/contact", priority: "0.7", changefreq: "monthly" },
  { path: "/quote", priority: "0.9", changefreq: "weekly" },
  { path: "/industries", priority: "0.7", changefreq: "monthly" },
  { path: "/industries/automotive", priority: "0.7", changefreq: "monthly" },
  { path: "/industries/aerospace", priority: "0.7", changefreq: "monthly" },
  { path: "/industries/medical", priority: "0.7", changefreq: "monthly" },
  { path: "/industries/industrial", priority: "0.7", changefreq: "monthly" },
  { path: "/blog", priority: "0.8", changefreq: "daily" },
];

interface Article {
  slug: string;
  language: string;
  updated_at: string;
  translation_id: string;
}

/**
 * Format date to W3C format for sitemap
 */
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toISOString().split('T')[0];
}

/**
 * Generate XML for a single URL entry with hreflang alternates
 */
function generateUrlEntry(
  url: string, 
  lastmod: string, 
  changefreq: string, 
  priority: string,
  alternates?: Array<{ lang: string; url: string }>
): string {
  let entry = `  <url>
    <loc>${url}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>`;

  if (alternates && alternates.length > 0) {
    entry += `\n`;
    for (const alt of alternates) {
      entry += `    <xhtml:link rel="alternate" hreflang="${alt.lang}" href="${alt.url}" />\n`;
    }
    // Add x-default pointing to English version
    const enVersion = alternates.find(a => a.lang === 'en');
    if (enVersion) {
      entry += `    <xhtml:link rel="alternate" hreflang="x-default" href="${enVersion.url}" />\n`;
    }
  }

  entry += `  </url>`;
  return entry;
}

/**
 * Generate the complete sitemap XML
 */
async function generateSitemap(): Promise<string> {
  const today = new Date().toISOString().split('T')[0];

  // Fetch all published articles
  const { data: articles, error } = await supabase
    .from("articles")
    .select("slug, language, updated_at, translation_id")
    .eq("status", "published")
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("Error fetching articles:", error);
    throw new Error(`Failed to fetch articles: ${error.message}`);
  }

  // Group articles by translation_id for hreflang
  const articlesByTranslation: Record<string, Article[]> = {};
  for (const article of articles || []) {
    if (!articlesByTranslation[article.translation_id]) {
      articlesByTranslation[article.translation_id] = [];
    }
    articlesByTranslation[article.translation_id].push(article);
  }

  let urlEntries: string[] = [];

  // 1. Generate entries for static pages (all languages)
  for (const page of STATIC_PAGES) {
    for (const lang of LANGUAGES) {
      const url = `${siteUrl}/${lang}${page.path}`;
      
      // Generate alternates for all languages
      const alternates = LANGUAGES.map(l => ({
        lang: l,
        url: `${siteUrl}/${l}${page.path}`
      }));

      urlEntries.push(generateUrlEntry(
        url,
        today,
        page.changefreq,
        page.priority,
        alternates
      ));
    }
  }

  // 2. Generate entries for blog articles with hreflang
  for (const translationId of Object.keys(articlesByTranslation)) {
    const translatedArticles = articlesByTranslation[translationId];
    
    // Generate alternates for this article group
    const alternates = translatedArticles.map(a => ({
      lang: a.language,
      url: `${siteUrl}/${a.language}/blog/${a.slug}`
    }));

    for (const article of translatedArticles) {
      const url = `${siteUrl}/${article.language}/blog/${article.slug}`;
      const lastmod = formatDate(article.updated_at);

      urlEntries.push(generateUrlEntry(
        url,
        lastmod,
        "weekly",
        "0.7",
        alternates
      ));
    }
  }

  // Build the complete sitemap
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urlEntries.join('\n')}
</urlset>`;

  return sitemap;
}

/**
 * Generate language-specific sitemap
 */
async function generateLanguageSitemap(lang: string): Promise<string> {
  const today = new Date().toISOString().split('T')[0];

  // Fetch articles for this language
  const { data: articles, error } = await supabase
    .from("articles")
    .select("slug, language, updated_at")
    .eq("status", "published")
    .eq("language", lang)
    .order("updated_at", { ascending: false });

  if (error) {
    console.error(`Error fetching ${lang} articles:`, error);
    throw new Error(`Failed to fetch ${lang} articles: ${error.message}`);
  }

  let urlEntries: string[] = [];

  // Static pages for this language
  for (const page of STATIC_PAGES) {
    const url = `${siteUrl}/${lang}${page.path}`;
    urlEntries.push(generateUrlEntry(url, today, page.changefreq, page.priority));
  }

  // Blog articles for this language
  for (const article of articles || []) {
    const url = `${siteUrl}/${lang}/blog/${article.slug}`;
    const lastmod = formatDate(article.updated_at);
    urlEntries.push(generateUrlEntry(url, lastmod, "weekly", "0.7"));
  }

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries.join('\n')}
</urlset>`;

  return sitemap;
}

/**
 * Generate sitemap index
 */
function generateSitemapIndex(): string {
  const today = new Date().toISOString().split('T')[0];
  
  let sitemaps = LANGUAGES.map(lang => `  <sitemap>
    <loc>${siteUrl}/sitemap-${lang}.xml</loc>
    <lastmod>${today}</lastmod>
  </sitemap>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemaps}
</sitemapindex>`;
}

/**
 * Upload sitemap to Supabase Storage (auto-replaces existing)
 */
async function uploadSitemapToStorage(
  filename: string,
  content: string
): Promise<{ success: boolean; publicUrl: string | null; error?: string }> {
  try {
    const blob = new Blob([content], { type: "application/xml" });
    
    // Upload to storage bucket (upsert = replace if exists)
    const { data, error } = await supabase.storage
      .from("sitemaps")
      .upload(filename, blob, {
        contentType: "application/xml",
        upsert: true, // Replace existing file
        cacheControl: "3600", // Cache for 1 hour
      });

    if (error) {
      console.error(`Storage upload error for ${filename}:`, error);
      return { success: false, publicUrl: null, error: error.message };
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from("sitemaps")
      .getPublicUrl(filename);

    console.log(`Sitemap uploaded: ${filename} -> ${urlData.publicUrl}`);
    return { success: true, publicUrl: urlData.publicUrl };
  } catch (error: any) {
    console.error(`Upload exception for ${filename}:`, error);
    return { success: false, publicUrl: null, error: error.message };
  }
}

/**
 * Main handler
 * Query params:
 * - type: "complete" (default), "index", or specific language code (e.g., "en", "de")
 * - save: "true" to auto-save to storage (default for complete sitemap)
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const type = url.searchParams.get("type") || "complete";
    const shouldSave = url.searchParams.get("save") !== "false"; // Default to true

    let sitemap: string;
    let stats = { type: "", urls: 0, languages: 0, articles: 0 };
    const uploadResults: Array<{ filename: string; publicUrl: string | null; success: boolean }> = [];

    if (type === "index") {
      // Generate sitemap index pointing to language-specific sitemaps
      sitemap = generateSitemapIndex();
      stats = { type: "index", urls: LANGUAGES.length, languages: LANGUAGES.length, articles: 0 };
      
      if (shouldSave) {
        const result = await uploadSitemapToStorage("sitemap-index.xml", sitemap);
        uploadResults.push({ filename: "sitemap-index.xml", ...result });
      }
    } else if (type === "all") {
      // Generate and save ALL sitemaps (complete + index + per-language)
      
      // 1. Generate and save complete sitemap
      sitemap = await generateSitemap();
      const completeResult = await uploadSitemapToStorage("sitemap.xml", sitemap);
      uploadResults.push({ filename: "sitemap.xml", ...completeResult });
      
      // 2. Generate and save sitemap index
      const indexSitemap = generateSitemapIndex();
      const indexResult = await uploadSitemapToStorage("sitemap-index.xml", indexSitemap);
      uploadResults.push({ filename: "sitemap-index.xml", ...indexResult });
      
      // 3. Generate and save per-language sitemaps
      for (const lang of LANGUAGES) {
        const langSitemap = await generateLanguageSitemap(lang);
        const langResult = await uploadSitemapToStorage(`sitemap-${lang}.xml`, langSitemap);
        uploadResults.push({ filename: `sitemap-${lang}.xml`, ...langResult });
      }
      
      const urlCount = (sitemap.match(/<url>/g) || []).length;
      const { count } = await supabase
        .from("articles")
        .select("*", { count: "exact", head: true })
        .eq("status", "published");
        
      stats = { 
        type: "all", 
        urls: urlCount, 
        languages: LANGUAGES.length, 
        articles: count || 0 
      };
    } else if (LANGUAGES.includes(type)) {
      // Generate language-specific sitemap
      sitemap = await generateLanguageSitemap(type);
      const urlCount = (sitemap.match(/<url>/g) || []).length;
      stats = { type: `language-${type}`, urls: urlCount, languages: 1, articles: urlCount - STATIC_PAGES.length };
      
      if (shouldSave) {
        const result = await uploadSitemapToStorage(`sitemap-${type}.xml`, sitemap);
        uploadResults.push({ filename: `sitemap-${type}.xml`, ...result });
      }
    } else {
      // Generate complete sitemap with all languages and hreflang
      sitemap = await generateSitemap();
      const urlCount = (sitemap.match(/<url>/g) || []).length;
      
      // Count articles
      const { count } = await supabase
        .from("articles")
        .select("*", { count: "exact", head: true })
        .eq("status", "published");

      stats = { 
        type: "complete", 
        urls: urlCount, 
        languages: LANGUAGES.length, 
        articles: count || 0 
      };
      
      if (shouldSave) {
        const result = await uploadSitemapToStorage("sitemap.xml", sitemap);
        uploadResults.push({ filename: "sitemap.xml", ...result });
      }
    }

    console.log(`Generated ${stats.type} sitemap with ${stats.urls} URLs`);

    // Construct public URLs for the sitemaps
    const storageBaseUrl = `${supabaseUrl}/storage/v1/object/public/sitemaps`;

    // Return both the sitemap XML and stats
    return new Response(
      JSON.stringify({
        success: true,
        message: `Sitemap generated and saved successfully`,
        stats,
        storage: {
          uploaded: uploadResults,
          publicUrls: {
            sitemap: `${storageBaseUrl}/sitemap.xml`,
            sitemapIndex: `${storageBaseUrl}/sitemap-index.xml`,
          }
        },
        sitemap: type !== "all" ? sitemap : undefined, // Don't include full sitemap in "all" response
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error: any) {
    console.error("Error generating sitemap:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Unknown error" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
