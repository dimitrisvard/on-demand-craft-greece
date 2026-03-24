/**
 * Tender Scanner API
 * POST /api/tender-scan
 * Body: { country_code: string }
 *
 * Triggers a scan for a specific country connector.
 * Each invocation processes ONE country to stay within Vercel timeout limits.
 * Stores new tenders in Supabase tenders table.
 *
 * Architecture: Node.js fetch + Regex, no heavy deps.
 */

import { createClient } from '@supabase/supabase-js';
import { scoreTender } from '../lib/scoring.js';
import { fetchNetherlands } from '../lib/connectors/netherlands.js';
import { fetchIreland } from '../lib/connectors/ireland.js';
import { fetchFrance } from '../lib/connectors/france.js';
import { fetchGermany } from '../lib/connectors/germany.js';
import { fetchSpain } from '../lib/connectors/spain.js';
import { fetchCountry } from '../lib/connectors/generic.js';

// ─── CORS ───────────────────────────────────────────
function setCors(res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');
}

// ─── Supabase ────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

// ─── Country dispatcher ─────────────────────────────
const CONNECTORS = {
  NL: fetchNetherlands,
  IE: fetchIreland,
  FR: fetchFrance,
  DE: fetchGermany,
  ES: fetchSpain,
  // Generic connector handles the rest
  IT: () => fetchCountry('IT'),
  PL: () => fetchCountry('PL'),
  BE: () => fetchCountry('BE'),
  SE: () => fetchCountry('SE'),
  AT: () => fetchCountry('AT'),
  DK: () => fetchCountry('DK'),
  FI: () => fetchCountry('FI'),
  PT: () => fetchCountry('PT'),
  RO: () => fetchCountry('RO'),
  EE: () => fetchCountry('EE'),
  NO: () => fetchCountry('NO'),
  CZ: () => fetchCountry('CZ'),
  HU: () => fetchCountry('HU'),
  HR: () => fetchCountry('HR'),
  SK: () => fetchCountry('SK'),
  SI: () => fetchCountry('SI'),
  BG: () => fetchCountry('BG'),
  LT: () => fetchCountry('LT'),
  LV: () => fetchCountry('LV'),
  CY: () => fetchCountry('CY'),
  LU: () => fetchCountry('LU'),
  MT: () => fetchCountry('MT'),
  CH: () => fetchCountry('CH'),
  EU: () => fetchCountry('EU'),
  GR: () => fetchCountry('GR'),
};

// ─── Main handler ────────────────────────────────────
export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { country_code } = req.body || {};

  if (!country_code) return res.status(400).json({ error: 'country_code is required' });

  const code = country_code.toUpperCase();
  const connector = CONNECTORS[code];
  if (!connector) return res.status(400).json({ error: `No connector for country: ${code}` });

  const startedAt = new Date();
  const logEntry = {
    country_code: code,
    started_at: startedAt.toISOString(),
    tenders_found: 0,
    tenders_new: 0,
    tenders_relevant: 0,
    errors: [],
  };

  try {
    // Mark connector as scanning
    await supabase
      .from('tender_connectors')
      .update({ last_error: null })
      .eq('country_code', code);

    // Run the connector
    console.log(`[tender-scan] Starting scan for ${code}`);
    const { tenders: rawTenders, errors } = await connector();
    logEntry.errors = errors;
    logEntry.tenders_found = rawTenders.length;

    console.log(`[tender-scan] ${code}: found ${rawTenders.length} tenders, ${errors.length} errors`);

    // Score and upsert tenders
    let newCount = 0;
    let relevantCount = 0;

    for (const raw of rawTenders) {
      const { score, matchedKeywords, matchedCpv, isRelevant } = scoreTender(raw);

      const record = {
        country_code: raw.countryCode,
        country_name: raw.countryName,
        portal_name: raw.portalName,
        portal_url: raw.portalUrl,
        tender_reference: raw.tenderReference,
        title: raw.title || 'Untitled',
        description: raw.description,
        buyer_name: raw.buyerName,
        buyer_type: raw.buyerType,
        cpv_codes: raw.cpvCodes || [],
        nature_of_contract: raw.natureOfContract,
        estimated_value_eur: raw.estimatedValueEur,
        estimated_value_original: raw.estimatedValueOriginal,
        currency: raw.currency || 'EUR',
        publication_date: raw.publicationDate,
        submission_deadline: raw.submissionDeadline,
        place_of_performance: raw.placeOfPerformance,
        nuts_code: raw.nutsCode,
        procedure_type: raw.procedureType,
        relevance_score: score,
        matched_keywords: matchedKeywords,
        matched_cpv: matchedCpv,
        is_relevant: isRelevant,
        original_language: raw.originalLanguage,
        raw_data: raw.rawData || null,
      };

      // Upsert — on conflict (country_code, tender_reference), update score fields
      const { error: upsertError, data: upserted } = await supabase
        .from('tenders')
        .upsert(record, {
          onConflict: 'country_code,tender_reference',
          ignoreDuplicates: false,
        })
        .select('id, discovered_at')
        .single();

      if (upsertError) {
        console.error(`[tender-scan] Upsert error for ${raw.tenderReference}:`, upsertError.message);
        continue;
      }

      // Check if this was a new insert (discovered_at close to now)
      if (upserted) {
        const discAt = new Date(upserted.discovered_at);
        const ageMs = Date.now() - discAt.getTime();
        if (ageMs < 60000) newCount++; // inserted within last minute
      }

      if (isRelevant) relevantCount++;
    }

    logEntry.tenders_new = newCount;
    logEntry.tenders_relevant = relevantCount;

    // Update connector status
    await supabase
      .from('tender_connectors')
      .update({
        last_scan_at: new Date().toISOString(),
        last_scan_count: rawTenders.length,
        last_error: errors.length > 0 ? errors.slice(0, 3).join('; ') : null,
      })
      .eq('country_code', code);

    // Write scan log
    const durationMs = Date.now() - startedAt.getTime();
    await supabase.from('tender_scan_logs').insert({
      ...logEntry,
      duration_ms: durationMs,
      completed_at: new Date().toISOString(),
    });

    // Send Telegram alert for high-scoring new tenders
    if (newCount > 0) {
      await sendHighScoreAlerts(code);
    }

    return res.status(200).json({
      success: true,
      country_code: code,
      tenders_found: rawTenders.length,
      tenders_new: newCount,
      tenders_relevant: relevantCount,
      errors,
      duration_ms: durationMs,
    });
  } catch (err) {
    console.error(`[tender-scan] Fatal error for ${code}:`, err);

    const durationMs = Date.now() - startedAt.getTime();
    logEntry.errors.push(err.message);

    await supabase.from('tender_scan_logs').insert({
      ...logEntry,
      duration_ms: durationMs,
      completed_at: new Date().toISOString(),
    });

    await supabase
      .from('tender_connectors')
      .update({ last_error: err.message, last_scan_at: new Date().toISOString() })
      .eq('country_code', code);

    return res.status(500).json({ error: err.message, country_code: code });
  }
}

// ─── Telegram high-score alerts ─────────────────────
async function sendHighScoreAlerts(countryCode) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return;

  try {
    // Get new high-scoring tenders (score >= 70) from last 5 min
    const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: highTenders } = await supabase
      .from('tenders')
      .select('*')
      .eq('country_code', countryCode)
      .gte('relevance_score', 70)
      .gte('discovered_at', since)
      .order('relevance_score', { ascending: false })
      .limit(3);

    if (!highTenders || highTenders.length === 0) return;

    for (const t of highTenders) {
      const flagMap = {
        NL: '🇳🇱', IE: '🇮🇪', FR: '🇫🇷', DE: '🇩🇪', IT: '🇮🇹',
        ES: '🇪🇸', PL: '🇵🇱', BE: '🇧🇪', SE: '🇸🇪', AT: '🇦🇹',
        DK: '🇩🇰', FI: '🇫🇮', PT: '🇵🇹', RO: '🇷🇴', EE: '🇪🇪',
        NO: '🇳🇴', CZ: '🇨🇿', HU: '🇭🇺', HR: '🇭🇷', SK: '🇸🇰',
        SI: '🇸🇮', BG: '🇧🇬', LT: '🇱🇹', LV: '🇱🇻', CY: '🇨🇾',
        LU: '🇱🇺', MT: '🇲🇹',
      };
      const flag = flagMap[t.country_code] || '';
      const scoreEmoji = t.relevance_score >= 80 ? '🟢' : '🟡';
      const deadline = t.submission_deadline
        ? new Date(t.submission_deadline).toLocaleDateString('en-GB')
        : 'Not specified';
      const value = t.estimated_value_eur
        ? `~€${Math.round(t.estimated_value_eur).toLocaleString()}`
        : 'Not specified';

      const msg = `🏛 HIGH-RELEVANCE TENDER\n\n${flag} Country: ${t.country_name}\n📋 Title: ${t.title.substring(0, 150)}\n🏢 Buyer: ${t.buyer_name || 'Unknown'}\n💰 Value: ${value}\n📅 Deadline: ${deadline}\n${scoreEmoji} Score: ${t.relevance_score}/100\n🏷 CPV: ${(t.cpv_codes || []).slice(0, 2).join(', ') || 'N/A'}\n🔑 Keywords: ${(t.matched_keywords || []).slice(0, 4).join(', ') || 'N/A'}\n\n🔗 ${t.portal_url || `https://micronshub.eu/dashboard/tenders`}\n\n/tender_${t.id.substring(0, 8)}`;

      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: msg, disable_web_page_preview: true }),
      });

      // Small delay between messages
      await new Promise(r => setTimeout(r, 300));
    }
  } catch (err) {
    console.error('[tender-scan] Telegram alert error:', err.message);
  }
}
