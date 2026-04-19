#!/usr/bin/env bash
# scripts/verify-ssr.sh
#
# Verify that SEO server-side rendering is working for every route type the
# middleware is responsible for. Crawls each sampled URL with a Googlebot
# User-Agent and asserts that the response body contains real localized
# content (not just the SPA shell).
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

UA="Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
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

echo "=== Homepage ==="
check "/en"                                        500 "manufactur"
check "/de"                                        500 "fertigung|hergestellt|cnc"
check "/pt"                                        500 "usinagem|manufatura"

echo ""
echo "=== Services index ==="
check "/en/services"                               500 "cnc|sheet metal"
check "/de/dienstleistungen"                       500 "cnc|blech"
check "/pt/servicos"                               500 "cnc|usinagem|chapa"

echo ""
echo "=== Service detail (critical — revenue funnel) ==="
check "/en/services/sheet-metal"                   800 "sheet metal"
check "/en/services/cnc-machining"                 800 "cnc"
check "/de/dienstleistungen/blechbearbeitung"      800 "blech"
check "/de/dienstleistungen/cnc-bearbeitung"       800 "cnc"
check "/pt/servicos/chapa-metalica"                800 "chapa"
check "/pt/servicos/usinagem-cnc"                  800 "usinagem|cnc"
check "/es/servicios/chapa-metalica"               800 "chapa"
check "/fr/services/tolerie"                       800 "tôlerie|tolerie"
check "/it/servizi/lavorazione-lamiera"            800 "lamiera"
check "/nl/diensten/plaatbewerking"                800 "plaat"
check "/pl/uslugi/obrobka-bluzy"                   800 "obr"
check "/sv/tjanster/platbearbetning"               800 "plåt|platbearb"
check "/da/tjenester/pladearbejde"                 800 "plade"
check "/hu/szolgaltatasok/lemezfeldolgozas"        800 "lemez"
check "/cs/sluzby/obrabeni-plechu"                 800 "plech"

echo ""
echo "=== Industries ==="
check "/en/industries"                             500 "aerospace|automotive|industri"
check "/de/branchen"                               500 "luft|auto|bran"
check "/pt/industrias"                             500 "aeroespacial|automotiva|indúst"

echo ""
echo "=== Blog index ==="
check "/en/blog"                                   300 "blog|article|post"
check "/de/blog"                                   300 "blog|artikel"
check "/sv/blogg"                                  300 "blog"

echo ""
echo "=== Simple pages ==="
check "/en/about"                                  500 "microns|manufactur"
check "/en/contact"                                400 "contact"
check "/en/quote"                                  400 "quote|manufactur"
check "/en/our-work"                               400 "portfolio|work|microns"
check "/de/ueber-uns"                              500 "microns|fertigung"
check "/pt/contato"                                400 "microns|contato"

echo ""
echo "=== UTF-8 encoding regression guard ==="
check_encoding "/pt/servicos/chapa-metalica"
check_encoding "/de/dienstleistungen/blechbearbeitung"
check_encoding "/fr/services/tolerie"
check_encoding "/pt"
check_encoding "/de"

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "ALL CHECKS PASSED"
  exit 0
else
  echo "VERIFICATION FAILED"
  exit 1
fi
