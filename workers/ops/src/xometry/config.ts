// Constants of the Xometry scanner, ported from xometry-bot/xometry_bot/config.py, filters.py and
// partner_client.py (the golden vectors pin every value and the query text, test/p5/xometry/config.test.ts).
//
// Rules
//   - Regular expressions keep the Python pattern text (PY_PATTERNS) and are compiled with the flags 'iu', so case
//     folding is Unicode-aware as Python's re.IGNORECASE on str patterns is ('ſandblasting' is excluded).
//   - Python's \s is its str.isspace() set (PY_SPACE) and \b is Unicode-aware; the compiled patterns spell both out.
//   - Python's IGNORECASE also treats dotless i (U+0131) and dotted capital I (U+0130) as 'i', which Unicode case
//     folding does not: pyMatches() maps those two characters to 'i' before testing (the text itself is never
//     changed).
//   - Only the 'milonk' preset is active; 'laser' stays documented and off.

import { SOURCE_BASES } from '../ports/p5';
import type { Preset } from './types';

export const PARTNER_GRAPHQL_PATH = '/partners/graphql';
export const PARTNER_GRAPHQL_URL = `${SOURCE_BASES.xometry}${PARTNER_GRAPHQL_PATH}`;
/** User-agent of the partner calls. */
export const USER_AGENT = 'microns-ops-xometry-scan/1 (+https://www.micronshub.eu)';

function preset(name: string, include: number[], exclude: number[] = []): Preset {
  return Object.freeze({ name, include: new Set(include), exclude: new Set(exclude) });
}

export const PRESETS: Readonly<Record<'milonk' | 'laser', Preset>> = Object.freeze({
  // Milling / Turning / EDM / CNC / Milling 5 axes / Milling mass / Turning 2+ axes / Turning Automat (preset 864).
  milonk: preset('milonk', [14, 10, 84, 123, 20, 295, 16, 22]),
  // Laser Cutting / Waterjet / Bending Sheet / Sheet (preset 831); documented, never active.
  laser: preset('laser', [36, 39, 34, 124]),
});

export const ACTIVE_PRESETS: readonly ['milonk'] = Object.freeze(['milonk'] as const);

export const SCAN_FILTER: Readonly<Record<string, string>> = Object.freeze({ urgentStatus: 'without_urgent', responseStatus: 'empty' });
export const SCAN_PAGE_LIMIT = 20;
/** Hard cap on pagination. */
export const SCAN_MAX_PAGES = 100;

/** The Python pattern texts (config.py, filters.py), compared with the golden config. */
export const PY_PATTERNS = Object.freeze({
  SECONDARY_OP_RE:
    'anodiz|powder coat|coating|plating|galvan|sandblast|bead blast|glass bead|spray paint|wet paint|painting|dyed|finish color|passivat|phosphat|chrome|cadmium|electropolish|tumbl|barrel polish|vapor polish',
  BORDERLINE_RE: 'grinding|heat treat|case harden|marking',
  TOLERANCE_RE: 'tolerance|iso\\s*2768|tol\\.?\\s*grade|iso\\s*286|±',
  ROUGHNESS_RE: '^\\s*ra\\b',
  THREAD_RISK_RE: 'thread rolling|deep drilling|threads at risk|deep small-dia drill',
});

/** Python's \s for str patterns: exactly the characters for which str.isspace() is true. */
export const PY_SPACE = '[\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
/** Python's Unicode \w (str.isalnum() or '_'), for a \b at the end of a word. */
const PY_WORD = '[\\p{L}\\p{N}_]';

export const SECONDARY_OP_RE = new RegExp(PY_PATTERNS.SECONDARY_OP_RE, 'iu');
/** Borderline machining ops kept by default (flagged); excluded only when listed in value.borderline_exclude. */
export const BORDERLINE_RE = new RegExp(PY_PATTERNS.BORDERLINE_RE, 'iu');
export const TOLERANCE_RE = new RegExp(`tolerance|iso${PY_SPACE}*2768|tol\\.?${PY_SPACE}*grade|iso${PY_SPACE}*286|±`, 'iu');
export const ROUGHNESS_RE = new RegExp(`^${PY_SPACE}*ra(?!${PY_WORD})`, 'iu');
export const THREAD_RISK_RE = new RegExp(PY_PATTERNS.THREAD_RISK_RE, 'iu');

/** re.search(pattern, text, re.IGNORECASE) as Python answers it (see the rules above). */
export function pyMatches(re: RegExp, text: string): boolean {
  return re.test(text.replace(/[\u0130\u0131]/g, 'i'));
}

/** Formats the buyer instant quote accepts; DXF is instant for flat-cut only. */
export const INSTANT_QUOTE_EXTS: ReadonlySet<string> = new Set(['.step', '.stp', '.sldprt', '.stl', '.sat', '.3dxml', '.3mf', '.prt', '.ipt', '.catpart', '.x_t', '.ptc', '.dxf', '.x_b']);
export const MANUAL_ONLY_EXTS: ReadonlySet<string> = new Set(['.pdf', '.dwg', '.dwf', '.dws']);
export const PREFERRED_QUOTE_EXTS: readonly string[] = Object.freeze(['.step', '.stp']);

/** Counteroffer at buyer_price * (1 - DISCOUNT). */
export const DISCOUNT = 0.2;
/** Floor multiplier on the own cost. */
export const MIN_MARGIN = 0.15;
export const LEADTIME_BUSINESS_DAYS = 10;
/** buyer_price / partner_cost outside this range flags price_implausible. */
export const PLAUSIBLE_BUYER_TO_PARTNER_RATIO: readonly [number, number] = Object.freeze([0.8, 5.0] as [number, number]);

/** Money fragment of the live partner schema (amount / currencyCode). */
export const MONEY_FRAGMENT = '{ amount currencyCode }';

/** The gshJobOffers query exactly as partner_client.py sends it (template with the money fragment filled in). */
export const GSH_JOB_OFFERS_QUERY = `
query gshJobOffers(
  $filter: OffersFilterType!, $offsetAttributes: OffsetAttributes, $sort: OffersSortType
) {
  gshJobOffers(filter: $filter, offsetAttributes: $offsetAttributes, sort: $sort) {
    metadata { hasMore limit offset totalCount }
    offers {
      ... on JobOffer {
        id
        code
        allowAutoaccept
        allowCounterofferFrom
        cost ${MONEY_FRAGMENT}
        leadtime
        isUrgent
        jobId
        job { publicComment jobState: state }
        parts {
          code
          name
          material
          processType
          quantity
          dimensions
          weightKg
          volumeMm3
          finish
          productionRemark
          measurementProtocolNeeded
          samplesNeeded
          tags { id name context }
          files { id name downloadUrl preview largeUrl }
        }
        publicationStart
        publicationEnd
      }
    }
  }
}
`;
