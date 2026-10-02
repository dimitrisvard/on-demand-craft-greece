import { describe, expect, it } from 'vitest';
import vercelJson from '../../../vercel.json';
import { REDIRECTS, matchRedirect } from '../src/redirects';

const ORIGIN = 'https://microns-site.example.workers.dev';

function redirectFor(path: string): Response | null {
  return matchRedirect(new URL(path, ORIGIN));
}

function expectRedirect(path: string, location: string): void {
  const res = redirectFor(path);
  expect(res, path).not.toBeNull();
  expect(res!.status).toBe(308);
  expect(res!.headers.get('Location')).toBe(location);
  expect([...res!.headers.keys()]).toEqual(['location']);
  expect(res!.body).toBeNull();
}

// Request path for each rule: the source itself (the URL parser percent-encodes non-ASCII characters, so the
// non-ASCII sources are only reachable through the decoded match).
const EXPECTED: ReadonlyArray<readonly [id: string, requestPath: string, location: string]> = [
  ['RD-01', '/nl/blog/knoedelen-ontwerpen-voor-diamant-vs-rechte-patronen', '/nl/blog/kartelen-ontwerpen-voor-diamant-vs-rechte-patronen'],
  ['RD-02', '/sv/spjutsgjutning', '/sv/tjanster/formsprutning'],
  ['RD-03', '/sv/sprutgjutning', '/sv/tjanster/formsprutning'],
  ['RD-04', '/sv/platarbe', '/sv/tjanster/platbearbetning'],
  ['RD-05', '/sv/blog/krapplingsoperationer-design-for-diamant-vs-raka-monster', '/sv/blogg/lattring-operationer-design-for-diamant-vs-raka-monster'],
  ['RD-06', '/sv/blogg/krapplingsoperationer-design-for-diamant-vs-raka-monster', '/sv/blogg/lattring-operationer-design-for-diamant-vs-raka-monster'],
  ['RD-07', '/da/spjutsgodsning', '/da/tjenester/sprojtestobning'],
  ['RD-08', '/da/sproejtestoebning', '/da/tjenester/sprojtestobning'],
  ['RD-09', '/nb/spjutsgjetting', '/nb/tjenester/sproytestoping'],
  ['RD-10', '/nb/sproyetestoping', '/nb/tjenester/sproytestoping'],
  ['RD-11', '/it/blog/minimizzare-chiacchiericcio-fresatura-cavita-profonde', '/it/blog/minimizzare-vibrazioni-fresatura-cavita-profonde'],
  // Percent-encoded bytes of the mojibake source (C3 85 C2 84), as the parity tool sends it (SEO_PARITY.md G6).
  ['RD-12', '/pl/wyko%C3%85%C2%84czenie-powierzchni', '/pl/uslugi/wykonczenie-powierzchni'],
  ['RD-13', '/dawycena', '/pl/wycena'],
  ['RD-14', '/en/dawycena', '/pl/wycena'],
  ['RD-15', '/danotre-travail', '/fr/notre-travail'],
  ['RD-16', '/csservicos/usinagem-cnc', '/pt/servicos/usinagem-cnc'],
  ['RD-17', '/daservices/sheet-metal', '/da/tjenester/pladearbejde'],
  ['RD-18', '/deservicos/prototipagem-rapida', '/pt/servicos/prototipagem-rapida'],
  ['RD-19', '/daservices/impression-3d', '/fr/services/impression-3d'],
  ['RD-20', '/nbservicos/prototipagem-rapida', '/pt/servicos/prototipagem-rapida'],
  ['RD-21', '/svorcamento', '/sv/offert'],
  ['RD-22', '/huorcamento', '/hu/ajanlat'],
  ['RD-23', '/itorcamento', '/it/preventivo'],
  ['RD-24', '/daorcamento', '/da/tilbud'],
  ['RD-25', '/deorcamento', '/de/angebot'],
  ['RD-26', '/csoffert', '/cs/nabidka'],
  ['RD-27', '/enoffert', '/en/quote'],
  ['RD-28', '/pl/wyko%C5%84czenie-powierzchni', '/pl/uslugi/wykonczenie-powierzchni'],
];

describe('redirect table', () => {
  it('has RD-01…RD-28 in order', () => {
    expect(REDIRECTS.map((r) => r.id)).toEqual(EXPECTED.map(([id]) => id));
    expect(new Set(REDIRECTS.map((r) => r.source)).size).toBe(28);
  });

  it('RD-01…RD-25 equal JSON.parse(vercel.json).redirects byte for byte, in file order', () => {
    const fromVercel = (vercelJson as { redirects: Array<{ source: string; destination: string; permanent: boolean }> }).redirects;
    expect(fromVercel).toHaveLength(25);
    expect(fromVercel.every((r) => r.permanent === true)).toBe(true);
    const table = REDIRECTS.slice(0, 25);
    expect(table.map((r) => ({ source: r.source, destination: r.destination }))).toEqual(
      fromVercel.map((r) => ({ source: r.source, destination: r.destination })),
    );
    expect(table.every((r) => r.origin === 'vercel')).toBe(true);
    // RD-12 keeps the mojibake bytes.
    const bytes = (s: string) => Array.from(new TextEncoder().encode(s));
    expect(bytes(REDIRECTS[11].source)).toEqual(bytes(fromVercel[11].source));
    expect(bytes(REDIRECTS[11].source).slice(8, 12)).toEqual([0xc3, 0x85, 0xc2, 0x84]);
    expect(REDIRECTS[11].source).toBe('/pl/wykoÅ\u0084czenie-powierzchni');
  });

  it('RD-26…RD-28 are the client-only entries of SEORedirects.tsx', () => {
    expect(REDIRECTS.slice(25).map((r) => [r.id, r.source, r.destination, r.origin])).toEqual([
      ['RD-26', '/csoffert', '/cs/nabidka', 'client'],
      ['RD-27', '/enoffert', '/en/quote', 'client'],
      ['RD-28', '/pl/wykończenie-powierzchni', '/pl/uslugi/wykonczenie-powierzchni', 'client'],
    ]);
  });

  for (const [id, path, location] of EXPECTED) {
    it(`${id}: ${path} -> 308 ${location}`, () => {
      expectRedirect(path, location);
    });
  }

  it('RD-12 also matches its source written with the literal characters', () => {
    expectRedirect('/pl/wykoÅ\u0084czenie-powierzchni', '/pl/uslugi/wykonczenie-powierzchni');
  });

  it('RD-28 matches the literal, the encoded and the decomposed (NFD) forms', () => {
    expectRedirect('/pl/wykończenie-powierzchni', '/pl/uslugi/wykonczenie-powierzchni');
    expectRedirect('/pl/wyko%c5%84czenie-powierzchni', '/pl/uslugi/wykonczenie-powierzchni');
    expectRedirect('/pl/wykon%CC%81czenie-powierzchni', '/pl/uslugi/wykonczenie-powierzchni');
  });

  it('an ASCII source reached through percent-encoding still redirects (decoded match)', () => {
    expectRedirect('/dawycen%61', '/pl/wycena');
  });

  it('preserves the query string', () => {
    expectRedirect('/deorcamento?utm_source=parity', '/de/angebot?utm_source=parity');
    expectRedirect('/en/dawycena?a=1&b=%C3%B6', '/pl/wycena?a=1&b=%C3%B6');
    expectRedirect('/pl/wyko%C5%84czenie-powierzchni?x=1', '/pl/uslugi/wykonczenie-powierzchni?x=1');
    // A bare "?" carries no query.
    expectRedirect('/csoffert?', '/cs/nabidka');
  });

  it('ignores the fragment', () => {
    expectRedirect('/enoffert#top', '/en/quote');
  });

  it.each([
    ['/dawycena/'],
    ['/DAWYCENA'],
    ['/Dawycena'],
    ['/en/dawycena/'],
    ['/EN/dawycena'],
    ['/deorcamento/x'],
    ['/xdeorcamento'],
    ['/pl/wykonczenie-powierzchni'],
    ['/pl/wyko%C5%84czenie-powierzchni/'],
    ['/pl/wyko%E9czenie-powierzchni'], // invalid UTF-8: decode error is guarded
    ['/%'],
    ['/'],
    ['/en'],
    // Client regex patterns (RD-P1, RD-P2) are not ported.
    ['/frdevis'],
    ['/ESorcamento'],
    ['/en/frdevis'],
    ['/de/PLwycena'],
  ])('near miss %s -> null', (path) => {
    expect(redirectFor(path)).toBeNull();
  });
});
