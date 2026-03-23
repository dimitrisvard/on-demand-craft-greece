/**
 * Funded Startups API — merged with scanner to stay within Vercel Hobby 12-function limit
 *
 * GET  /api/funded-startups                — Query with filters + pagination
 * GET  /api/funded-startups?action=stats   — Statistics
 * GET  /api/funded-startups?action=feeds   — Feed health status
 * GET  /api/funded-startups?action=export  — CSV download
 * GET  /api/funded-startups?id=<uuid>      — Single record
 * POST /api/funded-startups                — Trigger RSS scan { priority?: 1|2|3 }
 * PATCH /api/funded-startups               — Update outreach status / notes / website
 */

import { createClient } from '@supabase/supabase-js';

// ─── CORS ─────────────────────────────────────────────────────
function setCors(res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');
}

// ─── Supabase ──────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const PAGE_SIZE = 30;

// ─── Main handler ──────────────────────────────────────────────
export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const { action, id } = req.query;
    if (action === 'stats') return handleStats(req, res);
    if (action === 'feeds') return handleFeeds(req, res);
    if (action === 'export') return handleExport(req, res);
    if (id) return handleGetOne(req, res, id);
    return handleList(req, res);
  }

  if (req.method === 'POST') return handleScan(req, res);
  if (req.method === 'PATCH') return handlePatch(req, res);

  return res.status(405).json({ error: 'Method not allowed' });
}

// ══════════════════════════════════════════════════════════════
// GET HANDLERS
// ══════════════════════════════════════════════════════════════

async function handleList(req, res) {
  const {
    industry, country, stage, outreach_status,
    min_confidence = '0', min_amount, is_hardware,
    days_back = '30', page = '0', search, source,
  } = req.query;

  const offset = parseInt(page, 10) * PAGE_SIZE;
  const since = new Date(Date.now() - parseInt(days_back, 10) * 86400 * 1000).toISOString();

  let query = supabase
    .from('funded_startups')
    .select('*', { count: 'exact' })
    .gte('discovered_at', since)
    .gte('hardware_confidence', parseInt(min_confidence, 10))
    .order('discovered_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (industry) query = query.contains('industry_tags', [industry]);
  if (country && country !== 'all') query = query.eq('country_code', country);
  if (stage && stage !== 'all') query = query.eq('funding_stage', stage);
  if (outreach_status && outreach_status !== 'all') query = query.eq('outreach_status', outreach_status);
  if (is_hardware === 'true') query = query.eq('is_hardware', true);
  if (min_amount) query = query.gte('funding_amount_millions', parseFloat(min_amount));
  if (source && source !== 'all') query = query.eq('source_name', source);
  if (search) query = query.or(`article_title.ilike.%${search}%,company_name.ilike.%${search}%`);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ data: data || [], count: count || 0, page: parseInt(page, 10), page_size: PAGE_SIZE });
}

async function handleGetOne(req, res, id) {
  const { data, error } = await supabase.from('funded_startups').select('*').eq('id', id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Not found' });
  return res.status(200).json(data);
}

async function handleStats(req, res) {
  const { days_back = '30' } = req.query;
  const since = new Date(Date.now() - parseInt(days_back, 10) * 86400 * 1000).toISOString();

  const [totalRes, periodRes, hardwareRes, stagedRes, countryRes, outreachRes] = await Promise.all([
    supabase.from('funded_startups').select('id', { count: 'exact', head: true }),
    supabase.from('funded_startups').select('id', { count: 'exact', head: true }).gte('discovered_at', since),
    supabase.from('funded_startups').select('id', { count: 'exact', head: true }).eq('is_hardware', true).gte('discovered_at', since),
    supabase.from('funded_startups').select('funding_stage').gte('discovered_at', since),
    supabase.from('funded_startups').select('country_code').eq('is_hardware', true).gte('discovered_at', since),
    supabase.from('funded_startups').select('outreach_status').gte('discovered_at', since),
  ]);

  const last14 = new Date(Date.now() - 14 * 86400 * 1000).toISOString();
  const { data: dailyData } = await supabase
    .from('funded_startups').select('discovered_at').gte('discovered_at', last14);

  const daily_volume = {};
  (dailyData || []).forEach(r => {
    const day = r.discovered_at.substring(0, 10);
    daily_volume[day] = (daily_volume[day] || 0) + 1;
  });

  const by_stage = {};
  (stagedRes.data || []).forEach(r => { const s = r.funding_stage || 'unknown'; by_stage[s] = (by_stage[s] || 0) + 1; });

  const by_country = {};
  (countryRes.data || []).forEach(r => { const c = r.country_code || 'EU'; by_country[c] = (by_country[c] || 0) + 1; });

  const by_outreach = {};
  (outreachRes.data || []).forEach(r => { const o = r.outreach_status || 'new'; by_outreach[o] = (by_outreach[o] || 0) + 1; });

  return res.status(200).json({
    total_all_time: totalRes.count || 0,
    period_days: parseInt(days_back, 10),
    period_total: periodRes.count || 0,
    period_hardware: hardwareRes.count || 0,
    by_stage, by_country, by_outreach, daily_volume,
  });
}

async function handleFeeds(req, res) {
  const { data, error } = await supabase
    .from('funding_feeds')
    .select('id, name, feed_url, language, priority, is_active, last_fetched_at, last_item_count, error_count, last_error')
    .order('priority', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json(data || []);
}

async function handleExport(req, res) {
  const { days_back = '30', is_hardware } = req.query;
  const since = new Date(Date.now() - parseInt(days_back, 10) * 86400 * 1000).toISOString();

  let query = supabase
    .from('funded_startups')
    .select('company_name, country_code, funding_stage, funding_amount_millions, funding_currency, industry_tags, hardware_confidence, outreach_status, company_website, scraped_emails, article_title, source_name, source_url, discovered_at, notes')
    .gte('discovered_at', since)
    .order('discovered_at', { ascending: false })
    .limit(1000);

  if (is_hardware === 'true') query = query.eq('is_hardware', true);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const rows = data || [];
  const headers = ['company_name','country_code','funding_stage','funding_amount_millions','funding_currency','industry_tags','hardware_confidence','outreach_status','company_website','emails','article_title','source','source_url','discovered_at','notes'];
  const csvLines = [
    headers.join(','),
    ...rows.map(r => [
      q(r.company_name), q(r.country_code), q(r.funding_stage),
      r.funding_amount_millions || '', q(r.funding_currency),
      q((r.industry_tags || []).join('; ')), r.hardware_confidence || 0,
      q(r.outreach_status), q(r.company_website),
      q((r.scraped_emails || []).join('; ')),
      q(r.article_title), q(r.source_name), q(r.source_url), q(r.discovered_at), q(r.notes),
    ].join(',')),
  ];

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="funded-startups-${new Date().toISOString().substring(0, 10)}.csv"`);
  return res.status(200).send(csvLines.join('\n'));
}

// ─── PATCH ────────────────────────────────────────────────────
async function handlePatch(req, res) {
  const { id, outreach_status, notes, company_website, scraped_emails, email_scrape_status } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id is required' });

  const updates = {};
  if (outreach_status !== undefined) updates.outreach_status = outreach_status;
  if (notes !== undefined) updates.notes = notes;
  if (company_website !== undefined) updates.company_website = company_website;
  if (scraped_emails !== undefined) updates.scraped_emails = scraped_emails;
  if (email_scrape_status !== undefined) updates.email_scrape_status = email_scrape_status;
  if (outreach_status === 'contacted') updates.contacted_at = new Date().toISOString();

  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No fields to update' });

  const { data, error } = await supabase.from('funded_startups').update(updates).eq('id', id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json(data);
}

function q(val) {
  if (val === null || val === undefined) return '';
  return `"${String(val).replace(/"/g, '""')}"`;
}

// ══════════════════════════════════════════════════════════════
// POST — RSS SCANNER (merged from scan-funding.js)
// ══════════════════════════════════════════════════════════════

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
  'million', 'mln', 'mn', 'venture', 'backed', 'grant', 'eic', 'horizon',
];

const EXCLUDE_KEYWORDS = [
  'saas', 'software-as-a-service', 'mobile app only', 'social media platform',
  'dating app', 'food delivery app', 'cryptocurrency', 'blockchain token', 'nft',
  'ad tech', 'martech', 'marketing automation', 'recruitment platform', 'hr software',
];

const HARDWARE_BOOST_TERMS = [
  'prototype', 'manufacturing', 'physical product', 'device', 'machine',
  'component', 'assembly', 'factory', 'production line', 'supply chain',
  'pilot production', 'fda', 'ce marking', 'certification', 'iso',
];

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

function cleanText(raw) {
  return raw
    .replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ').trim();
}

function parseRssFeed(xml) {
  const items = [];
  const isAtom = xml.includes('<feed') && xml.includes('<entry>');
  const blockRe = isAtom ? /<entry>([\s\S]*?)<\/entry>/gi : /<item>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = blockRe.exec(xml)) !== null) {
    const block = match[1];
    const titleM = block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
    const title = titleM ? cleanText(titleM[1]) : '';

    let link = '';
    if (isAtom) {
      const lm = block.match(/<link[^>]*href="([^"]+)"[^>]*\/?>/i);
      if (lm) link = lm[1];
    } else {
      const lm = block.match(/<link[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i);
      if (lm) link = cleanText(lm[1]);
    }

    const descM = block.match(/<(?:description|summary)[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/(?:description|summary)>/i);
    const description = descM ? cleanText(descM[1]).substring(0, 1000) : '';

    const contentM = block.match(/<content:encoded>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/content:encoded>/i);
    const content = contentM ? cleanText(contentM[1]).substring(0, 3000) : '';

    const dateM = block.match(/<(?:pubDate|published|updated|dc:date)[^>]*>([\s\S]*?)<\/(?:pubDate|published|updated|dc:date)>/i);
    const pubDate = dateM ? dateM[1].trim() : '';

    if (title && link) items.push({ title, link, description, content, pubDate });
  }
  return items;
}

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
      if (!isNaN(num)) return { amount: parseFloat((num * multiplier).toFixed(3)), currency };
    }
  }
  return null;
}

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

function extractCountry(text) {
  const lower = text.toLowerCase();
  const countryMap = {
    DE: ['germany','german','berlin','munich','hamburg','frankfurt','stuttgart','cologne'],
    FR: ['france','french','paris','lyon','toulouse','marseille','bordeaux','grenoble'],
    NL: ['netherlands','dutch','amsterdam','rotterdam','eindhoven','delft','utrecht'],
    SE: ['sweden','swedish','stockholm','gothenburg','malmö','malmoe'],
    FI: ['finland','finnish','helsinki','espoo','tampere'],
    DK: ['denmark','danish','copenhagen','aarhus'],
    NO: ['norway','norwegian','oslo','bergen','trondheim'],
    ES: ['spain','spanish','madrid','barcelona','valencia','bilbao'],
    IT: ['italy','italian','milan','rome','turin','bologna','genoa'],
    BE: ['belgium','belgian','brussels','antwerp','ghent','leuven','liege'],
    AT: ['austria','austrian','vienna','graz','linz'],
    CH: ['switzerland','swiss','zurich','geneva','basel','lausanne','bern'],
    IE: ['ireland','irish','dublin','cork','galway'],
    PT: ['portugal','portuguese','lisbon','porto'],
    PL: ['poland','polish','warsaw','krakow','wroclaw','gdansk'],
    CZ: ['czech','prague','brno'],
    EE: ['estonia','estonian','tallinn'],
    LT: ['lithuania','lithuanian','vilnius'],
    LV: ['latvia','latvian','riga'],
    GR: ['greece','greek','athens','thessaloniki'],
    UK: ['united kingdom','british','london','cambridge','oxford','bristol','edinburgh','manchester','uk-based','uk based'],
    RO: ['romania','romanian','bucharest','cluj'],
    HU: ['hungary','hungarian','budapest'],
    HR: ['croatia','croatian','zagreb'],
    BG: ['bulgaria','bulgarian','sofia'],
    SI: ['slovenia','slovenian','ljubljana'],
    SK: ['slovakia','slovak','bratislava'],
    LU: ['luxembourg'],
    CY: ['cyprus','nicosia','limassol'],
    MT: ['malta','maltese'],
    IL: ['israel','israeli','tel aviv','tel-aviv'],
  };
  for (const [code, patterns] of Object.entries(countryMap)) {
    if (patterns.some(p => lower.includes(p))) return code;
  }
  return 'EU';
}

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
  return [...new Set(tags)];
}

function classifyArticle(title, description, content = '') {
  const fullText = `${title} ${description} ${content}`;
  const lower = fullText.toLowerCase();

  const hasFunding = FUNDING_KEYWORDS.some(kw => lower.includes(kw));
  if (!hasFunding) return { isRelevant: false, isHardware: false, hardwareConfidence: 0, matchedKeywords: [], industryTags: [], fundingStage: 'unknown', fundingAmount: null, countryCode: 'EU' };

  const matchedPrimary = HARDWARE_PRIMARY.filter(kw => lower.includes(kw));
  const matchedSecondary = HARDWARE_SECONDARY.filter(kw => lower.includes(kw));
  const allMatched = [...matchedPrimary, ...matchedSecondary];

  let confidence = matchedPrimary.length * 20 + matchedSecondary.length * 10;
  if (EXCLUDE_KEYWORDS.some(kw => lower.includes(kw))) confidence -= 30;
  confidence += HARDWARE_BOOST_TERMS.filter(t => lower.includes(t)).length * 5;
  confidence = Math.max(0, Math.min(100, confidence));

  return {
    isRelevant: hasFunding && allMatched.length > 0,
    isHardware: confidence >= 30,
    hardwareConfidence: confidence,
    matchedKeywords: allMatched.slice(0, 20),
    industryTags: extractIndustryTags(fullText),
    fundingStage: extractFundingStage(fullText),
    fundingAmount: extractFundingAmount(fullText),
    countryCode: extractCountry(fullText),
  };
}

async function findCompanyWebsite(articleUrl, companyName) {
  try {
    const html = await fetchWithRetry(articleUrl, 1, 8000);
    const skipDomains = [
      'twitter.com','x.com','linkedin.com','facebook.com','instagram.com','youtube.com',
      'crunchbase.com','tech.eu','techcrunch.com','eu-startups.com','sifted.eu',
      'siliconcanals.com','deutsche-startups.de','maddyness.com','uktech.news',
      'elevategreece.gov.gr','wikipedia.org','google.com','angel.co','pitchbook.com',
    ];
    const linkRe = /href="(https?:\/\/[^"#]{5,80})"/gi;
    let m;
    const candidates = [];
    while ((m = linkRe.exec(html)) !== null) {
      try {
        const domain = new URL(m[1]).hostname.toLowerCase().replace(/^www\./, '');
        if (!skipDomains.some(d => domain.includes(d))) candidates.push({ url: m[1], domain });
      } catch { /* skip invalid */ }
    }
    if (companyName) {
      const tokens = companyName.toLowerCase().split(/\s+/).filter(t => t.length > 2);
      for (const { url, domain } of candidates) {
        if (tokens.some(token => domain.includes(token))) return url;
      }
    }
    return candidates[0]?.url || null;
  } catch {
    return null;
  }
}

async function sendTelegramAlert(startup) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return;

  const flagMap = {
    DE:'🇩🇪',FR:'🇫🇷',NL:'🇳🇱',SE:'🇸🇪',FI:'🇫🇮',DK:'🇩🇰',NO:'🇳🇴',ES:'🇪🇸',IT:'🇮🇹',
    BE:'🇧🇪',AT:'🇦🇹',CH:'🇨🇭',IE:'🇮🇪',PT:'🇵🇹',PL:'🇵🇱',CZ:'🇨🇿',EE:'🇪🇪',LT:'🇱🇹',
    LV:'🇱🇻',GR:'🇬🇷',UK:'🇬🇧',RO:'🇷🇴',HU:'🇭🇺',HR:'🇭🇷',BG:'🇧🇬',SI:'🇸🇮',SK:'🇸🇰',
    LU:'🇱🇺',CY:'🇨🇾',MT:'🇲🇹',IL:'🇮🇱',EU:'🇪🇺',
  };
  const conf = startup.hardware_confidence;
  const amount = startup.funding_amount_millions ? `${startup.funding_currency}${startup.funding_amount_millions}M` : 'undisclosed';
  const stage = startup.funding_stage !== 'unknown' ? ` ${startup.funding_stage}` : '';
  const msg = [
    `🚀 FUNDED HARDWARE STARTUP`,``,
    `🏢 Company: ${startup.company_name || 'Unknown'}`,
    `${flagMap[startup.country_code] || '🌍'} Country: ${startup.country_code}`,
    `💰 Raised: ${amount}${stage}`,
    `🏷 Industry: ${(startup.industry_tags || []).slice(0, 4).join(', ') || 'N/A'}`,
    `${conf >= 70 ? '🟢' : conf >= 40 ? '🟡' : '🟠'} Hardware confidence: ${conf}/100`,``,
    `📰 Source: ${startup.source_name}`,
    `📋 "${startup.article_title.substring(0, 200)}"`,
    startup.company_website ? `🌐 ${startup.company_website}` : '',
    `🔑 Keywords: ${(startup.matched_keywords || []).slice(0, 5).join(', ')}`,``,
    `🔗 https://micronshub.eu/dashboard/funded-startups`,
  ].filter(Boolean).join('\n');

  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: msg, disable_web_page_preview: true }),
    });
  } catch (err) {
    console.error('[funded-startups] Telegram alert error:', err.message);
  }
}

async function handleScan(req, res) {
  const maxPriority = parseInt(req.body?.priority || '2', 10) || 2;
  const startedAt = new Date();
  const scanLog = { started_at: startedAt.toISOString(), feeds_scanned: 0, articles_found: 0, articles_relevant: 0, startups_hardware: 0, startups_new: 0, errors: [] };

  try {
    const { data: feeds, error: feedErr } = await supabase
      .from('funding_feeds').select('*').eq('is_active', true).lte('priority', maxPriority).order('priority', { ascending: true });

    if (feedErr) throw new Error(`Failed to load feeds: ${feedErr.message}`);
    if (!feeds || feeds.length === 0) return res.status(200).json({ success: true, message: 'No active feeds found', ...scanLog });

    for (const feed of feeds) {
      try {
        console.log(`[funded-startups/scan] Fetching: ${feed.name}`);
        const xml = await fetchWithRetry(feed.feed_url, 2, 12000);
        const items = parseRssFeed(xml);
        scanLog.feeds_scanned++;
        scanLog.articles_found += items.length;

        for (const item of items) {
          const { data: existing } = await supabase.from('funded_startups').select('id').eq('source_url', item.link).maybeSingle();
          if (existing) continue;

          const cl = classifyArticle(item.title, item.description, item.content);
          if (!cl.isRelevant) continue;

          scanLog.articles_relevant++;
          if (cl.isHardware) scanLog.startups_hardware++;

          const companyName = extractCompanyName(item.title);
          let companyWebsite = null;
          if (cl.hardwareConfidence >= 40 && companyName) companyWebsite = await findCompanyWebsite(item.link, companyName);

          const { data: inserted, error: insertErr } = await supabase
            .from('funded_startups')
            .insert({
              source_name: feed.name, source_url: item.link,
              article_title: item.title,
              article_excerpt: item.description ? item.description.substring(0, 500) : null,
              article_published_at: item.pubDate ? new Date(item.pubDate).toISOString() : null,
              company_name: companyName, company_website: companyWebsite,
              country_code: cl.countryCode,
              funding_amount_millions: cl.fundingAmount?.amount || null,
              funding_currency: cl.fundingAmount?.currency || 'EUR',
              funding_stage: cl.fundingStage,
              industry_tags: cl.industryTags, is_hardware: cl.isHardware,
              hardware_confidence: cl.hardwareConfidence, matched_keywords: cl.matchedKeywords,
            })
            .select('id,company_name,hardware_confidence,country_code,funding_stage,funding_amount_millions,funding_currency,industry_tags,matched_keywords,source_name,article_title,company_website')
            .single();

          if (insertErr) {
            if (!insertErr.message.includes('duplicate') && !insertErr.message.includes('unique')) scanLog.errors.push(insertErr.message);
            continue;
          }

          scanLog.startups_new++;
          if (cl.hardwareConfidence >= 60 && inserted) await sendTelegramAlert(inserted);
        }

        await supabase.from('funding_feeds').update({ last_fetched_at: new Date().toISOString(), last_item_count: items.length, error_count: 0, last_error: null }).eq('id', feed.id);

      } catch (feedErr) {
        console.error(`[funded-startups/scan] Feed error ${feed.name}:`, feedErr.message);
        scanLog.errors.push(`${feed.name}: ${feedErr.message}`);
        await supabase.from('funding_feeds').update({ error_count: (feed.error_count || 0) + 1, last_error: feedErr.message, last_fetched_at: new Date().toISOString() }).eq('id', feed.id);
      }

      await new Promise(r => setTimeout(r, 1500));
    }

    const durationMs = Date.now() - startedAt.getTime();
    await supabase.from('funding_scan_logs').insert({ ...scanLog, duration_ms: durationMs, completed_at: new Date().toISOString() });

    return res.status(200).json({ success: true, feeds_scanned: scanLog.feeds_scanned, articles_found: scanLog.articles_found, articles_relevant: scanLog.articles_relevant, startups_hardware: scanLog.startups_hardware, startups_new: scanLog.startups_new, errors: scanLog.errors, duration_ms: durationMs });

  } catch (err) {
    console.error('[funded-startups/scan] Fatal:', err);
    const durationMs = Date.now() - startedAt.getTime();
    scanLog.errors.push(err.message);
    await supabase.from('funding_scan_logs').insert({ ...scanLog, duration_ms: durationMs, completed_at: new Date().toISOString() }).catch(() => {});
    return res.status(500).json({ error: err.message });
  }
}
