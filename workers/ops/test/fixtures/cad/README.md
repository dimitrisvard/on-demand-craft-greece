# CAD test fixtures (synthetic)

Made up for the tests of the CAD backends; no customer data.

| File | Content | Used by |
|---|---|---|
| `plate-holes.dxf` | flat 200 x 100 mm, two holes r 5 mm, one line on layer `BEND` | inline DXF analysis, DXF metrics |
| `open-outline.dxf` | three lines that do not close | DXF metrics (area unknown) |
| `unfold-flat.dxf` | flat 180 x 120 mm, one hole r 10 mm, two bend lines | answer of the unfold-service stub (T1 fake fetcher, T2 `stubs/unfold.mjs`) |
| `unfold-headers.json` | `X-Part-*` headers of that answer | same |
| `cube-10x20x30.stl` | ASCII STL box 10 x 20 x 30 mm | inline STL analysis |
| `block-cnc.step` | STEP block 100 x 40 x 10 mm (points, vertices, edges) | inline STEP analysis |
| `bracket-sheet.step` | STEP header only | sheet-metal jobs sent to the unfold stub |
| `*.expected.json` | expected `CadResultV1` fields (compared within 0.1 mm) | `test/cad/backends.test.ts` |
