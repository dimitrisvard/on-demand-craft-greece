#!/usr/bin/env bash
set -e
UA="Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
HOST="${HOST:-https://www.micronshub.eu}"
FAIL=0

check() {
  local url="$1" min_body="$2" must="$3"
  local html body_text
  html=$(curl -sL --max-time 30 -A "$UA" "$HOST$url")
  body_text=$(echo "$html" | python3 -c "
import sys, re
h = sys.stdin.read()
h = re.sub(r'<script[^>]*>.*?</script>', ' ', h, flags=re.S|re.I)
h = re.sub(r'<style[^>]*>.*?</style>', ' ', h, flags=re.S|re.I)
m = re.search(r'<body[^>]*>(.*?)</body>', h, flags=re.S|re.I)
b = m.group(1) if m else h
print(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', b)).strip())
")
  local len=${#body_text}
  if [ "$len" -ge "$min_body" ] && echo "$body_text" | grep -qi "$must"; then
    echo "  ✅ $url ($len chars)"
  else
    echo "  ❌ $url (len=$len, min=$min_body, must='$must')"
    FAIL=1
  fi
  if echo "$html" | grep -q '"@type":"FAQPage"'; then
    echo "     ✅ FAQPage schema"
  else
    echo "     ❌ FAQPage schema missing"
    FAIL=1
  fi
}

check "/en/services"                     3000 "CNC machining"
check "/en/services/cnc-machining"       4000 "ISO 2768"
check "/en/services/sheet-metal"         4000 "laser"
check "/en/services/3d-printing"         4000 "SLS"
check "/en/services/injection-molding"   4000 "tooling"
check "/en/services/rapid-prototyping"   4000 "prototype"
check "/en/services/surface-finishes"    4000 "anodiz"

exit $FAIL
