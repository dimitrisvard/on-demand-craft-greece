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

// Static pages that exist for all languages (matching old sitemap format)
const STATIC_PAGES = [
  { path: "", priority: "1.0", changefreq: "weekly" },
  { path: "/services", priority: "0.9", changefreq: "monthly" },
  { path: "/cnc-machining", priority: "0.8", changefreq: "monthly" },
  { path: "/sheet-metal", priority: "0.8", changefreq: "monthly" },
  { path: "/3d-printing", priority: "0.8", changefreq: "monthly" },
  { path: "/injection-molding", priority: "0.8", changefreq: "monthly" },
  { path: "/surface-finish", priority: "0.8", changefreq: "monthly" },
  { path: "/rapid-prototyping", priority: "0.8", changefreq: "monthly" },
  { path: "/about", priority: "0.7", changefreq: "monthly" },
  { path: "/industries", priority: "0.7", changefreq: "monthly" },
  { path: "/contact", priority: "0.7", changefreq: "monthly" },
  { path: "/quote", priority: "0.9", changefreq: "monthly" },
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
 * Generate XML for a single URL entry (simple format for Google Search Console compatibility)
 */
function generateUrlEntry(
  url: string, 
  lastmod: string, 
  changefreq: string, 
  priority: string
): string {
  return `<url>
<loc>${url}</loc>
<lastmod>${lastmod}</lastmod>
<changefreq>${changefreq}</changefreq>
<priority>${priority}</priority>
</url>`;
}

/**
 * Get language display name for comments
 */
function getLanguageName(lang: string): string {
  const names: Record<string, string> = {
    en: "English",
    de: "German",
    fr: "French",
    es: "Spanish",
    it: "Italian",
    nl: "Dutch",
    pl: "Polish",
    sv: "Swedish",
    da: "Danish",
    fi: "Finnish",
    cs: "Czech",
    hu: "Hungarian",
    pt: "Portuguese",
    nb: "Norwegian",
  };
  return names[lang] || lang.toUpperCase();
}

/**
 * Generate the complete sitemap XML (simple format compatible with Google Search Console)
 */
async function generateSitemap(): Promise<string> {
  const today = new Date().toISOString().split('T')[0];

  // Fetch all published articles
  const { data: articles, error } = await supabase
    .from("articles")
    .select("slug, language, updated_at")
    .eq("status", "published")
    .order("language", { ascending: true })
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("Error fetching articles:", error);
    throw new Error(`Failed to fetch articles: ${error.message}`);
  }

  // Group articles by language
  const articlesByLanguage: Record<string, Article[]> = {};
  for (const article of articles || []) {
    if (!articlesByLanguage[article.language]) {
      articlesByLanguage[article.language] = [];
    }
    articlesByLanguage[article.language].push(article);
  }

  let urlEntries: string[] = [];

  // Generate sitemap organized by language sections (matching old format)
  for (const lang of LANGUAGES) {
    // Add language section comment
    urlEntries.push(`<!-- ${getLanguageName(lang)} Pages -->`);

    // 1. Static pages for this language
    for (const page of STATIC_PAGES) {
      const url = `${siteUrl}/${lang}${page.path}`;
      urlEntries.push(generateUrlEntry(
        url,
        today,
        page.changefreq,
        page.priority
      ));
    }

    // 2. Blog articles for this language
    if (articlesByLanguage[lang]) {
      for (const article of articlesByLanguage[lang]) {
        const url = `${siteUrl}/${lang}/blog/${article.slug}`;
        const lastmod = formatDate(article.updated_at);
        urlEntries.push(generateUrlEntry(
          url,
          lastmod,
          "weekly",
          "0.7"
        ));
      }
    }
  }

  // Build the complete sitemap (correct XML format with namespace for Google)
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries.join('\n')}
</urlset>`;

  return sitemap;
}

/**
 * Generate language-specific sitemap (simple format)
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

  // Add language section comment
  urlEntries.push(`<!-- ${getLanguageName(lang)} Pages -->`);

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

  const sitemap = `<urlset>
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
    } else if (type === "all" || type === "complete") {
      // Generate single complete sitemap (SEO-perfect, Google-compatible)
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
      
      // Save single sitemap-complete.xml file
      const result = await uploadSitemapToStorage("sitemap-complete.xml", sitemap);
      uploadResults.push({ filename: "sitemap-complete.xml", ...result });
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
      // Generate complete sitemap with all languages (SEO-perfect format)
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
        // Save as sitemap-complete.xml (single file for Google Search Console)
        const result = await uploadSitemapToStorage("sitemap-complete.xml", sitemap);
        uploadResults.push({ filename: "sitemap-complete.xml", ...result });
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
            sitemap: `${storageBaseUrl}/sitemap-complete.xml`,
          }
        },
        sitemap: sitemap, // Include sitemap in response
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
