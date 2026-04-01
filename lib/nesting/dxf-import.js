import DxfParser from 'dxf-parser';
import {
  polygonArea,
  isClockwise,
  ensureCCW,
  ensureCW,
  pointInPolygon,
  boundingBox,
  normalizeToOrigin,
  removeDuplicatePoints,
  removeCollinearPoints,
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

  for (const entity of entities) {
    const type = (entity.type || '').toUpperCase();

    switch (type) {
      case 'LWPOLYLINE': {
        const pts = extractLWPolyline(entity);
        if (pts) closedContours.push(pts);
        break;
      }
      case 'POLYLINE': {
        const pts = extractPolyline(entity);
        if (pts) closedContours.push(pts);
        break;
      }
      case 'LINE': {
        if (entity.vertices && entity.vertices.length >= 2) {
          looseSegments.push({
            start: { x: entity.vertices[0].x, y: entity.vertices[0].y },
            end: { x: entity.vertices[1].x, y: entity.vertices[1].y },
          });
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

  // Clean up contours: remove duplicate and collinear points
  const cleanedContours = closedContours
    .map((pts) => removeCollinearPoints(removeDuplicatePoints(pts)))
    .filter((pts) => pts.length >= 3);

  if (cleanedContours.length === 0) {
    throw new NestingError(
      'No closed contours found in DXF',
      'NO_CLOSED_CONTOURS',
      { entityCount: entities.length },
    );
  }

  // ---------------------------------------------------------------------------
  // Classify: largest area = outer, rest that are inside = holes
  // ---------------------------------------------------------------------------

  let outerIdx = 0;
  let maxArea = 0;
  for (let i = 0; i < cleanedContours.length; i++) {
    const a = Math.abs(polygonArea(cleanedContours[i]));
    if (a > maxArea) {
      maxArea = a;
      outerIdx = i;
    }
  }

  let outer = cleanedContours[outerIdx];
  outer = ensureCCW(outer);

  const holes = [];
  for (let i = 0; i < cleanedContours.length; i++) {
    if (i === outerIdx) continue;
    const contour = cleanedContours[i];
    // Check if the first point of this contour is inside the outer contour
    if (pointInPolygon(contour[0], outer)) {
      holes.push(ensureCW(contour));
    }
  }

  // ---------------------------------------------------------------------------
  // Normalize to origin
  // ---------------------------------------------------------------------------

  const normalized = normalizeToOrigin(outer, holes);
  outer = normalized.outer;
  const normalizedHoles = normalized.holes;

  const bbox = boundingBox(outer);

  // Compute net area
  const outerArea = Math.abs(polygonArea(outer));
  let holesArea = 0;
  for (const hole of normalizedHoles) {
    holesArea += Math.abs(polygonArea(hole));
  }
  const netArea = outerArea - holesArea;

  return {
    id: partMeta.id || 'part_' + Date.now(),
    name: partMeta.name || 'unnamed',
    material: partMeta.material || 'unknown',
    thickness: partMeta.thickness || 1.0,
    quantity: partMeta.quantity || 1,
    outer,
    holes: normalizedHoles,
    bbox: { w: bbox.w, h: bbox.h },
    area: netArea,
    originalEntities: entities,
  };
}
