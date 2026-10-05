// Flat-pattern metrics from a parsed DXF (cad/inline/dxf-parser.ts): cut length, closed loops, pierces and net area.
// Used for DXF inputs (inline backend) and for the flat.dxf the unfold service returns for STEP sheet metal.
//
// Rules
//   - Only outline edges count: edges on bend layers (the parser's bendEdges) are never cut.
//   - Cut length = sum of the outline edge lengths (arcs and circles as the parser tessellates them).
//   - Edge end points are joined when they agree to 0.001 mm. A component whose every vertex has exactly two edges
//     is a closed loop; pierces = closed loops - 1 (every loop but the outer contour needs a pierce).
//   - Net area = largest loop area - the other loop areas (shoelace), only when every outline component is a closed
//     loop; otherwise null (open geometry cannot be measured).

import type { DxfAnalysis } from './inline/dxf-parser';

export interface DxfMetrics {
  /** Bounding rectangle of the drawing (mm). */
  width_mm: number;
  height_mm: number;
  /** Net blank area (outer loop minus inner loops), null when the outline is not made of closed loops. */
  area_mm2: number | null;
  cut_length_mm: number;
  /** Closed loops - 1; null when no closed loop exists. */
  pierces: number | null;
  closed_loops: number;
  open_components: number;
  bend_lines: number;
}

interface Segment {
  a: string;
  b: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

const SNAP = 1000; // 0.001 mm

function key(x: number, y: number): string {
  return `${Math.round(x * SNAP)},${Math.round(y * SNAP)}`;
}

function round(n: number, places = 3): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** Shoelace area of a closed vertex ring (absolute value). */
export function ringArea(points: ReadonlyArray<{ x: number; y: number }>): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    sum += p.x * q.y - q.x * p.y;
  }
  return Math.abs(sum) / 2;
}

export function dxfMetrics(a: Pick<DxfAnalysis, 'edges' | 'bendLines' | 'dimensions'>): DxfMetrics {
  const segments: Segment[] = [];
  let cut = 0;
  for (const e of a.edges) {
    const length = Math.hypot(e.x2 - e.x1, e.y2 - e.y1);
    if (!Number.isFinite(length)) continue;
    cut += length;
    const ka = key(e.x1, e.y1);
    const kb = key(e.x2, e.y2);
    if (ka === kb) continue;
    segments.push({ a: ka, b: kb, ax: e.x1, ay: e.y1, bx: e.x2, by: e.y2 });
  }

  // Adjacency and connected components (union-find over vertex keys).
  const neighbours = new Map<string, string[]>();
  const coords = new Map<string, { x: number; y: number }>();
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r) as string;
    let c = k;
    while (parent.get(c) !== r) {
      const next = parent.get(c) as string;
      parent.set(c, r);
      c = next;
    }
    return r;
  };
  const addVertex = (k: string, x: number, y: number) => {
    if (!parent.has(k)) {
      parent.set(k, k);
      neighbours.set(k, []);
      coords.set(k, { x, y });
    }
  };
  for (const s of segments) {
    addVertex(s.a, s.ax, s.ay);
    addVertex(s.b, s.bx, s.by);
    (neighbours.get(s.a) as string[]).push(s.b);
    (neighbours.get(s.b) as string[]).push(s.a);
    const ra = find(s.a);
    const rb = find(s.b);
    if (ra !== rb) parent.set(ra, rb);
  }

  const components = new Map<string, string[]>();
  for (const k of parent.keys()) {
    const r = find(k);
    const list = components.get(r) ?? [];
    list.push(k);
    components.set(r, list);
  }

  const areas: number[] = [];
  let open = 0;
  for (const vertices of components.values()) {
    const closed = vertices.every((v) => (neighbours.get(v) as string[]).length === 2);
    if (!closed) {
      open++;
      continue;
    }
    // Walk the ring from its first vertex.
    const ring: Array<{ x: number; y: number }> = [];
    const start = vertices[0];
    let previous: string | null = null;
    let current = start;
    for (let guard = 0; guard <= vertices.length; guard++) {
      ring.push(coords.get(current) as { x: number; y: number });
      const [n1, n2] = neighbours.get(current) as string[];
      const next: string = n1 !== previous ? n1 : n2;
      previous = current;
      current = next;
      if (current === start) break;
    }
    areas.push(ringArea(ring));
  }

  const closedLoops = areas.length;
  let area: number | null = null;
  if (closedLoops > 0 && open === 0) {
    const sorted = [...areas].sort((x, y) => y - x);
    area = round(sorted[0] - sorted.slice(1).reduce((s, v) => s + v, 0), 2);
  }

  return {
    width_mm: round(a.dimensions.x),
    height_mm: round(a.dimensions.z),
    area_mm2: area,
    cut_length_mm: round(cut, 2),
    pierces: closedLoops > 0 ? closedLoops - 1 : null,
    closed_loops: closedLoops,
    open_components: open,
    bend_lines: a.bendLines.length,
  };
}
