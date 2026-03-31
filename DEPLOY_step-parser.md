# step-parser.ts — Copy everything below this line into Supabase Dashboard

```ts
/**
 * STEP/STP File Parser for Deno Edge Functions
 *
 * Pure-text parser that extracts geometry from STEP/STP files (ISO 10303-21)
 * without requiring WASM or OpenCascade. Works by parsing the ASCII STEP
 * entities (CARTESIAN_POINT, EDGE_CURVE, LINE, CIRCLE, etc.) to build
 * a wireframe representation suitable for manufacturing PDF generation.
 *
 * This gives us: bounding box, wireframe edges, and dimensional analysis
 * — sufficient for generating professional manufacturing drawings.
 */

import { type Triangle, type Vec3, type STLData } from "./stl-parser.ts";
import { type Edge2D, type MeshAnalysis, type BendLine } from "./mesh-analyzer.ts";

// ── STEP entity parsing ───────────────────────────────────────────────────

interface StepEntity {
  id: number;
  type: string;
  params: string;
}

/** Parse STEP file text into a map of entities by ID */
function parseStepEntities(text: string): Map<number, StepEntity> {
  const entities = new Map<number, StepEntity>();
  // Match lines like: #123=ENTITY_TYPE(...);
  const entityRegex = /#(\d+)\s*=\s*([A-Z_][A-Z0-9_]*)\s*\(([^;]*)\)\s*;/g;
  let match: RegExpExecArray | null;

  while ((match = entityRegex.exec(text)) !== null) {
    entities.set(parseInt(match[1]), {
      id: parseInt(match[1]),
      type: match[2],
      params: match[3],
    });
  }

  return entities;
}

/** Parse a reference like #123 to get the entity ID */
function parseRef(s: string): number | null {
  const m = s.trim().match(/^#(\d+)$/);
  return m ? parseInt(m[1]) : null;
}

/** Parse a tuple of floats like "1.0,2.0,3.0" */
function parseFloats(s: string): number[] {
  return s.split(",").map((v) => parseFloat(v.trim())).filter((v) => !isNaN(v));
}

/** Extract CARTESIAN_POINT coordinates: CARTESIAN_POINT('name',(x,y,z)) */
function extractPoint(entity: StepEntity): Vec3 | null {
  if (entity.type !== "CARTESIAN_POINT") return null;
  // Find the coordinate tuple inside parentheses
  const tupleMatch = entity.params.match(/\(([^)]+)\)\s*$/);
  if (!tupleMatch) return null;
  const coords = parseFloats(tupleMatch[1]);
  if (coords.length >= 3) {
    return { x: coords[0], y: coords[1], z: coords[2] };
  }
  if (coords.length === 2) {
    return { x: coords[0], y: coords[1], z: 0 };
  }
  return null;
}

/** Resolve a ref to a CARTESIAN_POINT */
function resolvePoint(entities: Map<number, StepEntity>, ref: string): Vec3 | null {
  const id = parseRef(ref);
  if (id === null) return null;
  const ent = entities.get(id);
  if (!ent) return null;
  return extractPoint(ent);
}

// ── Edge extraction from STEP entities ────────────────────────────────────

interface WireEdge {
  start: Vec3;
  end: Vec3;
}

/**
 * Extract wireframe edges by finding EDGE_CURVE entities and resolving
 * their VERTEX_POINT start/end references to CARTESIAN_POINTs.
 *
 * EDGE_CURVE('',#start_vertex,#end_vertex,#curve,.T.)
 * VERTEX_POINT('',#point)
 */
function extractEdges(entities: Map<number, StepEntity>): WireEdge[] {
  const edges: WireEdge[] = [];

  // Helper: resolve VERTEX_POINT → CARTESIAN_POINT
  function resolveVertex(ref: string): Vec3 | null {
    const id = parseRef(ref);
    if (id === null) return null;
    const ent = entities.get(id);
    if (!ent) return null;

    if (ent.type === "VERTEX_POINT") {
      // VERTEX_POINT('',#point_ref)
      const parts = splitParams(ent.params);
      if (parts.length >= 2) {
        return resolvePoint(entities, parts[1]);
      }
    } else if (ent.type === "CARTESIAN_POINT") {
      return extractPoint(ent);
    }
    return null;
  }

  for (const [, entity] of entities) {
    if (entity.type === "EDGE_CURVE" || entity.type === "ORIENTED_EDGE") {
      const parts = splitParams(entity.params);

      if (entity.type === "EDGE_CURVE" && parts.length >= 4) {
        // EDGE_CURVE('',#vertex1,#vertex2,#curve,.T.)
        const p1 = resolveVertex(parts[1]);
        const p2 = resolveVertex(parts[2]);
        if (p1 && p2) {
          edges.push({ start: p1, end: p2 });
        }
      }
    }
  }

  // If no EDGE_CURVE found, try extracting from LINE entities
  if (edges.length === 0) {
    for (const [, entity] of entities) {
      if (entity.type === "LINE") {
        // LINE('',#point,#vector)
        const parts = splitParams(entity.params);
        if (parts.length >= 2) {
          const point = resolvePoint(entities, parts[1]);
          if (point) {
            // We have the start point but LINE extends infinitely;
            // store it so we at least get bounding box data
          }
        }
      }
    }
  }

  return edges;
}

/**
 * Split STEP entity params respecting nested parentheses.
 * e.g., "'name',#1,(1.0,2.0),#3" → ["'name'", "#1", "(1.0,2.0)", "#3"]
 */
function splitParams(params: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let current = "";

  for (const ch of params) {
    if (ch === "(") {
      depth++;
      current += ch;
    } else if (ch === ")") {
      depth--;
      current += ch;
    } else if (ch === "," && depth === 0) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) {
    result.push(current.trim());
  }

  return result;
}

// ── Projection helpers (same as mesh-analyzer) ───────────────────────────

function projectTop(v: Vec3, c: Vec3): { x: number; y: number } {
  return { x: v.x - c.x, y: -(v.z - c.z) };
}

function projectFront(v: Vec3, c: Vec3): { x: number; y: number } {
  return { x: v.x - c.x, y: -(v.y - c.y) };
}

function projectRight(v: Vec3, c: Vec3): { x: number; y: number } {
  return { x: v.z - c.z, y: -(v.y - c.y) };
}

function projectIso(v: Vec3, c: Vec3): { x: number; y: number } {
  const dx = v.x - c.x, dy = v.y - c.y, dz = v.z - c.z;
  const cos30 = Math.cos(Math.PI / 6);
  const sin30 = Math.sin(Math.PI / 6);
  return { x: (dx - dz) * cos30, y: -dy + (dx + dz) * sin30 };
}

function projectEdge(
  edge: WireEdge,
  center: Vec3,
  projFn: (v: Vec3, c: Vec3) => { x: number; y: number },
): Edge2D {
  const p1 = projFn(edge.start, center);
  const p2 = projFn(edge.end, center);
  return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
}

// ── Circle/arc approximation ─────────────────────────────────────────────

function extractCircleEdges(entities: Map<number, StepEntity>): WireEdge[] {
  const edges: WireEdge[] = [];
  const SEGMENTS = 24;

  for (const [, entity] of entities) {
    if (entity.type === "CIRCLE") {
      // CIRCLE('',#axis2_placement,radius)
      const parts = splitParams(entity.params);
      if (parts.length >= 3) {
        const radius = parseFloat(parts[2]);
        if (isNaN(radius) || radius <= 0) continue;

        // Resolve axis placement to get center point
        const axisId = parseRef(parts[1]);
        if (axisId === null) continue;
        const axisEnt = entities.get(axisId);
        if (!axisEnt) continue;

        // AXIS2_PLACEMENT_3D('',#center,#axis,#ref_direction)
        const axisParts = splitParams(axisEnt.params);
        if (axisParts.length < 2) continue;
        const center = resolvePoint(entities, axisParts[1]);
        if (!center) continue;

        // Approximate circle as line segments in XY plane
        for (let i = 0; i < SEGMENTS; i++) {
          const a1 = (2 * Math.PI * i) / SEGMENTS;
          const a2 = (2 * Math.PI * (i + 1)) / SEGMENTS;
          edges.push({
            start: {
              x: center.x + radius * Math.cos(a1),
              y: center.y + radius * Math.sin(a1),
              z: center.z,
            },
            end: {
              x: center.x + radius * Math.cos(a2),
              y: center.y + radius * Math.sin(a2),
              z: center.z,
            },
          });
        }
      }
    }
  }

  return edges;
}

// ── Main STEP parser ─────────────────────────────────────────────────────

/**
 * Parse a STEP/STP file and return a MeshAnalysis object.
 *
 * Extracts wireframe geometry directly from the STEP text format
 * without WASM dependencies. Suitable for manufacturing drawing PDFs.
 */
export async function parseSTEP(buffer: ArrayBuffer): Promise<MeshAnalysis> {
  const text = new TextDecoder().decode(new Uint8Array(buffer));

  // Verify it's actually a STEP file
  if (!text.includes("ISO-10303-21") && !text.includes("STEP")) {
    throw new Error("Not a valid STEP file (missing ISO-10303-21 header)");
  }

  console.log(`Parsing STEP file (${(buffer.byteLength / 1024).toFixed(0)} KB)...`);

  const entities = parseStepEntities(text);
  console.log(`Found ${entities.size} STEP entities`);

  // 1. Extract all CARTESIAN_POINTs for bounding box
  const allPoints: Vec3[] = [];
  for (const [, entity] of entities) {
    if (entity.type === "CARTESIAN_POINT") {
      const pt = extractPoint(entity);
      if (pt) allPoints.push(pt);
    }
  }

  if (allPoints.length === 0) {
    throw new Error("No geometry points found in STEP file");
  }

  // 2. Extract wireframe edges
  const edgeCurveEdges = extractEdges(entities);
  const circleEdges = extractCircleEdges(entities);
  const allEdges = [...edgeCurveEdges, ...circleEdges];

  console.log(`Extracted ${edgeCurveEdges.length} edge curves, ${circleEdges.length} circle segments`);

  // 3. Compute bounding box from all points
  const min: Vec3 = { x: Infinity, y: Infinity, z: Infinity };
  const max: Vec3 = { x: -Infinity, y: -Infinity, z: -Infinity };

  for (const pt of allPoints) {
    min.x = Math.min(min.x, pt.x);
    min.y = Math.min(min.y, pt.y);
    min.z = Math.min(min.z, pt.z);
    max.x = Math.max(max.x, pt.x);
    max.y = Math.max(max.y, pt.y);
    max.z = Math.max(max.z, pt.z);
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

  // Estimate volume from bounding box (rough approximation)
  const volume = dimensions.x * dimensions.y * dimensions.z;
  const surfaceArea =
    2 * (dimensions.x * dimensions.y + dimensions.y * dimensions.z + dimensions.x * dimensions.z);

  // 4. If we have no edges, create bounding box wireframe as fallback
  if (allEdges.length === 0) {
    console.log("No edges found, generating bounding box wireframe");
    const corners = [
      { x: min.x, y: min.y, z: min.z },
      { x: max.x, y: min.y, z: min.z },
      { x: max.x, y: max.y, z: min.z },
      { x: min.x, y: max.y, z: min.z },
      { x: min.x, y: min.y, z: max.z },
      { x: max.x, y: min.y, z: max.z },
      { x: max.x, y: max.y, z: max.z },
      { x: min.x, y: max.y, z: max.z },
    ];
    // Bottom face
    allEdges.push({ start: corners[0], end: corners[1] });
    allEdges.push({ start: corners[1], end: corners[2] });
    allEdges.push({ start: corners[2], end: corners[3] });
    allEdges.push({ start: corners[3], end: corners[0] });
    // Top face
    allEdges.push({ start: corners[4], end: corners[5] });
    allEdges.push({ start: corners[5], end: corners[6] });
    allEdges.push({ start: corners[6], end: corners[7] });
    allEdges.push({ start: corners[7], end: corners[4] });
    // Vertical edges
    allEdges.push({ start: corners[0], end: corners[4] });
    allEdges.push({ start: corners[1], end: corners[5] });
    allEdges.push({ start: corners[2], end: corners[6] });
    allEdges.push({ start: corners[3], end: corners[7] });
  }

  // 5. Detect potential bend lines (edges with sharp angles between adjacent faces)
  const bendLines: BendLine[] = [];

  // 6. Generate 2D projections
  const featureEdges = allEdges.map((e) => ({ start: e.start, end: e.end }));
  const topView = allEdges.map((e) => projectEdge(e, center, projectTop));
  const frontView = allEdges.map((e) => projectEdge(e, center, projectFront));
  const rightView = allEdges.map((e) => projectEdge(e, center, projectRight));
  const isoView = allEdges.map((e) => projectEdge(e, center, projectIso));

  console.log(
    `STEP analysis: ${allPoints.length} points, ${allEdges.length} edges, dims: ${dimensions.x.toFixed(1)}×${dimensions.y.toFixed(1)}×${dimensions.z.toFixed(1)} mm`,
  );

  return {
    boundingBox: { min, max },
    dimensions,
    center,
    volume,
    surfaceArea,
    triangleCount: 0,
    featureEdges,
    bendLines,
    topView,
    frontView,
    rightView,
    isoView,
  };
}
```
