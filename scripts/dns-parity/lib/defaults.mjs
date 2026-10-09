// Built-in name list for micronshub.eu: every name of the 2026-09-30 capture
// (docs/migration/PLAN.md §6.1; scratch live/dns_2026-09-30.txt) plus the names later phases create.
// Each entry: [relative name, why]. All names are queried with the default type list.

export const DEFAULT_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'CAA', 'NS', 'SRV', 'HTTPS'];

export const MICRONSHUB_NAMES = [
  ['@', 'apex: A 216.198.79.1 (Vercel), 5 MX (Google Workspace), SPF and google-site-verification TXT, no AAAA, no CAA'],
  ['www', 'CNAME to the Vercel project target'],
  ['*', 'wildcard CNAME cname.vercel-dns.com (literal owner)'],
  ['_dmarc', 'DMARC p=none'],
  ['resend._domainkey', 'Resend DKIM'],
  ['google._domainkey', 'Google Workspace DKIM'],
  ['_domainkey', 'empty non-terminal: RFC 4592 servers answer NODATA, Cloudflare standard nameservers apply the wildcard'],
  ['send', 'Resend MAIL FROM: SPF TXT, no MX (H-16); owning a TXT blocks the wildcard for every type'],
  ['_vercel', 'answered by the wildcard today (no own record)'],
  ['laserkritis', 'tenant subdomain (tenants table, live 2026-10-04)'],
  ['micronshub', 'tenant slug of the default tenant (tenants table, live 2026-10-04); wildcard'],
  ['rfq', 'wildcard today; Email Routing subdomain from Phase 4 (MX and TXT added there)'],
  ['api', 'machine-caller host from Phase 3 (Phase 2 D-3); wildcard'],
  ['files', 'R2 custom domain of microns-public from P3-6; wildcard before'],
  ['mcp', 'Custom Domain of microns-ops from Phase 4; wildcard before'],
  ['random-probe-xyz', 'unknown label probed in the 2026-09-30 capture'],
];

/** Seeded probes: one unknown label, a two-label name below it, an underscore label. */
export function probeNames(label) {
  return [
    [`zz-dnsparity-${label}`, 'random label (wildcard)'],
    [`a.zz-dnsparity-${label}`, 'two labels below the apex (the wildcard covers several levels)'],
    [`_zz-dnsparity-${label}`, 'underscore label (wildcard)'],
    [`x._domainkey`, 'below an empty non-terminal'],
  ];
}
