import { describe, expect, it } from 'vitest';
import { decodeXmlText, parseListObjectsV2, parseS3Error } from '../../src/storage/s3-xml';

const HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>b</Name><Prefix>RFQ-1/</Prefix><KeyCount>3</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>';

function contents(key: string, lastModified = '2026-10-01T08:00:00.000Z'): string {
  return `<Contents><Key>${key}</Key><LastModified>${lastModified}</LastModified><ETag>&quot;abc&quot;</ETag><Size>12</Size><StorageClass>STANDARD</StorageClass></Contents>`;
}

describe('parseListObjectsV2', () => {
  it('returns Key and LastModified of each Contents entry in document order', () => {
    const xml = `${HEAD}${contents('RFQ-1/a.step')}${contents('RFQ-1/b.pdf', '2026-10-02T09:30:00.000Z')}</ListBucketResult>`;
    expect(parseListObjectsV2(xml)).toEqual([
      { key: 'RFQ-1/a.step', lastModified: '2026-10-01T08:00:00.000Z' },
      { key: 'RFQ-1/b.pdf', lastModified: '2026-10-02T09:30:00.000Z' },
    ]);
  });

  it('decodes escaped keys (named and numeric references)', () => {
    const xml = `${HEAD}${contents('RFQ-1/a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos; &#65;&#x42;&#x1F600;.pdf')}</ListBucketResult>`;
    expect(parseListObjectsV2(xml)[0].key).toBe('RFQ-1/a & b <c> "d" \'e\' AB\u{1F600}.pdf');
  });

  it('decodes once: an escaped entity stays literal text', () => {
    expect(parseListObjectsV2(`${HEAD}${contents('a&amp;amp;b')}</ListBucketResult>`)[0].key).toBe('a&amp;b');
  });

  it('returns an empty list for an empty result and skips entries without a key', () => {
    expect(parseListObjectsV2(`${HEAD}</ListBucketResult>`)).toEqual([]);
    expect(parseListObjectsV2(`${HEAD}<Contents><Size>1</Size></Contents>${contents('x')}</ListBucketResult>`)).toEqual([
      { key: 'x', lastModified: '2026-10-01T08:00:00.000Z' },
    ]);
  });

  it('reads a key that looks like markup only as text', () => {
    const xml = `${HEAD}${contents('RFQ-1/&lt;/Contents&gt;&lt;Contents&gt;&lt;Key&gt;evil')}</ListBucketResult>`;
    expect(parseListObjectsV2(xml)).toEqual([{ key: 'RFQ-1/</Contents><Contents><Key>evil', lastModified: '2026-10-01T08:00:00.000Z' }]);
  });

  it('keeps a missing LastModified as an empty string', () => {
    expect(parseListObjectsV2(`${HEAD}<Contents><Key>k</Key></Contents></ListBucketResult>`)).toEqual([{ key: 'k', lastModified: '' }]);
  });
});

describe('parseS3Error and decodeXmlText', () => {
  it('reads Code and Message of an error document', () => {
    expect(parseS3Error('<?xml version="1.0"?><Error><Code>AccessDenied</Code><Message>Access Denied</Message><RequestId>1</RequestId></Error>')).toEqual({
      code: 'AccessDenied',
      message: 'Access Denied',
    });
    expect(parseS3Error('')).toEqual({ code: null, message: null });
  });

  it('keeps references outside the Unicode range as written', () => {
    expect(decodeXmlText('a&#x110000;b')).toBe('a&#x110000;b');
  });
});
