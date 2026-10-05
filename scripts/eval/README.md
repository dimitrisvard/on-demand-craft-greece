# Golden-set evaluation (owner runbook)

The golden set is a private export of at least 30 past RFQ e-mails with a ground-truth table. It lives in the R2
bucket `microns-private` under `eval/golden/<yyyy-mm-dd>/` and never in this repository, a commit, an issue or a
log. The evaluation code is public: `workers/ops/eval/` (see `workers/ops/eval/README.md`).

| Step | What |
|---|---|
| 1 Export | For each e-mail: the request the intake prompt receives (`{prompt, user, expected}` as JSON: `user` is the delimited e-mail text and attachment blocks, `expected` the ground-truth fields). Upload the folder to `microns-private/eval/golden/<yyyy-mm-dd>/` |
| 2 Fetch locally | Download that folder to a directory outside the repository, e.g. `~/microns-golden/<yyyy-mm-dd>/` |
| 3 Approve the cost | About 30 requests at list price (≈ $1.50 per run with the current models) |
| 4 Run | In `workers/ops`: `EVAL_GOLDEN_DIR=~/microns-golden/<yyyy-mm-dd> EVAL_GATEWAY_BASE_URL=<provider-native Anthropic URL of the gateway> AI_GATEWAY_TOKEN=<gateway token> EVAL_REPORT=eval/out/<date>.json npm run eval:live` |
| 5 Compare | Before switching `agent.rfq_intake` from `shadow` to `assist`, and before any prompt or model change: rerun with `EVAL_BASELINE=eval/out/<previous>.json`; the run fails on a drop of more than 2 points |
| 6 Clean up | The recordings (`workers/ops/eval/recordings/`) and reports (`workers/ops/eval/out/`) are git-ignored; delete the local golden copy after the comparison |

The gateway keeps payload logging off for these requests as for production traffic.
