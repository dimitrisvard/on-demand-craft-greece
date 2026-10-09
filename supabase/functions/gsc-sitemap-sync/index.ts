import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SITEMAP_URL = "https://www.micronshub.eu/sitemap-complete.xml";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

interface BlogUrl {
  url: string;
  label: string;
  language: string;
  service_type: string;
  priority: number;
}

function extractBlogUrls(xml: string): BlogUrl[] {
  const urls: BlogUrl[] = [];
  const locRegex = /<loc>([^<]+)<\/loc>/g;
  let match;

  while ((match = locRegex.exec(xml)) !== null) {
    const url = match[1].trim();
    if (!url.includes("/blog/")) continue;

    // Extract language from /{lang}/blog/ pattern
    const pathPart = url.replace("https://www.micronshub.eu/", "");
    const parts = pathPart.split("/");
    const lang = parts[0];
    const slug = parts[parts.length - 1] || parts[parts.length - 2];

    // Create label from slug
    const label = slug
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c: string) => c.toUpperCase())
      .substring(0, 80);

    urls.push({
      url,
      label,
      language: lang,
      service_type: "blog",
      priority: 5,
    });
  }

  return urls;
}

Deno.serve(async (req: Request) => {
  try {
    // Fetch sitemap
    const sitemapRes = await fetch(SITEMAP_URL);
    if (!sitemapRes.ok) {
      return new Response(
        JSON.stringify({ error: `Failed to fetch sitemap: ${sitemapRes.status}` }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
    const xml = await sitemapRes.text();

    // Parse blog URLs
    const blogUrls = extractBlogUrls(xml);

    if (blogUrls.length === 0) {
      return new Response(
        JSON.stringify({ message: "No blog URLs found in sitemap", synced: 0 }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // Connect to Supabase with service role key (bypasses RLS)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get existing URLs to find new ones
    const { data: existing } = await supabase
      .from("gsc_monitored_urls")
      .select("url")
      .eq("service_type", "blog");

    const existingSet = new Set((existing || []).map((r: { url: string }) => r.url));
    const newUrls = blogUrls.filter((u) => !existingSet.has(u.url));

    let inserted = 0;
    if (newUrls.length > 0) {
      // Insert in batches of 50
      for (let i = 0; i < newUrls.length; i += 50) {
        const batch = newUrls.slice(i, i + 50);
        const { error } = await supabase
          .from("gsc_monitored_urls")
          .upsert(batch, { onConflict: "url", ignoreDuplicates: true });

        if (error) {
          console.error(`Batch insert error at offset ${i}:`, error);
        } else {
          inserted += batch.length;
        }
      }
    }

    // Also detect URLs that were removed from sitemap
    const sitemapSet = new Set(blogUrls.map((u) => u.url));
    const removedUrls = (existing || [])
      .filter((r: { url: string }) => !sitemapSet.has(r.url))
      .map((r: { url: string }) => r.url);

    return new Response(
      JSON.stringify({
        message: "Sitemap sync complete",
        sitemap_blog_count: blogUrls.length,
        existing_blog_count: existingSet.size,
        new_urls_inserted: inserted,
        removed_from_sitemap: removedUrls.length,
        removed_urls_sample: removedUrls.slice(0, 10),
        languages: [...new Set(blogUrls.map((u) => u.language))].sort(),
        by_language: Object.fromEntries(
          [...new Set(blogUrls.map((u) => u.language))]
            .sort()
            .map((lang) => [lang, blogUrls.filter((u) => u.language === lang).length])
        ),
      }),
      {
        headers: {
          "Content-Type": "application/json",
          Connection: "keep-alive",
        },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
