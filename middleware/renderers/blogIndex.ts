import { Lang, SITE_BASE } from '../types';
import { t } from '../i18n';
import { localizedPath } from '../slugs';
import { escapeHtml, renderFooterLinks, renderBreadcrumbs } from './common';
import { itemListSchema, breadcrumbSchema } from '../schema';

interface ArticleListItem {
  title: string;
  slug: string;
  excerpt: string | null;
  created_at: string;
}

export async function renderBlogIndex(
  lang: Lang,
  fetchArticles: () => Promise<ArticleListItem[]>
): Promise<{ bodyHtml: string; jsonLd: string[] }> {
  const title = t(lang, 'blog_title', 'Blog');
  const subtitle = t(lang, 'blog_subtitle',
    'Insights, news, and technical articles about manufacturing and engineering.');
  const homeLabel = t(lang, 'home_title', 'Home');

  const crumbs = [
    { label: homeLabel, href: localizedPath(lang, 'homepage') },
    { label: title, href: localizedPath(lang, 'blog-index') },
  ];

  let articles: ArticleListItem[] = [];
  try {
    articles = await Promise.race([
      fetchArticles(),
      new Promise<ArticleListItem[]>((resolve) => setTimeout(() => resolve([]), 500)),
    ]);
  } catch {
    articles = [];
  }

  const items = articles.length === 0
    ? `    <p>${escapeHtml(subtitle)}</p>`
    : articles.map((a) => `    <article>
      <h2><a href="${localizedPath(lang, 'blog-article', a.slug)}">${escapeHtml(a.title)}</a></h2>
      ${a.excerpt ? `<p>${escapeHtml(a.excerpt)}</p>` : ''}
    </article>`).join('\n');

  const bodyHtml = `
  <header>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(subtitle)}</p>
  </header>
${renderBreadcrumbs(lang, crumbs)}
  <section>
${items}
  </section>
${renderFooterLinks(lang)}
`;

  const jsonLd = [
    itemListSchema(articles.map((a) => ({
      name: a.title,
      url: `${SITE_BASE}${localizedPath(lang, 'blog-article', a.slug)}`,
    }))),
    breadcrumbSchema(lang, crumbs.map((c) => ({ name: c.label, path: c.href }))),
  ];

  return { bodyHtml, jsonLd };
}
