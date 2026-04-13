/**
 * Vercel Routing Middleware â SEO Meta Injection for Microns Hub
 *
 * Problem: Every page returns the same static index.html with generic English meta tags.
 * Solution: This middleware intercepts public-facing pages and rewrites the <head> section
 * with per-page, per-language SEO metadata before the response reaches the browser/crawler.
 *
 * Covers: homepages (14 langs), service pages (6 Ã 14), industry pages (14), blog articles (~1200).
 * Does NOT affect: /dashboard, /api, /assets, /login, /laserkritis, etc.
 */

// âââ Constants ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

const SUPABASE_URL = 'https://cfjrtmtaitwzggzpkhxi.supabase.co';
const DEFAULT_IMAGE = 'https://www.micronshub.eu/lovable-uploads/a27a8329-2c4a-4b05-b1c4-b200b903617e.png';
const SITE_BASE = 'https://www.micronshub.eu';
const LANGUAGES = ['en', 'de', 'fr', 'es', 'it', 'nl', 'pl', 'pt', 'sv', 'da', 'fi', 'nb', 'hu', 'cs'] as const;
type Lang = typeof LANGUAGES[number];

// In-memory cache for article metadata (survives within a single Edge instance)
const articleCache = new Map<string, { data: ArticleMeta | null; expires: number }>();
const translationCache = new Map<string, { data: TranslationMap; expires: number }>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

// âââ Types ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

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

type TranslationMap = Record<string, string>; // lang â slug

interface PageMeta {
  title: string;
  description: string;
  ogType: string;
  image: string;
  structuredData?: string;
  articleContent?: string; // Full HTML body for crawler injection
}

// âââ Bot / Crawler Detection âââââââââââââââââââââââââââââââââââââââââââââââââ

const BOT_UA_PATTERN = /googlebot|bingbot|yandexbot|duckduckbot|baiduspider|slurp|facebot|ia_archiver|semrushbot|ahrefsbot|dotbot|petalbot|mj12bot|sogou|applebot/i;

function isCrawler(request: Request): boolean {
  const ua = request.headers.get('user-agent') || '';
  return BOT_UA_PATTERN.test(ua);
}

// âââ Supabase Helpers âââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

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

// âââ Static Meta Maps âââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

const HOMEPAGE_META: Record<string, { title: string; description: string }> = {
  en: { title: 'Microns Hub | On-Demand Manufacturing Platform in Europe', description: 'European on-demand manufacturing platform. CNC machining, sheet metal, 3D printing, injection molding. Fast delivery across Europe from Greece.' },
  de: { title: 'Microns Hub | On-Demand Fertigungsplattform in Europa', description: 'EuropÃ¤ische On-Demand-Fertigungsplattform. CNC-Bearbeitung, Blechbearbeitung, 3D-Druck, Spritzguss. Schnelle Lieferung in ganz Europa.' },
  fr: { title: 'Microns Hub | Plateforme de fabrication Ã  la demande en Europe', description: 'Plateforme europÃ©enne de fabrication Ã  la demande. Usinage CNC, tÃ´lerie, impression 3D, moulage par injection. Livraison rapide en Europe.' },
  es: { title: 'Microns Hub | Plataforma de fabricaciÃ³n bajo demanda en Europa', description: 'Plataforma europea de fabricaciÃ³n bajo demanda. Mecanizado CNC, chapa metÃ¡lica, impresiÃ³n 3D, moldeo por inyecciÃ³n. Entrega rÃ¡pida en Europa.' },
  it: { title: 'Microns Hub | Piattaforma di produzione on-demand in Europa', description: 'Piattaforma europea di produzione on-demand. Lavorazione CNC, lamiera, stampa 3D, stampaggio a iniezione. Consegna rapida in Europa.' },
  nl: { title: 'Microns Hub | On-Demand Productieplatform in Europa', description: 'Europees on-demand productieplatform. CNC-bewerking, plaatbewerking, 3D-printen, spuitgieten. Snelle levering in heel Europa.' },
  pl: { title: 'Microns Hub | Platforma produkcji na Å¼Ädanie w Europie', description: 'Europejska platforma produkcji na Å¼Ädanie. ObrÃ³bka CNC, blacharstwo, druk 3D, wtrysk tworzyw. Szybka dostawa w Europie.' },
  pt: { title: 'Microns Hub | Plataforma de fabricaÃ§Ã£o sob demanda na Europa', description: 'Plataforma europeia de fabricaÃ§Ã£o sob demanda. Usinagem CNC, chapa metÃ¡lica, impressÃ£o 3D, moldagem por injeÃ§Ã£o. Entrega rÃ¡pida na Europa.' },
  sv: { title: 'Microns Hub | On-Demand Tillverkningsplattform i Europa', description: 'Europeisk on-demand tillverkningsplattform. CNC-bearbetning, plÃ¥tbearbetning, 3D-utskrift, formsprutning. Snabb leverans i Europa.' },
  da: { title: 'Microns Hub | On-Demand Produktionsplatform i Europa', description: 'EuropÃ¦isk on-demand produktionsplatform. CNC-bearbejdning, pladebearbejdning, 3D-print, sprÃ¸jtestÃ¸bning. Hurtig levering i Europa.' },
  fi: { title: 'Microns Hub | Tilaustuotantoalusta Euroopassa', description: 'Eurooppalainen tilaustuotantoalusta. CNC-tyÃ¶stÃ¶, levytyÃ¶stÃ¶, 3D-tulostus, ruiskupuristus. Nopea toimitus Euroopassa.' },
  nb: { title: 'Microns Hub | On-Demand Produksjonsplattform i Europa', description: 'Europeisk on-demand produksjonsplattform. CNC-bearbeiding, platearbeid, 3D-printing, sprÃ¸ytestÃ¸ping. Rask levering i Europa.' },
  hu: { title: 'Microns Hub | IgÃ©ny szerinti gyÃ¡rtÃ¡si platform EurÃ³pÃ¡ban', description: 'EurÃ³pai igÃ©ny szerinti gyÃ¡rtÃ¡si platform. CNC megmunkÃ¡lÃ¡s, lemezfeldolgozÃ¡s, 3D nyomtatÃ¡s, frÃ¶ccsÃ¶ntÃ©s. Gyors szÃ¡llÃ­tÃ¡s EurÃ³pÃ¡ban.' },
  cs: { title: 'Microns Hub | On-Demand VÃ½robnÃ­ Platforma v EvropÄ', description: 'EvropskÃ¡ on-demand vÃ½robnÃ­ platforma. CNC obrÃ¡bÄnÃ­, zpracovÃ¡nÃ­ plechu, 3D tisk, vstÅikovÃ¡nÃ­. RychlÃ© dodÃ¡nÃ­ po celÃ© EvropÄ.' },
};

// Service page slugs that match the URL pattern /{lang}/services/{serviceSlug}
// Note: in the URL these use the ENGLISH slugs because Vercel rewrites all to /index.html
// and the React router handles localized paths. But the monitored URLs use English service paths.
const SERVICE_META: Record<string, Record<string, { title: string; description: string }>> = {
  'cnc-machining': {
    en: { title: 'CNC Machining Services | Precision Parts On-Demand | Microns Hub', description: 'Professional CNC machining services in Europe. Precision milling and turning for prototypes and production. 4-9 day delivery, competitive pricing.' },
    de: { title: 'CNC-Bearbeitung | PrÃ¤zisionsteile auf Abruf | Microns Hub', description: 'Professionelle CNC-Bearbeitungsdienste in Europa. PrÃ¤zisionsfrÃ¤sen und -drehen fÃ¼r Prototypen und Serienproduktion. 4-9 Tage Lieferung.' },
    fr: { title: 'Usinage CNC | PiÃ¨ces de PrÃ©cision Ã  la Demande | Microns Hub', description: 'Services d\'usinage CNC professionnels en Europe. Fraisage et tournage de prÃ©cision pour prototypes et production. Livraison 4-9 jours.' },
    es: { title: 'Mecanizado CNC | Piezas de PrecisiÃ³n bajo Demanda | Microns Hub', description: 'Servicios profesionales de mecanizado CNC en Europa. Fresado y torneado de precisiÃ³n. Entrega en 4-9 dÃ­as.' },
    it: { title: 'Lavorazione CNC | Parti di Precisione su Richiesta | Microns Hub', description: 'Servizi professionali di lavorazione CNC in Europa. Fresatura e tornitura di precisione. Consegna in 4-9 giorni.' },
    nl: { title: 'CNC-bewerking | Precisieonderdelen on-demand | Microns Hub', description: 'Professionele CNC-bewerkingsdiensten in Europa. Precisiefrezen en -draaien. Levering in 4-9 dagen.' },
    pl: { title: 'ObrÃ³bka CNC | CzÄÅci precyzyjne na Å¼Ädanie | Microns Hub', description: 'Profesjonalne usÅugi obrÃ³bki CNC w Europie. Precyzyjne frezowanie i toczenie. Dostawa w 4-9 dni.' },
    pt: { title: 'Usinagem CNC | PeÃ§as de PrecisÃ£o sob Demanda | Microns Hub', description: 'ServiÃ§os profissionais de usinagem CNC na Europa. Fresamento e torneamento de precisÃ£o. Entrega em 4-9 dias.' },
    sv: { title: 'CNC-bearbetning | Precisionsdelar on-demand | Microns Hub', description: 'Professionella CNC-bearbetningstjÃ¤nster i Europa. PrecisionsfrÃ¤sning och svarvning. Leverans pÃ¥ 4-9 dagar.' },
    da: { title: 'CNC-bearbejdning | PrÃ¦cisionsdele on-demand | Microns Hub', description: 'Professionelle CNC-bearbejdningstjenester i Europa. PrÃ¦cisionsfrÃ¦sning og drejning. Levering pÃ¥ 4-9 dage.' },
    fi: { title: 'CNC-tyÃ¶stÃ¶ | Tarkkuusosat tilauksesta | Microns Hub', description: 'Ammattimaiset CNC-tyÃ¶stÃ¶palvelut Euroopassa. TarkkuusjyrsintÃ¤ ja -sorvaus. Toimitus 4-9 pÃ¤ivÃ¤ssÃ¤.' },
    nb: { title: 'CNC-bearbeiding | Presisjonsdeler on-demand | Microns Hub', description: 'Profesjonelle CNC-bearbeidingstjenester i Europa. Presisjonsfresing og dreiing. Levering pÃ¥ 4-9 dager.' },
    hu: { title: 'CNC megmunkÃ¡lÃ¡s | PrecÃ­ziÃ³s alkatrÃ©szek igÃ©ny szerint | Microns Hub', description: 'ProfesszionÃ¡lis CNC megmunkÃ¡lÃ¡si szolgÃ¡ltatÃ¡sok EurÃ³pÃ¡ban. PrecÃ­ziÃ³s marÃ¡s Ã©s esztergÃ¡lÃ¡s. SzÃ¡llÃ­tÃ¡s 4-9 nap.' },
    cs: { title: 'CNC obrÃ¡bÄnÃ­ | PÅesnÃ© dÃ­ly na zakÃ¡zku | Microns Hub', description: 'ProfesionÃ¡lnÃ­ CNC obrÃ¡bÄcÃ­ sluÅ¾by v EvropÄ. PÅesnÃ© frÃ©zovÃ¡nÃ­ a soustruÅ¾enÃ­. DodÃ¡nÃ­ za 4-9 dnÃ­.' },
  },
  'sheet-metal': {
    en: { title: 'Sheet Metal Fabrication | Custom Parts On-Demand | Microns Hub', description: 'Professional sheet metal fabrication in Europe. Laser cutting, bending, welding. Prototypes to production. Fast European delivery.' },
    de: { title: 'Blechbearbeitung | Kundenspezifische Teile | Microns Hub', description: 'Professionelle Blechbearbeitung in Europa. Laserschneiden, Biegen, SchweiÃen. Prototypen bis Serienproduktion.' },
    fr: { title: 'TÃ´lerie Industrielle | PiÃ¨ces sur Mesure | Microns Hub', description: 'TÃ´lerie industrielle professionnelle en Europe. DÃ©coupe laser, pliage, soudage. Du prototype Ã  la production.' },
    es: { title: 'FabricaciÃ³n de Chapa MetÃ¡lica | Piezas a Medida | Microns Hub', description: 'FabricaciÃ³n profesional de chapa metÃ¡lica en Europa. Corte lÃ¡ser, plegado, soldadura.' },
    it: { title: 'Lavorazione Lamiera | Parti su Misura | Microns Hub', description: 'Lavorazione professionale della lamiera in Europa. Taglio laser, piegatura, saldatura.' },
    nl: { title: 'Plaatbewerking | Onderdelen op Maat | Microns Hub', description: 'Professionele plaatbewerking in Europa. Lasersnijden, buigen, lassen.' },
    pl: { title: 'ObrÃ³bka Blachy | CzÄÅci na ZamÃ³wienie | Microns Hub', description: 'Profesjonalna obrÃ³bka blachy w Europie. CiÄcie laserowe, giÄcie, spawanie.' },
    pt: { title: 'FabricaÃ§Ã£o de Chapa MetÃ¡lica | PeÃ§as Sob Medida | Microns Hub', description: 'FabricaÃ§Ã£o profissional de chapa metÃ¡lica na Europa. Corte a laser, dobra, soldagem.' },
    sv: { title: 'PlÃ¥tbearbetning | Kundanpassade Delar | Microns Hub', description: 'Professionell plÃ¥tbearbetning i Europa. LaserskÃ¤rning, bockning, svetsning.' },
    da: { title: 'Pladebearbejdning | Specialfremstillede Dele | Microns Hub', description: 'Professionel pladebearbejdning i Europa. LaserskÃ¦ring, bukning, svejsning.' },
    fi: { title: 'LevytyÃ¶stÃ¶ | MittatilaustyÃ¶t | Microns Hub', description: 'Ammattimainen levytyÃ¶stÃ¶ Euroopassa. Laserleikkaus, taivutus, hitsaus.' },
    nb: { title: 'Platearbeid | Spesiallagde Deler | Microns Hub', description: 'Profesjonelt platearbeid i Europa. LaserskjÃ¦ring, bukking, sveising.' },
    hu: { title: 'LemezfeldolgozÃ¡s | Egyedi AlkatrÃ©szek | Microns Hub', description: 'ProfesszionÃ¡lis lemezfeldolgozÃ¡s EurÃ³pÃ¡ban. LÃ©zervÃ¡gÃ¡s, hajlÃ­tÃ¡s, hegesztÃ©s.' },
    cs: { title: 'ZpracovÃ¡nÃ­ Plechu | ZakÃ¡zkovÃ© DÃ­ly | Microns Hub', description: 'ProfesionÃ¡lnÃ­ zpracovÃ¡nÃ­ plechu v EvropÄ. LaserovÃ© ÅezÃ¡nÃ­, ohÃ½bÃ¡nÃ­, svaÅovÃ¡nÃ­.' },
  },
  '3d-printing': {
    en: { title: '3D Printing Services | Rapid Prototyping | Microns Hub', description: '3D printing services in Europe. SLA, SLS, FDM technologies. From rapid prototypes to functional parts. Fast delivery.' },
    de: { title: '3D-Druck | Rapid Prototyping | Microns Hub', description: '3D-Druckdienste in Europa. SLA, SLS, FDM Technologien. Vom Prototyp bis zum Funktionsteil.' },
    fr: { title: 'Impression 3D | Prototypage Rapide | Microns Hub', description: 'Services d\'impression 3D en Europe. Technologies SLA, SLS, FDM. Du prototype aux piÃ¨ces fonctionnelles.' },
    es: { title: 'ImpresiÃ³n 3D | Prototipado RÃ¡pido | Microns Hub', description: 'Servicios de impresiÃ³n 3D en Europa. TecnologÃ­as SLA, SLS, FDM.' },
    it: { title: 'Stampa 3D | Prototipazione Rapida | Microns Hub', description: 'Servizi di stampa 3D in Europa. Tecnologie SLA, SLS, FDM.' },
    nl: { title: '3D-printen | Rapid Prototyping | Microns Hub', description: '3D-printdiensten in Europa. SLA, SLS, FDM technologieÃ«n.' },
    pl: { title: 'Druk 3D | Szybkie Prototypowanie | Microns Hub', description: 'UsÅugi druku 3D w Europie. Technologie SLA, SLS, FDM.' },
    pt: { title: 'ImpressÃ£o 3D | Prototipagem RÃ¡pida | Microns Hub', description: 'ServiÃ§os de impressÃ£o 3D na Europa. Tecnologias SLA, SLS, FDM.' },
    sv: { title: '3D-utskrift | Snabb Prototypframtagning | Microns Hub', description: '3D-utskriftstjÃ¤nster i Europa. SLA, SLS, FDM teknologier.' },
    da: { title: '3D-print | Hurtig Prototyping | Microns Hub', description: '3D-print tjenester i Europa. SLA, SLS, FDM teknologier.' },
    fi: { title: '3D-tulostus | Nopea Prototyyppaus | Microns Hub', description: '3D-tulostuspalvelut Euroopassa. SLA, SLS, FDM teknologiat.' },
    nb: { title: '3D-printing | Rask Prototyping | Microns Hub', description: '3D-printing tjenester i Europa. SLA, SLS, FDM teknologier.' },
    hu: { title: '3D NyomtatÃ¡s | Gyors PrototÃ­pus | Microns Hub', description: '3D nyomtatÃ¡si szolgÃ¡ltatÃ¡sok EurÃ³pÃ¡ban. SLA, SLS, FDM technolÃ³giÃ¡k.' },
    cs: { title: '3D Tisk | RychlÃ© PrototypovÃ¡nÃ­ | Microns Hub', description: '3D tiskovÃ© sluÅ¾by v EvropÄ. SLA, SLS, FDM technologie.' },
  },
  'injection-molding': {
    en: { title: 'Injection Molding Services | Production Parts | Microns Hub', description: 'Injection molding services in Europe. From prototyping molds to production tooling. Competitive pricing, fast turnaround.' },
    de: { title: 'Spritzguss | Serienteile | Microns Hub', description: 'SpritzGussdienste in Europa. Vom Prototypenwerkzeug bis zur Serienfertigung.' },
    fr: { title: 'Moulage par Injection | PiÃ¨ces de Production | Microns Hub', description: 'Services de moulage par injection en Europe. Du moule prototype Ã  l\'outillage de production.' },
    es: { title: 'Moldeo por InyecciÃ³n | Piezas de ProducciÃ³n | Microns Hub', description: 'Servicios de moldeo por inyecciÃ³n en Europa. Desde moldes de prototipo hasta producciÃ³n.' },
    it: { title: 'Stampaggio a Iniezione | Parti di Produzione | Microns Hub', description: 'Servizi di stampaggio a iniezione in Europa. Dallo stampo prototipo alla produzione.' },
    nl: { title: 'Spuitgieten | Productieonderdelen | Microns Hub', description: 'Spuitgietdiensten in Europa. Van prototype mallen tot productie.' },
    pl: { title: 'Wtrysk Tworzyw | CzÄÅci Produkcyjne | Microns Hub', description: 'UsÅugi wtrysku tworzyw w Europie. Od form prototypowych do produkcji.' },
    pt: { title: 'Moldagem por InjeÃ§Ã£o | PeÃ§as de ProduÃ§Ã£o | Microns Hub', description: 'ServiÃ§os de moldagem por injeÃ§Ã£o na Europa. De moldes protÃ³tipos Ã  produÃ§Ã£o.' },
    sv: { title: 'Formsprutning | Produktionsdelar | Microns Hub', description: 'FormsprutningstjÃ¤nster i Europa. FrÃ¥n prototypverktyg till serieproduktion.' },
    da: { title: 'SprÃ¸jtestÃ¸bning | Produktionsdele | Microns Hub', description: 'SprÃ¸jtestÃ¸bningstjenester i Europa. Fra prototypevÃ¦rktÃ¸j til serieproduktion.' },
    fi: { title: 'Ruiskupuristus | Tuotanto-osat | Microns Hub', description: 'Ruiskupuristuspalvelut Euroopassa. Prototyyppimuoteista tuotantoon.' },
    nb: { title: 'SprÃ¸ytestÃ¸ping | Produksjonsdeler | Microns Hub', description: 'SprÃ¸ytestÃ¸pingstjenester i Europa. Fra prototypverktÃ¸y til serieproduksjon.' },
    hu: { title: 'FrÃ¶ccsÃ¶ntÃ©s | GyÃ¡rtÃ¡si AlkatrÃ©szek | Microns Hub', description: 'FrÃ¶ccsÃ¶ntÃ©si szolgÃ¡ltatÃ¡sok EurÃ³pÃ¡ban. PrototÃ­pus szerszÃ¡moktÃ³l a sorozatgyÃ¡rtÃ¡sig.' },
    cs: { title: 'VstÅikovÃ¡nÃ­ | VÃ½robnÃ­ DÃ­ly | Microns Hub', description: 'VstÅikovacÃ­ sluÅ¾by v EvropÄ. Od prototypovÃ½ch forem po sÃ©riovou vÃ½robu.' },
  },
  'surface-finishes': {
    en: { title: 'Surface Finishing Services | Anodizing, Plating & More | Microns Hub', description: 'Surface finishing services in Europe. Anodizing, powder coating, plating, polishing. Enhance your manufactured parts.' },
    de: { title: 'OberflÃ¤chenveredelung | Eloxieren, Beschichten | Microns Hub', description: 'OberflÃ¤chenveredelungsdienste in Europa. Eloxieren, Pulverbeschichtung, Galvanik, Polieren.' },
    fr: { title: 'Finition de Surface | Anodisation, RevÃªtement | Microns Hub', description: 'Services de finition de surface en Europe. Anodisation, thermolaquage, placage, polissage.' },
    es: { title: 'Acabado Superficial | Anodizado, Recubrimiento | Microns Hub', description: 'Servicios de acabado superficial en Europa. Anodizado, recubrimiento en polvo, galvanizado.' },
    it: { title: 'Finitura Superficiale | Anodizzazione, Rivestimento | Microns Hub', description: 'Servizi di finitura superficiale in Europa. Anodizzazione, verniciatura a polvere, galvanica.' },
    nl: { title: 'Oppervlakteafwerking | Anodiseren, Coating | Microns Hub', description: 'Oppervlakteafwerkingsdiensten in Europa. Anodiseren, poedercoating, galvaniseren.' },
    pl: { title: 'WykoÅczenie Powierzchni | Anodowanie, Powlekanie | Microns Hub', description: 'UsÅugi wykoÅczenia powierzchni w Europie. Anodowanie, malowanie proszkowe, galwanizacja.' },
    pt: { title: 'Acabamento Superficial | AnodizaÃ§Ã£o, Revestimento | Microns Hub', description: 'ServiÃ§os de acabamento superficial na Europa. AnodizaÃ§Ã£o, pintura a pÃ³, galvanizaÃ§Ã£o.' },
    sv: { title: 'Ytbehandling | Anodisering, BelÃ¤ggning | Microns Hub', description: 'YtbehandlingstjÃ¤nster i Europa. Anodisering, pulverlackering, galvanisering.' },
    da: { title: 'Overfladebehandling | Anodisering, BelÃ¦gning | Microns Hub', description: 'Overfladebehandlingstjenester i Europa. Anodisering, pulverlakering, galvanisering.' },
    fi: { title: 'PintakÃ¤sittely | Anodisointi, Pinnoitus | Microns Hub', description: 'PintakÃ¤sittelypalvelut Euroopassa. Anodisointi, jauhemaalaus, galvanointi.' },
    nb: { title: 'Overflatebehandling | Anodisering, Belegging | Microns Hub', description: 'Overflatebehandlingstjenester i Europa. Anodisering, pulverlakkering, galvanisering.' },
    hu: { title: 'FelÃ¼letkezelÃ©s | EloxÃ¡lÃ¡s, BevonatolÃ¡s | Microns Hub', description: 'FelÃ¼letkezelÃ©si szolgÃ¡ltatÃ¡sok EurÃ³pÃ¡ban. EloxÃ¡lÃ¡s, porszÃ³rÃ¡s, galvanizÃ¡lÃ¡s.' },
    cs: { title: 'PovrchovÃ¡ Ãprava | EloxovÃ¡nÃ­, PokovovÃ¡nÃ­ | Microns Hub', description: 'SluÅ¾by povrchovÃ© Ãºpravy v EvropÄ. EloxovÃ¡nÃ­, prÃ¡Å¡kovÃ© lakovÃ¡nÃ­, galvanizace.' },
  },
  'rapid-prototyping': {
    en: { title: 'Rapid Prototyping | Fast Manufacturing Prototypes | Microns Hub', description: 'Rapid prototyping services in Europe. CNC, 3D printing, sheet metal prototypes. 4-9 day delivery across Europe.' },
    de: { title: 'Rapid Prototyping | Schnelle Prototypen | Microns Hub', description: 'Rapid-Prototyping-Dienste in Europa. CNC, 3D-Druck, Blech-Prototypen. 4-9 Tage Lieferung.' },
    fr: { title: 'Prototypage Rapide | Prototypes Fabrication | Microns Hub', description: 'Services de prototypage rapide en Europe. CNC, impression 3D, prototypes en tÃ´le. Livraison 4-9 jours.' },
    es: { title: 'Prototipado RÃ¡pido | Prototipos de FabricaciÃ³n | Microns Hub', description: 'Servicios de prototipado rÃ¡pido en Europa. CNC, impresiÃ³n 3D, prototipos en chapa. Entrega 4-9 dÃ­as.' },
    it: { title: 'Prototipazione Rapida | Prototipi di Produzione | Microns Hub', description: 'Servizi di prototipazione rapida in Europa. CNC, stampa 3D, prototipi in lamiera. Consegna 4-9 giorni.' },
    nl: { title: 'Rapid Prototyping | Snelle Productieprototypes | Microns Hub', description: 'Rapid prototyping diensten in Europa. CNC, 3D-printen, plaatwerk prototypes. Levering in 4-9 dagen.' },
    pl: { title: 'Szybkie Prototypowanie | Prototypy Produkcyjne | Microns Hub', description: 'UsÅugi szybkiego prototypowania w Europie. CNC, druk 3D, prototypy blaszane. Dostawa w 4-9 dni.' },
    pt: { title: 'Prototipagem RÃ¡pida | ProtÃ³tipos de FabricaÃ§Ã£o | Microns Hub', description: 'ServiÃ§os de prototipagem rÃ¡pida na Europa. CNC, impressÃ£o 3D, protÃ³tipos em chapa. Entrega em 4-9 dias.' },
    sv: { title: 'Snabb Prototypframtagning | Tillverkningsprototyper | Microns Hub', description: 'Snabb prototypframtagningstjÃ¤nster i Europa. CNC, 3D-utskrift, plÃ¥tprototyper. Leverans pÃ¥ 4-9 dagar.' },
    da: { title: 'Hurtig Prototyping | Produktionsprototyper | Microns Hub', description: 'Hurtig prototyping-tjenester i Europa. CNC, 3D-print, pladeprototyper. Levering pÃ¥ 4-9 dage.' },
    fi: { title: 'Nopea Prototyyppaus | Valmistusmallit | Microns Hub', description: 'Nopeat prototyyppauspalvelut Euroopassa. CNC, 3D-tulostus, levyprototyypit. Toimitus 4-9 pÃ¤ivÃ¤ssÃ¤.' },
    nb: { title: 'Rask Prototyping | Produksjonsprototyper | Microns Hub', description: 'Raske prototyping-tjenester i Europa. CNC, 3D-printing, plateprototyper. Levering pÃ¥ 4-9 dager.' },
    hu: { title: 'Gyors PrototÃ­pus | GyÃ¡rtÃ¡si PrototÃ­pusok | Microns Hub', description: 'Gyors prototÃ­pus-kÃ©szÃ­tÃ©si szolgÃ¡ltatÃ¡sok EurÃ³pÃ¡ban. CNC, 3D nyomtatÃ¡s, lemez prototÃ­pusok. SzÃ¡llÃ­tÃ¡s 4-9 nap.' },
    cs: { title: 'RychlÃ© PrototypovÃ¡nÃ­ | VÃ½robnÃ­ Prototypy | Microns Hub', description: 'RychlÃ© prototypovacÃ­ sluÅ¾by v EvropÄ. CNC, 3D tisk, plechovÃ© prototypy. DodÃ¡nÃ­ za 4-9 dnÃ­.' },
  },
};

const INDUSTRIES_META: Record<string, { title: string; description: string }> = {
  en: { title: 'Industries We Serve | Manufacturing for All Sectors | Microns Hub', description: 'Microns Hub serves automotive, aerospace, medical, robotics, energy and consumer electronics industries with precision manufacturing.' },
  de: { title: 'Branchen | Fertigung fÃ¼r alle Sektoren | Microns Hub', description: 'Microns Hub bedient Automobil, Luft- und Raumfahrt, Medizin, Robotik und Elektronik mit PrÃ¤zisionsfertigung.' },
  fr: { title: 'Secteurs Industriels | Fabrication Multi-secteurs | Microns Hub', description: 'Microns Hub dessert l\'automobile, l\'aÃ©ronautique, le mÃ©dical, la robotique et l\'Ã©lectronique avec une fabrication de prÃ©cision.' },
  es: { title: 'Industrias | FabricaciÃ³n para Todos los Sectores | Microns Hub', description: 'Microns Hub sirve a las industrias automotriz, aeroespacial, mÃ©dica, robÃ³tica y electrÃ³nica.' },
  it: { title: 'Settori Industriali | Produzione per Tutti i Settori | Microns Hub', description: 'Microns Hub serve automotive, aerospaziale, medicale, robotica ed elettronica con produzione di precisione.' },
  nl: { title: 'IndustrieÃ«n | Productie voor Alle Sectoren | Microns Hub', description: 'Microns Hub bedient automotive, luchtvaart, medisch, robotica en elektronica met precisieproductie.' },
  pl: { title: 'BranÅ¼e | Produkcja dla Wszystkich SektorÃ³w | Microns Hub', description: 'Microns Hub obsÅuguje motoryzacjÄ, lotnictwo, medycynÄ, robotykÄ i elektronikÄ.' },
  pt: { title: 'IndÃºstrias | FabricaÃ§Ã£o para Todos os Setores | Microns Hub', description: 'Microns Hub atende automotivo, aeroespacial, mÃ©dico, robÃ³tica e eletrÃ´nica.' },
  sv: { title: 'Branscher | Tillverkning fÃ¶r Alla Sektorer | Microns Hub', description: 'Microns Hub betjÃ¤nar fordons-, flyg-, medicin-, robotik- och elektronikindustrin.' },
  da: { title: 'Brancher | Produktion for Alle Sektorer | Microns Hub', description: 'Microns Hub betjener bil-, fly-, medicin-, robot- og elektronikindustrien.' },
  fi: { title: 'Toimialat | Tuotanto Kaikille Sektoreille | Microns Hub', description: 'Microns Hub palvelee auto-, ilmailu-, lÃ¤Ã¤kintÃ¤-, robotiikka- ja elektroniikkateollisuutta.' },
  nb: { title: 'Bransjer | Produksjon for Alle Sektorer | Microns Hub', description: 'Microns Hub betjener bil-, fly-, medisinsk-, robotikk- og elektronikkindustrien.' },
  hu: { title: 'IparÃ¡gak | GyÃ¡rtÃ¡s Minden Szektornak | Microns Hub', description: 'A Microns Hub kiszolgÃ¡lja az autÃ³ipart, repÃ¼lÅgÃ©pipart, orvostechnikÃ¡t, robotikÃ¡t Ã©s elektronikÃ¡t.' },
  cs: { title: 'OdvÄtvÃ­ | VÃ½roba pro VÅ¡echny Sektory | Microns Hub', description: 'Microns Hub slouÅ¾Ã­ automobilovÃ©mu, leteckÃ©mu, zdravotnickÃ©mu, robotickÃ©mu a elektronickÃ©mu prÅ¯myslu.' },
};

// âââ URL Parsing ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

interface ParsedRoute {
  lang: Lang;
  type: 'homepage' | 'service' | 'industries' | 'blog' | 'other';
  serviceSlug?: string;
  blogSlug?: string;
  pathAfterLang: string; // e.g. "blog/some-slug" or "services/cnc-machining"
}

function parseRoute(pathname: string): ParsedRoute | null {
  // Match /{lang} or /{lang}/...
  const match = pathname.match(/^\/(en|de|fr|es|it|nl|pl|pt|sv|da|fi|nb|hu|cs)(\/(.*))?$/);
  if (!match) return null;

  const lang = match[1] as Lang;
  const rest = (match[3] || '').replace(/\/$/, ''); // trim trailing slash

  if (!rest) return { lang, type: 'homepage', pathAfterLang: '' };

  // Blog article: anything with /blog/ followed by a slug (but not just /blog)
  // Match both English "blog" and localized blog paths
  const blogMatch = rest.match(/^(?:blog|blogg|blogi)\/(.+)$/);
  if (blogMatch) return { lang, type: 'blog', blogSlug: blogMatch[1], pathAfterLang: rest };

  // Service pages: /services/{slug} or localized equivalents
  const serviceMatch = rest.match(/^(?:services|dienstleistungen|servizi|servicios|diensten|uslugi|servicos|tjanster|tjenester|palvelut|szolgaltatasok|sluzby)\/(.+)$/);
  if (serviceMatch) {
    // Map localized service slug back to English for lookup
    const localSlug = serviceMatch[1];
    const englishSlug = resolveServiceSlug(localSlug);
    if (englishSlug && SERVICE_META[englishSlug]) {
      return { lang, type: 'service', serviceSlug: englishSlug, pathAfterLang: rest };
    }
  }

  // Industries page
  if (/^(industries|branchen|secteurs|industrias|settori|branches|branze|industrias|branscher|brancher|toimialat|bransjer|iparagak|prumysl)$/.test(rest)) {
    return { lang, type: 'industries', pathAfterLang: rest };
  }

  return { lang, type: 'other', pathAfterLang: rest };
}

// Map localized service slugs to English
function resolveServiceSlug(slug: string): string | null {
  const map: Record<string, string> = {
    'cnc-machining': 'cnc-machining', 'cnc-bearbeitung': 'cnc-machining', 'usinage-cnc': 'cnc-machining', 'mecanizado-cnc': 'cnc-machining', 'lavorazione-cnc': 'cnc-machining', 'cnc-bewerking': 'cnc-machining', 'obrobka-cnc': 'cnc-machining', 'usinagem-cnc': 'cnc-machining', 'cnc-bearbetning': 'cnc-machining', 'cnc-bearbejdning': 'cnc-machining', 'cnc-tyÃ¶stÃ¶': 'cnc-machining', 'cnc-bearbeiding': 'cnc-machining', 'cnc-megmunkalas': 'cnc-machining', 'cnc-obrabeni': 'cnc-machining',
    'sheet-metal': 'sheet-metal', 'blechbearbeitung': 'sheet-metal', 'tolerie': 'sheet-metal', 'chapa-metalica': 'sheet-metal', 'lavorazione-lamiera': 'sheet-metal', 'plaatbewerking': 'sheet-metal', 'obrobka-bluzy': 'sheet-metal', 'platbearbetning': 'sheet-metal', 'pladearbejde': 'sheet-metal', 'levytyÃ¶stÃ¶': 'sheet-metal', 'platarbeid': 'sheet-metal', 'lemezfeldolgozas': 'sheet-metal', 'obrabeni-plechu': 'sheet-metal',
    '3d-printing': '3d-printing', '3d-druck': '3d-printing', 'impression-3d': '3d-printing', 'impresion-3d': '3d-printing', 'stampa-3d': '3d-printing', '3d-printen': '3d-printing', 'druk-3d': '3d-printing', 'impressao-3d': '3d-printing', '3d-skrivning': '3d-printing', '3d-udskrivning': '3d-printing', '3d-tulostus': '3d-printing', '3d-nyomtas': '3d-printing', '3d-tisk': '3d-printing',
    'injection-molding': 'injection-molding', 'spritzguss': 'injection-molding', 'injection-plastique': 'injection-molding', 'moldeo-por-inyeccion': 'injection-molding', 'stampaggio-iniezione': 'injection-molding', 'spuitgieten': 'injection-molding', 'wtrysk-tworzywa': 'injection-molding', 'moldagem-injecao': 'injection-molding', 'formsprutning': 'injection-molding', 'sprojtestobning': 'injection-molding', 'ruiskupuristus': 'injection-molding', 'sproytestoping': 'injection-molding', 'frccsnyomas': 'injection-molding', 'vstrekovani': 'injection-molding',
    'surface-finishes': 'surface-finishes', 'oberflaechenveredelung': 'surface-finishes', 'finition-surface': 'surface-finishes', 'acabados-superficie': 'surface-finishes', 'finitura-superficie': 'surface-finishes', 'oppervlakteafwerking': 'surface-finishes', 'wykonczenie-powierzchni': 'surface-finishes', 'acabamento-superficie': 'surface-finishes', 'ytbehandling': 'surface-finishes', 'overfladebehandling': 'surface-finishes', 'pinnan-viimeistely': 'surface-finishes', 'overflatebehandling': 'surface-finishes', 'feluletkezeles': 'surface-finishes', 'uprava-povrchu': 'surface-finishes',
    'rapid-prototyping': 'rapid-prototyping', 'prototypage-rapide': 'rapid-prototyping', 'prototipado-rapido': 'rapid-prototyping', 'prototipazione-rapida': 'rapid-prototyping', 'szybkie-prototypowanie': 'rapid-prototyping', 'prototipagem-rapida': 'rapid-prototyping', 'snabb-prototypering': 'rapid-prototyping', 'hurtig-prototypering': 'rapid-prototyping', 'nopea-prototyyppaus': 'rapid-prototyping', 'rask-prototyping': 'rapid-prototyping', 'gyors-prototipus': 'rapid-prototyping', 'rychle-prototypovani': 'rapid-prototyping',
  };
  return map[slug] || null;
}

// âââ HTML Rewriting âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildHreflangTags(lang: string, pathMap: Record<string, string> | string): string {
  // pathMap: either a Record<lang, fullPath> or a simple string path (same for all langs)
  const tags: string[] = [];
  for (const l of LANGUAGES) {
    const path = typeof pathMap === 'string' ? `/${l}/${pathMap}` : `/${l}/${pathMap[l] || pathMap['en'] || ''}`;
    tags.push(`<link rel="alternate" hreflang="${l}" href="${SITE_BASE}${path}" />`);
  }
  // x-default points to English
  const enPath = typeof pathMap === 'string' ? `/en/${pathMap}` : `/en/${pathMap['en'] || ''}`;
  tags.push(`<link rel="alternate" hreflang="x-default" href="${SITE_BASE}${enPath}" />`);
  return tags.join('\n    ');
}

function rewriteHtml(html: string, meta: PageMeta, lang: string, canonicalPath: string, hreflangTags: string): string {
  let result = html;

  // 1. Fix <html lang="en"> â <html lang="{lang}">
  result = result.replace(/<html\s+lang="[^"]*"/, `<html lang="${lang}"`);

  // 2. Replace <title>
  result = result.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(meta.title)}</title>`);

  // 3. Replace meta description
  result = result.replace(
    /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/,
    `<meta name="description" content="${escapeHtml(meta.description)}" />`
  );

  // 4. Replace OG tags
  result = result.replace(/<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/, `<meta property="og:title" content="${escapeHtml(meta.title)}" />`);
  result = result.replace(/<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/, `<meta property="og:description" content="${escapeHtml(meta.description)}" />`);
  result = result.replace(/<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/, `<meta property="og:url" content="${SITE_BASE}${canonicalPath}" />`);
  result = result.replace(/<meta\s+property="og:type"\s+content="[^"]*"\s*\/?>/, `<meta property="og:type" content="${meta.ogType}" />`);
  result = result.replace(/<meta\s+property="og:image"\s+content="[^"]*"\s*\/?>/, `<meta property="og:image" content="${escapeHtml(meta.image)}" />`);

  // 5. Replace Twitter tags
  result = result.replace(/<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?>/, `<meta name="twitter:title" content="${escapeHtml(meta.title)}" />`);
  result = result.replace(/<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/?>/, `<meta name="twitter:description" content="${escapeHtml(meta.description)}" />`);
  result = result.replace(/<meta\s+name="twitter:image"\s+content="[^"]*"\s*\/?>/, `<meta name="twitter:image" content="${escapeHtml(meta.image)}" />`);

  // 6. Inject canonical + hreflang + structured data before </head>
  const injections = [
    `<link rel="canonical" href="${SITE_BASE}${canonicalPath}" />`,
    hreflangTags,
  ];
  if (meta.structuredData) {
    injections.push(`<script type="application/ld+json">\n    ${meta.structuredData}\n    </script>`);
  }
  result = result.replace('</head>', `    ${injections.join('\n    ')}\n  </head>`);

  // 7. For crawlers: inject full article body content into <body> so search engines
  //    see the complete text (with long-tail keywords) on first crawl without
  //    needing JavaScript rendering. This is a form of dynamic rendering â the
  //    content matches exactly what users see after React hydration. Regular users
  //    never receive this block (guarded by isCrawler in the entry point).
  //    No CSS hiding â Google penalises hidden-text techniques. Since only bots
  //    see this HTML version, the content should be fully visible.
  if (meta.articleContent) {
    const seoBlock = `
    <article id="seo-content" lang="${lang}">
      ${meta.articleContent}
    </article>`;
    // Insert the SEO content block right after <body...>
    result = result.replace(/(<body[^>]*>)/, `$1${seoBlock}`);
  }

  return result;
}

// âââ Middleware Entry Point âââââââââââââââââââââââââââââââââââââââââââââââââââ

export default async function middleware(request: Request): Promise<Response | undefined> {
  const url = new URL(request.url);
  const route = parseRoute(url.pathname);

  // Not a public page we handle â pass through
  if (!route || route.type === 'other') return undefined;

  // Detect if the request is from a search engine crawler
  const crawlerRequest = isCrawler(request);

  // Fetch the original index.html (without language prefix to avoid re-triggering middleware)
  let originalHtml: string;
  try {
    const indexRes = await fetch(new URL('/index.html', url.origin), {
      headers: { 'Accept': 'text/html' },
    });
    if (!indexRes.ok) return undefined;
    originalHtml = await indexRes.text();
  } catch {
    return undefined; // fallback: let normal flow handle it
  }

  let meta: PageMeta;
  let canonicalPath: string;
  let hreflangTags: string;

  switch (route.type) {
    case 'homepage': {
      const hm = HOMEPAGE_META[route.lang] || HOMEPAGE_META.en;
      meta = { title: hm.title, description: hm.description, ogType: 'website', image: DEFAULT_IMAGE };
      canonicalPath = `/${route.lang}`;
      hreflangTags = buildHreflangTags(route.lang, '');
      break;
    }

    case 'service': {
      const sm = SERVICE_META[route.serviceSlug!]?.[route.lang] || SERVICE_META[route.serviceSlug!]?.en;
      if (!sm) return undefined;
      meta = { title: sm.title, description: sm.description, ogType: 'website', image: DEFAULT_IMAGE };
      canonicalPath = `/${route.lang}/${route.pathAfterLang}`;
      // For service pages, use the same pathAfterLang for all languages (simplified)
      hreflangTags = buildHreflangTags(route.lang, route.pathAfterLang);
      break;
    }

    case 'industries': {
      const im = INDUSTRIES_META[route.lang] || INDUSTRIES_META.en;
      meta = { title: im.title, description: im.description, ogType: 'website', image: DEFAULT_IMAGE };
      canonicalPath = `/${route.lang}/${route.pathAfterLang}`;
      hreflangTags = buildHreflangTags(route.lang, route.pathAfterLang);
      break;
    }

    case 'blog': {
      // For crawlers: fetch full content; for regular users: metadata only
      const article = await fetchArticleMeta(route.lang, route.blogSlug!, crawlerRequest);
      if (!article) return undefined; // Article not found â let SPA handle 404

      const title = article.meta_title || article.title;
      const description = article.meta_description || article.excerpt || '';
      const image = article.featured_image || DEFAULT_IMAGE;

      // Build hreflang with per-language slugs
      let hrefMap: Record<string, string> = {};
      if (article.translation_id) {
        const translations = await fetchTranslationSlugs(article.translation_id);
        for (const [l, s] of Object.entries(translations)) {
          hrefMap[l] = `blog/${s}`;
        }
      }
      if (Object.keys(hrefMap).length === 0) {
        hrefMap[route.lang] = `blog/${article.slug}`;
      }

      const structuredData = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: title,
        description: description,
        inLanguage: route.lang,
        datePublished: article.created_at,
        dateModified: article.updated_at,
        image: image,
        publisher: {
          '@type': 'Organization',
          name: 'Microns Hub',
          url: SITE_BASE,
          logo: { '@type': 'ImageObject', url: `${SITE_BASE}/logo.png` },
        },
        mainEntityOfPage: `${SITE_BASE}/${route.lang}/blog/${article.slug}`,
      });

      meta = {
        title,
        description,
        ogType: 'article',
        image,
        structuredData,
        // Only include article body for crawlers â saves bandwidth for real users
        articleContent: crawlerRequest && article.content ? article.content : undefined,
      };
      canonicalPath = `/${route.lang}/blog/${article.slug}`;
      hreflangTags = buildHreflangTags(route.lang, hrefMap);
      break;
    }

    default:
      return undefined;
  }

  // Rewrite the HTML and return
  const modifiedHtml = rewriteHtml(originalHtml, meta, route.lang, canonicalPath, hreflangTags);

  return new Response(modifiedHtml, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  });
}

// âââ Matcher Configuration ââââââââââââââââââââââââââââââââââââââââââââââââââââ

export const config = {
  matcher: [
    // Match only language-prefixed routes. This excludes:
    // /api/*, /assets/*, /dashboard/*, /login, /laserkritis/*, /index.html,
    // /sitemap.xml, /robots.txt, and any non-language-prefixed paths.
    '/(en|de|fr|es|it|nl|pl|pt|sv|da|fi|nb|hu|cs)',
    '/(en|de|fr|es|it|nl|pl|pt|sv|da|fi|nb|hu|cs)/(.*)',
  ],
};
