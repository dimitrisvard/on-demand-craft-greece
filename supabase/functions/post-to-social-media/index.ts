import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const geminiApiKey = Deno.env.get("GEMINI_API_KEY")!;
const siteUrl = Deno.env.get("SITE_URL") || "https://www.micronshub.eu";
const facebookPageId = Deno.env.get("FACEBOOK_PAGE_ID");
const facebookAccessToken = Deno.env.get("FACEBOOK_ACCESS_TOKEN");
const linkedinOrgId = Deno.env.get("LINKEDIN_ORG_ID");
const linkedinAccessToken = Deno.env.get("LINKEDIN_ACCESS_TOKEN");

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  error?: { message: string };
}

// Fetch the English version of an article using translation_id
async function fetchEnglishVersion(article: any): Promise<any> {
  // If already English, return as-is
  if (article.language === 'en') {
    return article;
  }

  // Try to find the English translation via translation_id
  if (article.translation_id) {
    const { data: englishArticle, error } = await supabase
      .from('articles')
      .select('*')
      .eq('translation_id', article.translation_id)
      .eq('language', 'en')
      .single();

    if (!error && englishArticle) {
      console.log(`Found English version (id: ${englishArticle.id}) for article ${article.id}`);
      return englishArticle;
    }
    console.warn(`No English translation found for translation_id: ${article.translation_id}`);
  }

  // Fallback: return the original article
  console.warn(`Using original ${article.language} article as fallback`);
  return article;
}

// Strip HTML tags and get plain text
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

// Generate a social media excerpt from the article content
function generateSocialExcerpt(article: any): string {
  // Priority: excerpt > meta_description > first ~300 chars of stripped content > title
  if (article.excerpt && article.excerpt.trim()) {
    return article.excerpt.trim();
  }
  if (article.meta_description && article.meta_description.trim()) {
    return article.meta_description.trim();
  }
  if (article.content) {
    const plainText = stripHtml(article.content);
    if (plainText.length > 300) {
      // Cut at the last complete sentence or word within 300 chars
      const truncated = plainText.substring(0, 300);
      const lastSentence = truncated.lastIndexOf('.');
      const lastSpace = truncated.lastIndexOf(' ');
      const cutAt = lastSentence > 200 ? lastSentence + 1 : lastSpace > 0 ? lastSpace : 300;
      return truncated.substring(0, cutAt) + '...';
    }
    return plainText;
  }
  return article.title;
}

// Generate hashtags using Gemini API
async function generateHashtags(
  title: string,
  excerpt: string,
  content: string
): Promise<string[]> {
  try {
    const textContent = stripHtml(content).substring(0, 2000);

    const prompt = `Analyze this blog article and generate 5-10 relevant hashtags for social media posting.

Title: ${title}
Excerpt: ${excerpt}
Content: ${textContent}

Generate hashtags that are:
- Relevant to manufacturing/CNC/engineering topics
- Industry-standard terms
- Appropriate for both Facebook and LinkedIn
- Mix of broad and specific tags

    Return only the hashtags, one per line, without # prefix.`;

    // gemini-2.0-flash is deprecated (shutdown 2026-06-01); migrate to 2.5-flash.
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 500,
        },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${err.substring(0, 200)}`);
    }

    const data: GeminiResponse = await response.json();
    if (data.error) throw new Error(`Gemini error: ${data.error.message}`);

    const candidate = data.candidates?.[0];
    if (!candidate?.content?.parts?.[0]?.text) {
      throw new Error("Empty Gemini response");
    }

    const hashtagsText = candidate.content.parts[0].text.trim();
    const hashtags = hashtagsText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => line.startsWith('#') ? line.substring(1) : line)
      .slice(0, 10);

    return hashtags;
  } catch (error: any) {
    console.error('Error generating hashtags:', error);
    return ['Manufacturing', 'CNCMachining', 'Engineering', 'Greece', 'IndustrialDesign'];
  }
}

// Format post content for social media
function formatPostContent(
  text: string,
  articleUrl: string,
  hashtags: string[]
): string {
  const hashtagsText = hashtags.map(tag => `#${tag}`).join(' ');

  // Enforce LinkedIn's 3000 char limit (leave room for URL and hashtags)
  const urlPart = `\n\nRead the full article: ${articleUrl}`;
  const hashPart = `\n\n${hashtagsText}`;
  const maxTextLen = 3000 - urlPart.length - hashPart.length;
  const trimmedText = text.length > maxTextLen ? text.substring(0, maxTextLen - 3) + '...' : text;

  return `${trimmedText}${urlPart}${hashPart}`;
}

// Post to Facebook using Graph API v21.0
async function postToFacebook(
  pageId: string,
  accessToken: string,
  message: string,
  link: string,
  imageUrl?: string
): Promise<{ success: boolean; postId?: string; error?: string }> {
  try {
    const body: any = {
      message,
      link,
      access_token: accessToken,
    };

    const response = await fetch(
      `https://graph.facebook.com/v21.0/${pageId}/feed`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      const errorMsg = data.error?.message || `Facebook API error: ${response.status}`;
      console.error('Facebook posting error:', errorMsg);
      return { success: false, error: errorMsg };
    }

    return { success: true, postId: data.id };
  } catch (error: any) {
    console.error('Facebook posting exception:', error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}

// Post to LinkedIn using the Posts API (replaces deprecated ugcPosts)
async function postToLinkedIn(
  orgId: string,
  accessToken: string,
  text: string,
  articleUrl: string,
  articleTitle?: string,
  imageUrl?: string
): Promise<{ success: boolean; postId?: string; error?: string }> {
  try {
    const response = await fetch('https://api.linkedin.com/rest/posts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
        'LinkedIn-Version': '202401',
      },
      body: JSON.stringify({
        author: `urn:li:organization:${orgId}`,
        commentary: text,
        visibility: 'PUBLIC',
        distribution: {
          feedDistribution: 'MAIN_FEED',
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        content: {
          article: {
            source: articleUrl,
            title: articleTitle || '',
            description: text.substring(0, 200),
            ...(imageUrl ? { thumbnail: imageUrl } : {}),
          },
        },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
      }),
    });

    if (response.status === 201 || response.status === 200) {
      const postUrn = response.headers.get('x-restli-id') || response.headers.get('x-linkedin-id');
      return { success: true, postId: postUrn || undefined };
    }

    const data = await response.json().catch(() => ({}));
    const errorMsg = data.message || data.error?.message || `LinkedIn API error: ${response.status}`;
    console.error('LinkedIn posting error:', errorMsg, JSON.stringify(data));
    return { success: false, error: errorMsg };
  } catch (error: any) {
    console.error('LinkedIn posting exception:', error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase configuration");
    }

    if (!geminiApiKey) {
      throw new Error("GEMINI_API_KEY not configured");
    }

    // Parse request body
    const { article_id, platforms, custom_text } = await req.json();

    if (!article_id) {
      return new Response(
        JSON.stringify({ error: "article_id is required" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    // Determine which platforms to post to (default: both)
    const postToFb = platforms ? platforms.includes('facebook') : true;
    const postToLi = platforms ? platforms.includes('linkedin') : true;

    // Fetch article from database
    const { data: article, error: articleError } = await supabase
      .from('articles')
      .select('*')
      .eq('id', article_id)
      .single();

    if (articleError || !article) {
      return new Response(
        JSON.stringify({ error: "Article not found" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 404,
        }
      );
    }

    // Check if article is published
    if (article.status !== 'published') {
      return new Response(
        JSON.stringify({ error: "Article must be published before posting to social media" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    // Fetch the English version for social media content
    const englishArticle = await fetchEnglishVersion(article);

    // Build the article URL (always link to English version)
    const articleUrl = `${siteUrl}/en/blog/${englishArticle.slug}`;

    // Generate social excerpt from the English version
    const socialExcerpt = generateSocialExcerpt(englishArticle);

    // Generate hashtags from the English version
    console.log('Generating hashtags...');
    const hashtags = await generateHashtags(
      englishArticle.title,
      socialExcerpt,
      englishArticle.content || ''
    );

    // Use custom text if provided, otherwise format from excerpt
    const postContent = custom_text
      ? formatPostContent(custom_text, articleUrl, hashtags)
      : formatPostContent(socialExcerpt, articleUrl, hashtags);

    const featuredImage = englishArticle.featured_image || article.featured_image || undefined;

    const results: {
      facebook?: { success: boolean; postId?: string; error?: string };
      linkedin?: { success: boolean; postId?: string; error?: string };
    } = {};

    // Post to Facebook
    if (postToFb && facebookPageId && facebookAccessToken) {
      console.log('Posting to Facebook...');
      results.facebook = await postToFacebook(
        facebookPageId,
        facebookAccessToken,
        postContent,
        articleUrl,
        featuredImage
      );
    } else if (postToFb) {
      console.warn('Facebook credentials not configured');
      results.facebook = { success: false, error: 'Facebook credentials not configured' };
    }

    // Post to LinkedIn
    if (postToLi && linkedinOrgId && linkedinAccessToken) {
      console.log('Posting to LinkedIn...');
      results.linkedin = await postToLinkedIn(
        linkedinOrgId,
        linkedinAccessToken,
        postContent,
        articleUrl,
        englishArticle.title,
        featuredImage
      );
    } else if (postToLi) {
      console.warn('LinkedIn credentials not configured');
      results.linkedin = { success: false, error: 'LinkedIn credentials not configured' };
    }

    // Update database with posting status
    const updateData: any = {
      social_posted_at: new Date().toISOString(),
    };

    if (results.facebook?.success) {
      updateData.posted_to_facebook = true;
      updateData.facebook_post_id = results.facebook.postId;
    }

    if (results.linkedin?.success) {
      updateData.posted_to_linkedin = true;
      updateData.linkedin_post_id = results.linkedin.postId;
    }

    // Only update if at least one platform succeeded
    if (results.facebook?.success || results.linkedin?.success) {
      const { error: updateError } = await supabase
        .from('articles')
        .update(updateData)
        .eq('id', article_id);

      if (updateError) {
        console.error('Error updating article status:', updateError);
      }
    }

    // Build response
    const postedTo: string[] = [];
    if (results.facebook?.success) postedTo.push('Facebook');
    if (results.linkedin?.success) postedTo.push('LinkedIn');

    const errors: string[] = [];
    if (results.facebook?.error) errors.push(`Facebook: ${results.facebook.error}`);
    if (results.linkedin?.error) errors.push(`LinkedIn: ${results.linkedin.error}`);

    return new Response(
      JSON.stringify({
        success: postedTo.length > 0,
        posted_to: postedTo,
        results,
        errors: errors.length > 0 ? errors : undefined,
        english_article_used: englishArticle.id !== article.id ? englishArticle.id : undefined,
        post_content_preview: postContent.substring(0, 200) + '...',
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: postedTo.length > 0 ? 200 : 500,
      }
    );
  } catch (error: any) {
    console.error('Edge function error:', error);
    return new Response(
      JSON.stringify({
        error: error.message || "Internal server error",
        success: false
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
