/**
 * Vercel Routing Middleware — SEO Meta Injection for Microns Hub
 *
 * Problem: Every page returns the same static index.html with generic English meta tags.
 * Solution: This middleware intercepts public-facing pages and rewrites the <head> section
 * with per-page, per-language SEO metadata before the response reaches the browser/crawler.
 *
 * Covers: homepages (14 langs), service pages (6 × 14), industry pages (14), blog articles (~1200).
 * Does NOT affect: /dashboard, /api, /assets, /login, /laserkritis, etc.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const SUPABASE_URL = 'https://cfjrtmtaitwzggzpkhxi.supabase.co';
const DEFAULT_IMAGE = 'https://www.micronshub.eu/lovable-uploads/a27a8329-2c4a-4b05-b1c4-b200b903617e.png';
const SITE_BASE = 'https://www.micronshub.eu';
const LANGUAGES = ['en', 'de', 'fr', 'es', 'it', 'nl', 'pl', 'pt', 'sv', 'da', 'fi', 'nb', 'hu', 'cs'] as const;
type Lang = typeof LANGUAGES[number];

// In-memory cache for article metadata (survives within a single Edge instance)
const articleCache = new Map<string, { data: ArticleMeta | null; expires: number }>();
const translationCache = new Map<string, { data: TranslationMap; expires: number }>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

// ─── Types ────────────────────────────────────────────────────────────────────

interface ArticleMeta {
  title: string;
  slug: string;
  meta_title: string | null;
  meta_description: string | null;
  excerpt: string | null;
  featured_image: string | null;
  featured_image_alt: string | null;
  language: string;
  created_at: string;
  updated_at: string;
  translation_id: string | null;
  content: string | null;
}

type TranslationMap = Record<string, string>; // lang → slug

interface PageMeta {
  title: string;
  description: string;
  ogType: string;
  image: string;
  structuredData?: string;
  articleContent?: string; // Full HTML body for crawler injection
}

// ─── Bot / Crawler Detection ─────────────────────────────────────────────────

const BOT_UA_PATTERN = /googlebot|bingbot|yandexbot|duckduckbot|baiduspider|slurp|facebot|ia_archiver|semrushbot|ahrefsbot|dotbot|petalbot|mj12bot|sogou|applebot/i;

function isCrawler(request: Request): boolean {
  const ua = request.headers.get('user-agent') || '';
  return BOT_UA_PATTERN.test(ua);
}

// ─── Supabase Helpers ─────────────────────────────────────────────────────────

function getAnonKey(): string {
  // Edge Runtime exposes process.env directly (not via globalThis)
  try {
    return process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
  } catch {
    return '';
  }
}

async function fetchArticleMeta(lang: string, slug: string, includeContent = false): Promise<ArticleMeta | null> {
  const cacheKey = `${lang}:${slug}:${includeContent ? 'full' : 'meta'}`;
  const cached = articleCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.data;

  const anonKey = getAnonKey();
  if (!anonKey) return null;

  const selectFields = 'title,slug,meta_title,meta_description,excerpt,featured_image,featured_image_alt,language,created_at,updated_at,translation_id'
    + (includeContent ? ',content' : '');

  try {
    const url = `${SUPABASE_URL}/rest/v1/articles?slug=eq.${encodeURIComponent(slug)}&language=eq.${lang}&status=eq.published&select=${selectFields}&limit=1`;
    const res = await fetch(url, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const article = data?.[0] ?? null;
    articleCache.set(cacheKey, { data: article, expires: Date.now() + CACHE_TTL });
    return article;
  } catch {
    return null;
  }
}

async function fetchTranslationSlugs(translationId: string): Promise<TranslationMap> {
  const cached = translationCache.get(translationId);
  if (cached && cached.expires > Date.now()) return cached.data;

  const anonKey = getAnonKey();
  if (!anonKey) return {};

  try {
    const url = `${SUPABASE_URL}/rest/v1/articles?translation_id=eq.${translationId}&status=eq.published&select=language,slug`;
    const res = await fetch(url, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
    });
    if (!res.ok) return {};
    const rows: { language: string; slug: string }[] = await res.json();
    const map: TranslationMap = {};
    for (const row of rows) map[row.language] = row.slug;
    translationCache.set(translationId, { data: map, expires: Date.now() + CACHE_TTL });
    return map;
  } catch {
    return {};
  }
}

// ─── Static Meta Maps ───────────────────────────────────────────────────────────────

const HOMEPAGE_META: Record<string, { title: string; description: string }> = {
  en: { title: 'Microns Hub | On-Demand Manufacturing Platform in Europe', description: 'European on-demand manufacturing platform. CNC machining, sheet metal, 3D printing, injection molding. Fast delivery across Europe from Greece.' },
  de: { title: 'Microns Hub | On-Demand Fertigungsplattform in Europa', description: 'Europäische On-Demand-Fertigungsplattform. CNC-Bearbeitung, Blechbearbeitung, 3D-Druck, Spritzguss. Schnelle Lieferung in ganz Europa.' },
  fr: { title: 'Microns Hub | Plateforme de fabrication à la demande en Europe', description: 'Plateforme européenne de fabrication à la demande. Usinage CNC, tôlerie, impression 3D, moulage par injection. Livraison rapide en Europe.' },
  es: { title: 'Microns Hub | Plataforma de fabricación bajo demanda en Europa', description: 'Plataforma europea de fabricación bajo demanda. Mecanizado CNC, chapa metálica, impresión 3D, moldeo por inyección. Entrega rápida en Europa.' },
  it: { title: 'Microns Hub | Piattaforma di produzione on-demand in Europa', description: 'Piattaforma europea di produzione on-demand. Lavorazione CNC, lamiera, stampa 3D, stampaggio a iniezione. Consegna rapida in Europa.' },
  nl: { title: 'Microns Hub | On-Demand Productieplatform in Europa', description: 'Europees on-demand productieplatform. CNC-bewerkingen, plaatbewerking, 3D-printen, spuitgieten. Snelle levering in heel Europa.' },
  pl: { title: 'Microns Hub | Platforma produkcji na żądanie w Europie', description: 'Europejska platforma produkcji na żądanie. Obróbka CNC, blacharstwo, druk 3D, wtryskiwanie. Szybka dostawa w całej Europie.' },
  pt: { title: 'Microns Hub | Plataforma de fabricação sob demanda na Europa', description: 'Plataforma europeia de fabricação sob demanda. Usinagem CNC, chapa metálica, impressão 3D, moldagem por injeção. Entrega rápida na Europa.' },
  sv: { title: 'Microns Hub | On-Demand Tillverkningsplattform i Europa', description: 'Europeisk on-demand tillverkningsplattform. CNC-bearbetning, plåtbearbetning, 3D-utskrift, formsprejtning. Snabb leverans i hela Europa.' },
  da: { title: 'Microns Hub | On-Demand Produktionsplatform i Europa', description: 'Europæisk on-demand produktionsplatform. CNC-bearbejdning, pladebearbejdning, 3D-print, sprøjtestøbning. Hurtig levering i hele Europa.' },
  fi: { title: 'Microns Hub | Tilauksesta käytettävä tuotantoalusta Euroopassa', description: 'Eurooppalainen tilauksesta käytettävä tuotantoalusta. CNC-työstö, levytyöstö, 3D-tulostus, ruiskuvaalu. Nopea toimitus koko Euroopassa.' },
  nb: { title: 'Microns Hub | On-Demand Produksjonsplattform i Europa', description: 'Europeisk on-demand produksjonsplattform. CNC-bearbeiding, platbearbeid, 3D-printing, sprøytestøping. Rask levering i hele Europa.' },
  hu: { title: 'Microns Hub | Igény szerinti gyártási platform Európában', description: 'Európai igény szerinti gyártási platform. CNC megmunkálás, lemezfeldolgozás, 3D nyomtatás, fröccsöntés. Gyors szállítás egész Európában.' },
  cs: { title: 'Microns Hub | On-Demand Výrobní Platforma v Evropě', description: 'Evropská on-demand výrobní platforma. CNC obrábění, zpracování plechu, 3D tisk, vstřikování. Rychlá dostava po celé Evropě.' },
};

// Service page slugs that match the URL pattern /{lang}/services/{service_slug}
// Note: in the URL these use the ENGLISH slugs because Vercel rewrites all to /index.html
// and the React router handles localized paths. But the monitored URLs use English service paths.
const SERVICE_META: Record<string, Record<string, { title: string; description: string }>> = {
  'cnc-machining': {
    en: { title: 'CNC Machining Services | Precision Parts On-Demand | Microns Hub', description: 'Professional CNC machining services in Europe. Precision milling and turning for prototypes and production. 4-9 day delivery, competitive pricing.' },
    de: { title: 'CNC-Bearbeitung | Präzisionsteile auf Abruf | Microns Hub', description: 'Professionelle CNC-Bearbeitungsdienste in Europa. Präzisionsfräsen und -drehen für Prototypen und Serienproduktion. 4-9 Tage Lieferung.' },
    fr: { title: 'Usinage CNC | Pièces de Précision à la Demande | Microns Hub', description: 'Services d\'usinage CNC professionnels en Europe. Fraisage et tournage de précision pour prototypes et production. Livraison 4-9 jours.' },
    es: { title: 'Mecanizado CNC | Piezas de Precisión bajo Demanda | Microns Hub', description: 'Servicios profesionales de mecanizado CNC en Europa. Fresado y torneado de precisión. Entrega en 4-9 días.' },
    it: { title: 'Lavorazione CNC | Parti di Precisione su Richiesta | Microns Hub', description: 'Servizi professionali di lavorazione CNC in Europa. Fresatura e tornatura di precisione. Consegna in 4-9 giorni.' },
    nl: { title: 'CNC-bewerkingen | Precisieonderdelen op bestelling | Microns Hub', description: 'Professionele CNC-bewerkingsdiensten in Europa. Precisiefrezen en -draaien. Levering in 4-9 dagen.' },
    pl: { title: 'Obróbka CNC | Części Precyzyjne na Żądanie | Microns Hub', description: 'Profesjonalne usługi obróbki CNC w Europie. Precyzyjne frezowanie i toczenie. Dostawa w 4-9 dni.' },
    pt: { title: 'Usinagem CNC | Peças de Precisão sob Demanda | Microns Hub', description: 'Serviços profissionais de usinagem CNC na Europa. Fresamento e torneamento de precisão. Entrega em 4-9 dias.' },
    sv: { title: 'CNC-bearbetning | Precisionsdelar på Beställning | Microns Hub', description: 'Professionella CNC-bearbetningtjänster i Europa. Precisionsfrässning och -vridning. Leverans på 4-9 dagar.' },
    da: { title: 'CNC-bearbejdning | Præcisionsdele på Bestilling | Microns Hub', description: 'Professionelle CNC-bearbejdningstjenester i Europa. Præcisionsfræsning og -drejning. Levering på 4-9 dage.' },
    fi: { title: 'CNC-työstö | Tarkkatyöosat Tilauksesta | Microns Hub', description: 'Ammattimaiset CNC-työstöpalvelut Euroopassa. Tarkkatyöfräsäys ja -sorvaus. Toimitus 4-9 päivässä.' },
    nb: { title: 'CNC-bearbeiding | Presisjonsdeler på Bestilling | Microns Hub', description: 'Profesjonelle CNC-bearbeidingstjenester i Europa. Presisjonsfreesing og -dreining. Levering på 4-9 dager.' },
    hu: { title: 'CNC megmunkálás | Precíziós Alkatrészek Igény Szerint | Microns Hub', description: 'Professzionális CNC megmunkálási szolgáltatások Európában. Precíziós marás és esztergálás. 4-9 nap szállítás.' },
    cs: { title: 'CNC obrábění | Přesné Součástky na Objednávku | Microns Hub', description: 'Profesionální CNC obrábění v Evropě. Přesné frézování a soustružení. Doručení v 4-9 dnech.' },
  },
  'sheet-metal': {
    en: { title: 'Sheet Metal Fabrication Services | On-Demand | Microns Hub', description: 'Professional sheet metal services in Europe. Cutting, bending, welding & finishing. 4-9 day delivery, competitive pricing.' },
    de: { title: 'Blechbearbeitung | On-Demand | Microns Hub', description: 'Professionelle Blechverarbeitungsdienste in Europa. Schneiden, Biegen, Schweißen & Oberflächenbearbeitung. 4-9 Tage Lieferung.' },
    fr: { title: 'Tôlerie | À la Demande | Microns Hub', description: 'Services professionnels de tôlerie en Europe. Découpe, pliage, soudage & finition. Livraison 4-9 jours.' },
    es: { title: 'Chapa Metálica | Bajo Demanda | Microns Hub', description: 'Servicios profesionales de chapa metálica en Europa. Corte, doblado, soldadura y acabado. Entrega en 4-9 días.' },
    it: { title: 'Lamiera | Su Richiesta | Microns Hub', description: 'Servizi professionali di lamiera in Europa. Taglio, piegatura, saldatura e finitura. Consegna in 4-9 giorni.' },
    nl: { title: 'Plaatwerk | Op Bestelling | Microns Hub', description: 'Professionele plaatmetaaldiensten in Europa. Snijden, buigen, lassen & afwerking. Levering in 4-9 dagen.' },
    pl: { title: 'Prace Blacharskie | Na Żądanie | Microns Hub', description: 'Profesjonalne usługi blacharskie w Europie. Cięcie, gięcie, spawanie i wykańczanie. Dostawa w 4-9 dni.' },
    pt: { title: 'Chapa Metálica | Sob Demanda | Microns Hub', description: 'Serviços profissionais de chapa metálica na Europa. Corte, dobragem, soldagem e acabamento. Entrega em 4-9 dias.' },
    sv: { title: 'Plåtarbete | På Beställning | Microns Hub', description: 'Professionella plåtmetallstjänster i Europa. Skärning, böjning, svetsning & yta. Leverans på 4-9 dagar.' },
    da: { title: 'Pladbejdning | På Bestilling | Microns Hub', description: 'Professionelle pladbejdningstjenester i Europa. Skæring, bøjning, svejsning & overflade. Levering på 4-9 dage.' },
    fi: { title: 'Levytyöstö | Tilauksesta | Microns Hub', description: 'Ammattimaiset levymetalli palvelut Euroopassa. Leikkaus, taivutus, hitsaus & pinnoitus. Toimitus 4-9 päivässä.' },
    nb: { title: 'Plabearbeiding | På Bestilling | Microns Hub', description: 'Profesjonelle plabemetallstjenester i Europa. Skjæring, bøying, sveising & overflate. Levering på 4-9 dager.' },
    hu: { title: 'Lemezfeldolgozás | Igény Szerint | Microns Hub', description: 'Professzionális lemezmunka szolgáltatások Európában. Vágás, hajlítás, hegesztés és felületkezelés. 4-9 nap szállítás.' },
    cs: { title: 'Zpraco Plechu | Na Objednávku | Microns Hub', description: 'Profesionální zpracování plechu v Evropě. Řezání, ohýbání, svařování a povrchová úprava. Doručení v 4-9 dnech.' },
  },
  '3d-printing': {
    en: { title: '3D Printing Services | Rapid Prototyping | Microns Hub', description: 'Professional 3D printing services in Europe. FDM, SLA, SLS, MJF technologies. Fast turnaround, competitive rates.' },
    de: { title: '3D-Druck | Rapid Prototyping | Microns Hub', description: 'Professionelle 3D-Druckdienste in Europa. FDM, SLA, SLS, MJF Technologien. Schnelle Bearbeitungszeit.' },
    fr: { title: 'Impression 3D | Prototypage Rapide | Microns Hub', description: 'Services d\'impression 3D professionnels en Europe. Technologiesthèmes FDM, SLA, SLS, MJF. Délai rapide.' },
    es: { title: 'Impresión 3D | Prototipado Rápido | Microns Hub', description: 'Servicios profesionales de impresión 3D en Europa. Tecnologías FDM, SLA, SLS, MJF. Entrega rápida.' },
    it: { title: 'Stampa 3D | Prototipazione Rapida | Microns Hub', description: 'Servizi professionali di stampa 3D in Europa. Tecnologie FDM, SLA, SLS, MJF. Consegna rapida.' },
    nl: { title: '3D-printen | Snel Prototyping | Microns Hub', description: 'Professionele 3D-printdiensten in Europa. FDM, SLA, SLS, MJF technologieën. Snelle levering.' },
    pl: { title: 'Druk 3D | Szybkie Prototypowanie | Microns Hub', description: 'Profesjonalne usługi druku 3D w Europie. Technologie FDM, SLA, SLS, MJF. Szybka dostawa.' },
    pt: { title: 'Impressão 3D | Prototipagem Rápida | Microns Hub', description: 'Serviços profissionais de impressão 3D na Europa. Tecnologias FDM, SLA, SLS, MJF. Entrega rápida.' },
    sv: { title: '3D-utskrift | Snabb Prototyping | Microns Hub', description: 'Professionella 3D-utskriftstjänster i Europa. FDM, SLA, SLS, MJF-teknologier. Snabb leverans.' },
    da: { title: '3D-print | Hurtig Prototyping | Microns Hub', description: 'Professionelle 3D-printtjenester i Europa. FDM, SLA, SLS, MJF-teknologier. Hurtig levering.' },
    fi: { title: '3D-tulostus | Nopea Prototyöinti | Microns Hub', description: 'Ammattimaiset 3D-tulostuspalvelut Euroopassa. FDM, SLA, SLS, MJF teknologiat. Nopea toimitus.' },
    nb: { title: '3D-printing | Rask Prototyping | Microns Hub', description: 'Profesjonelle 3D-printtjenester i Europa. FDM, SLA, SLS, MJF-teknologier. Rask levering.' },
    hu: { title: '3D nyomtatás | Gyors Prototípusozás | Microns Hub', description: 'Professzionális 3D nyomtatási szolgáltatások Európában. FDM, SLA, SLS, MJF technológiák. Gyors szállítás.' },
    cs: { title: '3D tisk | Rychlé Prototypování | Microns Hub', description: 'Profesionální 3D tiskové služby v Evropě. Technologie FDM, SLA, SLS, MJF. Rychlé doručení.' },
  },
  'injection-molding': {
    en: { title: 'Injection Molding Services | On-Demand Production | Microns Hub', description: 'Professional injection molding services in Europe. Thermoplastic & thermoset injection. Tool design & custom tooling.' },
    de: { title: 'Spritzguss | On-Demand Produktion | Microns Hub', description: 'Professionelle Spritzguß-Dienstleistungen in Europa. Kunststoff- & Elastomer-Spritzguss. Werkzeugdesign.' },
    fr: { title: 'Moulage par Injection | Production À la Demande | Microns Hub', description: 'Services professionnels de moulage par injection en Europe. Injection thermoplastique & thermodurcissable.' },
    es: { title: 'Moldeo por Inyección | Producción Bajo Demanda | Microns Hub', description: 'Servicios profesionales de moldeo por inyección en Europa. Inyección de termoplástico & termoestable.' },
    it: { title: 'Stampaggio a Iniezione | Produzione Su Richiesta | Microns Hub', description: 'Servizi professionali di stampaggio a iniezione in Europa. Stampaggio termoplastico e termoindurente.' },
    nl: { title: 'Spuitgieten | On-Demand Productie | Microns Hub', description: 'Professionele spuitgietdiensten in Europa. Kunststof- en kunststof-spuitgieten. Gereedschapsontwerp.' },
    pl: { title: 'Wtryskiwanie | Produkcja Na Żądanie | Microns Hub', description: 'Profesjonalne usługi wtrysków w Europie. Wtryskiwanie termoplastyczne i termotrwałe.' },
    pt: { title: 'Moldagem por Injeção | Produção Sob Demanda | Microns Hub', description: 'Serviços profissionais de moldagem por injeção na Europa. Injeção termoplástica e termofixa.' },
    sv: { title: 'Formsprejtning | On-Demand Produktion | Microns Hub', description: 'Professionella formsprejtningstjänster i Europa. Termoplast- & termoset-sprütning.' },
    da: { title: 'Sprøjtestøbning | On-Demand Produktion | Microns Hub', description: 'Professionelle sprøjtestøbningtjenester i Europa. Termoplast- & termofast-støbning.' },
    fi: { title: 'Ruiskuvaalu | Tilaustoimitus | Microns Hub', description: 'Ammattimaiset ruiskuvalantajat Euroopassa. Termoplasti- & termoset-ruiskuvalu.' },
    nb: { title: 'Sprøytestøping | On-Demand Produksjon | Microns Hub', description: 'Profesjonelle sprøytestøpingstjenester i Europa. Termoplast- & termofast-støping.' },
    hu: { title: 'Fröccsöntés | Igény Szerinti Gyártás | Microns Hub', description: 'Professzionális fröccsöntési szolgáltatások Európában. Termoplaszt és termoset fröccsöntés.' },
    cs: { title: 'Vstřikování | On-Demand Výroba | Microns Hub', description: 'Profesionální služby vstřikování v Evropě. Thermoplast & termoset vstřikování.' },
  },
};

// ─── Route Handlers ─────────────────────────────────────────────────────────────

export default async function middleware(request: Request) {
  const url = new URL(request.url);
  const isCrawlerRequest = isCrawler(request);

  // Extract language from URL path (first segment)
  const pathSegments = url.pathname.split('/').filter(Boolean);
  const lang = (pathSegments[0] || 'en').toLowerCase();
  const validLang = LANGUAGES.includes(lang as Lang) ? lang : 'en';

  // Route: Homepage (/{lang} or /)
  if (url.pathname === '/' || pathSegments.length === 1) {
    const meta = HOMEPAGE_META[validLang] || HOMEPAGE_META.en;
    return buildResponse(request, {
      title: meta.title,
      description: meta.description,
      ogType: 'website',
      image: DEFAULT_IMAGE,
    }, isCrawlerRequest);
  }

  // Route: Services /{lang}/services/{service_slug}
  if (pathSegments.length === 3 && pathSegments[1] === 'services') {
    const serviceSlug = pathSegments[2];
    const serviceMeta = SERVICE_META[serviceSlug]?.[validLang] || SERVICE_META[serviceSlug]?.en;
    if (serviceMeta) {
      return buildResponse(request, {
        title: serviceMeta.title,
        description: serviceMeta.description,
        ogType: 'website',
        image: DEFAULT_IMAGE,
      }, isCrawlerRequest);
    }
  }

  // Route: Blog Articles /{lang}/blog/{article_slug}
  if (pathSegments.length === 3 && pathSegments[1] === 'blog') {
    const articleSlug = pathSegments[2];
    const article = await fetchArticleMeta(validLang, articleSlug, isCrawlerRequest);

    if (article) {
      const pageMeta: PageMeta = {
        title: article.meta_title || article.title,
        description: article.meta_description || article.excerpt || '',
        ogType: 'article',
        image: article.featured_image || DEFAULT_IMAGE,
        structuredData: buildArticleSchema(article),
        articleContent: isCrawlerRequest ? article.content : undefined,
      };

      // If there's a translation_id, fetch all language versions for hreflang
      if (article.translation_id) {
        const translations = await fetchTranslationSlugs(article.translation_id);
        return buildResponse(request, pageMeta, isCrawlerRequest, validLang, translations);
      }

      return buildResponse(request, pageMeta, isCrawlerRequest);
    }
  }

  // Route: Industries /{lang}/industries/{industry_slug}
  if (pathSegments.length === 3 && pathSegments[1] === 'industries') {
    const industrySlug = pathSegments[2];
    // Industries are fetched from Supabase, similar to articles
    const industry = await fetchArticleMeta(validLang, industrySlug, isCrawlerRequest);

    if (industry) {
      const pageMeta: PageMeta = {
        title: industry.meta_title || industry.title,
        description: industry.meta_description || industry.excerpt || '',
        ogType: 'website',
        image: industry.featured_image || DEFAULT_IMAGE,
        articleContent: isCrawlerRequest ? industry.content : undefined,
      };
      return buildResponse(request, pageMeta, isCrawlerRequest);
    }
  }

  // Pass through for all other routes
  return new Response(null, { status: 404 });
}

function buildArticleSchema(article: ArticleMeta): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: article.meta_title || article.title,
    description: article.meta_description || article.excerpt || '',
    image: article.featured_image || DEFAULT_IMAGE,
    datePublished: article.created_at,
    dateModified: article.updated_at,
  });
}

function buildResponse(
  request: Request,
  meta: PageMeta,
  isCrawlerRequest: boolean,
  lang: string = 'en',
  translations?: TranslationMap
): Response {
  // For crawlers, include full article content in the HTML body
  // This allows Googlebot to see keywords without JavaScript rendering
  const bodyContent = isCrawlerRequest && meta.articleContent
    ? `<div id="article-body-for-crawler" style="display:none;">${escapeHtml(meta.articleContent)}</div>`
    : '';

  const hreflangTags = translations
    ? Object.entries(translations)
        .map(([lng, slug]) => `<link rel="alternate" hreflang="${lng}" href="${SITE_BASE}/${lng}/blog/${slug}/" />`)
        .join('\n  ')
    : '';

  const metaTags = `
  <title>${escapeHtml(meta.title)}</title>
  <meta name="description" content="${escapeHtml(meta.description)}" />
  <meta property="og:title" content="${escapeHtml(meta.title)}" />
  <meta property="og:description" content="${escapeHtml(meta.description)}" />
  <meta property="og:type" content="${meta.ogType}" />
  <meta property="og:image" content="${meta.image}" />
  <meta property="og:url" content="${new URL(request.url).href}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(meta.title)}" />
  <meta name="twitter:description" content="${escapeHtml(meta.description)}" />
  <meta name="twitter:image" content="${meta.image}" />
  ${meta.structuredData ? `<script type="application/ld+json">${meta.structuredData}</script>` : ''}
  ${hreflangTags}
  `;

  const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  ${metaTags}
  <script type="module" src="/src/main.tsx"></script>
</head>
<body>
  <div id="root"></div>
  ${bodyContent}
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
