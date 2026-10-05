# Offline evaluation of the agent prompts

Two modes of one vitest entry point (`eval/synthetic.eval.ts`, config `eval/vitest.eval.config.ts`; vitest because
the ops sources use extensionless TypeScript imports that plain Node cannot resolve):

| Mode | Command (in `workers/ops`) | Input | Network | Cost |
|---|---|---|---|---|
| Replay (default, CI) | `npm run eval:synthetic` | `eval/samples/*.json`, `test/fixtures/llm/**`, plus the folders in `EVAL_DIRS` (comma list, relative to `workers/ops`) | none: `fetch` is replaced by a function that throws | $0 |
| Live (owner only) | `npm run eval:live` | the golden set in `EVAL_GOLDEN_DIR` (JSON requests `{prompt, user, expected}`, kept outside git) | the AI Gateway (`EVAL_GATEWAY_BASE_URL` = the provider-native Anthropic URL of the gateway, `AI_GATEWAY_TOKEN`) | list price, about $0.05 per request |

Replay runs every fixture through the production LLM adapter (`src/ports/llm.ts`) with a fetch that answers the
recorded response, so parsing, stop reasons, schema checks and pricing are the real code. Live mode writes every
response as a replayable fixture to `eval/recordings/<date>/<prompt>/` (git-ignored); `EVAL_DIRS=eval/recordings/<date>
npm run eval:synthetic` replays a live run later for $0.

## Fixtures

Shape: `eval/fixtures.schema.json`. `request_sha256` is the SHA-256 of the canonical user content
(`llmContentSha256()` in `src/ports/llm.ts`); a fixture that carries `user` must hash to it. `expected` holds the
ground-truth output fields; a `{value, confidence}` field is compared by its value. Fixtures in this repository are
synthetic (addresses `example.com`, `example.de`, `example.gr`; fictitious companies). The golden set of real
e-mails never enters git.

## Metrics and gate

Per prompt: cases, ok rate, field accuracy against `expected`, high-confidence errors (wrong fields with confidence
at least 0.7, the auto-accept threshold), failures by code, tokens and cost. `EVAL_REPORT=<file>` writes the
metrics as JSON; `EVAL_BASELINE=<file>` fails the run when a prompt's ok rate or field accuracy drops by more than
2 points against that earlier report. A new prompt version or model ships only with no such regression on the
same set; the PR states the numbers only.
