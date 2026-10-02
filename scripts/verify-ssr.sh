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
#   # Cloudflare preview behind Cloudflare Access (service token):
#   CF_ACCESS_CLIENT_ID=... CF_ACCESS_CLIENT_SECRET=... \
#     HOST=https://staging-microns-site.<account>.workers.dev ./scripts/verify-ssr.sh
#
#   # Two hosts: every check runs against HOST and HOST_B, the per-check
#   # result lines are written to two files and compared with diff. The Access
#   # headers go to HOST_B only (the preview), never to the HOST baseline:
#   HOST_B=https://staging-microns-site.<account>.workers.dev \
#     CF_ACCESS_CLIENT_ID=... CF_ACCESS_CLIENT_SECRET=... ./scripts/verify-ssr.sh
#
# Environment:
#   HOST                     host under test (default https://www.micronshub.eu)
#   HOST_B                   optional second host; enables the paired run + diff
#   CF_ACCESS_CLIENT_ID      optional Cloudflare Access service-token id
#   CF_ACCESS_CLIENT_SECRET  optional Cloudflare Access service-token secret
#   CF_ACCESS_HOST           optional; the one origin that receives the Access
#                            headers (it must also be the host under test).
#                            Default: HOST_B in a paired run, else HOST — but
#                            never the production origin https://www.micronshub.eu
#                            unless CF_ACCESS_HOST names it explicitly.
#
# Access headers are only ever sent to that origin (scheme://host[:port]), and
# only while it is the host under test. Requests that carry them do not use
# curl -L: same-origin redirects are followed by hand (headers re-added), a
# redirect to any other origin is not followed and is reported as a failed
# request. Header values are passed to curl through a mode-600 file in a
# private temp dir and are never printed.
#
# Exit code:
#   0 — all checks passed (and, with HOST_B, no differing result line)
#   1 — at least one check failed, a request failed, or (with HOST_B) the two
#       hosts produced a differing result line

set -euo pipefail

UA="Mozilla/5.0 (compatible; micronshub-verify-ssr/1.0)"
HOST="${HOST:-https://www.micronshub.eu}"
HOST_B="${HOST_B:-}"
FAIL=0

RUN_DIR=$(umask 077 && mktemp -d "${TMPDIR:-/tmp}/verify-ssr.XXXXXX")
trap 'rm -rf "$RUN_DIR"' EXIT

# Lower-cased scheme://host[:port] of a URL, default ports dropped.
# (Written for bash 3.2 too, so it also runs on a stock macOS shell.)
url_origin() {
  local o
  o=$(printf '%s' "$1" | sed -nE 's#^([A-Za-z][A-Za-z0-9+.-]*://[^/?#]+).*#\1#p' \
    | tr '[:upper:]' '[:lower:]')
  case "$o" in
    https://*:443) o=${o%:443} ;;
    http://*:80) o=${o%:80} ;;
  esac
  printf '%s' "$o"
}

PRODUCTION_ORIGIN="https://www.micronshub.eu"
ACCESS_HEADER_FILE=""
ACCESS_ORIGIN=""
if [ -n "${CF_ACCESS_CLIENT_ID:-}" ] && [ -n "${CF_ACCESS_CLIENT_SECRET:-}" ]; then
  # The single origin allowed to receive the Access headers.
  if [ -n "${CF_ACCESS_HOST:-}" ]; then
    ACCESS_ORIGIN=$(url_origin "$CF_ACCESS_HOST")
  elif [ -n "$HOST_B" ]; then
    # Paired run: the token never reaches the HOST baseline (Vercel production).
    ACCESS_ORIGIN=$(url_origin "$HOST_B")
  elif [ "$(url_origin "$HOST")" != "$PRODUCTION_ORIGIN" ]; then
    ACCESS_ORIGIN=$(url_origin "$HOST")
  else
    echo "note: CF_ACCESS_CLIENT_ID/SECRET are set but HOST is the production origin; Access headers are not sent (set HOST to the preview, or CF_ACCESS_HOST)." >&2
  fi
  if [ -n "$ACCESS_ORIGIN" ]; then
    ACCESS_HEADER_FILE="$RUN_DIR/access-headers"
    ( umask 077
      printf 'CF-Access-Client-Id: %s\nCF-Access-Client-Secret: %s\n' \
        "$CF_ACCESS_CLIENT_ID" "$CF_ACCESS_CLIENT_SECRET" > "$ACCESS_HEADER_FILE" )
  fi
fi

# Record a failed request for the current run (fetch runs in a subshell, so it
# cannot set FAIL itself). Only the URL and a reason are written, never headers.
request_error() {
  printf '  [FAIL] request %s: %s\n' "$1" "$2" >> "$RUN_DIR/request-errors"
}

# True when the Access headers may be sent to URL $1: credentials are set, the
# URL's origin is the origin under test, and it is also ACCESS_ORIGIN.
access_applies() {
  [ -n "$ACCESS_HEADER_FILE" ] || return 1
  local o
  o=$(url_origin "$1")
  [ -n "$o" ] && [ "$o" = "$(url_origin "$HOST")" ] && [ "$o" = "$ACCESS_ORIGIN" ]
}

# fetch MODE URL — the single request wrapper used by every check.
#   body         GET, follow redirects, print the final body      (was: curl -sL)
#   head         HEAD, no redirects, print the headers             (was: curl -sI)
#   head_follow  HEAD, follow redirects, print every hop's headers (was: curl -sIL)
# Without Access credentials, or for a URL that is not on the origin under
# test, this is exactly the original curl invocation.
fetch() {
  local mode="$1" url="$2" flags
  case "$mode" in
    body) flags=-sL ;;
    head) flags=-sI ;;
    head_follow) flags=-sIL ;;
    *) request_error "$url" "unknown fetch mode $mode"; return 0 ;;
  esac

  if ! access_applies "$url"; then
    curl "$flags" --max-time 30 -A "$UA" "$url" || request_error "$url" "curl exit $?"
    return 0
  fi

  # Access path: no -L, so the headers can never be forwarded to another host.
  # Same-origin redirects are followed by hand with the headers re-added.
  local follow=1 method=-s hops=0 cur="$url" out next tmp rc
  [ "$mode" != "head" ] || follow=0
  [ "$mode" = "body" ] || method=-sI
  tmp=$(mktemp -d "$RUN_DIR/req.XXXXXX")
  while :; do
    rc=0
    out=$(curl "$method" --max-time 30 -A "$UA" -H @"$ACCESS_HEADER_FILE" \
      -D "$tmp/headers" -o "$tmp/body" -w '%{http_code} %{redirect_url}' "$cur") || rc=$?
    if [ "$rc" -ne 0 ]; then
      request_error "$cur" "curl exit $rc"
      break
    fi
    [ "$mode" = "body" ] || cat "$tmp/headers"
    next=${out#* }
    case "$out" in 3*) ;; *) break ;; esac
    if [ "$follow" -eq 0 ] || [ -z "$next" ]; then
      break
    fi
    hops=$((hops + 1))
    if [ "$hops" -gt 50 ]; then
      request_error "$url" "more than 50 redirects"
      break
    fi
    if ! access_applies "$next"; then
      request_error "$url" "redirect to another origin not followed ($(url_origin "$next"))"
      break
    fi
    cur="$next"
  done
  [ "$mode" != "body" ] || cat "$tmp/body" 2>/dev/null || true
  rm -rf "$tmp"
  return 0
}

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
  html=$(fetch body "$HOST$url")
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
  body=$(fetch body "$HOST$url")
  if echo "$body" | head -c 8000 | grep -qE "Ã§|Ã£|Ã¡|Ã©|Ã¶|Ã¼|ÃŸ|Ã¨|Ã²|Ã¬"; then
    echo "  [FAIL] $url contains UTF-8 mojibake"
    FAIL=1
  else
    echo "  [ok]   $url clean UTF-8"
  fi
}

# Every check, in the original order, against $HOST.
run_checks() {
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
  html=$(fetch body "$url")
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
  src=$(fetch head "$url" | grep -i '^x-seo-source:' | tr -d '\r\n' | awk -F': ' '{print $2}')
  if [ "$src" != "db" ]; then
    echo "  [FAIL] /en/$page x-seo-source='$src' (expected 'db')"
    FAIL=1
  fi
done

echo ""
echo "=== /en home row SSR ==="
home_body=$(fetch body "$HOST/en")
home_size=${#home_body}
if [ "$home_size" -lt 22000 ]; then
  echo "  [FAIL] /en raw=$home_size < min=22000 (content_pages.home row not served)"
  FAIL=1
else
  echo "  [ok]   /en raw=$home_size ≥ 22000"
fi
home_seo=$(fetch head_follow "$HOST/en" | grep -i '^x-seo-source:' | tr -d '\r' | awk -F': ' '{print $2}' | tail -1)
if [ "$home_seo" = "db" ]; then
  echo "  [ok]   /en x-seo-source: db"
else
  echo "  [FAIL] /en x-seo-source='$home_seo' (expected 'db')"
  FAIL=1
fi

echo ""
echo "=== Industry images in SSR ==="
industries_body=$(fetch body "$HOST/en/industries")
img_count=$(printf '%s' "$industries_body" | grep -oE '<img[^>]*unsplash.com' | wc -l | tr -d ' ')
if [ "$img_count" -lt 10 ]; then
  echo "  [FAIL] /en/industries only $img_count Unsplash <img> tags, expected ≥10"
  FAIL=1
else
  echo "  [ok]   /en/industries images ($img_count)"
fi

echo ""
echo "=== /en home images in SSR (6 services + 6 industries grids) ==="
home_img_count=$(printf '%s' "$home_body" | grep -oE '<img[^>]*unsplash.com' | wc -l | tr -d ' ')
if [ "$home_img_count" -lt 12 ]; then
  echo "  [FAIL] /en only $home_img_count Unsplash <img> tags, expected ≥12"
  FAIL=1
else
  echo "  [ok]   /en images ($home_img_count)"
fi

echo ""
echo "=== Hreflang parity: every content page ≥15 alternates ==="
for page in '' industries our-work education about contact legal-notice privacy-policy blog; do
  if [ -z "$page" ]; then url="$HOST/en"; else url="$HOST/en/$page"; fi
  body=$(fetch body "$url")
  count=$(printf '%s' "$body" | grep -oE 'rel="alternate" hreflang=' | wc -l | tr -d ' ')
  if [ "$count" -lt 15 ]; then
    echo "  [FAIL] $url only $count hreflang tags, expected ≥15"
    FAIL=1
  else
    echo "  [ok]   $url hreflang ($count)"
  fi
done

echo ""
echo "=== robots + og:locale meta on every content page ==="
for url in "$HOST/en" "$HOST/en/industries" "$HOST/en/legal-notice"; do
  body=$(fetch body "$url")
  if printf '%s' "$body" | grep -q '<meta name="robots"'; then
    echo "  [ok]   $url has meta robots"
  else
    echo "  [FAIL] $url missing <meta name=\"robots\">"
    FAIL=1
  fi
  if printf '%s' "$body" | grep -q '<meta property="og:locale"'; then
    echo "  [ok]   $url has og:locale"
  else
    echo "  [FAIL] $url missing <meta property=\"og:locale\">"
    FAIL=1
  fi
done

echo ""
echo "=== WebSite + SearchAction JSON-LD on /en only ==="
if printf '%s' "$home_body" | grep -q '"@type":"WebSite"'; then
  echo "  [ok]   /en has WebSite JSON-LD"
else
  echo "  [FAIL] /en missing WebSite JSON-LD"
  FAIL=1
fi
if printf '%s' "$home_body" | grep -q '"@type":"SearchAction"'; then
  echo "  [ok]   /en has SearchAction JSON-LD"
else
  echo "  [FAIL] /en missing SearchAction JSON-LD"
  FAIL=1
fi

echo ""
echo "=== No hidden/aria-hidden regression on #seo-content anywhere ==="
for url in "$HOST/en" "$HOST/en/industries" "$HOST/en/our-work" "$HOST/en/about" "$HOST/en/contact"; do
  body=$(fetch body "$url")
  if printf '%s' "$body" | grep -qE '<article[^>]*id="seo-content"[^>]*(hidden|aria-hidden)'; then
    echo "  [FAIL] $url: #seo-content has hidden/aria-hidden (regression)"
    FAIL=1
  else
    echo "  [ok]   $url clean #seo-content"
  fi
done

echo ""
echo "=== Footer VAT / legal-entity SSR regression ==="
home=$(fetch body "$HOST/en")
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

if [ -s "$RUN_DIR/request-errors" ]; then
  echo ""
  echo "=== Request errors ==="
  cat "$RUN_DIR/request-errors"
  FAIL=1
fi
rm -f "$RUN_DIR/request-errors"
}

# run_host LABEL — run every check against $HOST, stream the output, keep a copy
# with the host replaced by <HOST> in $RUN_DIR/LABEL.txt and the run's FAIL
# value in $RUN_DIR/LABEL.fail. A run that aborts counts as failed.
run_host() {
  local label="$1" rc=0
  FAIL=0
  rm -f "$RUN_DIR/request-errors"
  { run_checks; printf '%s' "$FAIL" > "$RUN_DIR/$label.fail"; } \
    | tee "$RUN_DIR/$label.raw" || rc=$?
  local line
  while IFS= read -r line || [ -n "$line" ]; do
    printf '%s\n' "${line//"$HOST"/<HOST>}"
  done < "$RUN_DIR/$label.raw" > "$RUN_DIR/$label.txt"
  if [ "$rc" -ne 0 ] || [ "$(cat "$RUN_DIR/$label.fail" 2>/dev/null)" != "0" ]; then
    [ "$rc" -eq 0 ] || echo "  [FAIL] run against $HOST aborted (exit $rc)"
    return 1
  fi
  return 0
}

if [ -z "$HOST_B" ]; then
  TOTAL_FAIL=0
  run_host a || TOTAL_FAIL=1
else
  TOTAL_FAIL=0
  HOST_A="$HOST"
  echo "##### HOST   = $HOST_A"
  run_host a || TOTAL_FAIL=1
  echo ""
  echo "##### HOST_B = $HOST_B"
  HOST="$HOST_B"
  run_host b || TOTAL_FAIL=1
  HOST="$HOST_A"
  echo ""
  echo "=== Result diff: HOST ($HOST_A) vs HOST_B ($HOST_B) ==="
  if diff -u --label HOST --label HOST_B "$RUN_DIR/a.txt" "$RUN_DIR/b.txt"; then
    echo "  [ok]   no differing result line"
  else
    echo "  [FAIL] result lines differ between HOST and HOST_B"
    TOTAL_FAIL=1
  fi
fi

echo ""
if [ "$TOTAL_FAIL" -eq 0 ]; then
  echo "ALL CHECKS PASSED"
  exit 0
else
  echo "VERIFICATION FAILED"
  exit 1
fi
