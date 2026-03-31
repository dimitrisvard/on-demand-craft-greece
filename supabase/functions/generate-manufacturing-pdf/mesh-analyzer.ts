/**
 * Mesh Analyzer — extracts geometric features from parsed STL data
 *
 * - Bounding box, volume, surface area
 * - Feature edges (boundary + crease edges) for wireframe views
 * - Bend line detection via normal angle analysis
 * - 2D projections for orthographic views
 */

import { type Triangle, type Vec3 } from "./stl-parser.ts";

// ── Vector math helpers ─────────────────────────────────────────────────────

function v3sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function v3cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
function v3dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function v3len(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}
function v3normalize(v: Vec3): Vec3 {
  const l = v3len(v);
  if (l < 1e-10) return { x: 0, y: 0, z: 0 };
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

// ── Edge hashing for adjacency detection ────────────────────────────────────

const HASH_PRECISION = 1e4; // ~0.1mm precision for vertex merging

function hashVertex(v: Vec3): string {
  const x = Math.round(v.x * HASH_PRECISION);
  const y = Math.round(v.y * HASH_PRECISION);
  const z = Math.round(v.z * HASH_PRECISION);
  return `${x},${y},${z}`;
}

function edgeKey(h1: string, h2: string): string {
  return h1 < h2 ? `${h1}|${h2}` : `${h2}|${h1}`;
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface Edge2D {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface BendLine {
  start: Vec3;
  end: Vec3;
  angle: number; // degrees
}

export interface MeshAnalysis {
  // Metrics
  boundingBox: { min: Vec3; max: Vec3 };
  dimensions: Vec3; // size in mm
  center: Vec3;
  volume: number; // mm³
  surfaceArea: number; // mm²
  triangleCount: number;

  // Feature edges (3D)
  featureEdges: Array<{ start: Vec3; end: Vec3 }>;
  bendLines: BendLine[];

  // Projected views (2D edges)
  topView: Edge2D[]; // looking down Y axis
  frontView: Edge2D[]; // looking down Z axis
  rightView: Edge2D[]; // looking down X axis
  isoView: Edge2D[]; // isometric projection
}

// ── Projection functions ────────────────────────────────────────────────────

/** Project 3D point to 2D for top view (XZ plane, looking down -Y) */
function projectTop(v: Vec3, center: Vec3): { x: number; y: number } {
  return { x: v.x - center.x, y: -(v.z - center.z) };
}

/** Project 3D point to 2D for front view (XY plane, looking down -Z) */
function projectFront(v: Vec3, center: Vec3): { x: number; y: number } {
  return { x: v.x - center.x, y: -(v.y - center.y) };
}

/** Project 3D point to 2D for right view (ZY plane, looking down -X) */
function projectRight(v: Vec3, center: Vec3): { x: number; y: number } {
  return { x: v.z - center.z, y: -(v.y - center.y) };
}

/** Standard isometric projection */
function projectIso(v: Vec3, center: Vec3): { x: number; y: number } {
  const dx = v.x - center.x;
  const dy = v.y - center.y;
  const dz = v.z - center.z;
  // Standard isometric angles
  const cos30 = Math.cos(Math.PI / 6);
  const sin30 = Math.sin(Math.PI / 6);
  return {
    x: (dx - dz) * cos30,
    y: -dy + (dx + dz) * sin30,
  };
}

type ProjectFn = (v: Vec3, center: Vec3) => { x: number; y: number };

function projectEdges(
  edges: Array<{ start: Vec3; end: Vec3 }>,
  center: Vec3,
  projFn: ProjectFn,
): Edge2D[] {
  return edges.map((e) => {
    const p1 = projFn(e.start, center);
    const p2 = projFn(e.end, center);
    return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
  });
}

// ── Main analysis function ──────────────────────────────────────────────────

const CREASE_ANGLE_DEG = 25; // angle threshold for feature edges
const BEND_MIN_ANGLE_DEG = 15; // minimum angle to consider a bend
const BEND_MAX_ANGLE_DEG = 160; // maximum angle for bends

export function analyzeMesh(triangles: Triangle[]): MeshAnalysis {
  // 1. Compute bounding box, volume, surface area
  const min: Vec3 = { x: Infinity, y: Infinity, z: Infinity };
  const max: Vec3 = { x: -Infinity, y: -Infinity, z: -Infinity };
  let volume = 0;
  let surfaceArea = 0;

  for (const tri of triangles) {
    for (const v of [tri.v0, tri.v1, tri.v2]) {
      min.x = Math.min(min.x, v.x);
      min.y = Math.min(min.y, v.y);
      min.z = Math.min(min.z, v.z);
      max.x = Math.max(max.x, v.x);
      max.y = Math.max(max.y, v.y);
      max.z = Math.max(max.z, v.z);
    }

    // Signed volume contribution (divergence theorem)
    const { v0, v1, v2 } = tri;
    volume +=
      (v0.x * (v1.y * v2.z - v1.z * v2.y) +
        v0.y * (v1.z * v2.x - v1.x * v2.z) +
        v0.z * (v1.x * v2.y - v1.y * v2.x)) /
      6.0;

    // Surface area
    const e1 = v3sub(v1, v0);
    const e2 = v3sub(v2, v0);
    surfaceArea += v3len(v3cross(e1, e2)) * 0.5;
  }

  const dimensions: Vec3 = {
    x: max.x - min.x,
    y: max.y - min.y,
    z: max.z - min.z,
  };
  const center: Vec3 = {
    x: (min.x + max.x) / 2,
    y: (min.y + max.y) / 2,
    z: (min.z + max.z) / 2,
  };

  // 2. Build edge adjacency map
  //    For each edge, store the indices of triangles that share it
  const edgeTriMap = new Map<string, number[]>();

  for (let i = 0; i < triangles.length; i++) {
    const tri = triangles[i];
    const verts = [tri.v0, tri.v1, tri.v2];
    const hashes = verts.map(hashVertex);

    for (let j = 0; j < 3; j++) {
      const key = edgeKey(hashes[j], hashes[(j + 1) % 3]);
      const existing = edgeTriMap.get(key);
      if (existing) {
        existing.push(i);
      } else {
        edgeTriMap.set(key, [i]);
      }
    }
  }

  // 3. Extract feature edges + bend lines
  const featureEdges: Array<{ start: Vec3; end: Vec3 }> = [];
  const bendLines: BendLine[] = [];
  const creaseThresh = Math.cos((CREASE_ANGLE_DEG * Math.PI) / 180);

  for (const [key, triIndices] of edgeTriMap) {
    const [h1, h2] = key.split("|");
    const [x1s, y1s, z1s] = h1.split(",").map(Number);
    const [x2s, y2s, z2s] = h2.split(",").map(Number);
    const start: Vec3 = {
      x: x1s / HASH_PRECISION,
      y: y1s / HASH_PRECISION,
      z: z1s / HASH_PRECISION,
    };
    const end: Vec3 = {
      x: x2s / HASH_PRECISION,
      y: y2s / HASH_PRECISION,
      z: z2s / HASH_PRECISION,
    };

    if (triIndices.length === 1) {
      // Boundary edge — always a feature edge
      featureEdges.push({ start, end });
    } else if (triIndices.length === 2) {
      // Check angle between adjacent face normals
      const t0 = triangles[triIndices[0]];
      const t1 = triangles[triIndices[1]];
      const n0 = v3normalize(
        v3cross(v3sub(t0.v1, t0.v0), v3sub(t0.v2, t0.v0)),
      );
      const n1 = v3normalize(
        v3cross(v3sub(t1.v1, t1.v0), v3sub(t1.v2, t1.v0)),
      );
      const dot = v3dot(n0, n1);

      if (dot < creaseThresh) {
        featureEdges.push({ start, end });

        // Check if this is a bend (sharp angle but not a corner)
        const angleDeg = (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
        if (angleDeg >= BEND_MIN_ANGLE_DEG && angleDeg <= BEND_MAX_ANGLE_DEG) {
          // Filter: bend lines should have reasonable length
          const edgeLen = v3len(v3sub(end, start));
          const maxDim = Math.max(dimensions.x, dimensions.y, dimensions.z);
          if (edgeLen > maxDim * 0.05) {
            bendLines.push({ start, end, angle: angleDeg });
          }
        }
      }
    }
  }

  // 4. Generate 2D projected views
  const topView = projectEdges(featureEdges, center, projectTop);
  const frontView = projectEdges(featureEdges, center, projectFront);
  const rightView = projectEdges(featureEdges, center, projectRight);
  const isoView = projectEdges(featureEdges, center, projectIso);

  return {
    boundingBox: { min, max },
    dimensions,
    center,
    volume: Math.abs(volume),
    surfaceArea,
    triangleCount: triangles.length,
    featureEdges,
    bendLines,
    topView,
    frontView,
    rightView,
    isoView,
  };
}
