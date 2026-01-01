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

// Static pages that exist for all languages (English paths - will be translated)
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

// URL slug translations for each language
// Maps: language -> English slug -> translated slug
const SLUG_TRANSLATIONS: Record<string, Record<string, string>> = {
  en: {
    "services": "services",
    "about": "about",
    "contact": "contact",
    "quote": "quote",
    "industries": "industries",
    "our-work": "our-work",
    "blog": "blog",
    "cnc-machining": "cnc-machining",
    "sheet-metal": "sheet-metal",
    "3d-printing": "3d-printing",
    "injection-molding": "injection-molding",
    "surface-finish": "surface-finish",
    "rapid-prototyping": "rapid-prototyping",
  },
  de: {
    "services": "dienstleistungen",
    "about": "ueber-uns",
    "contact": "kontakt",
    "quote": "angebot",
    "industries": "branchen",
    "our-work": "unsere-arbeit",
    "blog": "blog",
    "cnc-machining": "cnc-bearbeitung",
    "sheet-metal": "blechbearbeitung",
    "3d-printing": "3d-druck",
    "injection-molding": "spritzguss",
    "surface-finish": "oberflaechenveredelung",
    "rapid-prototyping": "rapid-prototyping",
  },
  fr: {
    "services": "services",
    "about": "a-propos",
    "contact": "contact",
    "quote": "devis",
    "industries": "industries",
    "our-work": "notre-travail",
    "blog": "blog",
    "cnc-machining": "usinage-cnc",
    "sheet-metal": "tolerie",
    "3d-printing": "impression-3d",
    "injection-molding": "moulage-par-injection",
    "surface-finish": "finition-de-surface",
    "rapid-prototyping": "prototypage-rapide",
  },
  es: {
    "services": "servicios",
    "about": "acerca-de",
    "contact": "contacto",
    "quote": "cotizacion",
    "industries": "industrias",
    "our-work": "nuestro-trabajo",
    "blog": "blog",
    "cnc-machining": "mecanizado-cnc",
    "sheet-metal": "chapa-metalica",
    "3d-printing": "impresion-3d",
    "injection-molding": "moldeo-por-inyeccion",
    "surface-finish": "acabado-de-superficie",
    "rapid-prototyping": "prototipado-rapido",
  },
  it: {
    "services": "servizi",
    "about": "chi-siamo",
    "contact": "contatto",
    "quote": "preventivo",
    "industries": "settori",
    "our-work": "il-nostro-lavoro",
    "blog": "blog",
    "cnc-machining": "lavorazione-cnc",
    "sheet-metal": "lavorazione-lamiera",
    "3d-printing": "stampa-3d",
    "injection-molding": "stampaggio-ad-iniezione",
    "surface-finish": "finitura-superficiale",
    "rapid-prototyping": "prototipazione-rapida",
  },
  nl: {
    "services": "diensten",
    "about": "over-ons",
    "contact": "contact",
    "quote": "offerte",
    "industries": "industrieen",
    "our-work": "ons-werk",
    "blog": "blog",
    "cnc-machining": "cnc-bewerking",
    "sheet-metal": "plaatbewerking",
    "3d-printing": "3d-printen",
    "injection-molding": "spuitgieten",
    "surface-finish": "oppervlakteafwerking",
    "rapid-prototyping": "rapid-prototyping",
  },
  pl: {
    "services": "uslugi",
    "about": "o-nas",
    "contact": "kontakt",
    "quote": "wycena",
    "industries": "branze",
    "our-work": "nasza-praca",
    "blog": "blog",
    "cnc-machining": "obrobka-cnc",
    "sheet-metal": "obrobka-blaszek",
    "3d-printing": "drukowanie-3d",
    "injection-molding": "formowanie-wtryskowe",
    "surface-finish": "wykończenie-powierzchni",
    "rapid-prototyping": "szybkie-prototypowanie",
  },
  sv: {
    "services": "tjanster",
    "about": "om-oss",
    "contact": "kontakt",
    "quote": "offert",
    "industries": "branscher",
    "our-work": "vart-arbete",
    "blog": "blog",
    "cnc-machining": "cnc-bearbetning",
    "sheet-metal": "platarbe",
    "3d-printing": "3d-utskrift",
    "injection-molding": "spjutsgjutning",
    "surface-finish": "ytbehandling",
    "rapid-prototyping": "snabbprototypning",
  },
  da: {
    "services": "tjenester",
    "about": "om-os",
    "contact": "kontakt",
    "quote": "tilbud",
    "industries": "brancher",
    "our-work": "vores-arbejde",
    "blog": "blog",
    "cnc-machining": "cnc-bearbejdning",
    "sheet-metal": "pladearbejde",
    "3d-printing": "3d-print",
    "injection-molding": "spjutsgodsning",
    "surface-finish": "overfladebehandling",
    "rapid-prototyping": "hurtig-prototypning",
  },
  fi: {
    "services": "palvelut",
    "about": "meista",
    "contact": "yhteystiedot",
    "quote": "tarjous",
    "industries": "toimialat",
    "our-work": "tyomme",
    "blog": "blog",
    "cnc-machining": "cnc-koneistus",
    "sheet-metal": "levytyo",
    "3d-printing": "3d-tulostus",
    "injection-molding": "ruiskumuovaus",
    "surface-finish": "pintakasittely",
    "rapid-prototyping": "nopea-prototyypointi",
  },
  cs: {
    "services": "sluzby",
    "about": "o-nas",
    "contact": "kontakt",
    "quote": "nabidka",
    "industries": "odvetvi",
    "our-work": "nase-prace",
    "blog": "blog",
    "cnc-machining": "cnc-obrabeni",
    "sheet-metal": "obrabeni-plechu",
    "3d-printing": "3d-tisk",
    "injection-molding": "vstrikovani",
    "surface-finish": "uprava-povrchu",
    "rapid-prototyping": "rychle-prototypovani",
  },
  hu: {
    "services": "szolgaltatasok",
    "about": "rolunk",
    "contact": "kapcsolat",
    "quote": "ajanlat",
    "industries": "iparagak",
    "our-work": "munkank",
    "blog": "blog",
    "cnc-machining": "cnc-megmunkalas",
    "sheet-metal": "lemezfeldolgozas",
    "3d-printing": "3d-nyomtatas",
    "injection-molding": "injekcios-ontes",
    "surface-finish": "feluletkezeles",
    "rapid-prototyping": "gyors-prototipus",
  },
  pt: {
    "services": "servicos",
    "about": "sobre-nos",
    "contact": "contato",
    "quote": "orcamento",
    "industries": "industrias",
    "our-work": "nosso-trabalho",
    "blog": "blog",
    "cnc-machining": "usinagem-cnc",
    "sheet-metal": "chapa-metalica",
    "3d-printing": "impressao-3d",
    "injection-molding": "moldagem-por-injecao",
    "surface-finish": "acabamento-de-superficie",
    "rapid-prototyping": "prototipagem-rapida",
  },
  nb: {
    "services": "tjenester",
    "about": "om-oss",
    "contact": "kontakt",
    "quote": "tilbud",
    "industries": "bransjer",
    "our-work": "vart-arbeid",
    "blog": "blog",
    "cnc-machining": "cnc-bearbeiding",
    "sheet-metal": "platearbeid",
    "3d-printing": "3d-utskrift",
    "injection-molding": "spjutsgjetting",
    "surface-finish": "overflatebehandling",
    "rapid-prototyping": "rask-prototyping",
  },
};

/**
 * Translate a URL path from English to the target language
 */
function translatePath(path: string, language: string): string {
  if (!path || path === "/" || path === "") {
    return "";
  }

  // Remove leading slash
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  
  // Split into segments
  const segments = cleanPath.split("/").filter(Boolean);
  
  // Get translations for this language (fallback to English if not found)
  const translations = SLUG_TRANSLATIONS[language] || SLUG_TRANSLATIONS.en;
  
  // Translate each segment
  const translatedSegments = segments.map(segment => {
    // Check if this segment has a translation
    if (translations[segment]) {
      return translations[segment];
    }
    // No translation found, keep original (e.g., blog article slugs)
    return segment;
  });
  
  return "/" + translatedSegments.join("/");
}

interface Article {
  slug: string;
  language: string;
  updated_at: string;
  translation_id?: string;
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
    .select("slug, language, updated_at, translation_id")
    .eq("status", "published")
    .order("language", { ascending: true })
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("Error fetching articles:", error);
    throw new Error(`Failed to fetch articles: ${error.message}`);
  }

  console.log(`Found ${articles?.length || 0} published articles for sitemap`);
  if (articles && articles.length > 0) {
    console.log(`Sample articles:`, articles.slice(0, 5).map(a => `${a.language}/${a.slug}`));
    // Log language distribution
    const langCounts: Record<string, number> = {};
    for (const article of articles) {
      const lang = (article.language || '').trim().toLowerCase();
      langCounts[lang] = (langCounts[lang] || 0) + 1;
    }
    console.log(`Article language distribution:`, langCounts);
  } else {
    console.warn("⚠️ No published articles found in database. Check if articles exist and have status='published'");
  }

  // Normalize and group articles by language
  // Normalize: trim whitespace and convert to lowercase for consistent matching
  const articlesByLanguage: Record<string, Article[]> = {};
  const languageNormalizationMap: Record<string, string> = {}; // Maps normalized -> original
  
  for (const article of articles || []) {
    // Normalize language code: trim and lowercase
    const normalizedLang = (article.language || '').trim().toLowerCase();
    
    // Store original language for reference
    if (!languageNormalizationMap[normalizedLang]) {
      languageNormalizationMap[normalizedLang] = article.language;
    }
    
    if (!articlesByLanguage[normalizedLang]) {
      articlesByLanguage[normalizedLang] = [];
    }
    articlesByLanguage[normalizedLang].push(article);
  }

  // Log all languages found in articles
  const foundLanguages = Object.keys(articlesByLanguage);
  console.log(`Languages found in articles: ${foundLanguages.join(', ')}`);
  console.log(`Languages to process: ${LANGUAGES.join(', ')}`);
  
  // Check for languages in articles that aren't in LANGUAGES array
  const missingLanguages = foundLanguages.filter(lang => !LANGUAGES.includes(lang));
  if (missingLanguages.length > 0) {
    console.warn(`⚠️ Articles found with languages not in LANGUAGES array: ${missingLanguages.join(', ')}`);
    console.warn(`These articles will be included if their normalized language matches a language in LANGUAGES array`);
  }

  let urlEntries: string[] = [];
  let totalArticlesAdded = 0;

  // Generate sitemap organized by language sections (matching old format)
  for (const lang of LANGUAGES) {
    // Add language section comment
    urlEntries.push(`<!-- ${getLanguageName(lang)} Pages -->`);

    // 1. Static pages for this language (with translated slugs)
    for (const page of STATIC_PAGES) {
      // Translate the path for this language
      const translatedPath = translatePath(page.path, lang);
      const url = `${siteUrl}/${lang}${translatedPath}`;
      urlEntries.push(generateUrlEntry(
        url,
        today,
        page.changefreq,
        page.priority
      ));
    }

    // 2. Blog articles for this language
    // Check both exact match and normalized match
    const normalizedLang = lang.toLowerCase().trim();
    const articlesForLang = articlesByLanguage[lang] || articlesByLanguage[normalizedLang] || [];
    
    if (articlesForLang.length > 0) {
      console.log(`Adding ${articlesForLang.length} blog articles for ${lang}`);
      totalArticlesAdded += articlesForLang.length;
      
      // Translate "blog" slug for this language
      const blogSlug = SLUG_TRANSLATIONS[lang]?.blog || "blog";
      
      for (const article of articlesForLang) {
        const url = `${siteUrl}/${lang}/${blogSlug}/${article.slug}`;
        const lastmod = formatDate(article.updated_at);
        urlEntries.push(generateUrlEntry(
          url,
          lastmod,
          "weekly",
          "0.7"
        ));
      }
    } else {
      console.log(`No blog articles found for language: ${lang} (checked keys: ${lang}, ${normalizedLang})`);
    }
  }

  // Log summary
  console.log(`Total articles added to sitemap: ${totalArticlesAdded} out of ${articles?.length || 0} published articles`);
  if (totalArticlesAdded < (articles?.length || 0)) {
    const missing = (articles?.length || 0) - totalArticlesAdded;
    console.warn(`⚠️ ${missing} articles were not included in sitemap. Check language codes match LANGUAGES array.`);
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
  const normalizedLang = lang.toLowerCase().trim();

  // Fetch articles for this language
  // First try exact match, then filter for normalized matches
  const { data: articles, error } = await supabase
    .from("articles")
    .select("slug, language, updated_at")
    .eq("status", "published")
    .order("updated_at", { ascending: false });

  if (error) {
    console.error(`Error fetching articles:`, error);
    throw new Error(`Failed to fetch articles: ${error.message}`);
  }

  // Filter articles by normalized language code (case-insensitive)
  const filteredArticles = (articles || []).filter(article => {
    const articleLang = (article.language || '').trim().toLowerCase();
    return articleLang === normalizedLang || articleLang === lang.toLowerCase();
  });

  console.log(`Found ${filteredArticles.length} articles for language ${lang} (from ${articles?.length || 0} total published)`);

  let urlEntries: string[] = [];

  // Add language section comment
  urlEntries.push(`<!-- ${getLanguageName(lang)} Pages -->`);

  // Static pages for this language (with translated slugs)
  for (const page of STATIC_PAGES) {
    // Translate the path for this language
    const translatedPath = translatePath(page.path, lang);
    const url = `${siteUrl}/${lang}${translatedPath}`;
    urlEntries.push(generateUrlEntry(url, today, page.changefreq, page.priority));
  }

  // Blog articles for this language
  // Translate "blog" slug for this language
  const blogSlug = SLUG_TRANSLATIONS[lang]?.blog || "blog";
  
  for (const article of filteredArticles) {
    const url = `${siteUrl}/${lang}/${blogSlug}/${article.slug}`;
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
