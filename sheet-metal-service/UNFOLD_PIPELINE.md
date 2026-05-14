# Sheet Metal Unfolding — Pipeline Map

FastAPI microservice that turns a bent STEP into a flat pattern (DXF / SVG /
PDF) using OpenCascade through the OCP / CadQuery Python bindings. This
document is the authoritative stage-by-stage reference for the unfolding
engine — what each stage consumes, what it produces, and what invariants it
assumes.

## Top-level entry points

| Route                       | Output                                                |
|-----------------------------|-------------------------------------------------------|
| `POST /api/v1/unfold`       | Streams a PDF (default), DXF, or SVG flat pattern.    |
| `POST /api/v1/unfold/preview` | Streams an SVG preview only.                        |
| `POST /api/v1/unfold/info`  | JSON metadata for the quoting engine.                 |
| `POST /flat-pattern`        | Compat JSON contract consumed by the Supabase edge fn. |
| `GET  /api/v1/health`       | Liveness + OCC version.                               |

All five funnel through `main.py::_run_pipeline` which runs the seven core
stages in order, then forks into the export-format-specific exporter.

## Stages (call order)

| # | Stage                | Module / Symbol                                         | Inputs                                  | Outputs                                                                                            |
|---|----------------------|---------------------------------------------------------|-----------------------------------------|----------------------------------------------------------------------------------------------------|
| 1 | STEP load            | `core/step_parser.py::load_step`                         | path                                    | `List[TopoDS_Solid]` (largest by `BRepGProp.VolumeProperties_s`)                                    |
| 2 | Topology             | `core/step_parser.py::build_topology`                    | `TopoDS_Solid`                          | `Topology` — faces, edge↔face map, face↔face adjacency, shared edges, bbox, volume                  |
| 3 | Thickness            | `core/thickness_detector.py::detect_thickness`           | `Topology`                              | `(thickness_mm, confidence)` from parallel-plane / cyl-radius / volume-area heuristics              |
| 4 | Face classification  | `core/face_classifier.py::classify_faces`                | `Topology, thickness`                   | `List[ClassifiedFace]` with `FaceType ∈ {FLANGE, BEND, HEM, THICKNESS, CONICAL}`                    |
| 5 | Bend detection       | `core/bend_detector.py::detect_bends`                    | `Topology, classified, thickness`       | `List[BendInfo]` (radius, angle, direction, axis, adjacent flanges, length)                         |
| 6 | Bend graph           | `core/bend_graph.py::build_bend_graph`                   | `classified, bends`                     | `BendGraph` (networkx; base = largest flange; BFS unfolding order)                                  |
| 7 | Unfold               | `core/unfolder.py::unfold`                               | all above + `k_factor`                  | `FlatPattern` (`outer_edges`, `extra_outlines`, `bend_lines`, `holes`, `width`, `height`, `warnings`) |
| 8a | DXF export          | `export/dxf_exporter.py::export_dxf`                     | `FlatPattern, path, part_name`          | DXF (layers: OUTLINE, BEND_UP red dashed, BEND_DOWN blue dashdot, HOLES, DIMENSIONS, CENTER, NOTES) |
| 8b | SVG export          | `export/svg_exporter.py::export_svg`                     | `FlatPattern, part_name`                | SVG string                                                                                          |
| 8c | PDF export          | `drawing/pdf_generator.py::generate_pdf`                 | flat + bends + thickness + solid + bbox | A3/A4 PDF — isometric (OCC HLR via `BRepMesh_IncrementalMesh(shape, 0.1)`) + flat view + bend table  |

## Key data structures

- `FaceInfo` (`step_parser.py`): index, face, surface_type, area, center_of_mass, normal (planar only), radius/axis/axis_location (cyl/cone).
- `ClassifiedFace` (`face_classifier.py`): `FaceInfo` + `FaceType` + `angular_span` (radians, cylindrical).
- `BendInfo` (`bend_detector.py`): bend_id, face_index, inner_radius, outer_radius, **angle_deg**, angular_span, **direction** (`"UP"`/`"DOWN"`), axis, axis_location, adjacent_flanges, length, is_inner, orientation (`"VALLEY"`/`"MOUNTAIN"`).
- `FlatPattern` (`unfolder.py`): `outer_edges: List[Edge2D]`, `extra_outlines: List[List[Edge2D]]`, `bend_lines: List[BendLine2D]`, `holes: List[Hole2D]`, `width`, `height`, `flange_widths`, `warnings`.
- `BendGraph` (`bend_graph.py`): networkx Graph (nodes = flanges, edges = bends with `bend_id`), `base_flange`, `unfolding_order: List[(from, bend_id, to)]` (BFS order), `has_cycles`, `cut_edges`.

## Invariants and assumptions

- Units throughout = mm. STEP convention is Z-up.
- Largest flange (by area) is the unfolding base. Everything else unfolds onto its plane.
- Each physical bend is detected twice (the inner and outer cylindrical faces). `_refine_bend_list` deduplicates by quantised axis-key + axis-location and keeps the smaller radius (inner face).
- Bend angle is clamped to `[0.1°, 179.9°]` in `bend_detector.py:97`. Hems sit near 179.5° (or 180° after the fix in this branch — see `UNFOLD_FIX_LOG.md`).
- **Bend angle convention**: `angle_deg` is the rotation from coplanar — 90° for an L-bend, 180° for a hem (folded back on itself), 0° for an unbent edge. **Not** the included interior dihedral angle between the flanges.
- Two cylindrical faces per bend (inner + outer) share the same axis direction/location to within rounding; they map to the same key in `_axis_key`.
- The unfolder has two paths: (A) a fast 1D strip layout for simple geometries, and (B) a 3D-transform BFS unfold that rotates each flange around its bend axis onto the base plane.

## Sign and direction conventions (verbatim from code)

- Bend angle (`bend_detector.py`):
  ```python
  angle_between = _angle_between(n1, n2)        # radians, between outward flange normals
  bend_angle_deg = math.degrees(angle_between)  # rotation from coplanar
  ```
  For consistently-outward normals, the angle between them equals the
  rotation from coplanar: 90° for an L-bend, 135° for an obtuse fold, 180°
  for a hem. (Prior to the fix in `UNFOLD_FIX_LOG.md` entry #2 the formula
  was `180 - degrees(angle_between)`, which only agreed at exactly 90°.)
- Face normal (`step_parser.py`): `info.normal = plane.Axis().Direction()`,
  flipped if `face.Orientation() == TopAbs_REVERSED`. This guarantees the
  stored normal points outward from the solid — every angle-based decision
  downstream depends on this.
- Direction (`bend_detector.py::_determine_direction`):
  ```python
  cross = base_normal × bend_axis
  return "UP" if cross · face_normal > 0 else "DOWN"
  ```
  `base_normal` is the largest flange's outward normal; `face_normal` is the
  outward normal of the cylindrical bend face at its midpoint.
- Bend allowance (`kfactor.py::compute_bend`):
  ```python
  angle_rad = math.radians(angle_deg)
  neutral_r = inner_radius + k_factor * thickness
  ba        = angle_rad * neutral_r
  ossb      = (inner_radius + thickness) * math.tan(angle_rad / 2.0)
  bd        = 2.0 * ossb - ba
  ```
- Unfold transform (`unfolder.py`): for each child flange, both `±angle_rad`
  rotations around the bend axis are tried; the sign that aligns the
  transformed child normal closest to `+Z` wins.

## Tessellation / 3D preview

- **No server-side GLB / glTF export exists.** The Three.js viewer in the
  frontend (`src/components/ThreeDViewerModal.tsx`) parses STEP in the
  browser via the `occt-import-js` WASM library.
- The only server-side mesh tessellation is in `export/projection.py:41`
  (`BRepMesh_IncrementalMesh(shape, 0.1)`) for the PDF isometric HLR view.

## External contract (do not change)

`POST /flat-pattern` is the contract consumed by
`supabase/functions/generate-manufacturing-pdf/index.ts`. It returns JSON
with `flat_pattern.dimensions`, `flat_pattern.bends[]`,
`flat_pattern.outline_edges[]`, top-level `bends[]`, `analysis.dimensions`,
`warnings[]`, and base64 `dxf_base64` / `svg_base64`. The frontend
consumer is `src/utils/serverManufacturingPdf.ts`.

## Fixtures and tests

- `tools/build_fixtures.py` generates five canonical sheet-metal STEPs into
  `tests/fixtures/unfold/` with paired `*.expected.json` carrying
  analytically-computed targets. Re-run any time the math header in
  `kfactor.py` changes.
- `tests/test_fixtures.py` runs the full pipeline against each fixture and
  diffs the result against the expected JSON.
- `tests/test_bend_detection.py` and `tests/test_unfolder.py` cover the
  pure-math helpers and historical in-memory CadQuery shapes.

## Debug dump

Passing `?debug=true` to `/api/v1/unfold/info` or `/flat-pattern` returns an
extra `debug_dump` field with the intermediate state of every stage
(topology summary, classified faces, bends, bend graph, transforms, flat
pattern). Use this to triage customer-support tickets without re-running the
job locally.
