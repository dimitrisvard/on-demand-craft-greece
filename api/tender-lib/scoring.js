/**
 * Tender relevance scoring engine for Microns Hub
 */

import { MANUFACTURING_CPV_CODES, MANUFACTURING_CPV_PREFIXES, isMfgCpv } from './cpv-codes.js';
import { getFlatKeywords } from './keywords.js';

const ALL_KEYWORDS = getFlatKeywords();

/**
 * Score a normalized tender for relevance to Microns Hub (0–100)
 * Returns { score, matchedKeywords, matchedCpv, isRelevant }
 */
export function scoreTender(tender) {
  let score = 0;
  const matchedKeywords = [];
  const matchedCpv = [];

  const titleLower = (tender.title || '').toLowerCase();
  const descLower = (tender.description || '').toLowerCase();
  const fullText = `${titleLower} ${descLower}`;

  // ─── CPV code match ───────────────────────────────────────────

  if (tender.cpvCodes && tender.cpvCodes.length > 0) {
    for (const cpv of tender.cpvCodes) {
      const clean = cpv.replace(/[^0-9]/g, '');
      const prefix2 = clean.substring(0, 2);

      if (clean in MANUFACTURING_CPV_CODES) {
        // Exact 8-digit match → high confidence
        score += 30;
        matchedCpv.push(cpv);
      } else if (MANUFACTURING_CPV_PREFIXES.includes(prefix2)) {
        // Category prefix match
        score += 15;
        matchedCpv.push(cpv);
      }
    }
    // Cap CPV contribution at 50
    score = Math.min(score, 50);
  }

  // ─── Keyword match in title (strong signal) ───────────────────

  const titleMatches = ALL_KEYWORDS.filter(kw =>
    titleLower.includes(kw.toLowerCase())
  );
  titleMatches.forEach(kw => {
    if (!matchedKeywords.includes(kw)) matchedKeywords.push(kw);
  });
  score += Math.min(titleMatches.length * 12, 30);

  // ─── Keyword match in description ────────────────────────────

  const descMatches = ALL_KEYWORDS.filter(kw =>
    descLower.includes(kw.toLowerCase()) &&
    !titleMatches.includes(kw)
  );
  descMatches.forEach(kw => {
    if (!matchedKeywords.includes(kw)) matchedKeywords.push(kw);
  });
  score += Math.min(descMatches.length * 3, 15);

  // ─── Value in sweet spot (€5K–€200K) ─────────────────────────

  if (tender.estimatedValueEur) {
    const v = tender.estimatedValueEur;
    if (v >= 5000 && v <= 200000) score += 10;
    else if (v > 200000 && v <= 500000) score += 5;
    else if (v < 5000 && v > 0) score += 2; // small but possible
  }

  // ─── Nature = supplies ────────────────────────────────────────

  if (tender.natureOfContract === 'supplies') score += 5;

  // Final cap
  const finalScore = Math.min(score, 100);
  const isRelevant = finalScore >= 20 || matchedKeywords.length > 0 || matchedCpv.length > 0;

  return {
    score: finalScore,
    matchedKeywords: matchedKeywords.slice(0, 20),
    matchedCpv: [...new Set(matchedCpv)],
    isRelevant,
  };
}
