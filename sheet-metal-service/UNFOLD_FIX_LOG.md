# Unfold Engine Fix Log

One entry per bug. Each entry records the symptom in production, the
root cause, the surgical fix, and the fixture that proves it.

Branch: `claude/fix-sheet-metal-unfold-RXIrd`

## How to reproduce the fixtures

```
cd sheet-metal-service
pip install -r requirements.txt
python tools/build_fixtures.py            # writes tests/fixtures/unfold/*.step + *.expected.json
python tools/build_fixtures.py --verify   # re-checks the analytic math
pytest tests/test_fixtures.py             # 3 pass, 2 xfail (known limits)
```

## Pre-existing test failures (NOT caused by this branch)

* `tests/test_dxf_export.py::TestDXFExport::test_dxf_has_outline_entities`
  — predates this branch; the DXF outline is now a single `LWPOLYLINE`
  rather than 4 individual LINE entities, so `assert len(entities) == 4`
  fails. Same result on `main`.
* `tests/test_unfolder.py::TestSTEPParser::test_load_step` (and the 7
  other tests under `TestSTEPParser` / `TestThicknessDetection` /
  `TestFaceClassification` / `TestFullPipeline`) — the in-memory L-bracket
  fixture in that file uses `threePointArc((p, p))` (a degenerate arc
  with identical mid/end), which raises `GC_MakeArcOfCircle::Value()`
  on this OCP version. Same error on `main`. Not addressed here.

## Bugs fixed

### Bug #1 — Planar face normals stored without orientation correction

* **Commit**: `b5b951e fix(unfold): honor face orientation when storing planar normal`
* **Symptom**: Bend direction (UP/DOWN) flipped from the right answer on
  STEPs where any planar face was imported with `TopAbs_REVERSED`
  orientation. Random across different source CADs because the export
  convention varies.
* **Root cause**: `step_parser.py:195–198` stored
  `plane.Axis().Direction()` as-is. That is the surface's intrinsic
  direction, not the topological outward normal. For a REVERSED face
  the true outward normal is the negation.
* **Fix**: Negate the stored normal when
  `face.Orientation() == TopAbs_REVERSED` (`step_parser.py:195–204`).
* **Fixture**: All five fixtures rely on this being correct — after the
  fix, base flange top reads `+Z`, base flange bottom reads `-Z`, and
  the second flange's normal matches `rotate(+Z, -axis, angle)` exactly.

### Bug #2 — End-cap faces polluting bend-adjacent flange pick

* **Commit**: `64ae608 fix(unfold): filter end-cap faces from bend-adjacent flange pick`
* **Symptom**: `bend.angle_deg` reported ~90° on every fixture
  regardless of the actual fold angle. `l_bend_45` and `l_bend_135`
  both came out as 90°.
* **Root cause**: `_find_adjacent_flanges` returned the entire
  face-adjacency set of the cylindrical bend face. On an extruded
  sheet-metal part that set includes both the two real flange faces
  AND the two extrusion end-cap faces (normals parallel to the bend
  axis). `detect_bends` picked `adj_flanges[0]` and `adj_flanges[1]`
  with no filter — `set` iteration order then decided which two faces
  won, and an end-cap often slipped into the first two slots. The
  angle calc then compared an outward flange normal against an end-cap
  normal, yielding 90° regardless of the actual fold.
* **Fix**: `_filter_perpendicular_to_axis` drops faces with
  `|n · axis| > 1 − 0.1`. `_top_two_by_area` deterministically picks
  the two real flanges from what survives the filter
  (`bend_detector.py` new helpers + new pre-pick step in
  `detect_bends`).
* **Fixture**: With this fix `l_bend_90` reports `UP` (was `DOWN`);
  `l_bend_45` and `l_bend_135` still reported the wrong angle (45°
  reported as 135° and vice versa) — handed off to bug #3.

### Bug #3 — 180° subtraction in bend angle formula

* **Commit**: `0914409 fix(unfold): drop spurious 180° subtraction in bend angle formula`
* **Symptom**: After bug #2 fix, `l_bend_45` reported 135° and
  `l_bend_135` reported 45° — supplementary angles. 90° L-bend
  coincidentally still gave the right answer because `180 − 90 = 90`.
* **Root cause**: `bend_detector.py:95`
  `bend_angle_deg = 180.0 - degrees(angle_between(n1, n2))` assumed
  the angle between OUTWARD flange normals is the included interior
  dihedral. It isn't — for consistently outward-facing normals the
  angle between them IS the rotation from coplanar (90° for an
  L-bend, 180° for a hem, 0° for an unbent edge). The subtraction
  turned every non-90° fold into its supplement and the wrong value
  propagated through `compute_bend` into BA / BD / OSSB.
* **Fix**: `bend_angle_deg = degrees(angle_between(n1, n2))`. Also
  updated the docstring to nail down the convention as
  *rotation-from-coplanar*. `core/kfactor.py` now carries a
  ground-truth math header documenting the same convention.
* **Fixture**: `l_bend_90 → 90°`, `l_bend_45 → 45°`,
  `l_bend_135 → 135°`, `u_channel → both 90°`.

### Bug #4 — `_is_inner_face` heuristic collapsed inner radius to 0.1 mm

* **Commit**: `cb5179b fix(unfold): determine bend inner-radius from cylinder face orientation`
* **Symptom**: Every bend reported `inner_radius_mm = 0.1` (the clamp
  in `bend_detector.py:102`), so BA = `(π/180)·angle·(0.1+K·T)` came
  out at ~25% of its real value and the bend table's radius column
  was meaningless.
* **Root cause**: `_is_inner_face` cross-multiplied the parametric
  surface derivatives (`d1u × d1v`) and tested the sign of
  `normal · to_axis`. OCC parameterises both the inner *and* outer
  cylindrical faces of a single bend with radially-outward intrinsic
  normals, so the heuristic returned `False` for both. The dedup pass
  then set `inner_radius = max(radius − T, 0.1)`, which collapses to
  0.1 mm whenever `radius ≤ T` (i.e. for every real inner cylinder).
* **Fix**: Use `face.Orientation()` directly. The OUTER cylinder face
  is FORWARD (solid sits inside, topological outward matches the
  radially-outward intrinsic normal). The INNER cylinder face is
  REVERSED (solid sits outside, topological outward is the negation).
  Same convention as the planar-normal fix in bug #1.
* **Fixture**: `l_bend_90 / 135 / 45 / u_channel` all now report
  `inner_radius = 2.0 mm` exactly.

### Bug #5 — Missing bend-allowance translation in 3D unfold

* **Commit**: `059259a fix(unfold): insert bend-allowance translation between unfolded flanges`
* **Symptom**: Flat width for every L-bend came out exactly
  `Σ flange_length` (150 mm for a 100 mm base + 50 mm flange), missing
  the bend-arc contribution. Real flat patterns should be
  `Σ flange + Σ BA` (154.178 mm for the same fixture at 90°, K = 0.33,
  R = T = 2 mm).
* **Root cause**: `_bfs_compose_transforms` composed each child
  flange's unfold transform as a pure rotation around the bend axis.
  A rotation alone collapses the cylindrical bend region (which has
  neutral-axis arc length BA) into a single column at the rotation
  axis, so the projected child flange ends up flush against the
  parent with zero gap. The BA / BD values were computed correctly in
  `core/kfactor.py`; they just never made it into the geometry.
* **Fix**: After the rotation, append a translation of magnitude BA
  perpendicular to the bend axis in the unfolded XY plane,
  sign-chosen so the child centroid moves AWAY from the parent
  centroid. The rotation + translation pair implements a true k-line
  unfold of the bend. Plumbed `thickness` and `k_factor` through
  `_bfs_compose_transforms` so BA can be computed where it's needed.
* **Fixture math correction**: At the same time the fixture
  `*.expected.json` files were re-derived. The earlier values used the
  BD-subtraction convention with bend-tangent-to-edge flange
  dimensions; that double-counts the setback. Correct formula is
  `flat = Σ flange + Σ BA` (k-line method).
* **Fixture results**:
  * `l_bend_90`  expected 154.178 mm  engine 154.180 mm  Δ +0.002 mm
  * `l_bend_135` expected 156.267 mm  engine 156.270 mm  Δ +0.003 mm
  * `l_bend_45`  expected 152.089 mm  engine 152.090 mm  Δ +0.001 mm

### Bug #6 — Anchored disconnected-component bends had no bend line

* **Commit**: `3ef4d93 fix(unfold): include anchored disconnected components in bend_lines`
* **Symptom**: On a U-channel only the right-side bend appeared as a
  red dashed bend line in the flat pattern; the left-side bend was
  missing entirely.
* **Root cause**: On a U-channel the base flange's TOP and BOTTOM
  planar faces both classify as FLANGE, and each bend's inner cylinder
  vs outer cylinder connects different (TOP↔TOP) vs (BOTTOM↔BOTTOM)
  pairs. The bend graph therefore splits into two disconnected
  components. `_unfold_via_3d_transforms` runs an "anchor + BFS" pass
  to fold each disconnected component onto the main chain via the
  coplanar parent flange, but the locally-built `local_order` for that
  BFS was never appended to `bend_graph.unfolding_order`. The
  bend-line placement pass (`_place_bend_lines_3d`) iterates the
  graph's `unfolding_order`, not the bend list, so the anchored bends
  got their geometric transforms but no bend line.
* **Fix**: Splice the anchored component's `local_order` entries back
  into `bend_graph.unfolding_order`.
* **Fixture**: `u_channel` bend-line count went from 1 to 2. (Other
  open issues on the U-channel layout are below.)

### Bug #7 — Guardrails + `?debug=true` JSON dump

* **Commit**: `ab90b02 feat(unfold): runtime guards + ?debug=true intermediate dump + fixture tests`
* **Not a regression fix** — Phase 6 deliverable from the task brief.
* `core/guards.py`: typed exceptions (`ThicknessOutOfRangeError`,
  `BendAngleOutOfRangeError`, `FlatAreaMismatchError`) plus
  `check_thickness`, `check_bend_angles`, `check_flat_area`. Currently
  logged as warnings rather than raised so legitimate edge cases keep
  returning a usable response; one-line change to escalate to raise.
* `?debug=true` query param on `POST /api/v1/unfold/info` and
  `POST /flat-pattern` returns a `debug_dump` object with:
  * `topology` — face count, volume, bbox.
  * `face_classification` — type counts and per-face summary.
  * `bends` — per-bend angle / radius / direction / axis / adjacent.
  * `bend_graph` — base flange index, edges, unfolding order.
  * `flat_pattern` — width, height, outer-edge count, hole count,
    bend-line positions.
* `tests/test_fixtures.py` — pytest harness for the five fixtures.

## Open issues (NOT fixed in this branch)

These would require deeper algorithmic changes to the unfold engine
and are flagged here per the brief's rule "If a bug needs
architectural change, STOP and report."

### O1 — `z_fold` STEP yields phantom bend faces

When `tools/build_fixtures.py` generates `z_fold.step`, OCC produces
two additional cylindrical faces beyond the two intended 90° bends.
The first phantom has `R = 2.249` at `(105.2, ?, 55.9)`, the second
`R = 18.788` at `(113.2, ?, 36.5)`. Both have orientation REVERSED so
the `is_inner` heuristic catches them and they are not deduplicated
away. They are real cylindrical sub-faces in the B-rep — likely from
how CadQuery's extrusion stitches the second bend's tangent-continuous
edges with the surrounding straight segments — and detected as bends
because the classifier doesn't have a heuristic for "small / not at a
flange junction" beyond the existing radius cap. Two possible fixes:

1. Build the `z_fold` fixture with primitive boxes + cylinders + a
   boolean union instead of a single profile extrusion, so OCC has no
   reason to emit tangent-continuous sub-faces.
2. Add a guard in `_refine_bend_list` that requires the bend's
   cylindrical face to be adjacent to ≥ 2 large flanges after the
   end-cap filter from bug #2. Phantom sub-faces only touch the
   surrounding cylindrical surfaces, not flanges, so they would be
   discarded.

### O2 — Disconnected components don't merge into outline bbox

For `u_channel`, bug #6 ensured both bend lines are drawn but the
flat width still comes out short by ~one flange length. The flange on
the side that was added via the anchor pass projects into the 2D
plane correctly (the transform composes), but `_compose_multi_flange_outline`
doesn't include the anchored-component flanges in the union it feeds
to pyclipper — so the unioned outline only spans the main-chain
flanges. Likely fix: extend the projection loop in
`_unfold_via_3d_transforms` (lines 1097–1108 of `unfolder.py`) to
include faces added by the anchor pass into `flange_polys` so they
participate in the outline union. Touches more of the unfolder than a
"surgical fix" comfortably should — defer until the user prioritises
multi-bend parts.

### O3 — Direction sign flips between bends on the same part

For `u_channel`, B1 reports `direction = "UP"` and B2 reports `"DOWN"`
even though physically both bends fold the side flanges upward. The
`_determine_direction` function computes the cross product
`base_normal × bend_axis` and dots it with the cylindrical face's
midpoint surface normal. The bend axis is stored with a sign chosen
by OCC's surface parameterisation, which can flip between otherwise
identical bends on the same part — making the cross product flip too.
A robust fix should canonicalise the bend axis sign (e.g. dot with a
fixed world-frame reference and negate if negative) BEFORE computing
the direction. Direction reporting is correct on the L-bend fixtures
(all `UP`) so this only manifests on multi-bend geometry.

### O4 — Symptom C (3D preview quality) deferred

The task brief asked for a fix to "3D preview quality poor". There is
no server-side GLB / glTF generation in `sheet-metal-service`; the
Three.js viewer (`src/components/ThreeDViewerModal.tsx`) parses STEP
in the browser via the `occt-import-js` WASM library with
`linearDeflection = 0.001` (bounding-box ratio). The only server-side
mesh call is `BRepMesh_IncrementalMesh(shape, 0.1)` in
`export/projection.py:41`, used for the PDF isometric HLR view. Per
the planning conversation the user deferred symptom C until A and B
were verified — bring a reproducible "3D preview wrong" example back
and we can decide which surface (PDF isometric, frontend WASM
tessellator, or a new server-side GLB endpoint) to attack.
