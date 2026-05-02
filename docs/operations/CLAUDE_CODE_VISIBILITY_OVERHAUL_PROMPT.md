# Claude Code prompt — paste this into a fresh Claude Code session

> **How to use:** open Claude Code in a terminal anywhere on your machine. Paste everything in the code block below as a single message. Claude Code will run the commands for you and report back.

---

```text
You are my execution partner for a one-time GitHub setup. I have a folder of prepared repo
scaffolds on my machine and four repos already created on GitHub (three empty, one with a
production README on `on-demand-craft-greece`). Your job is to get all the local files
pushed to the right remotes, in the right order, with the right safety checks. Don't ask
clarifying questions unless something would be irreversible — I'm in a hurry. Report progress
inline as you go, and at the end give me one short summary of what's now on GitHub vs what
failed.

GLOBAL CONTEXT

- My GitHub username is `dimitrisvard`. All four target repos already exist as
  `dimitrisvard/<name>`.
- The local files live under:
  `C:\Users\dimit\Desktop\Microns Hub Claude Cowork\new carrer path\me\visibility-overhaul`
- I'm on Windows. Run shell commands via Git Bash or whatever shell you have. Use forward
  slashes when you can. If a path with spaces gives you trouble, quote it.
- I'm authenticated to GitHub via either the `gh` CLI or HTTPS with a stored credential
  helper — assume one of those works. If pushing fails with auth errors, stop and tell me.
- Use `Dimitris Vardalachakis <dimitrisvard@hotmail.com>` for git author if a commit needs
  an author override.

────────────────────────────────────────────────────────────────────
STEP 0 — orientation
────────────────────────────────────────────────────────────────────

1. `cd` to the visibility-overhaul folder above.
2. List the four subfolders you'll touch: `mcp-toolkit/`, `rag-project/`, `personal-site/`,
   `github-main-repo/`. Confirm all four exist before doing anything else.
3. Run `git --version` and `gh --version || echo "no gh"` so we know what we're working with.

────────────────────────────────────────────────────────────────────
STEP 1 — push `mcp-business-toolkit` (TypeScript MCP scaffold)
────────────────────────────────────────────────────────────────────

Target remote: https://github.com/dimitrisvard/mcp-business-toolkit.git
Local source: visibility-overhaul/mcp-toolkit/

Inside `mcp-toolkit/`:
- If `.git` already exists, skip `git init`. Otherwise: `git init`.
- Verify the `.gitignore` is present (it covers `node_modules/`, `dist/`, `.env*`). If it's
  missing for any reason, create it before staging.
- `git add .`
- `git commit -m "Initial: 5-tool MCP server scaffold"`  (skip if nothing to commit)
- `git branch -M main`
- Set the remote idempotently: `git remote remove origin 2>/dev/null; git remote add origin
  https://github.com/dimitrisvard/mcp-business-toolkit.git`
- `git push -u origin main`

Acceptance: report the count of files pushed. Expected ~13 files including README.md,
LICENSE, package.json, tsconfig.json, .env.example, .gitignore, src/server.ts,
src/tools/{index,types,gsc,supabase,apollo,gmail,vercel}.ts,
tests/{tool-isolation,supabase-allowlist}.test.ts, examples/claude-desktop-config.json.

If push fails with "rejected non-fast-forward" (because the remote isn't actually empty),
STOP and tell me before forcing.

────────────────────────────────────────────────────────────────────
STEP 2 — push `manufacturing-rag` (Python RAG scaffold)
────────────────────────────────────────────────────────────────────

Target remote: https://github.com/dimitrisvard/manufacturing-rag.git
Local source: visibility-overhaul/rag-project/

Same flow as Step 1, with these differences:
- Commit message: "Initial: production RAG scaffold with eval harness"
- Remote: https://github.com/dimitrisvard/manufacturing-rag.git

Acceptance: ~12 files including README.md, LICENSE, architecture.md, Makefile,
requirements.txt, .env.example, src/{ingest,retrieve,generate,ui_streamlit}.py,
evals/{run.py,eval-set.jsonl}.

────────────────────────────────────────────────────────────────────
STEP 3 — push `dimitrisvard.github.io` (personal site, single file)
────────────────────────────────────────────────────────────────────

Target remote: https://github.com/dimitrisvard/dimitrisvard.github.io.git
Local source: visibility-overhaul/personal-site/

Inside `personal-site/`:
- Same idempotent `.git init` pattern as above.
- IMPORTANT: only stage `index.html`, NOT the `README-deploy.md` (that file is just
  instructions for me, not part of the live site). Use `git add index.html`.
- Commit message: "Initial site"
- Remote: https://github.com/dimitrisvard/dimitrisvard.github.io.git
- Push.

Acceptance: GitHub Pages will serve this at https://dimitrisvard.github.io within ~5
minutes. After the push, tell me to open that URL in incognito after a coffee break to
verify.

────────────────────────────────────────────────────────────────────
STEP 4 — pin the four right repos on the profile
────────────────────────────────────────────────────────────────────

This step needs the GitHub UI; commands can't pin repos. After Steps 1–3 finish, output
the exact instructions I should follow:

  "Open https://github.com/dimitrisvard, click 'Customize your pins' in the top right
   of the Popular repositories section, tick these four:
     - on-demand-craft-greece
     - mcp-business-toolkit
     - manufacturing-rag
     - dimitrisvard.github.io
   Click Save pins."

Just print those lines. Don't try to automate the click.

────────────────────────────────────────────────────────────────────
STEP 5 — production README + LICENSE on `on-demand-craft-greece`
────────────────────────────────────────────────────────────────────

PRECONDITION CHECK: this step touches the existing public production codebase. Before
doing anything:

1. Ask me to confirm I've already run the secret scan from
   `visibility-overhaul/github-main-repo/pre-publish-checklist.md` and that nothing real
   came back, OR that I've rotated any leaked credentials. Wait for my "yes, scan is
   clean".
2. If I say no, stop here and don't touch the repo. Print the exact `git log -p -S` lines
   from section 1 of pre-publish-checklist.md so I can run them myself.

Once I confirm the scan is clean:

1. Ask me where my local clone of `on-demand-craft-greece` lives. (You won't know; the
   visibility-overhaul folder doesn't contain that repo.)
2. `cd` to that path.
3. Verify it's the right repo: `git remote get-url origin` should contain
   `dimitrisvard/on-demand-craft-greece`.
4. Stash any uncommitted local changes first (`git stash push -m "before README swap"`)
   so I can recover anything I was mid-editing.
5. Copy:
   - `visibility-overhaul/github-main-repo/README.md` → `./README.md` (overwrite)
   - `visibility-overhaul/github-main-repo/LICENSE`   → `./LICENSE` (overwrite)
6. `git add README.md LICENSE`
7. `git commit -m "Production README + proprietary LICENSE"`
8. `git push`
9. Tell me to add 2–3 real screenshots into `docs/screenshots/` and update the image
   paths near the top of the new README.

────────────────────────────────────────────────────────────────────
FINAL REPORT
────────────────────────────────────────────────────────────────────

End with a single short status block, no fluff:

  ✅  mcp-business-toolkit          — N files pushed
  ✅  manufacturing-rag             — N files pushed
  ✅  dimitrisvard.github.io        — 1 file pushed (live in ~5 min)
  ✅/⏸️  on-demand-craft-greece    — README/LICENSE replaced  (or "skipped — secret scan not confirmed")

  Next manual step: pin the four repos on github.com/dimitrisvard.
```

---

## How to read the report

The prompt is intentionally explicit — every command is named, every commit message is
fixed, every remote URL is hardcoded — so Claude Code can run end-to-end without guessing.
Two safety gates:

1. **Step 1's force-push check.** If a remote isn't actually empty (e.g. you created it
   with a README via the web), Claude Code will refuse to clobber and ask you. Good.
2. **Step 5's secret-scan gate.** This one's the real one. Claude Code will not touch your
   live `on-demand-craft-greece` repo until you confirm "scan is clean". Don't lie to it —
   the whole point of the gate is to keep you from a credential leak compounding.
