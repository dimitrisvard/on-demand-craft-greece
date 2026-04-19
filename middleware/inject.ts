import { Lang, LANGUAGES, PageMeta, SITE_BASE } from './types';

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function buildHreflangTags(pathFor: (lang: Lang) => string): string {
  const tags: string[] = [];
  for (const l of LANGUAGES) {
    tags.push(`<link rel="alternate" hreflang="${l}" href="${SITE_BASE}${pathFor(l)}" />`);
  }
  tags.push(`<link rel="alternate" hreflang="x-default" href="${SITE_BASE}${pathFor('en')}" />`);
  return tags.join('\n    ');
}

export interface RewriteInput {
  meta: PageMeta;
  lang: Lang;
  canonicalPath: string;
  hreflangTags: string;
  jsonLdBlocks?: string[]; // each is raw JSON text (already stringified)
  bodyHtml?: string;        // crawler-only SEO body block content
}

export function rewriteHtml(html: string, input: RewriteInput): string {
  const { meta, lang, canonicalPath, hreflangTags, jsonLdBlocks = [], bodyHtml } = input;
  let result = html;

  result = result.replace(/<html\s+lang="[^"]*"/, `<html lang="${lang}"`);
  result = result.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(meta.title)}</title>`);
  result = result.replace(
    /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/,
    `<meta name="description" content="${escapeHtml(meta.description)}" />`
  );

  result = result.replace(/<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/,
    `<meta property="og:title" content="${escapeHtml(meta.title)}" />`);
  result = result.replace(/<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/,
    `<meta property="og:description" content="${escapeHtml(meta.description)}" />`);
  result = result.replace(/<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/,
    `<meta property="og:url" content="${SITE_BASE}${canonicalPath}" />`);
  result = result.replace(/<meta\s+property="og:type"\s+content="[^"]*"\s*\/?>/,
    `<meta property="og:type" content="${meta.ogType}" />`);
  result = result.replace(/<meta\s+property="og:image"\s+content="[^"]*"\s*\/?>/,
    `<meta property="og:image" content="${escapeHtml(meta.image)}" />`);
  result = result.replace(/<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?>/,
    `<meta name="twitter:title" content="${escapeHtml(meta.title)}" />`);
  result = result.replace(/<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/?>/,
    `<meta name="twitter:description" content="${escapeHtml(meta.description)}" />`);
  result = result.replace(/<meta\s+name="twitter:image"\s+content="[^"]*"\s*\/?>/,
    `<meta name="twitter:image" content="${escapeHtml(meta.image)}" />`);

  const injections = [
    `<link rel="canonical" href="${SITE_BASE}${canonicalPath}" />`,
    hreflangTags,
  ];
  for (const block of jsonLdBlocks) {
    injections.push(`<script type="application/ld+json">\n    ${block}\n    </script>`);
  }
  result = result.replace('</head>', `    ${injections.join('\n    ')}\n  </head>`);

  if (bodyHtml) {
    const block = `
    <article id="seo-content" lang="${lang}" hidden aria-hidden="true">
      ${bodyHtml}
    </article>`;
    result = result.replace(/(<body[^>]*>)/, `$1${block}`);
  }

  return result;
}
