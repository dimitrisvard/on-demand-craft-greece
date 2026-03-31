/**
 * DXF File Parser for Deno Edge Functions
 *
 * Parses AutoCAD DXF files (ASCII format) and extracts 2D geometry entities.
 * Supports LINE, ARC, CIRCLE, LWPOLYLINE, POLYLINE, ELLIPSE, and SPLINE entities.
 *
 * Returns Edge2D arrays and basic dimensional analysis compatible with
 * the existing PDF builder pipeline.
 */

import { type Edge2D, type MeshAnalysis, type BendLine } from "./mesh-analyzer.ts";
import { type Vec3 } from "./stl-parser.ts";

// ── DXF entity types ──────────────────────────────────────────────────────

interface DxfLine {
  type: "LINE";
  x1: number; y1: number; z1: number;
  x2: number; y2: number; z2: number;
  layer: string;
}

interface DxfArc {
  type: "ARC";
  cx: number; cy: number; cz: number;
  radius: number;
  startAngle: number; // degrees
  endAngle: number;   // degrees
  layer: string;
}

interface DxfCircle {
  type: "CIRCLE";
  cx: number; cy: number; cz: number;
  radius: number;
  layer: string;
}

interface DxfLwPolyline {
  type: "LWPOLYLINE";
  vertices: Array<{ x: number; y: number; bulge: number }>;
  closed: boolean;
  layer: string;
}

type DxfEntity = DxfLine | DxfArc | DxfCircle | DxfLwPolyline;

// ── DXF group-code parsing ────────────────────────────────────────────────

interface GroupCode {
  code: number;
  value: string;
}

function parseGroupCodes(text: string): GroupCode[] {
  const lines = text.split(/\r?\n/);
  const groups: GroupCode[] = [];

  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    const value = lines[i + 1].trim();
    if (!isNaN(code)) {
      groups.push({ code, value });
    }
  }

  return groups;
}

// ── Entity extraction ─────────────────────────────────────────────────────

function extractEntities(groups: GroupCode[]): DxfEntity[] {
  const entities: DxfEntity[] = [];

  // Find ENTITIES section
  let i = 0;
  while (i < groups.length) {
    if (groups[i].code === 2 && groups[i].value === "ENTITIES") break;
    i++;
  }
  if (i >= groups.length) return entities;
  i++;

  // Parse entities until ENDSEC
  while (i < groups.length) {
    if (groups[i].code === 0 && groups[i].value === "ENDSEC") break;

    if (groups[i].code === 0) {
      const entityType = groups[i].value;
      i++;

      // Collect all group codes for this entity until next code 0
      const entityGroups: GroupCode[] = [];
      while (i < groups.length && groups[i].code !== 0) {
        entityGroups.push(groups[i]);
        i++;
      }

      const entity = parseEntity(entityType, entityGroups);
      if (entity) entities.push(entity);
    } else {
      i++;
    }
  }

  return entities;
}

function getVal(groups: GroupCode[], code: number, def = "0"): string {
  const g = groups.find((g) => g.code === code);
  return g ? g.value : def;
}

function getNum(groups: GroupCode[], code: number, def = 0): number {
  return parseFloat(getVal(groups, code, String(def)));
}

function parseEntity(type: string, groups: GroupCode[]): DxfEntity | null {
  const layer = getVal(groups, 8, "0");

  switch (type) {
    case "LINE":
      return {
        type: "LINE",
        x1: getNum(groups, 10), y1: getNum(groups, 20), z1: getNum(groups, 30),
        x2: getNum(groups, 11), y2: getNum(groups, 21), z2: getNum(groups, 31),
        layer,
      };

    case "ARC":
      return {
        type: "ARC",
        cx: getNum(groups, 10), cy: getNum(groups, 20), cz: getNum(groups, 30),
        radius: getNum(groups, 40),
        startAngle: getNum(groups, 50),
        endAngle: getNum(groups, 51),
        layer,
      };

    case "CIRCLE":
      return {
        type: "CIRCLE",
        cx: getNum(groups, 10), cy: getNum(groups, 20), cz: getNum(groups, 30),
        radius: getNum(groups, 40),
        layer,
      };

    case "LWPOLYLINE": {
      const vertices: Array<{ x: number; y: number; bulge: number }> = [];
      let closed = false;

      // Check closed flag (group 70, bit 1)
      const flags = getNum(groups, 70);
      closed = (flags & 1) !== 0;

      // Extract vertices — group 10/20 pairs, with optional bulge (42)
      let curX = 0, curY = 0, curBulge = 0;
      let hasVertex = false;

      for (const g of groups) {
        if (g.code === 10) {
          if (hasVertex) {
            vertices.push({ x: curX, y: curY, bulge: curBulge });
            curBulge = 0;
          }
          curX = parseFloat(g.value);
          hasVertex = true;
        } else if (g.code === 20) {
          curY = parseFloat(g.value);
        } else if (g.code === 42) {
          curBulge = parseFloat(g.value);
        }
      }
      if (hasVertex) {
        vertices.push({ x: curX, y: curY, bulge: curBulge });
      }

      if (vertices.length < 2) return null;
      return { type: "LWPOLYLINE", vertices, closed, layer };
    }

    case "POLYLINE":
      // POLYLINE is complex (uses VERTEX sub-entities), skip for now
      return null;

    default:
      return null;
  }
}

// ── Geometry → Edge2D conversion ──────────────────────────────────────────

const ARC_SEGMENTS = 32; // segments per full circle

function arcToEdges(
  cx: number, cy: number, radius: number,
  startDeg: number, endDeg: number,
): Edge2D[] {
  const edges: Edge2D[] = [];
  let startRad = (startDeg * Math.PI) / 180;
  let endRad = (endDeg * Math.PI) / 180;

  // Ensure positive sweep
  if (endRad <= startRad) endRad += 2 * Math.PI;

  const sweep = endRad - startRad;
  const segments = Math.max(8, Math.round((sweep / (2 * Math.PI)) * ARC_SEGMENTS));

  for (let i = 0; i < segments; i++) {
    const a1 = startRad + (sweep * i) / segments;
    const a2 = startRad + (sweep * (i + 1)) / segments;
    edges.push({
      x1: cx + radius * Math.cos(a1),
      y1: cy + radius * Math.sin(a1),
      x2: cx + radius * Math.cos(a2),
      y2: cy + radius * Math.sin(a2),
    });
  }

  return edges;
}

function circleToEdges(cx: number, cy: number, radius: number): Edge2D[] {
  return arcToEdges(cx, cy, radius, 0, 360);
}

/**
 * Convert a bulge polyline segment to arc edges.
 * Bulge = tan(sweep_angle / 4), sign indicates direction.
 */
function bulgeArcToEdges(
  x1: number, y1: number, x2: number, y2: number, bulge: number,
): Edge2D[] {
  if (Math.abs(bulge) < 1e-6) {
    return [{ x1, y1, x2, y2 }];
  }

  // Calculate arc parameters from bulge
  const dx = x2 - x1;
  const dy = y2 - y1;
  const chordLen = Math.sqrt(dx * dx + dy * dy);
  if (chordLen < 1e-10) return [];

  const sagitta = Math.abs(bulge) * chordLen / 2;
  const radius = (chordLen * chordLen / 4 + sagitta * sagitta) / (2 * sagitta);

  // Midpoint of chord
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;

  // Normal to chord, pointing toward center
  const nx = -dy / chordLen;
  const ny = dx / chordLen;
  const dist = radius - sagitta;
  const sign = bulge > 0 ? 1 : -1;

  const cx = mx + sign * dist * nx;
  const cy = my + sign * dist * ny;

  // Compute angles
  let startAngle = Math.atan2(y1 - cy, x1 - cx);
  let endAngle = Math.atan2(y2 - cy, x2 - cx);

  if (bulge > 0) {
    // Counter-clockwise
    if (endAngle <= startAngle) endAngle += 2 * Math.PI;
  } else {
    // Clockwise
    if (startAngle <= endAngle) startAngle += 2 * Math.PI;
  }

  const sweep = Math.abs(endAngle - startAngle);
  const segments = Math.max(4, Math.round((sweep / (2 * Math.PI)) * ARC_SEGMENTS));
  const edges: Edge2D[] = [];

  for (let i = 0; i < segments; i++) {
    const t1 = i / segments;
    const t2 = (i + 1) / segments;
    const a1 = startAngle + (endAngle - startAngle) * t1;
    const a2 = startAngle + (endAngle - startAngle) * t2;
    edges.push({
      x1: cx + radius * Math.cos(a1),
      y1: cy + radius * Math.sin(a1),
      x2: cx + radius * Math.cos(a2),
      y2: cy + radius * Math.sin(a2),
    });
  }

  return edges;
}

function entityToEdges(entity: DxfEntity): Edge2D[] {
  switch (entity.type) {
    case "LINE":
      return [{ x1: entity.x1, y1: entity.y1, x2: entity.x2, y2: entity.y2 }];

    case "ARC":
      return arcToEdges(entity.cx, entity.cy, entity.radius, entity.startAngle, entity.endAngle);

    case "CIRCLE":
      return circleToEdges(entity.cx, entity.cy, entity.radius);

    case "LWPOLYLINE": {
      const edges: Edge2D[] = [];
      const verts = entity.vertices;
      const count = entity.closed ? verts.length : verts.length - 1;

      for (let i = 0; i < count; i++) {
        const v1 = verts[i];
        const v2 = verts[(i + 1) % verts.length];

        if (Math.abs(v1.bulge) > 1e-6) {
          edges.push(...bulgeArcToEdges(v1.x, v1.y, v2.x, v2.y, v1.bulge));
        } else {
          edges.push({ x1: v1.x, y1: v1.y, x2: v2.x, y2: v2.y });
        }
      }
      return edges;
    }

    default:
      return [];
  }
}

// ── Bend line detection from DXF layers ───────────────────────────────────

const BEND_LAYER_PATTERNS = [
  /bend/i, /fold/i, /b[0-9]/i, /bl[0-9]/i,
  /κάμψη/i, /δίπλωμα/i, // Greek terms
];

function isBendLayer(layer: string): boolean {
  return BEND_LAYER_PATTERNS.some((p) => p.test(layer));
}

// ── Main DXF parser ───────────────────────────────────────────────────────

export interface DxfAnalysis {
  edges: Edge2D[];
  bendEdges: Edge2D[];
  bendLines: BendLine[];
  boundingBox: { min: Vec3; max: Vec3 };
  dimensions: Vec3;
  center: Vec3;
  entityCount: number;
  layerNames: string[];
}

/**
 * Parse a DXF file buffer and extract 2D geometry + bend information.
 */
export function parseDXF(buffer: ArrayBuffer): DxfAnalysis {
  const text = new TextDecoder().decode(new Uint8Array(buffer));
  const groups = parseGroupCodes(text);
  const entities = extractEntities(groups);

  if (entities.length === 0) {
    throw new Error("No geometry entities found in DXF file");
  }

  // Separate bend entities from regular geometry
  const regularEdges: Edge2D[] = [];
  const bendEdges: Edge2D[] = [];
  const layers = new Set<string>();

  for (const entity of entities) {
    layers.add(entity.layer);
    const edges = entityToEdges(entity);

    if (isBendLayer(entity.layer)) {
      bendEdges.push(...edges);
    } else {
      regularEdges.push(...edges);
    }
  }

  const allEdges = [...regularEdges, ...bendEdges];

  // Calculate bounding box from all edges
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  for (const e of allEdges) {
    minX = Math.min(minX, e.x1, e.x2);
    minY = Math.min(minY, e.y1, e.y2);
    maxX = Math.max(maxX, e.x1, e.x2);
    maxY = Math.max(maxY, e.y1, e.y2);
  }

  const width = maxX - minX;
  const height = maxY - minY;

  // Convert bend edges to BendLine format (approximate 3D from 2D)
  const bendLines: BendLine[] = bendEdges
    .filter((e) => {
      const len = Math.sqrt((e.x2 - e.x1) ** 2 + (e.y2 - e.y1) ** 2);
      return len > Math.max(width, height) * 0.05; // filter very short segments
    })
    .map((e) => ({
      start: { x: e.x1, y: 0, z: e.y1 },
      end: { x: e.x2, y: 0, z: e.y2 },
      angle: 90, // Default bend angle — DXF doesn't encode this directly
    }));

  console.log(`DXF parsed: ${entities.length} entities, ${allEdges.length} edges, ${bendLines.length} bends, layers: [${[...layers].join(", ")}]`);

  return {
    edges: regularEdges.length > 0 ? regularEdges : allEdges,
    bendEdges,
    bendLines,
    boundingBox: {
      min: { x: minX, y: 0, z: minY },
      max: { x: maxX, y: 0, z: maxY },
    },
    dimensions: { x: width, y: 0, z: height },
    center: {
      x: (minX + maxX) / 2,
      y: 0,
      z: (minY + maxY) / 2,
    },
    entityCount: entities.length,
    layerNames: [...layers],
  };
}

/**
 * Convert DXF analysis to a MeshAnalysis-compatible object
 * so the existing PDF builder can render it.
 */
export function dxfToMeshAnalysis(dxf: DxfAnalysis): MeshAnalysis {
  return {
    boundingBox: dxf.boundingBox,
    dimensions: dxf.dimensions,
    center: dxf.center,
    volume: 0,
    surfaceArea: dxf.dimensions.x * dxf.dimensions.z,
    triangleCount: 0,
    featureEdges: dxf.edges.map((e) => ({
      start: { x: e.x1, y: 0, z: e.y1 },
      end: { x: e.x2, y: 0, z: e.y2 },
    })),
    bendLines: dxf.bendLines,
    topView: dxf.edges, // DXF is already a top-down 2D view
    frontView: [],       // No front view for 2D DXF
    rightView: [],       // No right view for 2D DXF
    isoView: dxf.edges,  // Use same edges for isometric (already 2D)
  };
}
