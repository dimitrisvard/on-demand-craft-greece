-- ============================================================================
-- Populate content_pages.localized_slug for every non-EN language × slug pair.
-- Mirrors the SLUGS map in middleware/slugs.ts and vite.config.ts so the
-- middleware, React router, and Supabase rows all agree on the URL path
-- for each (language, slug) tuple. Matches the existing service_pages pattern
-- (fetchServicePage queries by canonical slug and emits per-language alt URLs
-- using localized_slug).
--
-- Canonical English slugs covered: industries, our-work, about, contact,
-- education, legal-notice, privacy-policy, home.
--
-- For the 4 slugs that already have native URLs in SLUGS
-- (industries / our-work / about / contact) we use those values verbatim.
-- For the 3 DB-only slugs (education / legal-notice / privacy-policy) we use
-- the English canonical form in every language; when native translations are
-- seeded later they can be updated with a targeted UPDATE per language.
-- 'home' gets the canonical 'home' so the homepage content row remains
-- addressable from the middleware; the URL itself stays `/:lang/` because the
-- homepage arm in middleware.ts uses localizedPath('homepage').
--
-- Idempotent: restricted to rows where localized_slug IS NULL so re-running
-- never overwrites manually-curated slugs.
-- ============================================================================

-- ── about ────────────────────────────────────────────────────────────────────
UPDATE content_pages SET localized_slug = 'ueber-uns'      WHERE language='de' AND slug='about' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'a-propos'       WHERE language='fr' AND slug='about' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'sobre-nosotros' WHERE language='es' AND slug='about' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'chi-siamo'      WHERE language='it' AND slug='about' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'over-ons'       WHERE language='nl' AND slug='about' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'o-nas'          WHERE language='pl' AND slug='about' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'sobre-nos'      WHERE language='pt' AND slug='about' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'om-oss'         WHERE language='sv' AND slug='about' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'om-os'          WHERE language='da' AND slug='about' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'meista'         WHERE language='fi' AND slug='about' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'om-oss'         WHERE language='nb' AND slug='about' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'rolunk'         WHERE language='hu' AND slug='about' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'o-nas'          WHERE language='cs' AND slug='about' AND localized_slug IS NULL;

-- ── contact ──────────────────────────────────────────────────────────────────
UPDATE content_pages SET localized_slug = 'kontakt'    WHERE language='de' AND slug='contact' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'contact'    WHERE language='fr' AND slug='contact' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'contacto'   WHERE language='es' AND slug='contact' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'contatto'   WHERE language='it' AND slug='contact' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'contact'    WHERE language='nl' AND slug='contact' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'kontakt'    WHERE language='pl' AND slug='contact' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'contato'    WHERE language='pt' AND slug='contact' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'kontakt'    WHERE language='sv' AND slug='contact' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'kontakt'    WHERE language='da' AND slug='contact' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'yhteys'     WHERE language='fi' AND slug='contact' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'kontakt'    WHERE language='nb' AND slug='contact' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'kapcsolat'  WHERE language='hu' AND slug='contact' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'kontakt'    WHERE language='cs' AND slug='contact' AND localized_slug IS NULL;

-- ── industries ───────────────────────────────────────────────────────────────
UPDATE content_pages SET localized_slug = 'branchen'   WHERE language='de' AND slug='industries' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'secteurs'   WHERE language='fr' AND slug='industries' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'industrias' WHERE language='es' AND slug='industries' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'settori'    WHERE language='it' AND slug='industries' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'branches'   WHERE language='nl' AND slug='industries' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'branze'     WHERE language='pl' AND slug='industries' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'industrias' WHERE language='pt' AND slug='industries' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'branscher'  WHERE language='sv' AND slug='industries' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'brancher'   WHERE language='da' AND slug='industries' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'toimialat'  WHERE language='fi' AND slug='industries' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'bransjer'   WHERE language='nb' AND slug='industries' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'iparagak'   WHERE language='hu' AND slug='industries' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'prumysl'    WHERE language='cs' AND slug='industries' AND localized_slug IS NULL;

-- ── our-work ─────────────────────────────────────────────────────────────────
UPDATE content_pages SET localized_slug = 'unsere-arbeit'    WHERE language='de' AND slug='our-work' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'notre-travail'    WHERE language='fr' AND slug='our-work' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'nuestro-trabajo'  WHERE language='es' AND slug='our-work' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'i-nostri-lavori'  WHERE language='it' AND slug='our-work' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'ons-werk'         WHERE language='nl' AND slug='our-work' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'nasza-praca'      WHERE language='pl' AND slug='our-work' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'nosso-trabalho'   WHERE language='pt' AND slug='our-work' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'vart-arbete'      WHERE language='sv' AND slug='our-work' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'vores-arbejde'    WHERE language='da' AND slug='our-work' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'tyomme'           WHERE language='fi' AND slug='our-work' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'vart-arbeid'      WHERE language='nb' AND slug='our-work' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'munkaink'         WHERE language='hu' AND slug='our-work' AND localized_slug IS NULL;
UPDATE content_pages SET localized_slug = 'nase-prace'       WHERE language='cs' AND slug='our-work' AND localized_slug IS NULL;

-- ── education / legal-notice / privacy-policy ────────────────────────────────
-- No localized URLs yet in SLUGS; seed with the English canonical so the
-- middleware can still match these rows and avoid returning NULL, which
-- currently forces the fallback renderer path. Once native translations are
-- agreed on we'll patch each language with a targeted UPDATE.
UPDATE content_pages SET localized_slug = slug
  WHERE slug IN ('education', 'legal-notice', 'privacy-policy')
    AND language <> 'en'
    AND localized_slug IS NULL;

-- ── home ─────────────────────────────────────────────────────────────────────
-- Homepage URL is `/:lang/` (no slug segment), but we still populate
-- localized_slug='home' for the row so any future tooling that joins against
-- this column finds a non-null value.
UPDATE content_pages SET localized_slug = 'home'
  WHERE slug = 'home'
    AND language <> 'en'
    AND localized_slug IS NULL;

-- ── EN rows ──────────────────────────────────────────────────────────────────
-- Mirror the canonical slug into localized_slug for English so the OR-filter
-- in fetchContentPageRaw always finds a row, regardless of whether the URL
-- segment passed matches slug or localized_slug.
UPDATE content_pages SET localized_slug = slug
  WHERE language = 'en' AND localized_slug IS NULL;
