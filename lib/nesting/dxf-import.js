import DxfParser from 'dxf-parser';
import {
  polygonArea,
  isClockwise,
  ensureCCW,
  ensureCW,
  pointInPolygon,
  centroid,
  boundingBox,
  normalizeToOrigin,
  removeDuplicatePoints,
  removeCollinearPoints,
  convexHull,
  translatePoints,
} from './geometry.js';

export class NestingError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'NestingError';
    this.code = code;
    this.details = details;
  }
}

// ---------------------------------------------------------------------------
// Bulge-to-arc interpolation
// ---------------------------------------------------------------------------

/**
 * Given two consecutive polyline vertices where p1 carries a non-zero bulge,
 * return an array of interpolated arc points (excluding p1, including p2).
 *
 * bulge = tan(included_angle / 4)
 *   positive → CCW arc
 *   negative → CW arc
 */
function bulgeArcPoints(p1, p2, bulge) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const chord = Math.sqrt(dx * dx + dy * dy);

  if (chord < 1e-9) return [p2];

  const sagitta = Math.abs(bulge) * chord / 2;
  const radius = ((chord / 2) ** 2 + sagitta ** 2) / (2 * sagitta);

  // Midpoint of the chord
  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2;

  // Unit normal to the chord (perpendicular)
  const nx = -dy / chord;
  const ny = dx / chord;

  // Distance from chord midpoint to arc center along the normal
  const d = radius - sagitta;

  // For positive bulge the arc centre is to the left of the chord direction,
  // for negative bulge it is to the right.
  const sign = bulge > 0 ? 1 : -1;
  const cx = mx + sign * d * nx;
  const cy = my + sign * d * ny;

  // Start and end angles relative to arc center
  let startAngle = Math.atan2(p1.y - cy, p1.x - cx);
  let endAngle = Math.atan2(p2.y - cy, p2.x - cx);

  // Determine sweep based on bulge sign
  if (bulge > 0) {
    // CCW sweep – endAngle must be greater than startAngle
    while (endAngle <= startAngle) endAngle += 2 * Math.PI;
  } else {
    // CW sweep – endAngle must be less than startAngle
    while (endAngle >= startAngle) endAngle -= 2 * Math.PI;
  }

  const sweep = endAngle - startAngle;
  const stepRad = (5 * Math.PI) / 180; // ~5 degree steps
  const steps = Math.max(2, Math.ceil(Math.abs(sweep) / stepRad));

  const points = [];
  for (let i = 1; i <= steps; i++) {
    const a = startAngle + (sweep * i) / steps;
    points.push({
      x: cx + radius * Math.cos(a),
      y: cy + radius * Math.sin(a),
    });
  }

  return points;
}

// ---------------------------------------------------------------------------
// Entity extraction helpers
// ---------------------------------------------------------------------------

function extractLWPolyline(entity) {
  const verts = entity.vertices;
  if (!verts || verts.length < 2) return null;

  const isClosed =
    entity.shape === true ||
    entity.shape === 1 ||
    (verts.length > 2 &&
      Math.abs(verts[0].x - verts[verts.length - 1].x) < 0.1 &&
      Math.abs(verts[0].y - verts[verts.length - 1].y) < 0.1);

  if (!isClosed) return null;

  const pts = [];
  const count = isClosed ? verts.length : verts.length - 1;

  for (let i = 0; i < count; i++) {
    const v = verts[i];
    const next = verts[(i + 1) % verts.length];
    pts.push({ x: v.x, y: v.y });

    const bulge = v.bulge || 0;
    if (bulge !== 0) {
      const arcPts = bulgeArcPoints({ x: v.x, y: v.y }, { x: next.x, y: next.y }, bulge);
      // arcPts includes the endpoint (next), so push all but skip
      // duplicating the endpoint – it will be added as the start of next segment.
      for (let j = 0; j < arcPts.length - 1; j++) {
        pts.push(arcPts[j]);
      }
    }
  }

  return pts;
}

function extractPolyline(entity) {
  // POLYLINE with vertices sub-entities – treat like LWPOLYLINE
  const verts = entity.vertices;
  if (!verts || verts.length < 2) return null;
  // Build a pseudo-LWPOLYLINE entity and reuse
  return extractLWPolyline({
    ...entity,
    vertices: verts.map((v) => ({
      x: v.x,
      y: v.y,
      bulge: v.bulge || 0,
    })),
    shape: entity.shape,
  });
}

function discretizeArc(entity) {
  const { center, radius, startAngle, endAngle } = entity;
  if (!center || radius == null) return null;

  // dxf-parser returns ARC angles in radians
  let start = startAngle;
  let end = endAngle;
  if (end <= start) end += 2 * Math.PI;

  const stepRad = (5 * Math.PI) / 180;
  const steps = Math.max(2, Math.ceil(Math.abs(end - start) / stepRad));
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = start + ((end - start) * i) / steps;
    pts.push({
      x: center.x + radius * Math.cos(a),
      y: center.y + radius * Math.sin(a),
    });
  }
  return pts;
}

function circleToPolygon(entity) {
  const { center, radius } = entity;
  if (!center || radius == null) return null;

  const sides = 32;
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const a = (2 * Math.PI * i) / sides;
    pts.push({
      x: center.x + radius * Math.cos(a),
      y: center.y + radius * Math.sin(a),
    });
  }
  return pts;
}

function ellipseToPolygon(entity) {
  const { center, majorAxis, axisRatio } = entity;
  if (!center || !majorAxis) return null;

  const rx = Math.sqrt(majorAxis.x ** 2 + majorAxis.y ** 2);
  const ry = rx * (axisRatio || 1);
  const rotation = Math.atan2(majorAxis.y, majorAxis.x);

  const sides = 32;
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const a = (2 * Math.PI * i) / sides;
    const lx = rx * Math.cos(a);
    const ly = ry * Math.sin(a);
    pts.push({
      x: center.x + lx * Math.cos(rotation) - ly * Math.sin(rotation),
      y: center.y + lx * Math.sin(rotation) + ly * Math.cos(rotation),
    });
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Line chaining – join individual LINE entities into closed contours
// ---------------------------------------------------------------------------

const EPS = 0.1; // endpoint matching tolerance (mm)

function ptsClose(a, b) {
  return Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;
}

function chainLines(lines) {
  if (!lines.length) return [];

  // Each line is { start: {x,y}, end: {x,y} }
  const remaining = lines.map((l, i) => ({ ...l, _idx: i }));
  const used = new Set();
  const contours = [];

  for (let seed = 0; seed < remaining.length; seed++) {
    if (used.has(seed)) continue;

    const chain = [remaining[seed].start, remaining[seed].end];
    used.add(seed);

    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < remaining.length; i++) {
        if (used.has(i)) continue;
        const seg = remaining[i];
        const head = chain[0];
        const tail = chain[chain.length - 1];

        if (ptsClose(seg.start, tail)) {
          chain.push(seg.end);
          used.add(i);
          changed = true;
        } else if (ptsClose(seg.end, tail)) {
          chain.push(seg.start);
          used.add(i);
          changed = true;
        } else if (ptsClose(seg.end, head)) {
          chain.unshift(seg.start);
          used.add(i);
          changed = true;
        } else if (ptsClose(seg.start, head)) {
          chain.unshift(seg.end);
          used.add(i);
          changed = true;
        }
      }
    }

    // Check if closed
    if (chain.length >= 4 && ptsClose(chain[0], chain[chain.length - 1])) {
      // Remove the duplicate closing point
      chain.pop();
      contours.push(chain);
    }
  }

  return contours;
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

export function parseDXF(dxfContent, partMeta = {}) {
  const parser = new DxfParser();

  let dxf;
  try {
    dxf = parser.parseSync(dxfContent);
  } catch (err) {
    throw new NestingError(
      `Failed to parse DXF: ${err.message}`,
      'INVALID_DXF',
      { originalError: err.message },
    );
  }

  if (!dxf) {
    throw new NestingError('DXF parsing returned empty result', 'INVALID_DXF');
  }

  const entities = dxf.entities || [];
  const closedContours = [];
  const looseSegments = []; // line segments to be chained
  // Bend lines live on dedicated layers (BEND_UP / BEND_DOWN) emitted by the
  // sheet-metal-service DXF exporter. We collect them separately so the
  // nesting preview can render them in red without treating them as part of
  // the outer / hole geometry.
  const bendLines = [];

  const isBendLayer = (layer) => {
    if (!layer) return null;
    const upper = String(layer).toUpperCase();
    if (upper === 'BEND_UP') return 'UP';
    if (upper === 'BEND_DOWN') return 'DOWN';
    return null;
  };

  for (const entity of entities) {
    const type = (entity.type || '').toUpperCase();
    const bendDir = isBendLayer(entity.layer);

    switch (type) {
      case 'LWPOLYLINE': {
        if (bendDir) break; // direction arrow triangle — skip
        const pts = extractLWPolyline(entity);
        if (pts) closedContours.push(pts);
        break;
      }
      case 'POLYLINE': {
        if (bendDir) break;
        const pts = extractPolyline(entity);
        if (pts) closedContours.push(pts);
        break;
      }
      case 'LINE': {
        if (entity.vertices && entity.vertices.length >= 2) {
          const seg = {
            start: { x: entity.vertices[0].x, y: entity.vertices[0].y },
            end: { x: entity.vertices[1].x, y: entity.vertices[1].y },
          };
          if (bendDir) {
            bendLines.push({ ...seg, direction: bendDir });
          } else {
            looseSegments.push(seg);
          }
        }
        break;
      }
      case 'ARC': {
        // Discretize arc into line segments for chaining
        const pts = discretizeArc(entity);
        if (pts) {
          for (let i = 0; i < pts.length - 1; i++) {
            looseSegments.push({ start: pts[i], end: pts[i + 1] });
          }
        }
        break;
      }
      case 'CIRCLE': {
        const pts = circleToPolygon(entity);
        if (pts) closedContours.push(pts);
        break;
      }
      case 'ELLIPSE': {
        const pts = ellipseToPolygon(entity);
        if (pts) closedContours.push(pts);
        break;
      }
      default:
        break;
    }
  }

  // Chain all loose segments (lines + discretized arcs) into closed contours
  const chainedContours = chainLines(looseSegments);
  closedContours.push(...chainedContours);

  // Clean up contours: remove duplicate points only. Do NOT call
  // removeCollinearPoints with the default tolerance — it strips out
  // arc-discretization vertices (which differ by tiny perpendicular
  // distances) and "shortcuts" curves into straight chords that may cut
  // THROUGH the polygon interior. That collapses 300+ vertex flange
  // outlines into ~15 vertex zigzag shapes whose interior no longer
  // contains the holes that should be inside them. Use a microscopic
  // tolerance (1e-6 mm) so only TRULY collinear vertices (within float
  // precision) get removed, preserving every arc-segment vertex.
  const cleanedContours = closedContours
    .map((pts) => removeCollinearPoints(removeDuplicatePoints(pts), 1e-6))
    .filter((pts) => pts.length >= 3);

  if (cleanedContours.length === 0) {
    throw new NestingError(
      'No closed contours found in DXF',
      'NO_CLOSED_CONTOURS',
      { entityCount: entities.length },
    );
  }

  // ---------------------------------------------------------------------------
  // Classify: build containment hierarchy. A contour is a "hole" if it lies
  // inside another (parent) contour and not inside anyone else more deeply.
  // Top-level contours (depth 0) are PART PIECES — there can be more than one
  // when the unfolded sheet metal has disconnected components (e.g. flanges
  // joined by hems where the back-side projects to a disjoint outline).
  // The previous classifier picked the single largest contour as the outer
  // and silently dropped every other top-level contour and its holes — which
  // resulted in the nesting layout missing entire flanges.
  // ---------------------------------------------------------------------------

  // Pre-compute a representative inside point for each contour (centroid is
  // not always inside non-convex shapes; fall back to first/mid vertex).
  const reps = cleanedContours.map((c) => {
    const cen = centroid(c);
    if (pointInPolygon(cen, c)) return cen;
    const mid = c[Math.floor(c.length / 2)];
    return mid;
  });

  // For each contour i, count how many OTHER contours strictly contain it.
  // depth = number of ancestors. Top-level pieces have depth 0.
  const depth = new Array(cleanedContours.length).fill(0);
  const directParent = new Array(cleanedContours.length).fill(-1);

  for (let i = 0; i < cleanedContours.length; i++) {
    const inside = [];
    for (let j = 0; j < cleanedContours.length; j++) {
      if (i === j) continue;
      // Use multi-point voting for robustness on degenerate boundaries
      const ci = reps[i];
      const c0 = cleanedContours[i][0];
      const cm = cleanedContours[i][Math.floor(cleanedContours[i].length / 2)];
      const votes =
        (pointInPolygon(ci, cleanedContours[j]) ? 1 : 0) +
        (pointInPolygon(c0, cleanedContours[j]) ? 1 : 0) +
        (pointInPolygon(cm, cleanedContours[j]) ? 1 : 0);
      if (votes >= 2) inside.push(j);
    }
    depth[i] = inside.length;
    if (inside.length > 0) {
      // Direct parent = the smallest containing contour (largest depth + 1).
      // Pick the one with smallest area among all ancestors.
      let bestParent = inside[0];
      let bestArea = Math.abs(polygonArea(cleanedContours[bestParent]));
      for (let k = 1; k < inside.length; k++) {
        const a = Math.abs(polygonArea(cleanedContours[inside[k]]));
        if (a < bestArea) {
          bestArea = a;
          bestParent = inside[k];
        }
      }
      directParent[i] = bestParent;
    }
  }

  // Group: each top-level contour (depth 0) becomes one piece, its direct
  // children (depth 1) become its holes. Deeper nestings are treated as
  // additional outer pieces (islands inside holes) — uncommon for sheet
  // metal but parsed safely.
  const pieces = []; // each: { outer, holes }
  for (let i = 0; i < cleanedContours.length; i++) {
    if (depth[i] !== 0) continue;
    const outerI = ensureCCW(cleanedContours[i]);
    const holesI = [];
    for (let j = 0; j < cleanedContours.length; j++) {
      if (directParent[j] === i) {
        holesI.push(ensureCW(cleanedContours[j]));
      }
    }
    pieces.push({ outer: outerI, holes: holesI });
  }

  if (pieces.length === 0) {
    throw new NestingError(
      'No top-level outer contour found in DXF',
      'NO_CLOSED_CONTOURS',
    );
  }

  // ---------------------------------------------------------------------------
  // Recover orphan holes: the upstream unfolder occasionally emits a hole
  // (typically a CIRCLE entity) at a coordinate that lies outside its parent
  // flange's projected outline polygon — happens when hem-flange holes are
  // projected with the parent transform but land in a region the parent's
  // outline doesn't quite cover. The classifier above sees these as tiny
  // top-level pieces. Re-attach any small CIRCULAR piece (no holes of its
  // own, all vertices ~equidistant from centroid) whose bbox fits inside a
  // larger piece's bbox as a hole of that piece. This is an unfolder bug
  // workaround that keeps the nesting layout looking sane while we fix the
  // upstream geometry.
  // ---------------------------------------------------------------------------
  if (pieces.length > 1) {
    const isCircular = (poly) => {
      if (poly.length < 8) return false; // need enough verts to call it circular
      let cx = 0, cy = 0;
      for (const p of poly) { cx += p.x; cy += p.y; }
      cx /= poly.length; cy /= poly.length;
      let rSum = 0;
      const rs = poly.map((p) => {
        const r = Math.hypot(p.x - cx, p.y - cy);
        rSum += r;
        return r;
      });
      const rMean = rSum / poly.length;
      if (rMean < 1e-6) return false;
      let maxDev = 0;
      for (const r of rs) maxDev = Math.max(maxDev, Math.abs(r - rMean));
      return (maxDev / rMean) < 0.05; // <5% radial deviation → circle
    };

    const pieceBboxes = pieces.map((p) => boundingBox(p.outer));
    const pieceAreas = pieces.map((p) => Math.abs(polygonArea(p.outer)));

    const recovered = new Set();
    for (let i = 0; i < pieces.length; i++) {
      if (recovered.has(i)) continue;
      const p = pieces[i];
      if (p.holes.length > 0) continue; // already a real piece with its own holes
      if (!isCircular(p.outer)) continue;
      const bb = pieceBboxes[i];
      // Find the largest piece whose bbox strictly contains this one
      let bestParent = -1;
      let bestParentArea = 0;
      for (let j = 0; j < pieces.length; j++) {
        if (j === i) continue;
        if (recovered.has(j)) continue;
        if (pieces[j].outer.length < 8) continue;
        const bbj = pieceBboxes[j];
        if (
          bb.minX >= bbj.minX - 1e-6 &&
          bb.minY >= bbj.minY - 1e-6 &&
          bb.minX + bb.w <= bbj.minX + bbj.w + 1e-6 &&
          bb.minY + bb.h <= bbj.minY + bbj.h + 1e-6 &&
          pieceAreas[j] > pieceAreas[i] * 5 // parent must be substantially larger
        ) {
          if (pieceAreas[j] > bestParentArea) {
            bestParentArea = pieceAreas[j];
            bestParent = j;
          }
        }
      }
      if (bestParent >= 0) {
        pieces[bestParent].holes.push(ensureCW(p.outer));
        recovered.add(i);
      }
    }
    if (recovered.size > 0) {
      const remaining = [];
      for (let i = 0; i < pieces.length; i++) {
        if (!recovered.has(i)) remaining.push(pieces[i]);
      }
      pieces.length = 0;
      pieces.push(...remaining);
    }
  }

  // ---------------------------------------------------------------------------
  // Build the nesting "outer" — the polygon used by the nester for collision
  // detection and bbox reservation. For a single-piece part this is just the
  // piece's outer. For multi-piece parts we use the convex hull of the union
  // of all top-level outer points so the nester reserves enough sheet space
  // and never lets another part overlap any piece.
  // ---------------------------------------------------------------------------

  let nestingOuter;
  if (pieces.length === 1) {
    nestingOuter = pieces[0].outer;
  } else {
    const allPts = [];
    for (const p of pieces) {
      for (const v of p.outer) allPts.push(v);
    }
    nestingOuter = ensureCCW(convexHull(allPts));
  }

  // Aggregate all holes for the nester (used for net-area computation).
  const aggregatedHoles = [];
  for (const p of pieces) {
    for (const h of p.holes) aggregatedHoles.push(h);
  }

  // ---------------------------------------------------------------------------
  // Normalize to origin — translate every piece, hole, and bend line by the
  // SAME offset so they remain in the same coordinate frame. We anchor on
  // the nesting outer's bounding box.
  // ---------------------------------------------------------------------------

  const preBBox = boundingBox(nestingOuter);
  const tdx = -preBBox.minX;
  const tdy = -preBBox.minY;

  const translatedPieces = pieces.map((p) => ({
    outer: translatePoints(p.outer, tdx, tdy),
    holes: p.holes.map((h) => translatePoints(h, tdx, tdy)),
  }));
  const translatedNestingOuter = translatePoints(nestingOuter, tdx, tdy);
  const translatedAggregatedHoles = aggregatedHoles.map((h) =>
    translatePoints(h, tdx, tdy),
  );

  const outerBBox = boundingBox(translatedNestingOuter);
  const normalizedBendLines = bendLines
    .map((bl) => ({
      start: { x: bl.start.x + tdx, y: bl.start.y + tdy },
      end: { x: bl.end.x + tdx, y: bl.end.y + tdy },
      direction: bl.direction,
    }))
    .map((bl) => clipBendLineToBBox(bl, outerBBox))
    .filter(Boolean);

  // Compute net area = sum(piece outer areas) − sum(hole areas)
  let outerAreaSum = 0;
  let holesAreaSum = 0;
  for (const p of translatedPieces) {
    outerAreaSum += Math.abs(polygonArea(p.outer));
    for (const h of p.holes) holesAreaSum += Math.abs(polygonArea(h));
  }
  const netArea = outerAreaSum - holesAreaSum;

  return {
    id: partMeta.id || 'part_' + Date.now(),
    name: partMeta.name || 'unnamed',
    material: partMeta.material || 'unknown',
    thickness: partMeta.thickness || 1.0,
    quantity: partMeta.quantity || 1,
    // For nester collision testing — single polygon (convex hull when multi-piece)
    outer: translatedNestingOuter,
    holes: translatedAggregatedHoles,
    // For preview rendering — full multi-piece detail. Always present so the
    // preview can render every flange + every hole, even when the unfolded
    // pattern is multi-component.
    pieces: translatedPieces,
    bendLines: normalizedBendLines,
    bbox: { w: outerBBox.w, h: outerBBox.h },
    area: netArea,
    originalEntities: entities,
  };
}

function clipBendLineToBBox(bl, bbox) {
  // Clamp bend-line endpoints to the outer bounding box so the preview
  // renders them inside the part rather than trailing into whitespace.
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const minX = bbox.minX ?? 0;
  const minY = bbox.minY ?? 0;
  const maxX = minX + (bbox.w ?? 0);
  const maxY = minY + (bbox.h ?? 0);
  const start = { x: clamp(bl.start.x, minX, maxX), y: clamp(bl.start.y, minY, maxY) };
  const end = { x: clamp(bl.end.x, minX, maxX), y: clamp(bl.end.y, minY, maxY) };
  if (Math.abs(end.x - start.x) < 1e-3 && Math.abs(end.y - start.y) < 1e-3) return null;
  return { start, end, direction: bl.direction };
}
