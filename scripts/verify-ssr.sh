#!/usr/bin/env bash
# scripts/verify-ssr.sh
#
# Verify that SEO server-side rendering is working for every route type the
# middleware is responsible for. The middleware now injects the SSR body for
# every request regardless of user-agent, so the script uses a plain curl UA
# to catch regressions that would affect third-party SEO tools (Seobility,
# LinkedIn, WhatsApp) that aren't in any crawler whitelist.
#
# Usage:
#   ./scripts/verify-ssr.sh                         # runs against production
#   HOST=https://preview-xyz.vercel.app ./scripts/verify-ssr.sh
#   HOST=http://localhost:3000 ./scripts/verify-ssr.sh
#
# Exit code:
#   0 — all checks passed
#   1 — at least one check failed

set -euo pipefail

UA="Mozilla/5.0 (compatible; micronshub-verify-ssr/1.0)"
HOST="${HOST:-https://www.micronshub.eu}"
FAIL=0

extract_body() {
  python3 -c '
import sys, re
h = sys.stdin.read()
h = re.sub(r"<script[^>]*>.*?</script>", " ", h, flags=re.DOTALL|re.I)
h = re.sub(r"<style[^>]*>.*?</style>", " ", h, flags=re.DOTALL|re.I)
m = re.search(r"<body[^>]*>(.*?)</body>", h, flags=re.DOTALL|re.I)
body = m.group(1) if m else h
text = re.sub(r"<[^>]+>", " ", body)
print(re.sub(r"\s+", " ", text).strip())
'
}

check() {
  local url="$1"; local min_body="$2"; local must_contain="$3"
  local html body_text body_len contains_ok has_seo_content has_canonical has_jsonld
  html=$(curl -sL --max-time 30 -A "$UA" "$HOST$url")
  body_text=$(echo "$html" | extract_body)
  body_len=${#body_text}

  contains_ok="no"
  if echo "$body_text" | grep -qiE "$must_contain"; then contains_ok="yes"; fi

  has_seo_content="no"
  if echo "$html" | grep -q 'id="seo-content"'; then has_seo_content="yes"; fi

  has_canonical="no"
  if echo "$html" | grep -q '<link rel="canonical"'; then has_canonical="yes"; fi

  has_jsonld="no"
  if echo "$html" | grep -q 'application/ld+json'; then has_jsonld="yes"; fi

  if [ "$body_len" -ge "$min_body" ] \
     && [ "$contains_ok" = "yes" ] \
     && [ "$has_seo_content" = "yes" ] \
     && [ "$has_canonical" = "yes" ] \
     && [ "$has_jsonld" = "yes" ]; then
    printf "  [ok] %s  body=%d  seo=%s canonical=%s ld=%s\n" \
      "$url" "$body_len" "$has_seo_content" "$has_canonical" "$has_jsonld"
  else
    printf "  [FAIL] %s  body=%d/min=%d contains='%s':%s seo=%s canonical=%s ld=%s\n" \
      "$url" "$body_len" "$min_body" "$must_contain" "$contains_ok" \
      "$has_seo_content" "$has_canonical" "$has_jsonld"
    FAIL=1
  fi
}

check_encoding() {
  local url="$1"
  local body
  body=$(curl -sL --max-time 30 -A "$UA" "$HOST$url")
  if echo "$body" | head -c 8000 | grep -qE "Ã§|Ã£|Ã¡|Ã©|Ã¶|Ã¼|ÃŸ|Ã¨|Ã²|Ã¬"; then
    echo "  [FAIL] $url contains UTF-8 mojibake"
    FAIL=1
  else
    echo "  [ok]   $url clean UTF-8"
  fi
}

echo "=== Homepage (all 14 languages) ==="
check "/en"          500 "manufactur"
check "/de"          500 "fertigung|hergestellt|cnc"
check "/fr"          500 "fabrication|usinage|microns"
check "/es"          500 "fabricaci|microns|cnc"
check "/it"          500 "produzione|microns|cnc"
check "/nl"          500 "productie|microns|cnc"
check "/pl"          500 "produkcj|microns|cnc"
check "/pt"          500 "usinagem|manufatura"
check "/sv"          500 "tillverkning|microns|cnc"
check "/da"          500 "produktion|microns|cnc"
check "/fi"          500 "tuotanto|microns|cnc"
check "/nb"          500 "produksjon|microns|cnc"
check "/hu"          500 "gyárt|microns|cnc"
check "/cs"          500 "výrob|microns|cnc"

echo ""
echo "=== Services index (all 14 languages) ==="
check "/en/services"               500 "cnc|sheet metal"
check "/de/dienstleistungen"       500 "cnc|blech"
check "/fr/services"               500 "cnc|usinage|tôlerie|tolerie"
check "/es/servicios"              500 "cnc|mecanizado|chapa"
check "/it/servizi"                500 "cnc|lavorazione|lamiera"
check "/nl/diensten"               500 "cnc|bewerking"
check "/pl/uslugi"                 500 "cnc|obróbk|obrobk"
check "/pt/servicos"               500 "cnc|usinagem|chapa"
check "/sv/tjanster"               500 "cnc|bearbetning"
check "/da/tjenester"              500 "cnc|bearbejd"
check "/fi/palvelut"               500 "cnc|työstö|tyost"
check "/nb/tjenester"              500 "cnc|bearbeid"
check "/hu/szolgaltatasok"         500 "cnc|megmunk|lemez"
check "/cs/sluzby"                 500 "cnc|obráb|obrab"

echo ""
echo "=== EN service pages (DB-backed, full content) ==="
check "/en/services"                               3000 "cnc machining"
check "/en/services/cnc-machining"                 4000 "ISO 2768"
check "/en/services/sheet-metal"                   4000 "laser"
check "/en/services/3d-printing"                   4000 "SLS"
check "/en/services/injection-molding"             4000 "tooling"
check "/en/services/rapid-prototyping"             4000 "prototype"
check "/en/services/surface-finishes"              4000 "anodiz"

echo ""
echo "=== Service detail (non-EN, i18n fallback, one representative URL each) ==="
check "/de/dienstleistungen/blechbearbeitung"      800 "blech"
check "/de/dienstleistungen/cnc-bearbeitung"       800 "cnc"
check "/fr/services/tolerie"                       800 "tôlerie|tolerie"
check "/fr/services/usinage-cnc"                   800 "usinage|cnc"
check "/es/servicios/chapa-metalica"               800 "chapa"
check "/es/servicios/mecanizado-cnc"               800 "mecaniz|cnc"
check "/it/servizi/lavorazione-lamiera"            800 "lamiera"
check "/it/servizi/lavorazione-cnc"                800 "cnc|lavorazione"
check "/nl/diensten/plaatbewerking"                800 "plaat"
check "/nl/diensten/cnc-bewerking"                 800 "cnc|bewerking"
check "/pl/uslugi/obrobka-bluzy"                   800 "obrób|obrob"
check "/pl/uslugi/obrobka-cnc"                     800 "cnc|obrób|obrob"
check "/pt/servicos/chapa-metalica"                800 "chapa"
check "/pt/servicos/usinagem-cnc"                  800 "usinagem|cnc"
check "/sv/tjanster/platbearbetning"               800 "plåt|platbearb"
check "/sv/tjanster/cnc-bearbetning"               800 "cnc|bearbetning"
check "/da/tjenester/pladearbejde"                 800 "plade"
check "/da/tjenester/cnc-bearbejdning"             800 "cnc|bearbejd"
check "/fi/palvelut/ruiskupuristus"                800 "ruisku"
check "/fi/palvelut/3d-tulostus"                   800 "3d|tulostus"
check "/nb/tjenester/platarbeid"                   800 "platarbeid"
check "/nb/tjenester/cnc-bearbeiding"              800 "cnc|bearbeid"
check "/hu/szolgaltatasok/lemezfeldolgozas"        800 "lemez"
check "/hu/szolgaltatasok/cnc-megmunkalas"         800 "cnc|megmunk"
check "/cs/sluzby/obrabeni-plechu"                 800 "plech"
check "/cs/sluzby/cnc-obrabeni"                    800 "cnc|obráb|obrab"

echo ""
echo "=== Industries (all 14 languages) ==="
check "/en/industries"        500 "aerospace|automotive|industri"
check "/de/branchen"          500 "luft|auto|bran"
check "/fr/secteurs"          500 "aéro|auto|secteur"
check "/es/industrias"        500 "aero|auto|industri"
check "/it/settori"           500 "aero|auto|settori"
check "/nl/branches"          500 "lucht|auto|industri"
check "/pl/branze"            500 "lotni|motoryzac|bran"
check "/pt/industrias"        500 "aeroesp|automotiv|indúst|indust"
check "/sv/branscher"         500 "flyg|fordon|branscher"
check "/da/brancher"          500 "fly|bil|branche"
check "/fi/toimialat"         500 "ilmailu|auto|toimia"
check "/nb/bransjer"          500 "fly|bil|bransje"
check "/hu/iparagak"          500 "repül|autó|iparág"
check "/cs/prumysl"           500 "leteck|auto|průmys|prumys"

echo ""
echo "=== Blog index (all 14 languages) ==="
check "/en/blog"             300 "blog|article|post"
check "/de/blog"             300 "blog|artikel"
check "/fr/blog"             300 "blog|article"
check "/es/blog"             300 "blog|artículo|articulo"
check "/it/blog"             300 "blog|articolo"
check "/nl/blog"             300 "blog|artikel"
check "/pl/blog"             300 "blog|artyku"
check "/pt/blog"             300 "blog|artigo"
check "/sv/blogg"            300 "blog|artikel"
check "/da/blog"             300 "blog|artikel"
check "/fi/blogi"            300 "blog|artikkel"
check "/nb/blogg"            300 "blog|artikkel"
check "/hu/blog"             300 "blog|cikk"
check "/cs/blog"             300 "blog|článek|clanek|microns"

echo ""
echo "=== Simple pages (sampling every language across 4 page types) ==="
check "/en/about"             500 "microns|manufactur"
check "/en/contact"           400 "contact|microns"
check "/en/quote"             400 "quote|manufactur"
check "/en/our-work"          400 "portfolio|work|microns"
check "/de/ueber-uns"         500 "microns|fertigung|über|uber"
check "/de/kontakt"           400 "kontakt|microns"
check "/de/angebot"           400 "angebot|microns"
check "/de/unsere-arbeit"     400 "arbeit|microns"
check "/fr/a-propos"          500 "microns|fabric"
check "/es/sobre-nosotros"    500 "microns|sobre"
check "/it/chi-siamo"         500 "microns|chi siamo|chi-siamo"
check "/nl/over-ons"          500 "microns|over"
check "/pl/o-nas"             500 "microns|o nas"
check "/pt/sobre-nos"         500 "microns|sobre"
check "/sv/om-oss"            500 "microns|om oss"
check "/da/om-os"             500 "microns|om os"
check "/fi/meista"            500 "microns|meistä|meista"
check "/nb/om-oss"            500 "microns|om oss"
check "/hu/rolunk"            500 "microns|rólunk|rolunk"
check "/cs/o-nas"             500 "microns|o nás|o nas"

echo ""
echo "=== Content pages (EN, DB-backed) ==="
# Minimum body-text size after HTML stripping. content_pages rows are large
# enough that 22kB raw / ~3kB text is a conservative floor; legal pages have
# less prose so we use a slightly lower min.
check "/en/industries"        3000 "aerospace|automotive|aerospace|industri"
check "/en/our-work"          1500 "portfolio|case|project|work"
check "/en/education"         1500 "education|formula student|student|NET30|DFM"
check "/en/about"             2000 "heraklion|dimitrios|microns|founded|supplier"
check "/en/contact"           1500 "heraklion|info@micronshub|contact"
check "/en/legal-notice"      1500 "MICRONS HUB DV|803129638|190254227000|heraklion"
check "/en/privacy-policy"    1500 "GDPR|regulation|2016/679|data subject|personal data"

# Regression guards specific to content_pages:
# 1. Raw body ≥ 22kB (≥ 20kB for legal pages). The generic check() above only
#    measures text-extracted length; this enforces the raw HTML floor too.
# 2. <article id="seo-content"> must NOT carry hidden / aria-hidden — that was
#    yesterday's bug and would hide the whole SEO block from crawlers.
# 3. x-seo-source: db header must be present so we know the row was fetched.
for page in industries our-work education about contact legal-notice privacy-policy; do
  url="$HOST/en/$page"
  html=$(curl -sL --max-time 30 -A "$UA" "$url")
  size=${#html}
  if [ "$page" = "legal-notice" ] || [ "$page" = "privacy-policy" ]; then
    MIN_SIZE=20000
  else
    MIN_SIZE=22000
  fi
  if [ "$size" -lt "$MIN_SIZE" ]; then
    echo "  [FAIL] /en/$page raw=$size < min=$MIN_SIZE"
    FAIL=1
  else
    echo "  [ok]   /en/$page raw=$size ≥ $MIN_SIZE"
  fi
  if echo "$html" | grep -qE '<article[^>]*id="seo-content"[^>]*(hidden|aria-hidden)'; then
    echo "  [FAIL] /en/$page #seo-content has hidden/aria-hidden (yesterday-bug regression)"
    FAIL=1
  fi
  h2_count=$(printf '%s' "$html" | grep -oE '<h2[[:space:]>]' | wc -l | tr -d ' ')
  if [ "$h2_count" -lt 3 ]; then
    echo "  [FAIL] /en/$page only $h2_count H2s (expected ≥ 3)"
    FAIL=1
  fi
  ld_count=$(printf '%s' "$html" | grep -oE 'application/ld\+json' | wc -l | tr -d ' ')
  if [ "$page" = "legal-notice" ] || [ "$page" = "privacy-policy" ]; then
    MIN_LD=2
  else
    MIN_LD=3
  fi
  if [ "$ld_count" -lt "$MIN_LD" ]; then
    echo "  [FAIL] /en/$page only $ld_count JSON-LD blocks (expected ≥ $MIN_LD)"
    FAIL=1
  fi
  src=$(curl -sI --max-time 30 -A "$UA" "$url" | grep -i '^x-seo-source:' | tr -d '\r\n' | awk -F': ' '{print $2}')
  if [ "$src" != "db" ]; then
    echo "  [FAIL] /en/$page x-seo-source='$src' (expected 'db')"
    FAIL=1
  fi
done

echo ""
echo "=== Footer VAT / legal-entity SSR regression ==="
home=$(curl -sL --max-time 30 -A "$UA" "$HOST/en")
if echo "$home" | grep -q "EL803129638"; then
  echo "  [ok]   /en contains VAT EL803129638 in SSR body"
else
  echo "  [FAIL] /en missing EL803129638 in SSR body"
  FAIL=1
fi
if echo "$home" | grep -q "MICRONS HUB DV"; then
  echo "  [ok]   /en contains legal entity MICRONS HUB DV in SSR body"
else
  echo "  [FAIL] /en missing MICRONS HUB DV in SSR body"
  FAIL=1
fi
if echo "$home" | grep -q "190254227000"; then
  echo "  [ok]   /en contains GEMI 190254227000 in SSR body"
else
  echo "  [FAIL] /en missing GEMI 190254227000 in SSR body"
  FAIL=1
fi

echo ""
echo "=== UTF-8 encoding regression guard (pt/de/fr/es/it/sv/fi/hu/cs) ==="
check_encoding "/pt/servicos/chapa-metalica"
check_encoding "/de/dienstleistungen/blechbearbeitung"
check_encoding "/fr/services/tolerie"
check_encoding "/es/servicios/chapa-metalica"
check_encoding "/it/servizi/lavorazione-lamiera"
check_encoding "/sv/tjanster/platbearbetning"
check_encoding "/fi/palvelut/ruiskupuristus"
check_encoding "/hu/szolgaltatasok/lemezfeldolgozas"
check_encoding "/cs/sluzby/obrabeni-plechu"
check_encoding "/pt"
check_encoding "/de"
check_encoding "/fr"

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "ALL CHECKS PASSED"
  exit 0
else
  echo "VERIFICATION FAILED"
  exit 1
fi
