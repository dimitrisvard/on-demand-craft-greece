// Lead keyword scoring of the scheduled collectors (Phase 5, unit G5), ported from the live reddit-collector
// (version 15) and hn-collector (version 7). Pure, apart from loadKeywords().
//
// Rules (the live matchKeywords of both functions)
//   - A keyword matches when the lower-cased text contains the lower-cased keyword (plain substring, no word
//     boundary); matched keywords keep the order of the keyword list, categories the order of first match.
//   - totalWeight = sum of the weights of the matched keywords (a null weight adds 0).
//   - score: no match -> noise; (sourcing_intent and geographic_europe) or competitor_complaints or
//     (sourcing_intent and competition_teams) or totalWeight >= 6 -> high; sourcing_intent or (material and at least
//     two matched keywords) or competition_teams or totalWeight >= 3 -> medium; competitor_mentions or
//     geographic_europe or totalWeight >= 1 -> low; else noise.
//   - "material" differs by variant: reddit counts material_specific or industry_specific, hn counts
//     material_specific only (as the two live functions do).
//   - loadKeywords: lead_keywords with is_active true, columns keyword, category, weight, in the order the database
//     answers (the live select has no order clause).

import type { Db } from '../db/postgrest';

export interface Keyword {
  keyword: string;
  category: string;
  weight: number | null;
}

export type LeadScore = 'high' | 'medium' | 'low' | 'noise';

/** Which live collector's rule set: reddit counts industry_specific as material, hn does not. */
export type ScoringVariant = 'reddit' | 'hn';

export interface KeywordMatch {
  matched: string[];
  categories: string[];
  score: LeadScore;
  /** Sum of the matched weights (the hn collector stores it as leads.score_value). */
  scoreValue: number;
}

/** The active keywords, as the live loadKeywords() reads them. */
export async function loadKeywords(db: Db): Promise<Keyword[]> {
  const rows = await db.select<{ keyword: unknown; category: unknown; weight: unknown }>('lead_keywords', {
    columns: 'keyword,category,weight',
    filters: [['is_active', 'eq', true]],
  });
  return rows.map((r) => ({
    keyword: String(r.keyword ?? ''),
    category: String(r.category ?? ''),
    weight: typeof r.weight === 'number' ? r.weight : r.weight === null || r.weight === undefined ? null : Number(r.weight),
  }));
}

/** Pure: the live matchKeywords of the given variant. */
export function matchKeywords(text: string, keywords: readonly Keyword[], variant: ScoringVariant): KeywordMatch {
  const lowerText = text.toLowerCase();
  const matched: string[] = [];
  const matchedCategories = new Set<string>();
  let totalWeight = 0;
  for (const kw of keywords) {
    if (lowerText.includes(kw.keyword.toLowerCase())) {
      matched.push(kw.keyword);
      matchedCategories.add(kw.category);
      totalWeight += kw.weight ?? 0;
    }
  }
  const categories = Array.from(matchedCategories);
  const hasSourcingIntent = categories.includes('sourcing_intent');
  const hasGeoEurope = categories.includes('geographic_europe');
  const hasCompetitorComplaint = categories.includes('competitor_complaints');
  const hasCompetitorMention = categories.includes('competitor_mentions');
  const hasMaterialSpecific = categories.includes('material_specific') || (variant === 'reddit' && categories.includes('industry_specific'));
  const hasCompetitionTeam = categories.includes('competition_teams');

  let score: LeadScore = 'noise';
  if (matched.length === 0) {
    score = 'noise';
  } else if ((hasSourcingIntent && hasGeoEurope) || hasCompetitorComplaint || (hasSourcingIntent && hasCompetitionTeam) || totalWeight >= 6) {
    score = 'high';
  } else if (hasSourcingIntent || (hasMaterialSpecific && matched.length >= 2) || hasCompetitionTeam || totalWeight >= 3) {
    score = 'medium';
  } else if (hasCompetitorMention || hasGeoEurope || totalWeight >= 1) {
    score = 'low';
  }
  return { matched, categories, score, scoreValue: totalWeight };
}
