// Constants shared by the SEO parity tool (docs/migration/SEO_PARITY.md).
// Changing IGNORED_HEADERS or the field rules is a reviewed change (§2.2).

export const TOOL_NAME = 'micronshub-seo-parity';
// Written to every manifest.json, urls.json and report.json. Bump it whenever
// the stored record, a field rule, a volatile rule or the signable rules
// change, so that outputs of different semantics can be told apart. 1.1.0:
// gate-evidence rules (evidence.mjs), the blog-index-article-list and
// prerender-tag-scripts rules, F23_sans_tag_scripts in stored HTML records.
// USER_AGENT is fixed by SEO_PARITY.md §2.3 and does not follow this number.
export const TOOL_VERSION = '1.1.0';
export const USER_AGENT = 'micronshub-seo-parity/1.0 (owner-run parity check)';
export const DEFAULT_SEED = 'micronshub-parity-v1';
export const DEFAULT_CONCURRENCY = 8;
export const DEFAULT_TIMEOUT_MS = 30000;
export const DEFAULT_MAX_HOPS = 5;
export const DEFAULT_RECHECK_AFTER_S = 3900;
export const MAX_ATTEMPTS = 3;
export const ERROR_RATE_LIMIT = 0.005; // 0.5 % (§1)
export const ARTICLES_PER_LANGUAGE = 50; // G4 gate sample (§3.1)
export const ALLOW_MAX_DAYS = 120; // §5.6
export const APPROVER = 'Dimitris';
export const PRODUCTION_ORIGIN = 'https://www.micronshub.eu';

// §2.2: recorded, never gated. `cf-*` and `x-vercel-*` are prefixes.
export const IGNORED_HEADERS = new Set([
  'date', 'age', 'server', 'via', 'connection', 'keep-alive', 'transfer-encoding',
  'content-length', 'content-encoding', 'etag', 'last-modified', 'accept-ranges',
  'alt-svc', 'nel', 'report-to', 'server-timing', 'cf-ray', 'cf-cache-status',
  'x-matched-path',
]);
export const IGNORED_HEADER_PREFIXES = ['cf-', 'x-vercel-'];

// Headers with their own field rule (F2, F5–F10) or handled separately
// (Set-Cookie names). Everything else falls into F11 (deny by default).
export const OWN_RULE_HEADERS = new Set([
  'location', 'content-type', 'cache-control', 'vary', 'strict-transport-security',
  'x-seo-source', 'x-robots-tag', 'set-cookie',
]);

// Fields whose difference is re-checked when X-Seo-Source is `db` on either
// side (§2.4).
export const DB_BACKED_FIELDS = new Set(['F9', 'F14', 'F15', 'F16', 'F17', 'F18', 'F19', 'F20', 'F21', 'F22']);

export const FIELD_IDS = Array.from({ length: 26 }, (_, i) => `F${i + 1}`);

export const GROUPS = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10'];
// §3.2 single-group profiles.
export const GROUP_PROFILES = { sitemaps: 'G5', redirects: 'G6', variants: 'G9', api: 'G10' };
export const PROFILES = ['gate', 'full', ...Object.keys(GROUP_PROFILES)];

// Volatile window (§2.4): refuse to start inside, invalid when crossing.
export const WINDOW_START_MIN = 6 * 60 + 55; // 06:55 UTC
export const WINDOW_END_MIN = 10 * 60 + 5; // 10:05 UTC
// A run is invalid when it crosses 00:00 or 09:00 UTC, or enters the
// 06:55–10:05 window (crossing 06:55): §2.4 "runs happen between 10:05 and
// 06:55 UTC", and a run that starts at 06:54 and ends at 08:59 spans the
// whole content pipeline without crossing 09:00.
export const CROSSING_MINUTES = [0, 6 * 60 + 55, 9 * 60]; // 00:00, 06:55 and 09:00 UTC
export const WINDOW_OVERRIDE_ENV = 'PARITY_IGNORE_WINDOW';
