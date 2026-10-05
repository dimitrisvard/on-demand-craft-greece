// IN-2 / I-2: raw-MIME edge cases with postal-mime in Node (T2 injects composed messages only): every synthetic
// fixture of test/fixtures/mime parses into the expected headers, text and attachment kinds.

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMime } from '../../src/mail-in/parse';
import { stripQuoted } from '../../src/mail-in/quote-strip';
import { sniffKind } from '../../src/mail-in/sniff';

const DIR = new URL('../fixtures/mime/', import.meta.url);
const raw = (name: string) => new Uint8Array(readFileSync(new URL(name, DIR)));

async function kinds(name: string) {
  const parsed = await parseMime(raw(name));
  return parsed.attachments.map((a) => [a.filename, sniffKind(a.content, a.filename, a.mime), Boolean(a.inline)]);
}

describe('MIME fixtures', () => {
  it('the fixture set holds 13 synthetic messages with example domains only', () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith('.eml')).sort();
    expect(files).toHaveLength(13);
    for (const f of files) {
      const text = readFileSync(new URL(f, DIR), 'utf8');
      for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g)) {
        expect(m[1], `${f}: ${m[1]}`).toMatch(/(^|\.)example\.(com|de|gr|net)$/);
      }
    }
  });

  it('EN RFQ with STEP and PDF: headers, text and kinds', async () => {
    const p = await parseMime(raw('en-step-pdf.eml'));
    expect(p.headers).toMatchObject({
      message_id: '<rfq-en-step-pdf-001@mail.example.com>',
      in_reply_to: null,
      references: [],
      from_email: 'anna.becker@example.com',
      from_name: 'Anna Becker',
      to: ['rfq@example.com'],
      subject: 'RFQ: 50 laser-cut brackets',
      auto_submitted: null,
      authentication_results: [expect.stringContaining('dmarc=pass')],
    });
    expect(p.text).toContain('Quantity: 50 pcs');
    expect(p.from_html).toBe(false);
    expect(await kinds('en-step-pdf.eml')).toEqual([['bracket.step', 'step', false], ['drawing BR-100.pdf', 'pdf', false]]);
  });

  it('encoded words in From and Subject (DE, EL) decode to UTF-8', async () => {
    const de = await parseMime(raw('de-sheet-metal-step.eml'));
    expect(de.headers.from_name).toBe('Hans Müller');
    expect(de.headers.subject).toBe('Anfrage Kantteile Winkel W-20');
    expect(de.text).toContain('Blechdicke 1,5 mm');
    const el = await parseMime(raw('el-dxf.eml'));
    expect(el.headers.from_name).toBe('Γιώργος Παπαδόπουλος');
    expect(el.headers.subject).toBe('Ζήτηση προσφοράς: λαμαρίνα κοπή laser');
    expect(await kinds('el-dxf.eml')).toEqual([['plate.dxf', 'dxf', false]]);
  });

  it('HTML-only bodies become text; inline images are marked; binary STL is recognised', async () => {
    const pl = await parseMime(raw('pl-stl-image.eml'));
    expect(pl.from_html).toBe(true);
    expect(pl.text).toContain('prosimy o ofertę na frezowanie CNC 10 sztuk');
    expect(pl.text).toContain('±0,02 mm');
    expect(pl.text).not.toMatch(/<|cid:/);
    expect(await kinds('pl-stl-image.eml')).toEqual([['logo.png', 'image', true], ['obudowa.stl', 'stl', false], ['zdjecie.png', 'image', false]]);
    const html = await parseMime(raw('en-no-attachment.eml'));
    expect(html.from_html).toBe(true);
    expect(html.text).toBe('Good afternoon,\n\ncould you quote 500 turned shafts, stainless steel 1.4305, diameter 12 mm, length 80 mm, tolerance h7 on the bearing seat?\n\nRegards,\nMark Taylor\nExample Motion Ltd');
    expect(html.attachments).toEqual([]);
  });

  it('ZIP attachment, auto-reply, bounce and missing Message-ID headers', async () => {
    expect(await kinds('en-zip.eml')).toEqual([['parts.zip', 'zip', false]]);
    const auto = await parseMime(raw('auto-reply.eml'));
    expect(auto.headers.auto_submitted).toBe('auto-replied');
    const bounce = await parseMime(raw('bounce.eml'));
    expect(bounce.headers.content_type).toMatch(/^multipart\/report/);
    expect(bounce.headers.from_email).toBe('MAILER-DAEMON@example.com');
    const none = await parseMime(raw('no-message-id.eml'));
    expect(none.headers.message_id).toBeNull();
  });

  it('a reply keeps In-Reply-To and References in order; quote stripping leaves the new text', async () => {
    const reply = await parseMime(raw('reply-known-quote.eml'));
    expect(reply.headers.in_reply_to).toBe('<q.11111111-2222-4333-8444-555555555555.0@rfq.example.com>');
    expect(reply.headers.references).toEqual(['<rfq-en-step-pdf-001@mail.example.com>', '<q.11111111-2222-4333-8444-555555555555.0@rfq.example.com>']);
    expect(stripQuoted(reply.text)).toBe('Thank you, we accept the quotation and will send the purchase order today.');
  });

  it('a forwarded notification keeps its forwarded content', async () => {
    const tp = await parseMime(raw('techpilot.eml'));
    expect(stripQuoted(tp.text)).toContain('1.000 Stück Drehteile, Werkstoff 1.0718');
  });
});
