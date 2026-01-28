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

// Generate hashtags using Gemini API
async function generateHashtags(
  title: string,
  excerpt: string,
  content: string
): Promise<string[]> {
  try {
    // Extract first 500 words of content (remove HTML tags)
    const textContent = content.replace(/<[^>]*>/g, '').substring(0, 2000);
    
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

    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`;
    
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
    
    // Parse hashtags from response (one per line, without #)
    const hashtagsText = candidate.content.parts[0].text.trim();
    const hashtags = hashtagsText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => line.startsWith('#') ? line.substring(1) : line)
      .slice(0, 10); // Limit to 10 hashtags
    
    return hashtags;
  } catch (error: any) {
    console.error('Error generating hashtags:', error);
    // Return default hashtags if generation fails
    return ['Manufacturing', 'CNCMachining', 'Engineering', 'Greece', 'IndustrialDesign'];
  }
}

// Format post content for social media
function formatPostContent(
  excerpt: string,
  articleUrl: string,
  hashtags: string[]
): string {
  const hashtagsText = hashtags.map(tag => `#${tag}`).join(' ');
  
  return `${excerpt}

Read the full article: ${articleUrl}

${hashtagsText}`;
}

// Post to Facebook
async function postToFacebook(
  pageId: string,
  accessToken: string,
  message: string,
  link: string
): Promise<{ success: boolean; postId?: string; error?: string }> {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${pageId}/feed`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          link,
          access_token: accessToken,
        }),
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

// Post to LinkedIn
async function postToLinkedIn(
  orgId: string,
  accessToken: string,
  text: string,
  articleUrl: string
): Promise<{ success: boolean; postId?: string; error?: string }> {
  try {
    const response = await fetch('https://api.linkedin.com/v2/ugcPosts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify({
        author: `urn:li:organization:${orgId}`,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: {
              text: text,
            },
            shareMediaCategory: 'ARTICLE',
            media: [{
              status: 'READY',
              description: {
                text: text.substring(0, 200),
              },
              originalUrl: articleUrl,
            }],
          },
        },
        visibility: {
          'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
        },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      const errorMsg = data.message || data.error?.message || `LinkedIn API error: ${response.status}`;
      console.error('LinkedIn posting error:', errorMsg);
      return { success: false, error: errorMsg };
    }

    // LinkedIn returns the post ID in the response
    const postId = data.id || data.entity || undefined;
    return { success: true, postId };
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
    // Validate environment variables
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase configuration");
    }

    if (!geminiApiKey) {
      throw new Error("GEMINI_API_KEY not configured");
    }

    // Parse request body
    const { article_id } = await req.json();

    if (!article_id) {
      return new Response(
        JSON.stringify({ error: "article_id is required" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

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

    // Build article URL
    const articleUrl = `${siteUrl}/${article.language}/blog/${article.slug}`;

    // Generate hashtags
    console.log('Generating hashtags...');
    const hashtags = await generateHashtags(
      article.title,
      article.excerpt || '',
      article.content
    );

    // Format post content
    const postContent = formatPostContent(
      article.excerpt || article.title,
      articleUrl,
      hashtags
    );

    const results: {
      facebook?: { success: boolean; postId?: string; error?: string };
      linkedin?: { success: boolean; postId?: string; error?: string };
    } = {};

    // Post to Facebook
    if (facebookPageId && facebookAccessToken) {
      console.log('Posting to Facebook...');
      results.facebook = await postToFacebook(
        facebookPageId,
        facebookAccessToken,
        postContent,
        articleUrl
      );
    } else {
      console.warn('Facebook credentials not configured');
      results.facebook = { success: false, error: 'Facebook credentials not configured' };
    }

    // Post to LinkedIn
    if (linkedinOrgId && linkedinAccessToken) {
      console.log('Posting to LinkedIn...');
      results.linkedin = await postToLinkedIn(
        linkedinOrgId,
        linkedinAccessToken,
        postContent,
        articleUrl
      );
    } else {
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
