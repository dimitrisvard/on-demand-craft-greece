/**
 * Funding Scanner API
 * POST /api/scan-funding
 * Body: { priority?: 1|2|3 }  — optional, scan only feeds at/above this priority
 *
 * Fetches European startup funding RSS/Atom feeds, classifies articles for
 * hardware relevance, and stores new funded startup leads in Supabase.
 *
 * Architecture: Node.js Fetch + Regex — NO external XML or parsing deps.
 */

import { createClient } from '@supabase/supabase-js';

// ─── CORS ────────────────────────────────────────────────────
function setCors(res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');
}

// ─── Supabase ─────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

// ─── Keyword definitions ──────────────────────────────────────

const HARDWARE_PRIMARY = [
  'robotics', 'robot', 'robotic',
  'medtech', 'medical device', 'medical technology', 'healthtech hardware',
  'automotive', 'electric vehicle', 'e-mobility',
  'aerospace', 'space', 'satellite', 'drone', 'uav',
  'cleantech', 'clean technology', 'energy storage', 'battery',
  'consumer electronics', 'wearable', 'iot', 'internet of things',
  'industrial automation', 'industrial iot',
  'defense', 'defence', 'security hardware',
  'semiconductor', 'chip', 'sensor',
  'hardware startup', 'deeptech', 'deep tech',
  '3d printing', 'additive manufacturing',
];

const HARDWARE_SECONDARY = [
  'agritech', 'agriculture technology', 'foodtech',
  'biotech', 'biotechnology', 'life science',
  'marine', 'maritime', 'ocean technology',
  'quantum', 'photonics', 'optics',
  'energy', 'solar', 'wind', 'hydrogen',
  'mobility', 'logistics hardware',
];

const FUNDING_KEYWORDS = [
  'raises', 'raised', 'secures', 'secured', 'closes', 'closed',
  'funding', 'funding round', 'investment',
  'seed round', 'pre-seed', 'series a', 'series b', 'series c',
  'million', 'mln', 'mn',
  'venture', 'backed',
  'grant', 'eic', 'horizon',
];

const EXCLUDE_KEYWORDS = [
  'saas', 'software-as-a-service',
  'mobile app only', 'social media platform',
  'dating app', 'food delivery app',
  'cryptocurrency', 'blockchain token', 'nft',
  'ad tech', 'martech', 'marketing automation',
  'recruitment platform', 'hr software',
];

const HARDWARE_BOOST_TERMS = [
  'prototype', 'manufacturing', 'physical product',
  'device', 'machine', 'component', 'assembly',
  'factory', 'production line', 'supply chain', 'pilot production',
  'fda', 'ce marking', 'certification', 'iso',
];

// ─── Utility: fetch with retry ────────────────────────────────
async function fetchWithRetry(url, maxRetries = 2, timeoutMs = 10000) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'MiconsHub-FundingScanner/1.0 (+https://micronshub.eu)' },
      });
      clearTimeout(timer);
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return await response.text();
    } catch (err) {
      if (attempt === maxRetries) throw err;
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
}

// ─── Utility: strip HTML tags and clean text ─────────────────
function cleanText(raw) {
  return raw
    .replace(/<!\[CDATA\[/g, '')
    .replace(/\]\]>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ─── RSS / Atom parser ────────────────────────────────────────
function parseRssFeed(xml) {
  const items = [];

  // Detect Atom vs RSS
  const isAtom = xml.includes('<feed') && xml.includes('<entry>');
  const blockRe = isAtom
    ? /<entry>([\s\S]*?)<\/entry>/gi
    : /<item>([\s\S]*?)<\/item>/gi;

  let match;
  while ((match = blockRe.exec(xml)) !== null) {
    const block = match[1];

    // Title
    const titleM = block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
    const title = titleM ? cleanText(titleM[1]) : '';

    // Link
    let link = '';
    if (isAtom) {
      const linkM = block.match(/<link[^>]*href="([^"]+)"[^>]*\/?>/i);
      if (linkM) link = linkM[1];
    } else {
      const linkM = block.match(/<link[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i);
      if (linkM) link = cleanText(linkM[1]);
    }

    // Description / summary
    const descM = block.match(/<(?:description|summary)[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/(?:description|summary)>/i);
    const description = descM ? cleanText(descM[1]).substring(0, 1000) : '';

    // content:encoded (full article text)
    const contentM = block.match(/<content:encoded>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/content:encoded>/i);
    const content = contentM ? cleanText(contentM[1]).substring(0, 3000) : '';

    // Publication date
    const dateM = block.match(/<(?:pubDate|published|updated|dc:date)[^>]*>([\s\S]*?)<\/(?:pubDate|published|updated|dc:date)>/i);
    const pubDate = dateM ? dateM[1].trim() : '';

    if (title && link) {
      items.push({ title, link, description, content, pubDate });
    }
  }

  return items;
}

// ─── Funding amount extractor ─────────────────────────────────
function extractFundingAmount(text) {
  const patterns = [
    [/(?:€|EUR\s?)(\d+(?:[.,]\d+)?)\s*(?:M|m|million|mln|mn)/i, 'EUR', 1],
    [/(?:\$|USD\s?)(\d+(?:[.,]\d+)?)\s*(?:M|m|million|mln|mn)/i, 'USD', 1],
    [/(?:£|GBP\s?)(\d+(?:[.,]\d+)?)\s*(?:M|m|million|mln|mn)/i, 'GBP', 1],
    [/(\d+(?:[.,]\d+)?)\s*million\s*(?:euros?|€)/i, 'EUR', 1],
    [/(\d+(?:[.,]\d+)?)\s*million\s*(?:dollars?|\$)/i, 'USD', 1],
    [/(?:€|EUR\s?)(\d+(?:[.,]\d+)?)\s*(?:K|k|thousand)/i, 'EUR', 0.001],
    [/(?:\$|USD\s?)(\d+(?:[.,]\d+)?)\s*(?:K|k|thousand)/i, 'USD', 0.001],
  ];

  for (const [pattern, currency, multiplier] of patterns) {
    const m = text.match(pattern);
    if (m) {
      const num = parseFloat(m[1].replace(',', '.'));
      if (!isNaN(num)) {
        return { amount: parseFloat((num * multiplier).toFixed(3)), currency };
      }
    }
  }
  return null;
}

// ─── Funding stage extractor ──────────────────────────────────
function extractFundingStage(text) {
  const lower = text.toLowerCase();
  if (lower.includes('pre-seed') || lower.includes('preseed')) return 'pre-seed';
  if (lower.includes('series c')) return 'series-c';
  if (lower.includes('series b')) return 'series-b';
  if (lower.includes('series a')) return 'series-a';
  if (lower.includes('seed')) return 'seed';
  if (lower.includes('grant') || lower.includes('eic') || lower.includes('horizon')) return 'grant';
  if (lower.includes('ipo')) return 'ipo';
  if (lower.includes('bridge')) return 'bridge';
  return 'unknown';
}

// ─── Country extractor ────────────────────────────────────────
function extractCountry(text) {
  const lower = text.toLowerCase();
  const countryMap = {
    DE: ['germany', 'german', 'berlin', 'munich', 'hamburg', 'frankfurt', 'stuttgart', 'cologne'],
    FR: ['france', 'french', 'paris', 'lyon', 'toulouse', 'marseille', 'bordeaux', 'grenoble'],
    NL: ['netherlands', 'dutch', 'amsterdam', 'rotterdam', 'eindhoven', 'delft', 'utrecht'],
    SE: ['sweden', 'swedish', 'stockholm', 'gothenburg', 'malmö', 'malmoe'],
    FI: ['finland', 'finnish', 'helsinki', 'espoo', 'tampere'],
    DK: ['denmark', 'danish', 'copenhagen', 'aarhus'],
    NO: ['norway', 'norwegian', 'oslo', 'bergen', 'trondheim'],
    ES: ['spain', 'spanish', 'madrid', 'barcelona', 'valencia', 'bilbao'],
    IT: ['italy', 'italian', 'milan', 'rome', 'turin', 'bologna', 'genoa'],
    BE: ['belgium', 'belgian', 'brussels', 'antwerp', 'ghent', 'leuven', 'liege'],
    AT: ['austria', 'austrian', 'vienna', 'graz', 'linz'],
    CH: ['switzerland', 'swiss', 'zurich', 'geneva', 'basel', 'lausanne', 'bern'],
    IE: ['ireland', 'irish', 'dublin', 'cork', 'galway'],
    PT: ['portugal', 'portuguese', 'lisbon', 'porto'],
    PL: ['poland', 'polish', 'warsaw', 'krakow', 'wroclaw', 'gdansk'],
    CZ: ['czech', 'prague', 'brno'],
    EE: ['estonia', 'estonian', 'tallinn'],
    LT: ['lithuania', 'lithuanian', 'vilnius'],
    LV: ['latvia', 'latvian', 'riga'],
    GR: ['greece', 'greek', 'athens', 'thessaloniki'],
    UK: ['united kingdom', 'british', 'london', 'cambridge', 'oxford', 'bristol', 'edinburgh', 'manchester', 'uk-based', 'uk based'],
    RO: ['romania', 'romanian', 'bucharest', 'cluj'],
    HU: ['hungary', 'hungarian', 'budapest'],
    HR: ['croatia', 'croatian', 'zagreb'],
    BG: ['bulgaria', 'bulgarian', 'sofia'],
    SI: ['slovenia', 'slovenian', 'ljubljana'],
    SK: ['slovakia', 'slovak', 'bratislava'],
    LU: ['luxembourg'],
    CY: ['cyprus', 'nicosia', 'limassol'],
    MT: ['malta', 'maltese'],
    IL: ['israel', 'israeli', 'tel aviv', 'tel-aviv'],
  };

  for (const [code, patterns] of Object.entries(countryMap)) {
    if (patterns.some(p => lower.includes(p))) return code;
  }
  return 'EU';
}

// ─── Company name extractor ───────────────────────────────────
function extractCompanyName(title) {
  const patterns = [
    /^([A-Z][A-Za-z0-9\s.\-&']+?)\s+(?:raises?|secures?|closes?|lands?|bags?|nabs?|gets?|receives?|announces?)\b/i,
    /\b([A-Z][A-Za-z0-9\s.\-&']{2,30}),?\s+a\s+(?:robotics?|medtech|hardware|software|deep\s*tech|startup)\b/i,
    /(?:startup|company|firm)\s+([A-Z][A-Za-z0-9\s.\-&']+?)\s+(?:raises?|secures?)/i,
  ];

  for (const pattern of patterns) {
    const m = title.match(pattern);
    if (m) {
      const name = m[1].trim().replace(/\s+/g, ' ');
      if (name.length > 1 && name.length < 60) return name;
    }
  }
  return null;
}

// ─── Industry tag extractor ───────────────────────────────────
function extractIndustryTags(text) {
  const lower = text.toLowerCase();
  const tags = [];
  if (lower.includes('robot')) tags.push('robotics');
  if (lower.includes('medtech') || lower.includes('medical device') || lower.includes('medical technology')) tags.push('medtech');
  if (lower.includes('automotive') || lower.includes('electric vehicle') || lower.includes(' ev ')) tags.push('automotive');
  if (lower.includes('aerospace') || lower.includes(' space ') || lower.includes('satellite')) tags.push('aerospace');
  if (lower.includes('drone') || lower.includes('uav')) tags.push('drones');
  if (lower.includes('cleantech') || lower.includes('clean tech') || lower.includes('clean energy')) tags.push('cleantech');
  if (lower.includes('battery') || lower.includes('energy storage')) tags.push('energy-storage');
  if (lower.includes('solar') || lower.includes('wind') || lower.includes('hydrogen')) tags.push('renewable-energy');
  if (lower.includes('consumer electronics') || lower.includes('wearable')) tags.push('consumer-electronics');
  if (lower.includes('iot') || lower.includes('internet of things')) tags.push('iot');
  if (lower.includes('defense') || lower.includes('defence')) tags.push('defense');
  if (lower.includes('agritech') || lower.includes('agriculture tech')) tags.push('agritech');
  if (lower.includes('biotech') || lower.includes('life science')) tags.push('biotech');
  if (lower.includes('industrial') || lower.includes('automation')) tags.push('industrial');
  if (lower.includes('semiconductor') || lower.includes('chip')) tags.push('semiconductor');
  if (lower.includes('marine') || lower.includes('maritime')) tags.push('marine');
  if (lower.includes('deeptech') || lower.includes('deep tech')) tags.push('deeptech');
  if (lower.includes('photon') || lower.includes('optics') || lower.includes('quantum')) tags.push('photonics');
  return [...new Set(tags)]; // deduplicate
}

// ─── Article classifier ───────────────────────────────────────
function classifyArticle(title, description, content = '') {
  const fullText = `${title} ${description} ${content}`;
  const lower = fullText.toLowerCase();

  // Step 1: Must mention funding
  const hasFunding = FUNDING_KEYWORDS.some(kw => lower.includes(kw));
  if (!hasFunding) {
    return { isRelevant: false, isHardware: false, hardwareConfidence: 0, matchedKeywords: [], industryTags: [], fundingStage: 'unknown', fundingAmount: null, countryCode: 'EU' };
  }

  // Step 2: Check keyword matches
  const matchedPrimary = HARDWARE_PRIMARY.filter(kw => lower.includes(kw));
  const matchedSecondary = HARDWARE_SECONDARY.filter(kw => lower.includes(kw));
  const allMatched = [...matchedPrimary, ...matchedSecondary];

  // Step 3: Confidence score
  let confidence = 0;
  confidence += matchedPrimary.length * 20;
  confidence += matchedSecondary.length * 10;
  if (EXCLUDE_KEYWORDS.some(kw => lower.includes(kw))) confidence -= 30;
  const boostMatches = HARDWARE_BOOST_TERMS.filter(t => lower.includes(t));
  confidence += boostMatches.length * 5;
  confidence = Math.max(0, Math.min(100, confidence));

  const isRelevant = hasFunding && allMatched.length > 0;
  const isHardware = confidence >= 30;

  return {
    isRelevant,
    isHardware,
    hardwareConfidence: confidence,
    matchedKeywords: allMatched.slice(0, 20),
    industryTags: extractIndustryTags(fullText),
    fundingStage: extractFundingStage(fullText),
    fundingAmount: extractFundingAmount(fullText),
    countryCode: extractCountry(fullText),
  };
}

// ─── Website finder from article HTML ────────────────────────
async function findCompanyWebsite(articleUrl, companyName) {
  try {
    const html = await fetchWithRetry(articleUrl, 1, 8000);
    const lower = html.toLowerCase();

    // Domains to skip (news sites, social media, etc.)
    const skipDomains = [
      'twitter.com', 'x.com', 'linkedin.com', 'facebook.com', 'instagram.com',
      'youtube.com', 'crunchbase.com', 'tech.eu', 'techcrunch.com',
      'eu-startups.com', 'sifted.eu', 'siliconcanals.com', 'deutsche-startups.de',
      'maddyness.com', 'uktech.news', 'elevategreece.gov.gr',
      'wikipedia.org', 'google.com', 'angel.co', 'pitchbook.com',
    ];

    const linkRe = /href="(https?:\/\/[^"#]{5,80})"/gi;
    let m;
    const candidates = [];

    while ((m = linkRe.exec(html)) !== null) {
      const url = m[1];
      try {
        const domain = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
        if (skipDomains.some(d => domain.includes(d))) continue;
        candidates.push({ url, domain });
      } catch { /* invalid URL */ }
    }

    if (companyName) {
      const tokens = companyName.toLowerCase().split(/\s+/).filter(t => t.length > 2);
      for (const { url, domain } of candidates) {
        if (tokens.some(token => domain.includes(token))) return url;
      }
    }

    // Return first plausible external link
    return candidates[0]?.url || null;
  } catch {
    return null;
  }
}

// ─── Telegram notification ────────────────────────────────────
async function sendTelegramAlert(startup) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return;

  const flagMap = {
    DE: '🇩🇪', FR: '🇫🇷', NL: '🇳🇱', SE: '🇸🇪', FI: '🇫🇮', DK: '🇩🇰',
    NO: '🇳🇴', ES: '🇪🇸', IT: '🇮🇹', BE: '🇧🇪', AT: '🇦🇹', CH: '🇨🇭',
    IE: '🇮🇪', PT: '🇵🇹', PL: '🇵🇱', CZ: '🇨🇿', EE: '🇪🇪', LT: '🇱🇹',
    LV: '🇱🇻', GR: '🇬🇷', UK: '🇬🇧', RO: '🇷🇴', HU: '🇭🇺', HR: '🇭🇷',
    BG: '🇧🇬', SI: '🇸🇮', SK: '🇸🇰', LU: '🇱🇺', CY: '🇨🇾', MT: '🇲🇹',
    IL: '🇮🇱', EU: '🇪🇺',
  };

  const flag = flagMap[startup.country_code] || '🌍';
  const conf = startup.hardware_confidence;
  const confEmoji = conf >= 70 ? '🟢' : conf >= 40 ? '🟡' : '🟠';
  const amount = startup.funding_amount_millions
    ? `${startup.funding_currency}${startup.funding_amount_millions}M`
    : 'undisclosed';
  const stage = startup.funding_stage !== 'unknown' ? ` ${startup.funding_stage}` : '';
  const website = startup.company_website ? `\n🌐 ${startup.company_website}` : '';
  const tags = (startup.industry_tags || []).slice(0, 4).join(', ');

  const msg = [
    `🚀 FUNDED HARDWARE STARTUP`,
    ``,
    `🏢 Company: ${startup.company_name || 'Unknown'}`,
    `${flag} Country: ${startup.country_code}`,
    `💰 Raised: ${amount}${stage}`,
    `🏷 Industry: ${tags || 'N/A'}`,
    `${confEmoji} Hardware confidence: ${conf}/100`,
    ``,
    `📰 Source: ${startup.source_name}`,
    `📋 "${startup.article_title.substring(0, 200)}"`,
    website,
    `🔑 Keywords: ${(startup.matched_keywords || []).slice(0, 5).join(', ')}`,
    ``,
    `🔗 https://micronshub.eu/dashboard/funded-startups`,
  ].filter(l => l !== null).join('\n');

  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: msg, disable_web_page_preview: true }),
    });
  } catch (err) {
    console.error('[scan-funding] Telegram alert error:', err.message);
  }
}

// ─── Main handler ─────────────────────────────────────────────
export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const maxPriority = parseInt(req.body?.priority || '2', 10) || 2;
  const startedAt = new Date();

  const scanLog = {
    started_at: startedAt.toISOString(),
    feeds_scanned: 0,
    articles_found: 0,
    articles_relevant: 0,
    startups_hardware: 0,
    startups_new: 0,
    errors: [],
  };

  try {
    // Load active feeds up to the requested priority
    const { data: feeds, error: feedErr } = await supabase
      .from('funding_feeds')
      .select('*')
      .eq('is_active', true)
      .lte('priority', maxPriority)
      .order('priority', { ascending: true });

    if (feedErr) throw new Error(`Failed to load feeds: ${feedErr.message}`);
    if (!feeds || feeds.length === 0) {
      return res.status(200).json({ success: true, message: 'No active feeds found', ...scanLog });
    }

    for (const feed of feeds) {
      try {
        console.log(`[scan-funding] Fetching feed: ${feed.name} (${feed.feed_url})`);
        const xml = await fetchWithRetry(feed.feed_url, 2, 12000);
        const items = parseRssFeed(xml);

        scanLog.feeds_scanned++;
        scanLog.articles_found += items.length;

        console.log(`[scan-funding] ${feed.name}: ${items.length} items`);

        for (const item of items) {
          // Dedup by URL
          const { data: existing } = await supabase
            .from('funded_startups')
            .select('id')
            .eq('source_url', item.link)
            .maybeSingle();

          if (existing) continue;

          const classification = classifyArticle(item.title, item.description, item.content);
          if (!classification.isRelevant) continue;

          scanLog.articles_relevant++;
          if (classification.isHardware) scanLog.startups_hardware++;

          const companyName = extractCompanyName(item.title);

          // Find website for high-confidence leads
          let companyWebsite = null;
          if (classification.hardwareConfidence >= 40 && companyName) {
            companyWebsite = await findCompanyWebsite(item.link, companyName);
          }

          const record = {
            source_name: feed.name,
            source_url: item.link,
            article_title: item.title,
            article_excerpt: item.description ? item.description.substring(0, 500) : null,
            article_published_at: item.pubDate ? new Date(item.pubDate).toISOString() : null,
            company_name: companyName,
            company_website: companyWebsite,
            country_code: classification.countryCode,
            funding_amount_millions: classification.fundingAmount?.amount || null,
            funding_currency: classification.fundingAmount?.currency || 'EUR',
            funding_stage: classification.fundingStage,
            industry_tags: classification.industryTags,
            is_hardware: classification.isHardware,
            hardware_confidence: classification.hardwareConfidence,
            matched_keywords: classification.matchedKeywords,
          };

          const { data: inserted, error: insertErr } = await supabase
            .from('funded_startups')
            .insert(record)
            .select('id, company_name, hardware_confidence, country_code, funding_stage, funding_amount_millions, funding_currency, industry_tags, matched_keywords, source_name, article_title, company_website')
            .single();

          if (insertErr) {
            // Could be a race-condition duplicate — skip silently
            if (!insertErr.message.includes('duplicate') && !insertErr.message.includes('unique')) {
              console.error(`[scan-funding] Insert error:`, insertErr.message);
              scanLog.errors.push(insertErr.message);
            }
            continue;
          }

          scanLog.startups_new++;

          // Telegram notification for high-confidence hardware leads
          if (classification.hardwareConfidence >= 60 && inserted) {
            await sendTelegramAlert(inserted);
          }
        }

        // Update feed last_fetched_at
        await supabase
          .from('funding_feeds')
          .update({
            last_fetched_at: new Date().toISOString(),
            last_item_count: items.length,
            error_count: 0,
            last_error: null,
          })
          .eq('id', feed.id);

      } catch (feedErr) {
        console.error(`[scan-funding] Feed error for ${feed.name}:`, feedErr.message);
        scanLog.errors.push(`${feed.name}: ${feedErr.message}`);

        await supabase
          .from('funding_feeds')
          .update({
            error_count: (feed.error_count || 0) + 1,
            last_error: feedErr.message,
            last_fetched_at: new Date().toISOString(),
          })
          .eq('id', feed.id);
      }

      // Rate limit between feeds
      await new Promise(r => setTimeout(r, 1500));
    }

    // Write scan log
    const durationMs = Date.now() - startedAt.getTime();
    await supabase.from('funding_scan_logs').insert({
      ...scanLog,
      duration_ms: durationMs,
      completed_at: new Date().toISOString(),
    });

    return res.status(200).json({
      success: true,
      feeds_scanned: scanLog.feeds_scanned,
      articles_found: scanLog.articles_found,
      articles_relevant: scanLog.articles_relevant,
      startups_hardware: scanLog.startups_hardware,
      startups_new: scanLog.startups_new,
      errors: scanLog.errors,
      duration_ms: durationMs,
    });

  } catch (err) {
    console.error('[scan-funding] Fatal error:', err);
    const durationMs = Date.now() - startedAt.getTime();
    scanLog.errors.push(err.message);

    await supabase.from('funding_scan_logs').insert({
      ...scanLog,
      duration_ms: durationMs,
      completed_at: new Date().toISOString(),
    }).catch(() => {});

    return res.status(500).json({ error: err.message });
  }
}
