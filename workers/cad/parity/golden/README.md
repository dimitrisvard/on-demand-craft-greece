# Golden manifest of the CAD parity check

`manifest.json` lists, for the 5 reference parts of `sheet-metal-service/tests/fixtures/unfold/` and each endpoint
(`/flat-pattern`, `/api/v1/unfold` as dxf, svg and pdf, `/api/v1/unfold/info`), the HTTP status, the compared
headers (`content-type`, `content-disposition`, `X-Part-*`), the raw size and the SHA-256 of the body after the
masks of `../cad_parity.py` (`normalised_sha256`). The masks cover the DXF dates, GUIDs, ezdxf marker and
`CLASSES` order, and in PDF `/CreationDate`, `/ModDate`, `/ID` and the drawing date of the title block
(`Date: YYYY-MM-DD`; PDF content streams are hashed decoded). The hashes therefore hold on any day.

Status: **provisional**. Captured on 2026-10-08 with `cad_parity.py capture` from the service code at the Phase 4
close commit (the endpoint code is unchanged by Phase 5), run locally with uvicorn, the versions of
`sheet-metal-service/requirements.lock.txt` and `PYTHONHASHSEED=0`, the reference files served from a local HTTP
server; `manifest` re-run over the same bodies on 2026-10-09 when the drawing date joined the PDF masks (only the
five `unfold-pdf` hashes changed). The patched service (key middleware and wall clock) reproduces it for all 25
captures on later days (`tests/test_p5_service.py`, `cad_parity.py check`).

At the parity gate the owner replaces it with the manifest of the VPS capture (`workers/cad/README.md`, Parity),
together with the raw VPS bodies when they are kept for review. The raw bodies are synthetic parts and carry no
customer data.
