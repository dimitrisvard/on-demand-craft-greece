// IN-2 / I-2 (pure helpers of src/mail-in): incremental SHA-256, Authentication-Results selection, safe names and
// keys, UUIDv5, type sniffing, quote stripping and HTML-to-text.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { authResultsOf, CF_AUTHSERV_ID, dmarcPass, domainOf, fromDomainMismatch, parseInstance, stripComments } from '../../src/mail-in/auth-results';
import { htmlToText, messageIdTokens } from '../../src/mail-in/parse';
import { quoteStart, stripQuoted } from '../../src/mail-in/quote-strip';
import { attachmentKey, bodyTextKey, displayName, rawKey, rfqFileLocation, safeName, uuidV5 } from '../../src/mail-in/safe-name';
import { Sha256 } from '../../src/mail-in/sha256';
import { contentTypeFor, sniffKind } from '../../src/mail-in/sniff';
import { buildZip } from './zip-builder';

const SHA = 'a'.repeat(64);
const enc = (s: string) => new TextEncoder().encode(s);

describe('Sha256 (incremental)', () => {
  it('equals node:crypto for empty, one-block, multi-block and chunked inputs', () => {
    const cases = ['', 'abc', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'y'.repeat(1000)];
    for (const text of cases) {
      expect(new Sha256().update(enc(text)).hex()).toBe(createHash('sha256').update(text).digest('hex'));
    }
    const big = new Uint8Array(200_003).map((_, i) => (i * 31 + 7) & 0xff);
    const h = new Sha256();
    for (let i = 0; i < big.length; i += 777) h.update(big.subarray(i, i + 777));
    expect(h.hex()).toBe(createHash('sha256').update(big).digest('hex'));
  });

  it('refuses an update after the digest', () => {
    const h = new Sha256();
    h.hex();
    expect(() => h.update(enc('x'))).toThrow(/after digest/);
  });
});

describe('Authentication-Results', () => {
  const trustedHeader = 'mx.trusted.example; spf=pass smtp.mailfrom=example.de; dkim=pass header.d=example.de; dmarc=pass (p=reject) header.from=example.de';
  const forged = 'mx.trusted.example; dmarc=pass header.from=example.de';

  it('is not pinned yet: every message reads none and untrusted, the topmost authserv-id is recorded for pinning', () => {
    expect(CF_AUTHSERV_ID).toBeNull();
    const r = authResultsOf([trustedHeader]);
    expect(r).toEqual({ v: 1, trusted: false, authserv_id: 'mx.trusted.example', spf: 'none', dkim: 'none', dmarc: 'none', dmarc_from_domain: null, raw_count: 1 });
    expect(dmarcPass(r, 'h.mueller@example.de')).toBe(false);
  });

  it('with a pinned id only the topmost instance carrying that id counts; other instances are ignored', () => {
    const r = authResultsOf([trustedHeader, 'evil.example; dmarc=fail header.from=example.de'], 'MX.TRUSTED.EXAMPLE');
    expect(r).toMatchObject({ trusted: true, spf: 'pass', dkim: 'pass', dmarc: 'pass', dmarc_from_domain: 'example.de', raw_count: 2 });
    expect(dmarcPass(r, 'H.Mueller@Example.DE')).toBe(true);
    // An instance with another authserv-id, even on top, is never trusted.
    const other = authResultsOf(['relay.example; dmarc=pass header.from=example.com'], 'mx.trusted.example');
    expect(other).toMatchObject({ trusted: false, dmarc: 'none', authserv_id: 'relay.example' });
    // The first instance with the pinned id wins over a lower one.
    expect(authResultsOf([forged.replace('pass', 'fail'), forged], 'mx.trusted.example').dmarc).toBe('fail');
  });

  it('a From domain other than the authenticated header.from is a mismatch and never passes', () => {
    const r = authResultsOf([trustedHeader], 'mx.trusted.example');
    expect(fromDomainMismatch(r, 'someone@example.com')).toBe(true);
    expect(dmarcPass(r, 'someone@example.com')).toBe(false);
    expect(dmarcPass({ ...r, dmarc_from_domain: null }, 'h.mueller@example.de')).toBe(false);
  });

  it('parses comments, versions, several dkim results and none', () => {
    expect(stripComments('a (b (c)) d "e (f)"')).toBe('a  d "e (f)"');
    expect(parseInstance('mx.example 1; dkim=fail header.d=x; dkim=pass header.d=y; spf=softfail')).toEqual({
      authserv_id: 'mx.example',
      results: [
        { method: 'dkim', result: 'fail', props: { 'header.d': 'x' } },
        { method: 'dkim', result: 'pass', props: { 'header.d': 'y' } },
        { method: 'spf', result: 'softfail', props: {} },
      ],
    });
    expect(authResultsOf(['mx.example; dkim=fail; dkim=pass; spf=softfail'], 'mx.example')).toMatchObject({ dkim: 'pass', spf: 'softfail', dmarc: 'none' });
    expect(authResultsOf(['mx.example; none'], 'mx.example')).toMatchObject({ trusted: true, dmarc: 'none' });
    expect(authResultsOf([], 'mx.example')).toMatchObject({ trusted: false, authserv_id: null, raw_count: 0 });
    expect(parseInstance('dmarc=pass')).toBeNull();
    expect(domainOf('A@B.Example')).toBe('b.example');
    expect(domainOf('nope')).toBeNull();
  });
});

describe('safe names, keys and UUIDv5', () => {
  it('sender names are only the last key segment, sanitised, extension kept', () => {
    expect(safeName('../../etc/passwd')).toBe('passwd');
    expect(safeName('C:\\Users\\x\\Zeichnung Ä 1.STEP')).toBe('Zeichnung___1.STEP');
    expect(safeName('a\u0000b\u202e.pdf')).toBe('ab_.pdf');
    expect(safeName('...')).toBe('file');
    const long = safeName(`${'x'.repeat(300)}.step`);
    expect(long).toHaveLength(100);
    expect(long.endsWith('.step')).toBe(true);
    expect(attachmentKey(SHA, 3, '../a b.dxf')).toBe(`email/${SHA}/att/3-a_b.dxf`);
    expect(rawKey(SHA)).toBe(`email/${SHA}/raw.eml`);
    expect(bodyTextKey(SHA)).toBe(`email/${SHA}/body.txt`);
    expect(() => attachmentKey('ABC', 1, 'x')).toThrow();
    expect(() => attachmentKey(SHA, 0, 'x')).toThrow();
  });

  it('rfq file location: file_path without, r2_key with the rfq/ prefix', () => {
    const rfq = '0d6f6c35-2e5a-4f0e-9a56-2c8f4b8a1f10';
    const file = '5f1c0b3e-6d1a-5b2e-8c3d-1a2b3c4d5e6f';
    expect(rfqFileLocation(rfq, file, 'Bracket 1.step')).toEqual({ file_path: `${rfq}/${file}-Bracket_1.step`, r2_key: `rfq/${rfq}/${file}-Bracket_1.step` });
    expect(() => rfqFileLocation('x', file, 'a')).toThrow();
  });

  it('display names keep the sender text without control characters, at most 200 characters', () => {
    expect(displayName('Zeichnung\u0007 Ä.pdf')).toBe('Zeichnung Ä.pdf');
    expect(displayName('  ')).toBe('attachment');
    expect(displayName('y'.repeat(300))).toHaveLength(200);
  });

  it('UUIDv5 matches the RFC 9562 test vector and is stable', async () => {
    // RFC 9562 Appendix A.4: namespace DNS, name www.example.com
    expect(await uuidV5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'www.example.com')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
    const a = await uuidV5('0d6f6c35-2e5a-4f0e-9a56-2c8f4b8a1f10', SHA);
    expect(a).toBe(await uuidV5('0d6f6c35-2e5a-4f0e-9a56-2c8f4b8a1f10', SHA));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('type sniffing (bytes decide, never the name alone)', () => {
  const stl = () => {
    const b = new Uint8Array(84 + 100);
    new DataView(b.buffer).setUint32(80, 2, true);
    return b;
  };
  it.each([
    ['pdf', enc('%PDF-1.7\n...'), 'x.bin', ''],
    ['image', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]), 'a', ''],
    ['image', new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), 'a.dat', ''],
    ['step', enc('\uFEFFISO-10303-21;\nHEADER;'), 'part.txt', ''],
    ['step', enc('  ISO-10303-21 ;'), 'x', ''],
    ['dxf', enc('  0\nSECTION\n  2\nHEADER\n'), 'drawing', ''],
    ['dxf', enc('999\ncreated by test\n0\r\nSECTION\r\n2\r\nENTITIES'), 'x', ''],
    ['dxf', enc('AutoCAD Binary DXF\r\n\u001a\u0000'), 'x', ''],
    ['stl', enc('solid part\n facet normal 0 0 1\n'), 'x', ''],
    ['stl', stl(), 'x', ''],
    ['zip', buildZip([{ name: 'a.step', content: 'x' }]), 'parts.zip', ''],
    ['zip', buildZip([{ name: 'a.step', content: 'x' }]), 'parts', 'application/zip'],
    ['other', buildZip([{ name: 'word/document.xml', content: 'x' }]), 'offer.docx', 'application/zip'],
    ['other', buildZip([{ name: 'a', content: 'x' }]), 'unknown.bin', ''],
    ['other', enc('solid but no triangles'), 'x.stl', ''],
    ['other', enc('just text'), 'model.step', 'model/step'],
  ] as const)('%s <- %s', (kind, bytes, name, mime) => {
    expect(sniffKind(bytes, name, mime)).toBe(kind);
  });

  it('the binary STL rule uses the whole size when only the head is known', () => {
    const head = stl().slice(0, 100);
    expect(sniffKind(head, 'x', '', 184)).toBe('stl');
    expect(sniffKind(head, 'x', '', 185)).toBe('other');
  });

  it('content types follow the kind; a sender type is kept only for other files and only when well formed', () => {
    expect(contentTypeFor('pdf', 'application/octet-stream')).toBe('application/pdf');
    expect(contentTypeFor('image', '', new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('image/png');
    expect(contentTypeFor('step', 'text/plain')).toBe('model/step');
    expect(contentTypeFor('other', 'Application/MSWord')).toBe('application/msword');
    expect(contentTypeFor('other', 'text/html; charset=x')).toBe('application/octet-stream');
  });
});

describe('quote stripping', () => {
  it.each([
    ['en', 'On Mon, 5 Oct 2026 at 16:00, Quotes <q@example.com> wrote:'],
    ['en wrapped', 'On Mon, 5 Oct 2026 at 16:00, Microns Quotations\n<q@example.com> wrote:'],
    ['de', 'Am 05.10.2026 um 16:00 schrieb Hans Müller <h@example.de>:'],
    ['fr', 'Le lun. 5 oct. 2026 à 16:00, Jean <j@example.com> a écrit :'],
    ['it', 'Il giorno lun 5 ott 2026 alle ore 16:00 Marco <m@example.com> ha scritto:'],
    ['es', 'El lun, 5 oct 2026 a las 16:00, Ana (<a@example.com>) escribió:'],
    ['pt', 'Em seg., 5 de out. de 2026 às 16:00, Rui <r@example.com> escreveu:'],
    ['nl', 'Op ma 5 okt 2026 om 16:00 schreef Jan <j@example.com>:'],
    ['el', 'Στις Δευ 5 Οκτ 2026 στις 4:00 μ.μ., ο/η Γιώργος <g@example.com> έγραψε:'],
    ['pl', 'W dniu 5.10.2026 o 16:00, Piotr <p@example.com> napisał:'],
    ['cs', 'Dne 5. 10. 2026 16:00 Jan <j@example.com> napsal(a):'],
    ['hu', '2026. okt. 5., hétfő 16:00 időpontban Péter <p@example.com> ezt írta:'],
    ['ro', 'În lun., 5 oct. 2026 la 16:00, Ion <i@example.com> a scris:'],
    ['sv', 'Den 5 okt. 2026 kl. 16:00 skrev Anna <a@example.com>:'],
    ['tr', '5 Eki 2026 Pzt, 16:00 tarihinde Ali <a@example.com> şunu yazdı:'],
    ['bg', 'На пн, 5.10.2026 г. в 16:00 ч. Иван <i@example.com> написа:'],
    ['outlook', '-----Original Message-----\nFrom: Q <q@example.com>\nSent: Monday'],
    ['outlook de', '-----Ursprüngliche Nachricht-----'],
    ['outlook block', '________________________________\nVon: Q <q@example.com>\nGesendet: Montag, 5. Oktober 2026 16:00\nAn: x'],
    ['header block', 'From: Q <q@example.com>\nSent: Monday, 5 October 2026 16:00\nTo: x\nSubject: y'],
  ])('%s reply header cuts the history', (_lang, header) => {
    const text = `Thank you, we accept the offer and send the order today.\n\n${header}\nOld quoted text that must go.`;
    expect(stripQuoted(text)).toBe('Thank you, we accept the offer and send the order today.');
  });

  it('removes > lines, keeps a forwarded message whose own text is too short, normalises line endings', () => {
    expect(stripQuoted('New part request for 20 pcs.\r\n> old line\r\n>> older\r\nThanks')).toBe('New part request for 20 pcs.\nThanks');
    const forward = 'FYI\n\n-----Original Message-----\nFrom: Client <c@example.com>\nSent: Monday\n\nPlease quote 20 plates.';
    expect(stripQuoted(forward)).toContain('Please quote 20 plates.');
    expect(stripQuoted('a\n\n\n\nb   \n')).toBe('a\n\nb');
    expect(quoteStart(['no history here', 'at 10:00 we cut 4 parts'])).toBe(-1);
  });
});

describe('HTML to text and message ids', () => {
  it('drops scripts, styles and tags, keeps line structure and decodes entities', () => {
    const html = '<html><head><style>p{}</style><script>alert(1)</script></head><body><p>Hello&nbsp;&amp; welcome</p><div>Line 2<br>Line 3</div><table><tr><td>a</td><td>b</td></tr></table>&#x3a9;&#937;&lt;x&gt;<!-- c --></body></html>';
    expect(htmlToText(html)).toBe('Hello & welcome\n\nLine 2\nLine 3\n\na b\n\nΩΩ<x>');
  });

  it('message id tokens keep brackets and case, at most 100', () => {
    expect(messageIdTokens(' <A@x>  <b@Y> junk <c@z>')).toEqual(['<A@x>', '<b@Y>', '<c@z>']);
    expect(messageIdTokens(Array.from({ length: 150 }, (_, i) => `<${i}@x>`).join(' '))).toHaveLength(100);
    expect(messageIdTokens(null)).toEqual([]);
  });
});
