// ListObjectsV2 XML parsing (Key and LastModified of each Contents entry, XML entities decoded), and the
// Code/Message pair of an S3 error document. S3 answers plain XML without CDATA, so a small scanner is enough;
// a Contents entry without a Key is skipped.

const ENTITY = /&(?:#x([0-9a-fA-F]+)|#([0-9]+)|(amp|lt|gt|quot|apos));/g;
const NAMED: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Decodes the five predefined XML entities and numeric character references. */
export function decodeXmlText(text: string): string {
  return text.replace(ENTITY, (whole, hex: string | undefined, dec: string | undefined, name: string | undefined) => {
    if (name) return NAMED[name];
    const code = hex !== undefined ? parseInt(hex, 16) : parseInt(dec as string, 10);
    // A reference outside the Unicode range is not a character: keep it as written.
    if (!Number.isFinite(code) || code > 0x10ffff) return whole;
    return String.fromCodePoint(code);
  });
}

/** Text of the first <tag>…</tag> inside `xml`, decoded; null when absent. */
function firstElementText(xml: string, tag: string): string | null {
  const open = xml.indexOf(`<${tag}>`);
  if (open === -1) return null;
  const start = open + tag.length + 2;
  const close = xml.indexOf(`</${tag}>`, start);
  if (close === -1) return null;
  return decodeXmlText(xml.slice(start, close));
}

export function parseListObjectsV2(xml: string): Array<{ key: string; lastModified: string }> {
  const out: Array<{ key: string; lastModified: string }> = [];
  let from = 0;
  for (;;) {
    const open = xml.indexOf('<Contents>', from);
    if (open === -1) break;
    const close = xml.indexOf('</Contents>', open);
    if (close === -1) break;
    const entry = xml.slice(open + '<Contents>'.length, close);
    from = close + '</Contents>'.length;
    const key = firstElementText(entry, 'Key');
    if (!key) continue;
    out.push({ key, lastModified: firstElementText(entry, 'LastModified') ?? '' });
  }
  return out;
}

/** Code and Message of an S3 error document (<Error><Code>…</Code><Message>…</Message></Error>). */
export function parseS3Error(xml: string): { code: string | null; message: string | null } {
  return { code: firstElementText(xml, 'Code'), message: firstElementText(xml, 'Message') };
}
