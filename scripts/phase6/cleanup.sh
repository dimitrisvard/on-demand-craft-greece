#!/usr/bin/env bash
# Phase 6 repository cleanup (docs/migration/PLAN.md P6-5, P6-6). Owner-run, once Vercel is no longer a rollback
# target.
#
# Run it only when all of these hold (the script cannot check them; --decommissioned says they do):
#   - the Phase 3 gate was signed at least 30 days ago and the Vercel project is paused or disconnected from Git,
#     so a push to main no longer builds a Vercel deployment (vercel.json, middleware.ts and the workflows below
#     are what that build used);
#   - the Phase 5 gate is signed (the Xometry scan and the ported jobs run on Cloudflare).
#
# Usage (from anywhere inside the repository):
#   bash scripts/phase6/cleanup.sh                            dry run: prints every action and its state, changes nothing
#   bash scripts/phase6/cleanup.sh --apply --decommissioned   performs the TODO actions and stages them (never commits)
# Options:
#   --with-statics          also remove public/laserkritis/ and public/cookie-consent.html (only after the access-log
#                           check of PLAN.md P6-6 shows no real traffic on them)
#   --with-gsc-functions    also remove the four gsc-* function folders (only after OW6-13: no caller outside the
#                           repository and the functions deleted in Supabase)
#   --with-cron-functions   also remove the four function folders without a caller after Phase 5 (only after OW6-17:
#                           14 days of logs without an invocation and the functions deleted in Supabase)
#   --keep-forward          keep API_FORWARD_ORIGIN (default: set to "" in both env blocks of workers/site/wrangler.jsonc,
#                           so every forward answers 502 without an outbound request)
#   --allow-main            allow running on branch main/master (default: refused; run it on a branch, merge by PR)
#   --allow-dirty           allow --apply with uncommitted changes to tracked files (default: refused, so the cleanup
#                           stays one reviewable change)
#
# Every action is idempotent: TODO (will run), DONE (already in that state), BLOCKED (state is unexpected; nothing
# is changed). Any BLOCKED action stops the run before the first change. NOTE lines are reported, never blocking.
# A file outside docs/, reference/, *.md, scripts/phase6/ and supabase/migrations/ that names a moved or deleted
# path blocks the run unless the line is a known edit or listed in KNOWN_MENTIONS (scripts/phase6/cleanup-edits.mjs).
# Exit codes: 0 ok, 1 blocked, 2 refused.
#
# Kept on purpose (printed as KEEP): middleware/ (imported by workers/site/src/seo), api/ and lib/ (imported by
# microns-site and microns-ops through the Express-compatible shim), tsconfig.middleware.json, the Vite prerender
# plugin (owner decision), xometry-bot/ (golden source of the Worker port).

set -euo pipefail

APPLY=0 DECOMMISSIONED=0 WITH_STATICS=0 WITH_GSC=0 WITH_CRON=0 KEEP_FORWARD=0 ALLOW_MAIN=0 ALLOW_DIRTY=0
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    --decommissioned) DECOMMISSIONED=1 ;;
    --with-statics) WITH_STATICS=1 ;;
    --with-gsc-functions) WITH_GSC=1 ;;
    --with-cron-functions) WITH_CRON=1 ;;
    --keep-forward) KEEP_FORWARD=1 ;;
    --allow-main) ALLOW_MAIN=1 ;;
    --allow-dirty) ALLOW_DIRTY=1 ;;
    -h|--help) sed -n '2,38p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg (see --help)" >&2; exit 2 ;;
  esac
done

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "not inside a git repository" >&2; exit 2; }
cd "$ROOT"
command -v node >/dev/null 2>&1 || { echo "node is required (text edits and the mention scan)" >&2; exit 2; }
EDITS="scripts/phase6/cleanup-edits.mjs"
[ -f "$EDITS" ] || { echo "missing $EDITS" >&2; exit 2; }
GROUP_FLAGS=""
[ "$WITH_STATICS" = 1 ] && GROUP_FLAGS="$GROUP_FLAGS --with-statics"
[ "$WITH_GSC" = 1 ] && GROUP_FLAGS="$GROUP_FLAGS --with-gsc-functions"
[ "$WITH_CRON" = 1 ] && GROUP_FLAGS="$GROUP_FLAGS --with-cron-functions"
[ "$KEEP_FORWARD" = 1 ] && GROUP_FLAGS="$GROUP_FLAGS --keep-forward"

BRANCH=$(git symbolic-ref --quiet --short HEAD 2>/dev/null || echo "(detached)")
MODE="DRY RUN (nothing is changed; add --apply --decommissioned to run)"
[ "$APPLY" = 1 ] && MODE="APPLY"
echo "Phase 6 cleanup (PLAN.md P6-5, P6-6): $MODE"
echo "repository: $ROOT"
echo "branch: $BRANCH  HEAD: $(git rev-parse --short HEAD)"

# ----- refusals --------------------------------------------------------------------------------------------------
if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
  if [ "$ALLOW_MAIN" != 1 ]; then
    echo "REFUSED  branch $BRANCH: run on a branch and merge by pull request, or pass --allow-main" >&2
    exit 2
  fi
  echo "note     running on $BRANCH (--allow-main)"
fi
if [ "$APPLY" = 1 ] && [ "$DECOMMISSIONED" != 1 ]; then
  echo "REFUSED  --apply needs --decommissioned (see the preconditions printed by the dry run)" >&2
  exit 2
fi
DIRTY=$(git status --porcelain --untracked-files=no)
if [ -n "$DIRTY" ]; then
  if [ "$APPLY" = 1 ] && [ "$ALLOW_DIRTY" != 1 ]; then
    echo "REFUSED  uncommitted changes to tracked files (commit or stash them, or pass --allow-dirty):" >&2
    echo "$DIRTY" >&2
    exit 2
  fi
  echo "note     uncommitted changes to tracked files present"
fi

echo "preconditions (the script cannot check them; --decommissioned confirms them):"
echo "  - the Phase 3 gate was signed at least 30 days ago"
echo "  - the Vercel project is paused or disconnected from Git (a push to main no longer builds it)"
echo "  - the Phase 5 gate is signed"
[ "$WITH_STATICS" = 1 ] && echo "  - static-file log check done: no real traffic on /laserkritis/* and /cookie-consent.html (OW6-14)"
[ "$WITH_GSC" = 1 ] && echo "  - OW6-13 done: nothing outside the repository calls the four gsc-* functions; they are deleted in Supabase"
[ "$WITH_CRON" = 1 ] && echo "  - OW6-17 done: 14 days of logs without an invocation; the four functions are deleted in Supabase"

# ----- plan ------------------------------------------------------------------------------------------------------
TODO=0 DONE=0 BLOCKED=0
PLAN_MV=() PLAN_RM=() PLAN_README=0
report() { # state text
  printf '  %-7s  %s\n' "$1" "$2"
  case "$1" in TODO) TODO=$((TODO + 1)) ;; DONE) DONE=$((DONE + 1)) ;; BLOCKED) BLOCKED=$((BLOCKED + 1)) ;; esac
}
tracked() { [ -n "$(git ls-files -- "$1")" ]; }

plan_mv() { # src dst why
  if tracked "$1" && [ ! -e "$2" ]; then report TODO "git mv $1 $2 ($3)"; PLAN_MV+=("$1|$2")
  elif ! tracked "$1" && [ ! -e "$1" ] && tracked "$2"; then report DONE "$2 ($3)"
  elif [ -e "$1" ] && [ -e "$2" ]; then report BLOCKED "both $1 and $2 exist ($3)"
  else report BLOCKED "neither $1 (tracked) nor $2 found ($3)"; fi
}
plan_rm() { # path why
  if tracked "$1"; then report TODO "git rm -r $1 ($2)"; PLAN_RM+=("$1")
  elif [ -e "$1" ]; then report BLOCKED "$1 exists but is not tracked ($2)"
  else report DONE "$1 removed ($2)"; fi
}
plan_group() { # group letter: moves and deletions listed by cleanup-edits.mjs
  local out op src dst why
  out=$(node "$EDITS" actions --group "$1") || { echo "action list failed" >&2; exit 2; }
  while IFS=$'\t' read -r op src dst why; do
    [ -z "$op" ] && continue
    if [ "$op" = mv ]; then plan_mv "$src" "$dst" "$why"; else plan_rm "$src" "$why"; fi
  done <<< "$out"
}
plan_edits() { # group letter: text edits listed by cleanup-edits.mjs
  local out rc line state rest
  out=$(node "$EDITS" plan --group "$1") && rc=0 || rc=$?
  [ "$rc" -gt 1 ] && { echo "edit planner failed" >&2; exit 2; }
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    state=${line%% *}
    rest=${line#"$state"}
    rest=${rest#"${rest%%[! ]*}"}
    report "$state" "$rest"
  done <<< "$out"
}

echo "[A] freeze the Vercel config and middleware as the parity reference (tests, parity tool)"
plan_group A

echo "[B] repoint the consumers and other text edits"
plan_edits B

echo "[C] delete (PLAN.md §5.6 list and the Phase 5 hand-over)"
plan_group C

echo "[D] README rewrite (prepared in docs/migration/phase6/root-README.md)"
if [ -f docs/migration/phase6/root-README.md ]; then
  report TODO "README.md <- docs/migration/phase6/root-README.md (the prepared file is moved into place)"; PLAN_README=1
elif grep -q 'Deployed_on-Vercel' README.md 2>/dev/null; then
  report BLOCKED "README.md still describes Vercel and docs/migration/phase6/root-README.md is missing"
else
  report DONE "README.md rewritten"
fi

echo "[E] reachable static files (opt-in, after the access-log check)"
if [ "$WITH_STATICS" = 1 ]; then
  plan_group E
else
  echo "  skip     public/laserkritis/, public/cookie-consent.html (add --with-statics after the log check)"
fi

echo "[G] retire the Vercel forward (API_FORWARD_ORIGIN becomes \"\"; every forward then answers 502)"
if [ "$KEEP_FORWARD" = 1 ]; then
  echo "  skip     edits E16, E17 (--keep-forward)"
else
  plan_edits G
fi

echo "[H] gsc-* function folders (opt-in, after OW6-13)"
if [ "$WITH_GSC" = 1 ]; then
  plan_group H
else
  echo "  skip     supabase/functions/gsc-{sitemap-sync,performance,index-url,inspect-url} (add --with-gsc-functions after OW6-13)"
fi

echo "[I] function folders with no caller after Phase 5 (opt-in, after OW6-17)"
if [ "$WITH_CRON" = 1 ]; then
  plan_group I
else
  echo "  skip     supabase/functions/{process-article-queue,auto-update-sitemap,auto-translate-articles,tender-collector} (add --with-cron-functions after OW6-17)"
fi

echo "[S] other files that name a moved or deleted path"
# shellcheck disable=SC2086 # GROUP_FLAGS is a list of words
SCAN_OUT=$(node "$EDITS" scan $GROUP_FLAGS) && SCAN_RC=0 || SCAN_RC=$?
[ "$SCAN_RC" -gt 1 ] && { echo "mention scan failed" >&2; exit 2; }
SCAN_HITS=0
while IFS= read -r line; do
  [ -z "$line" ] && continue
  SCAN_HITS=$((SCAN_HITS + 1))
  report BLOCKED "${line#BLOCKED  } (edit it, or add it to KNOWN_MENTIONS in $EDITS with its reason)"
done <<< "$SCAN_OUT"
[ "$SCAN_HITS" = 0 ] && echo "  none"

echo "[N] notes (reported, not changed)"
NOTE_OUT=$(node "$EDITS" gpteng) || { echo "note scan failed" >&2; exit 2; }
if [ -n "$NOTE_OUT" ]; then
  while IFS= read -r line; do
    [ -n "$line" ] && echo "  $line"
  done <<< "$NOTE_OUT"
else
  echo "  none"
fi

echo "[F] kept on purpose"
for keep in "middleware/ (workers/site/src/seo imports it)" "api/, lib/ (microns-site and microns-ops import them)" \
  "tsconfig.middleware.json (type-checks middleware/)" "vite.config.ts prerender plugin (owner decision: keep)" \
  "xometry-bot/ (golden source of the Worker port)"; do
  echo "  KEEP     $keep"
done

echo "summary: $TODO to do, $DONE already done, $BLOCKED BLOCKED"
if [ "$BLOCKED" -gt 0 ]; then
  echo "BLOCKED actions found: nothing was changed." >&2
  exit 1
fi
if [ "$APPLY" != 1 ]; then
  exit 0
fi
if [ "$TODO" = 0 ]; then
  echo "nothing to do."
  exit 0
fi

# ----- apply (moves, edits, deletions, README; staged, not committed) --------------------------------------------
for pair in ${PLAN_MV[@]+"${PLAN_MV[@]}"}; do
  dst=${pair#*|}
  mkdir -p "$(dirname "$dst")"
  git mv "${pair%%|*}" "$dst"
done
# shellcheck disable=SC2086
CHANGED=$(node "$EDITS" apply $GROUP_FLAGS)
while IFS= read -r file; do
  [ -n "$file" ] && git add -- "$file"
done <<< "$CHANGED"
for path in ${PLAN_RM[@]+"${PLAN_RM[@]}"}; do
  git rm -r -q -- "$path"
  if [ -e "$path" ]; then echo "note     untracked files remain in $path (not removed)"; fi
done
if [ "$PLAN_README" = 1 ]; then
  cp docs/migration/phase6/root-README.md README.md
  git rm -q -- docs/migration/phase6/root-README.md
  git add README.md
fi

echo
echo "staged changes:"
git status --short --untracked-files=no
cat <<'NEXT'

next (review, test, commit; nothing was committed):
  git diff --cached --stat
  npm run cf:test:all && node tests/middleware/smoke.mjs && npm --prefix scripts/seo-parity test
  workers/site/node_modules/.bin/vitest run -c tests/frontend-api/vitest.config.mjs
  workers/site/node_modules/.bin/vitest run -c tests/edge-functions/vitest.config.mjs
  npx vite build                      # dist/ for the parity re-run (PLAN.md Phase 6 gate item 4)
  git commit -m "chore(phase6): remove Vercel-era files, freeze the Vercel reference (P6-6)"
NEXT
