// Router step 1: the redirect table (PLAN.md P1-5; ARCHITECTURE.md §6.2 step 1; INVENTORY.md RD-01…RD-28).
//
// RD-01…RD-25: the 25 "redirects" of vercel.json in file order, source and destination copied byte-exact from
// the parsed file (all "permanent": true, so Vercel answers 308). test/redirects.test.ts compares them with
// JSON.parse(vercel.json).redirects, so any drift fails CI. Non-ASCII characters are written as \u escapes:
// RD-12's source holds U+00C5 U+0084 (the UTF-8 bytes of "ń" read as Latin-1, a dead mojibake source that no
// real request matches; INVENTORY.md RD-12) and stays byte-identical on purpose.
//
// RD-26…RD-28: client-only entries of src/components/SEORedirects.tsx:39-57 (today: 200 SPA shell, then a client
// navigate(replace)). Served here as 308: a documented parity deviation, SEO_PARITY.md AL-001…AL-003. The client
// map stays in the SPA as a fallback. The two client regex patterns (RD-P1, SEORedirects.tsx:66; RD-P2, :73) are
// NOT ported; they stay client-side (no AL-005).
//
// Matching (to confirm in the P0-3 baseline, SEO_PARITY.md G6 and G9 #15):
//   - exact, case-sensitive pathname; no trailing-slash or case variants (/dawycena/ and /DAWYCENA do not match);
//   - against the raw pathname and against the NFC-normalised decodeURIComponent(pathname), so both
//     /pl/wyko%C5%84czenie-powierzchni and its decomposed form reach RD-28;
//   - Location is the destination exactly as written (relative path) plus the request's query string, as Vercel
//     forwards the query on redirects (confirm in P0-3 baseline, SEO_PARITY.md G9 #15);
//   - empty body, no other headers: finalise() (src/preview.ts) adds the rest.

export interface RedirectRule {
  id: string;
  source: string;
  destination: string;
  origin: 'vercel' | 'client';
}

// Vercel "permanent": true.
const REDIRECT_STATUS = 308;

export const REDIRECTS: ReadonlyArray<RedirectRule> = [
  { id: 'RD-01', source: '/nl/blog/knoedelen-ontwerpen-voor-diamant-vs-rechte-patronen', destination: '/nl/blog/kartelen-ontwerpen-voor-diamant-vs-rechte-patronen', origin: 'vercel' }, // vercel.json:3-7
  { id: 'RD-02', source: '/sv/spjutsgjutning', destination: '/sv/tjanster/formsprutning', origin: 'vercel' }, // vercel.json:8-12
  { id: 'RD-03', source: '/sv/sprutgjutning', destination: '/sv/tjanster/formsprutning', origin: 'vercel' }, // vercel.json:13-17
  { id: 'RD-04', source: '/sv/platarbe', destination: '/sv/tjanster/platbearbetning', origin: 'vercel' }, // vercel.json:18-22
  { id: 'RD-05', source: '/sv/blog/krapplingsoperationer-design-for-diamant-vs-raka-monster', destination: '/sv/blogg/lattring-operationer-design-for-diamant-vs-raka-monster', origin: 'vercel' }, // vercel.json:23-27
  { id: 'RD-06', source: '/sv/blogg/krapplingsoperationer-design-for-diamant-vs-raka-monster', destination: '/sv/blogg/lattring-operationer-design-for-diamant-vs-raka-monster', origin: 'vercel' }, // vercel.json:28-32
  { id: 'RD-07', source: '/da/spjutsgodsning', destination: '/da/tjenester/sprojtestobning', origin: 'vercel' }, // vercel.json:33-37
  { id: 'RD-08', source: '/da/sproejtestoebning', destination: '/da/tjenester/sprojtestobning', origin: 'vercel' }, // vercel.json:38-42
  { id: 'RD-09', source: '/nb/spjutsgjetting', destination: '/nb/tjenester/sproytestoping', origin: 'vercel' }, // vercel.json:43-47
  { id: 'RD-10', source: '/nb/sproyetestoping', destination: '/nb/tjenester/sproytestoping', origin: 'vercel' }, // vercel.json:48-52
  { id: 'RD-11', source: '/it/blog/minimizzare-chiacchiericcio-fresatura-cavita-profonde', destination: '/it/blog/minimizzare-vibrazioni-fresatura-cavita-profonde', origin: 'vercel' }, // vercel.json:53-57
  // Mojibake source (UTF-8 bytes C3 85 C2 84 after "/pl/wyko"), kept byte-identical; see RD-28 for the real URL.
  { id: 'RD-12', source: '/pl/wykoÅ\u0084czenie-powierzchni', destination: '/pl/uslugi/wykonczenie-powierzchni', origin: 'vercel' }, // vercel.json:58-62
  { id: 'RD-13', source: '/dawycena', destination: '/pl/wycena', origin: 'vercel' }, // vercel.json:63-67
  // Inside the /{lang}/* matcher: must redirect before the SEO handler (router step 1 before step 4).
  { id: 'RD-14', source: '/en/dawycena', destination: '/pl/wycena', origin: 'vercel' }, // vercel.json:68-72
  { id: 'RD-15', source: '/danotre-travail', destination: '/fr/notre-travail', origin: 'vercel' }, // vercel.json:73-77
  { id: 'RD-16', source: '/csservicos/usinagem-cnc', destination: '/pt/servicos/usinagem-cnc', origin: 'vercel' }, // vercel.json:78-82
  { id: 'RD-17', source: '/daservices/sheet-metal', destination: '/da/tjenester/pladearbejde', origin: 'vercel' }, // vercel.json:83-87
  { id: 'RD-18', source: '/deservicos/prototipagem-rapida', destination: '/pt/servicos/prototipagem-rapida', origin: 'vercel' }, // vercel.json:88-92
  { id: 'RD-19', source: '/daservices/impression-3d', destination: '/fr/services/impression-3d', origin: 'vercel' }, // vercel.json:93-97
  { id: 'RD-20', source: '/nbservicos/prototipagem-rapida', destination: '/pt/servicos/prototipagem-rapida', origin: 'vercel' }, // vercel.json:98-102
  { id: 'RD-21', source: '/svorcamento', destination: '/sv/offert', origin: 'vercel' }, // vercel.json:103-107
  { id: 'RD-22', source: '/huorcamento', destination: '/hu/ajanlat', origin: 'vercel' }, // vercel.json:108-112
  { id: 'RD-23', source: '/itorcamento', destination: '/it/preventivo', origin: 'vercel' }, // vercel.json:113-117
  { id: 'RD-24', source: '/daorcamento', destination: '/da/tilbud', origin: 'vercel' }, // vercel.json:118-122
  { id: 'RD-25', source: '/deorcamento', destination: '/de/angebot', origin: 'vercel' }, // vercel.json:123-127
  // Client-only entries: documented parity deviation 200 -> 308 (SEO_PARITY.md AL-001…AL-003).
  { id: 'RD-26', source: '/csoffert', destination: '/cs/nabidka', origin: 'client' }, // src/components/SEORedirects.tsx:43
  { id: 'RD-27', source: '/enoffert', destination: '/en/quote', origin: 'client' }, // src/components/SEORedirects.tsx:57
  // Also reached as /pl/wyko%C5%84czenie-powierzchni (SEORedirects.tsx:40) through the decoded match.
  { id: 'RD-28', source: '/pl/wykończenie-powierzchni', destination: '/pl/uslugi/wykonczenie-powierzchni', origin: 'client' }, // src/components/SEORedirects.tsx:39-40
];

const BY_SOURCE: ReadonlyMap<string, RedirectRule> = new Map(REDIRECTS.map((rule) => [rule.source, rule]));

// NFC-normalised decoded pathname, or null when the pathname is not valid percent-encoded UTF-8.
function decodedPath(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname).normalize('NFC');
  } catch {
    return null;
  }
}

export function findRedirect(url: URL): RedirectRule | null {
  const raw = BY_SOURCE.get(url.pathname);
  if (raw) return raw;
  const decoded = decodedPath(url.pathname);
  return (decoded !== null && BY_SOURCE.get(decoded)) || null;
}

export function matchRedirect(url: URL): Response | null {
  const rule = findRedirect(url);
  if (!rule) return null;
  // url.search is '' without a query and '?…' otherwise (a bare '?' is dropped, as by the URL parser).
  return new Response(null, {
    status: REDIRECT_STATUS,
    headers: { Location: rule.destination + url.search },
  });
}
