# Golden manifest of the CAD parity check

`manifest.json` lists, for the 5 reference parts of `sheet-metal-service/tests/fixtures/unfold/` and each endpoint
(`/flat-pattern`, `/api/v1/unfold` as dxf, svg and pdf, `/api/v1/unfold/info`), the HTTP status, the compared
headers (`content-type`, `content-disposition`, `X-Part-*`), the raw size and the SHA-256 of the body after the
masks of `../cad_parity.py` (`normalised_sha256`).

Status: **provisional**. Captured on 2026-10-08 with `cad_parity.py capture` + `manifest` from the service code at
the Phase 4 close commit (the endpoint code is unchanged by Phase 5), run locally with uvicorn, the versions of
`sheet-metal-service/requirements.lock.txt` and `PYTHONHASHSEED=0`, the reference files served from a local HTTP
server. The patched service (key middleware and wall clock) reproduces it for all 25 captures
(`tests/test_p5_service.py`).

At the parity gate the owner replaces it with the manifest of the VPS capture (`workers/cad/README.md`, Parity),
together with the raw VPS bodies when they are kept for review. The raw bodies are synthetic parts and carry no
customer data.
