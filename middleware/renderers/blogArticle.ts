import { Lang } from '../types';
import { t } from '../i18n';
import { escapeHtml, renderFooterLinks, renderBreadcrumbs } from './common';

interface RenderArticleInput {
  lang: Lang;
  title: string;
  content: string | null;
  featuredImage: string | null;
  featuredImageAlt: string | null;
  createdAt: string;
  updatedAt: string;
  blogIndexPath: string;
}

/**
 * Render an article row into the SEO body block. The articles.content column
 * already contains HTML, so it's injected verbatim inside a semantic <article>
 * wrapper with h1, byline, and hero image. Crawlers pick up the full prose;
 * hydration isn't affected because this lives in the hidden seo-content
 * sibling of <div id="root">.
 */
export function renderArticleFromRow(input: RenderArticleInput): string {
  const {
    lang, title, content, featuredImage, featuredImageAlt,
    createdAt, updatedAt, blogIndexPath,
  } = input;

  const homeLabel = t(lang, 'home_title', 'Home');
  const blogLabel = t(lang, 'blog_title', 'Blog');
  const crumbs = [
    { label: homeLabel, href: `/${lang}` },
    { label: blogLabel, href: blogIndexPath },
    { label: title, href: '#' },
  ];

  const publishedIso = createdAt || '';
  const modifiedIso = updatedAt || createdAt || '';
  const publishedDisplay = publishedIso ? escapeHtml(publishedIso.slice(0, 10)) : '';

  const hero = featuredImage
    ? `  <figure>
    <img src="${escapeHtml(featuredImage)}" alt="${escapeHtml(featuredImageAlt || title)}" />
  </figure>`
    : '';

  const byline = publishedDisplay
    ? `  <p><time datetime="${escapeHtml(publishedIso)}">${publishedDisplay}</time></p>`
    : '';

  // article.content is already HTML from the DB. Inject as-is.
  const body = content ?? '';

  return `
  <article>
    <header>
      <h1>${escapeHtml(title)}</h1>
${byline}
    </header>
${renderBreadcrumbs(lang, crumbs)}
${hero}
    <div>
${body}
    </div>
    <footer>
      <p><a href="${blogIndexPath}">&larr; ${escapeHtml(t(lang, 'blog_back_to_blog', 'Back to Blog'))}</a></p>
      <p><time datetime="${escapeHtml(modifiedIso)}">${escapeHtml(modifiedIso.slice(0, 10))}</time></p>
    </footer>
  </article>
${renderFooterLinks(lang)}
`;
}
