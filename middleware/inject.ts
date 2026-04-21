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
  jsonLdBlocks?: string[];
  bodyHtml?: string;
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
    // Pattern B: SSR content sits OUTSIDE <div id="root">.
    // IMPORTANT: Do NOT use the "hidden" HTML attribute here. The hidden attr
    // tells crawlers (including Googlebot first-pass) to ignore the element,
    // which defeats the entire purpose of SSR body injection. Instead we use
    // a MutationObserver to hide the block via CSS once React renders into #root.
    // For crawlers that don't execute JS, the SSR block remains fully visible
    // and indexable.
    // The observer script runs right after <body> opens, BEFORE the browser
    // has parsed <div id="root"> further down in the body. An older version
    // of this block looked up #root immediately and bailed with `if(!r)return;`
    // because #root didn't exist yet — which meant the observer never attached
    // and #seo-content stayed visible to real users forever. Defer attach()
    // to DOMContentLoaded (or run immediately if parse is already done) so
    // #root is guaranteed to exist when we reach for it. Handle the race
    // where React mounted before the listener fires by checking
    // r.children.length on first attempt and hiding immediately.
    const block = `
    <article id="seo-content" lang="${lang}">
      ${bodyHtml}
    </article>
    <script>
    (function(){
      function hide(){
        var s=document.getElementById('seo-content');
        if(s)s.style.display='none';
      }
      function attach(){
        var r=document.getElementById('root');
        if(!r)return;
        if(r.children.length>0){hide();return;}
        var o=new MutationObserver(function(){
          if(r.children.length>0){hide();o.disconnect();}
        });
        o.observe(r,{childList:true});
      }
      if(document.readyState==='loading'){
        document.addEventListener('DOMContentLoaded',attach);
      }else{
        attach();
      }
    })();
    </script>`;
    result = result.replace(/(<body[^>]*>)/, `$1${block}`);
  }

  return result;
}
