/**
 * Pure geometry utilities for sheet metal nesting engine.
 * All points are {x, y} objects in mm. No external dependencies.
 */

export const CLIPPER_SCALE = 1000;

/**
 * Shoelace formula. Returns signed area:
 *   positive = counter-clockwise winding
 *   negative = clockwise winding
 */
export function polygonArea(points) {
  const n = points.length;
  if (n < 3) return 0;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return area / 2;
}

/**
 * Returns true if the polygon winds clockwise (negative signed area).
 */
export function isClockwise(points) {
  return polygonArea(points) < 0;
}

/**
 * Returns points in counter-clockwise order. Reverses if currently CW.
 */
export function ensureCCW(points) {
  return isClockwise(points) ? [...points].reverse() : points;
}

/**
 * Returns points in clockwise order. Reverses if currently CCW.
 */
export function ensureCW(points) {
  return isClockwise(points) ? points : [...points].reverse();
}

/**
 * Returns the axis-aligned bounding box of a set of points.
 */
export function boundingBox(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/**
 * Returns the centroid (geometric center) of a polygon.
 */
export function centroid(points) {
  const n = points.length;
  if (n === 0) return { x: 0, y: 0 };
  if (n === 1) return { x: points[0].x, y: points[0].y };
  if (n === 2) return { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };

  let cx = 0;
  let cy = 0;
  let areaSum = 0;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const cross = points[i].x * points[j].y - points[j].x * points[i].y;
    cx += (points[i].x + points[j].x) * cross;
    cy += (points[i].y + points[j].y) * cross;
    areaSum += cross;
  }

  const area6 = areaSum * 3; // 6 * signed_area / 2 = 3 * areaSum
  return { x: cx / area6, y: cy / area6 };
}

/**
 * Ray-casting algorithm to test if a point is inside a polygon.
 */
export function pointInPolygon(point, polygon) {
  const { x, y } = point;
  const n = polygon.length;
  let inside = false;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;

    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * Returns a new array of points translated by (dx, dy).
 */
export function translatePoints(points, dx, dy) {
  return points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

/**
 * Returns a new array of points rotated by angleDeg degrees around (cx, cy).
 */
export function rotatePoints(points, angleDeg, cx = 0, cy = 0) {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  return points.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    return {
      x: cx + dx * cos - dy * sin,
      y: cy + dx * sin + dy * cos,
    };
  });
}

/**
 * Translates points so the bounding box starts at the origin (0, 0).
 */
export function normalizeToOrigin(points, holes) {
  const bb = boundingBox(points);
  const dx = -bb.minX;
  const dy = -bb.minY;
  const normalizedOuter = translatePoints(points, dx, dy);

  // When called with a holes array (from dxf-import), return an object
  if (holes !== undefined) {
    const normalizedHoles = (holes || []).map((h) => translatePoints(h, dx, dy));
    return { outer: normalizedOuter, holes: normalizedHoles };
  }

  // Single-argument form: return the translated points array directly
  return normalizedOuter;
}

/**
 * Removes duplicate or near-duplicate consecutive points within tolerance (mm).
 */
export function removeDuplicatePoints(points, tolerance = 0.01) {
  if (points.length === 0) return [];
  const result = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = result[result.length - 1];
    if (distanceBetween(prev, points[i]) > tolerance) {
      result.push(points[i]);
    }
  }
  // Check wrap-around: if last point duplicates first, remove it
  if (result.length > 1 && distanceBetween(result[result.length - 1], result[0]) <= tolerance) {
    result.pop();
  }
  return result;
}

/**
 * Removes collinear points (points that lie on the line between their neighbors)
 * within the given tolerance (mm).
 */
export function removeCollinearPoints(points, tolerance = 0.01) {
  if (points.length < 3) return [...points];

  const result = [];
  const n = points.length;

  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];

    // Cross product magnitude gives twice the triangle area
    const cross = Math.abs(
      (curr.x - prev.x) * (next.y - prev.y) - (curr.y - prev.y) * (next.x - prev.x)
    );

    // Normalize by the length of the base to get perpendicular distance
    const base = distanceBetween(prev, next);
    const dist = base > 0 ? cross / base : 0;

    if (dist > tolerance) {
      result.push(curr);
    }
  }

  return result.length < 3 ? [...points] : result;
}

/**
 * Douglas-Peucker polygon simplification.
 */
export function simplifyPolygon(points, tolerance = 0.05) {
  if (points.length < 3) return [...points];

  // For a closed polygon, find the point farthest from the first point
  // to split the ring into two open polylines, simplify each, then rejoin.
  let maxDist = 0;
  let splitIdx = 0;
  for (let i = 1; i < points.length; i++) {
    const d = distanceBetween(points[0], points[i]);
    if (d > maxDist) {
      maxDist = d;
      splitIdx = i;
    }
  }

  const line1 = points.slice(0, splitIdx + 1);
  const line2 = points.slice(splitIdx).concat([points[0]]);

  const simplified1 = douglasPeucker(line1, tolerance);
  const simplified2 = douglasPeucker(line2, tolerance);

  // Merge: drop last of simplified1 (== first of simplified2) and last of simplified2 (== first of simplified1)
  const merged = simplified1.slice(0, -1).concat(simplified2.slice(0, -1));
  return merged.length < 3 ? [...points] : merged;
}

/**
 * Douglas-Peucker for an open polyline.
 */
function douglasPeucker(points, tolerance) {
  if (points.length <= 2) return [...points];

  const first = points[0];
  const last = points[points.length - 1];

  let maxDist = 0;
  let maxIdx = 0;

  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }

  if (maxDist > tolerance) {
    const left = douglasPeucker(points.slice(0, maxIdx + 1), tolerance);
    const right = douglasPeucker(points.slice(maxIdx), tolerance);
    return left.slice(0, -1).concat(right);
  }

  return [first, last];
}

/**
 * Perpendicular distance from point p to the line segment (a, b).
 */
function perpendicularDistance(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return distanceBetween(p, a);
  const cross = Math.abs(dx * (a.y - p.y) - dy * (a.x - p.x));
  return cross / Math.sqrt(lenSq);
}

/**
 * Convex hull using the Graham scan algorithm.
 * Returns hull vertices in counter-clockwise order.
 */
export function convexHull(points) {
  if (points.length < 3) return [...points];

  // Find the lowest point (and leftmost if tied)
  let pivot = 0;
  for (let i = 1; i < points.length; i++) {
    if (
      points[i].y < points[pivot].y ||
      (points[i].y === points[pivot].y && points[i].x < points[pivot].x)
    ) {
      pivot = i;
    }
  }

  const p0 = points[pivot];

  // Sort by polar angle relative to pivot
  const sorted = points
    .filter((_, i) => i !== pivot)
    .map((p) => ({
      point: p,
      angle: Math.atan2(p.y - p0.y, p.x - p0.x),
      dist: distanceBetween(p0, p),
    }))
    .sort((a, b) => {
      if (a.angle !== b.angle) return a.angle - b.angle;
      return a.dist - b.dist;
    })
    .map((o) => o.point);

  const stack = [p0];
  for (const p of sorted) {
    while (stack.length > 1) {
      const a = stack[stack.length - 2];
      const b = stack[stack.length - 1];
      const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
      if (cross <= 0) {
        stack.pop();
      } else {
        break;
      }
    }
    stack.push(p);
  }

  return stack;
}

/**
 * Euclidean distance between two points.
 */
export function distanceBetween(p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Converts [{x, y}, ...] to clipper integer format [{X, Y}, ...].
 */
export function toClipperPath(points, scale = CLIPPER_SCALE) {
  return points.map((p) => ({
    X: Math.round(p.x * scale),
    Y: Math.round(p.y * scale),
  }));
}

/**
 * Converts clipper integer format [{X, Y}, ...] back to [{x, y}, ...].
 */
export function fromClipperPath(path, scale = CLIPPER_SCALE) {
  return path.map((p) => ({
    x: p.X / scale,
    y: p.Y / scale,
  }));
}
