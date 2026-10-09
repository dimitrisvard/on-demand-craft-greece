# CAD Container (`microns-cad`)

Phase 5 of the Cloudflare migration (P5-6). The sheet-metal unfold service (`sheet-metal-service/`) runs as a
Cloudflare Container behind `microns-ops`. This folder holds this README and the parity tool only; there is no npm
package here.

| Part | Where |
|---|---|
| Container class `CadContainer` (port 8000, sleeps after 10 min, no internet, ping `localhost/health`) | `workers/ops/src/cad-container/cad-container.ts` |
| Outbound input proxy for `cad-input.internal` | `workers/ops/src/cad-container/input-proxy.ts` |
| Slot names `cad-0` … `cad-<CAD_SLOTS - 1>` | `workers/ops/src/cad-container/slots.ts` |
| Container backend of the `cad-jobs` consumer | `workers/ops/src/cad/backends/container.ts` |
| Slots, priorities and recycle | `workers/ops/src/do/cad-router.ts` (`CadRouter`) |
| Compat path of the CAD edge functions | `workers/ops/src/routes/cad-compat.ts` (ops) and the site's `/api/cad/` gate |
| Image | `sheet-metal-service/Dockerfile`, `sheet-metal-service/requirements.lock.txt` |
| Image build, tests and push | `.github/workflows/cad-image.yml` |
| Parity comparator and golden manifest | `workers/cad/parity/` |

`@cloudflare/containers` (0.3.7, exact) is a dependency of `workers/ops` only. `src/index.ts` re-exports
`ContainerProxy` from the same specifier `CadContainer` extends, so the bundle holds one copy of the package; the
outbound handler is registered with an assignment after the class body (`CadContainer.outboundByHost = {…}`), never
as a `static` class field. `workers/ops/scripts/check-bundle.mjs` fails on a second copy.

## Service rules (P5-6)

- `X-API-Key` is required on every route except `/health` and `/api/v1/health` (constant-time compare).
  `REQUIRE_API_KEY=1` (set in the Container) answers 503 `{"error":"API key not configured"}` while `API_KEY` is
  empty.
- Processing requests (`POST /api/v1/unfold*`, `POST /flat-pattern`) run in a forked child process. The child is
  stopped after `PROCESSING_TIMEOUT` seconds (default 120) with 504 `{"detail":"Processing timeout after 120 s"}`,
  when the client goes away, or answers 500 `{"detail":"Processing crashed (exit …)"}` when it dies. One job runs at
  a time; `/health` answers during a job. Endpoint bodies are unchanged, so answers are byte-identical apart from
  the values the service randomises itself (see Parity).
- The Container gets `API_KEY` (= `CAD_SHARED_SECRET` of `microns-ops`), `REQUIRE_API_KEY=1` and
  `PROCESSING_TIMEOUT` (= `CAD_PROCESSING_TIMEOUT_S`, default 120). It holds no storage or database credentials.
- **Compatibility rule:** the VPS keeps its current image until Phase 6 and is never rebuilt from the new
  Dockerfile while the Supabase secret `UNFOLD_SERVICE_URL` points to it.

## How `microns-ops` uses it

- Agent jobs (`cad-jobs` queue): `CadRouter.acquire({…, priority: 'batch'})` grants a lease with a slot; the job
  runs `POST http://cad/api/v1/unfold` (multipart upload, `X-API-Key`) on `getContainer(CAD_CONTAINER, slot)`.
  Batch jobs hold at most `CAD_SLOTS - 1` slots, so one slot stays free for the compat path. Used when
  `CAD_BACKEND_DEFAULT = "container"` (the merged config keeps `"vps"` until the switch-over step S9).
- Compat path of the edge functions `extract-flat-pattern` and `generate-manufacturing-pdf`: the site answers
  `POST /api/cad/<token>/flat-pattern` (action CD-1, secret `CAD_COMPAT_TOKEN`) and calls ops with the function URL
  `/api/cad/flat-pattern`. Ops validates the body (`file_url` https on a host of `CAD_INPUT_HOSTS`, plain
  `file_name`), takes an interactive lease (503 `CAD busy` after 20 s), rewrites `file_url` to
  `http://cad-input.internal/u/<base64url>` and returns the container's status, content type and bytes unchanged
  within 110 s (else 502 `CAD unavailable`). The container fetches its input through the outbound handler, which
  accepts only https URLs on the exact hosts of `CAD_INPUT_HOSTS` and at most 3 re-checked redirects.
- Outcomes: 504 processing timeout -> `timeout`, not retried; 500 crash -> retried once, the slot's container is
  destroyed (`recycle`); 401 -> failed, one Telegram line "CAD key mismatch", slot recycled; 503 "API key not
  configured" -> failed, one Telegram line. The container is never probed actively (a probe would wake it).
- A container started before `CAD_SHARED_SECRET` changed keeps the old key until it restarts: recycle its slots
  (or wait for the 10-minute sleep) after a key rotation.

## Build and run locally

```bash
docker build --platform linux/amd64 -t microns-cad:dev sheet-metal-service
key="$(openssl rand -hex 24)"
docker run --rm -p 8000:8000 -e API_KEY="$key" -e REQUIRE_API_KEY=1 microns-cad:dev
# in a second shell
python3 -m http.server 8765 --bind 127.0.0.1 -d sheet-metal-service/tests/fixtures/unfold
CAD_PARITY_KEY="$key" python3 workers/cad/parity/cad_parity.py check \
  --base http://127.0.0.1:8000 --files http://host.docker.internal:8765 --golden workers/cad/parity/golden
```

Without Docker (development), the service tests run in a virtualenv with the locked versions:

```bash
python3 -m venv .venv-cad && .venv-cad/bin/pip install -r sheet-metal-service/requirements.lock.txt pytest httpx
(cd sheet-metal-service && ../.venv-cad/bin/python -m pytest -q tests/test_p5_service.py tests/test_fixtures.py)
python3 workers/cad/parity/cad_parity.py self-test
```

`wrangler dev` in `workers/ops` runs the container locally only when Docker is running. The T2 profile `jobs`
(`npm --prefix workers/ops run test:integration:jobs`) replaces the container with the stub
`workers/site/test/integration/stubs/cad-container.mjs` through `CAD_CONTAINER_BASE_URL`.

## Build and push the image (owner)

1. GitHub: environment `cad-release` with yourself as required reviewer and the secrets `CLOUDFLARE_API_TOKEN`
   (Containers write) and `CLOUDFLARE_ACCOUNT_ID`.
2. Dispatch `.github/workflows/cad-image.yml` with `push: true` and approve the `push` job. The job summary prints
   the image reference.
3. Put that reference into `workers/ops/wrangler.jsonc` (`containers[0].image`), then deploy `microns-ops`
   (`cf-ops.yml`); the first deploy with the container takes several minutes before requests succeed.
4. Keep at most 3 tags in the registry (`npx wrangler containers images list`, `… images delete`).

Before the parity gate, replace `sheet-metal-service/requirements.lock.txt` with the `pip freeze` of the service
on the VPS (with `python --version` and `uname -m`) and rebuild, so both run the same library versions.

## Parity (exit gate item 4)

"Byte-identical" means the raw bodies are equal after masking only what the service makes different on every call
or every day: in DXF (also inside `/flat-pattern` `dxf_base64`) `$TDCREATE`, `$TDUCREATE`, `$TDUPDATE`,
`$TDUUPDATE`, `$VERSIONGUID`, `$FINGERPRINTGUID`, the ezdxf marker and the order of the `CLASSES` records; in PDF
`/CreationDate`, `/ModDate`, `/ID` and the drawing date of the title block (`Date: YYYY-MM-DD`, written by
`drawing/title_block.py` with the day of the call). PDF content streams (`ASCII85Decode`, `FlateDecode`) are
compared decoded, so their compressed bytes, their `/Length` and the byte offsets of the xref table and `startxref`
(which follow from those lengths) are not compared; the drawing itself is. JSON, SVG, outline, bends and the
`X-Part-*`, `content-type` and `content-disposition` headers must match exactly. A capture of one day therefore
compares `IDENTICAL` with a capture of any other day.

```bash
python3 workers/cad/parity/cad_parity.py self-test                 # masks proven, a 0.01 mm change DIFFERS
python3 workers/cad/parity/cad_parity.py capture --base <service> --files <fixture server> --out <dir>
python3 workers/cad/parity/cad_parity.py compare <vps dir> <container dir>   # 5/5 IDENTICAL per endpoint
python3 workers/cad/parity/cad_parity.py manifest <dir>              # normalised SHA-256 per capture
python3 workers/cad/parity/cad_parity.py check --base <service> --files <fixture server> --golden workers/cad/parity/golden
```

Inputs: `--files <folder URL>` uses `<folder URL>/<ref>.step` for each reference; `--urls <file>` takes one full
URL per reference from a JSON object `{"l_bend_45": "https://…", …}` and uses each exactly as given (presigned
GET URLs). The input URL is sent as `file_url` to `/flat-pattern` and downloaded by the tool for the multipart
endpoints.

Credentials: the key is read from the environment variable `CAD_PARITY_KEY` (or the one named by `--key-env`), never
from the command line. `--compat` captures `/flat-pattern` only and sends no key; its base URL (the site's
`https://www.micronshub.eu/api/cad/<token>` without `/flat-pattern`) is read from the environment variable named by
`--base-env` (default `CAD_COMPAT_BASE`), never from the command line. Output and error lines never print a base
URL or the query of an input URL.

Gate procedure (owner, at S9 (a)):

1. Upload the 5 fixtures (`for r in l_bend_45 l_bend_90 l_bend_135 u_channel z_fold; do npx wrangler r2 object put
   "microns-private/cad/parity/$r.step" --file "sheet-metal-service/tests/fixtures/unfold/$r.step" --jurisdiction eu
   --remote; done`).
2. Presign a GET URL for each, valid for 1 hour, with an R2 API token that can read `microns-private` (AWS CLI
   profile with region `auto`; R2 docs, "Presigned URLs"):
   `aws s3 presign --endpoint-url "https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com" s3://microns-private/cad/parity/<ref>.step --expires-in 3600`.
   The URL host must be one of the hosts in `CAD_INPUT_HOSTS` (the compat path accepts no other). Write the 5 URLs
   to a `urls.json` outside the repository and delete it after the captures.
3. VPS: `read -rs CAD_PARITY_KEY && export CAD_PARITY_KEY`, then
   `cad_parity.py capture --base <vps> --urls urls.json --out vps` and `cad_parity.py manifest vps`.
4. Container through the compat path: `read -rs CAD_COMPAT_BASE && export CAD_COMPAT_BASE`, then
   `cad_parity.py check --compat --urls urls.json --golden vps` (5/5 `IDENTICAL` for `/flat-pattern`); keep the
   bodies for review with `cad_parity.py capture --compat --urls urls.json --out compat`.
5. Container through a `cad-jobs` dual run (5/5 `IDENTICAL` for every endpoint), then replace
   `parity/golden/manifest.json` with `vps/manifest.json`.

Cold start: 3 timed compat calls on a cold slot and 3 warm calls; record the timings. A slot is cold after
`CadRouter.recycle(slot)` (a Durable Object method; Phase 5 adds no HTTP route for it) or after more than 10 minutes
without a CAD call (`sleepAfter`); compat calls take the lowest free slot, so one cold call per idle period is
measured that way.

`parity/golden/manifest.json` is provisional until that capture: it holds the normalised hashes of the service
code of this repository at the Phase 4 close (endpoint code unchanged by Phase 5), captured locally with the
locked versions and `PYTHONHASHSEED=0` (`parity/golden/README.md`).

## Tests outside the image gate

Nine service tests fail or error under the locked library versions today and stay outside the CI gate
(`cad-image.yml` runs `tests/test_fixtures.py`, `tests/test_bend_detection.py` and `tests/test_p5_service.py`):

- `tests/test_unfolder.py`: 8 errors at fixture set-up (`makeThreePointArc` raises `StdFail_NotDone` under OCP 7.9)
  — `TestSTEPParser` (2), `TestThicknessDetection` (1), `TestFaceClassification` (1), `TestFullPipeline` (4)
- `tests/test_dxf_export.py::TestDXFExport::test_dxf_has_outline_entities`: expects `LINE` entities, the exporter
  writes one `LWPOLYLINE`

`tests/test_fixtures.py` marks `u_channel` and `z_fold` as expected failures of the engine (2 xfailed).

## Status (2026-10-09, local)

Nothing is built into an image, pushed or deployed here: the image is built only by `cad-image.yml` in CI, and the
Container needs the owner steps of docs/migration/PLAN.md §5.5 (image push and reference, VPS library freeze,
deploy) before the switch-over step S9.

| Check | Result |
|---|---|
| Ops T1 (`npm --prefix workers/ops test -- test/p5/cad`) | 7 files, 76 tests green (the whole ops suite, 2,038 tests, green in the Wave 3 run), including the three wiring tests against the real `@cloudflare/containers` 0.3.7, the input proxy, slots and priorities, the outcome mapping and the compat route |
| Ops T2 (`npm --prefix workers/ops run test:integration:jobs -- test/t2-jobs/p5-cad.jobs.ts`) | 4 tests green, with the container stub |
| Service tests (`tests/test_p5_service.py`, `tests/test_fixtures.py`, locked versions in a virtualenv) | 15 passed, 2 expected failures: key matrix, 504 at the wall clock, no child left after a disconnect, the 5 references equal to the provisional golden manifest after masking |
| Comparator (`cad_parity.py self-test`) | masks proven; a 0.01 mm change reports `DIFFERS` |
| Exit gate item 4 | Blocked until S9: the VPS capture replaces the provisional manifest, `requirements.lock.txt` is replaced by the VPS freeze, then 5/5 `IDENTICAL` per endpoint and the cold-start timings; preview checks of the input interception, cold start and the 110 s abort |

Open: `CadRouter.recycle` has no HTTP caller (an admin route is a later decision); the CAD router client type of
Phase 4 gets the optional priority, recycle and slot fields in a follow-up commit (Phase 5 passes them
structurally).
