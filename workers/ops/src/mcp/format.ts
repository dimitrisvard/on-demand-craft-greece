// Text formatting of the remote MCP tools, ported from mcp-server/src/index.ts (formatLead :142-155, truncateCsv
// :108-139, formatTender :1151-1172, formatFundedStartup :1483-1504, gscDateRange/buildFilterGroups/fmtGscRow
// :1723-1750). The remote texts use plain-text markers instead of pictographs, ISO timestamps (UTC) instead of the
// host's locale, and masked e-mail addresses in lists.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

/** 'h***@example.de' for one address; every address in a text with maskEmails. */
export function maskEmail(addr: string): string {
  const value = String(addr ?? '').trim();
  const at = value.lastIndexOf('@');
  if (at < 1 || at === value.length - 1) return '***';
  return `${value[0]}***@${value.slice(at + 1).toLowerCase()}`;
}

const EMAIL_IN_TEXT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function maskEmails(text: string): string {
  return text.replace(EMAIL_IN_TEXT, (m) => maskEmail(m));
}

/** ISO time (UTC) of a stored timestamp, or the fallback. */
export function isoTime(value: unknown, fallback = 'unknown'): string {
  if (value === null || value === undefined || value === '') return fallback;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? fallback : d.toISOString().replace('.000Z', 'Z');
}

/** YYYY-MM-DD of a stored timestamp, or the fallback. */
export function isoDate(value: unknown, fallback = 'N/A'): string {
  if (value === null || value === undefined || value === '') return fallback;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? fallback : d.toISOString().slice(0, 10);
}

export function formatLead(lead: Row): string {
  const score = lead.manual_score || lead.auto_score;
  return [
    `[${score?.toUpperCase?.() ?? 'UNSCORED'}] ${lead.title}`,
    `   Status: ${lead.status} | Source: ${lead.subreddit || lead.source}`,
    `   Author: ${lead.author || 'unknown'} | Discovered: ${isoTime(lead.discovered_at)}`,
    lead.matched_keywords?.length ? `   Keywords: ${lead.matched_keywords.slice(0, 5).join(', ')}` : '',
    `   URL: ${lead.source_url}`,
    `   ID: ${lead.id}`,
  ].filter(Boolean).join('\n');
}

export function formatTender(t: Row): string {
  const band = t.relevance_score >= 70 ? 'HIGH' : t.relevance_score >= 40 ? 'MED' : 'LOW';
  const value = t.estimated_value_eur ? `EUR ${Math.round(t.estimated_value_eur).toLocaleString('en-GB')}` : 'N/A';
  const deadline = t.submission_deadline ? isoDate(t.submission_deadline) : 'N/A';
  return [
    `[${t.relevance_score} ${band}] ${t.country_code} ${t.country_name} - ${t.title}`,
    `   Buyer: ${t.buyer_name || 'Unknown buyer'} | Value: ${value} | Deadline: ${deadline}`,
    `   Status: ${t.status} | CPV: ${(t.cpv_codes || []).slice(0, 2).join(', ') || 'N/A'}`,
    `   Keywords: ${(t.matched_keywords || []).slice(0, 5).join(', ') || 'none'}`,
    `   ID: ${t.id}`,
    t.portal_url ? `   URL: ${t.portal_url}` : '',
  ].filter(Boolean).join('\n');
}

export function formatFundedStartup(s: Row): string {
  const conf = s.hardware_confidence;
  const band = conf >= 70 ? 'HIGH' : conf >= 40 ? 'MED' : 'LOW';
  const amount = s.funding_amount_millions ? `${s.funding_currency}${s.funding_amount_millions}M` : 'undisclosed';
  return [
    `${s.company_name || 'Unknown'} (${s.country_code || 'EU'})`,
    `   Funding: ${amount} ${s.funding_stage || ''}`.trimEnd(),
    `   Tags: ${(s.industry_tags || []).join(', ') || 'N/A'}`,
    `   Confidence: ${conf}/100 (${band}) | Outreach: ${s.outreach_status}`,
    s.company_website ? `   Website: ${s.company_website}` : '',
    `   Source: ${s.source_name}: ${s.article_title?.substring(0, 100)}`,
    `   URL: ${s.source_url}`,
    `   ID: ${s.id}`,
  ].filter(Boolean).join('\n');
}

/** Cuts a CSV text at the last record boundary within `limitBytes` of UTF-8 (quoted line breaks are kept). */
export function truncateCsv(csv: string, limitBytes: number): { text: string; truncated: boolean; totalBytes: number; keptRows: number; totalRows: number } {
  const totalBytes = new TextEncoder().encode(csv).length;
  let bytes = 0;
  let inQuotes = false;
  let records = csv.length === 0 ? 0 : 1;
  let cutIndex = -1;
  let keptRecords = 0;
  for (let i = 0; i < csv.length; i++) {
    const code = csv.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i++;
      continue;
    }
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
    if (code === 0x22) {
      inQuotes = !inQuotes;
    } else if (code === 0x0a && !inQuotes) {
      if (bytes - 1 <= limitBytes) {
        cutIndex = i;
        keptRecords = records;
      }
      records++;
    }
  }
  const totalRows = Math.max(records - 1, 0);
  if (totalBytes <= limitBytes) return { text: csv, truncated: false, totalBytes, keptRows: totalRows, totalRows };
  const text = cutIndex >= 0 ? csv.slice(0, cutIndex) : '';
  return { text, truncated: true, totalBytes, keptRows: Math.max(keptRecords - 1, 0), totalRows };
}

/** GSC data lags about 2 days: the window ends 3 days ago. */
export function gscDateRange(days: number, now: Date = new Date()): { startDate: string; endDate: string } {
  const end = new Date(now.getTime());
  end.setUTCDate(end.getUTCDate() - 3);
  const start = new Date(end.getTime());
  start.setUTCDate(start.getUTCDate() - days);
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  return { startDate: fmt(start), endDate: fmt(end) };
}

export function buildFilterGroups(opts: { page?: string; country?: string; device?: string; query?: string }): Array<{ groupType: string; filters: Row[] }> | undefined {
  const filters: Row[] = [];
  if (opts.page) filters.push({ dimension: 'page', operator: 'contains', expression: opts.page });
  if (opts.country) filters.push({ dimension: 'country', operator: 'equals', expression: opts.country });
  if (opts.device) filters.push({ dimension: 'device', operator: 'equals', expression: opts.device });
  if (opts.query) filters.push({ dimension: 'query', operator: 'contains', expression: opts.query });
  if (filters.length === 0) return undefined;
  return [{ groupType: 'and', filters }];
}

export function fmtGscRow(r: Row, dim: string): string {
  const key = r.keys?.[0] || '-';
  const clicks = r.clicks ?? 0;
  const impressions = r.impressions ?? 0;
  const ctr = `${((r.ctr ?? 0) * 100).toFixed(1)}%`;
  const pos = (r.position ?? 0).toFixed(1);
  return `  ${dim}: ${key}\n    clicks: ${clicks} | imp: ${impressions} | ctr: ${ctr} | pos: ${pos}`;
}

/** Days of `n` before `now` as an ISO timestamp (the local tools' `days_back` filter). */
export function daysAgoIso(days: number, now: Date): string {
  return new Date(now.getTime() - days * 86400 * 1000).toISOString();
}
