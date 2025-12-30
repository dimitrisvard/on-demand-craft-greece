/**
 * @deprecated This file is no longer used.
 * 
 * Article translation is now handled by the Supabase Edge Function:
 * /functions/v1/translate-article
 * 
 * The Edge Function uses Gemini AI for proper translation and supports:
 * - Full article translation (all fields: title, content, excerpt, meta)
 * - Optional target_languages parameter for specific languages
 * - Rate limiting protection with exponential backoff
 * - SEO-optimized slug handling (keeps English slugs for consistency)
 * - Internal link localization
 * 
 * Usage from frontend:
 * 
 * const response = await fetch(
 *   `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/translate-article`,
 *   {
 *     method: "POST",
 *     headers: {
 *       "Content-Type": "application/json",
 *       "Authorization": `Bearer ${token}`,
 *     },
 *     body: JSON.stringify({ 
 *       article_id: "uuid",
 *       target_languages: ["de", "fr"] // Optional: specific languages, or omit for all
 *     }),
 *   }
 * );
 */

export {}; // Empty export to keep TypeScript happy
