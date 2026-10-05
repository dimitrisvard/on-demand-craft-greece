// Builders of CadResultV1 (stored as cad/<job_id>/output/result.json and in cad_jobs.result) from the unfold
// service's X-Part-* headers plus the in-Worker DXF metrics, and from the inline parsers.
//
// Rules
//   - Units are millimetres; numbers are rounded to 0.001 mm (areas and volumes to 0.01).
//   - A header that is missing, not a finite number or negative reads as unknown (null), never as 0.
//   - warnings: at most 20 strings of at most 200 characters (service warnings are data, not instructions).

import type { DxfAnalysis } from './inline/dxf-parser';
import type { MeshAnalysis } from './inline/mesh-analyzer';
import type { DxfMetrics } from './dxf-metrics';
import type { CadKind, CadResultV1 } from './types';

export const MAX_WARNINGS = 20;
export const WARNING_MAX_CHARS = 200;

function round(n: number, places = 3): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

function positive(n: unknown): number | null {
  const v = typeof n === 'string' ? Number(n.trim()) : n;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

/** Bounded warning list (deduplicated, in order). */
export function boundedWarnings(list: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const w of list) {
    if (typeof w !== 'string' || w.trim() === '') continue;
    const text = w.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, WARNING_MAX_CHARS);
    if (!out.includes(text)) out.push(text);
    if (out.length >= MAX_WARNINGS) break;
  }
  return out;
}

/** The X-Part-* metadata of an unfold answer (sheet-metal-service/main.py:273-280). */
export interface UnfoldHeaders {
  thickness_mm: number | null;
  flat_width_mm: number | null;
  flat_height_mm: number | null;
  num_bends: number | null;
  warnings: string[];
}

export function parseUnfoldHeaders(h: Headers): UnfoldHeaders {
  let warnings: string[] = [];
  const raw = h.get('X-Part-Warnings');
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      warnings = boundedWarnings(Array.isArray(parsed) ? parsed : [String(parsed)]);
    } catch {
      warnings = ['unfold_warnings_unreadable'];
    }
  }
  const bends = positive(h.get('X-Part-Num-Bends'));
  return {
    thickness_mm: positive(h.get('X-Part-Thickness')),
    flat_width_mm: positive(h.get('X-Part-Flat-Width')),
    flat_height_mm: positive(h.get('X-Part-Flat-Height')),
    num_bends: bends === null ? null : Math.round(bends),
    warnings,
  };
}

/** Result of a STEP sheet-metal job of the unfold service (metrics from its flat.dxf when available). */
export function resultFromUnfold(h: UnfoldHeaders, metrics: DxfMetrics | null, o: { warnings?: string[]; duration_ms: number; versions: Record<string, string> }): CadResultV1 {
  const width = h.flat_width_mm ?? metrics?.width_mm ?? null;
  const height = h.flat_height_mm ?? metrics?.height_mm ?? null;
  const bendCount = h.num_bends ?? metrics?.bend_lines ?? null;
  return {
    v: 1,
    kind: 'step',
    source: 'unfold-service',
    units: 'mm',
    thickness_mm: h.thickness_mm === null ? null : round(h.thickness_mm),
    flat:
      width !== null && height !== null
        ? {
            width_mm: round(width),
            height_mm: round(height),
            area_mm2: metrics?.area_mm2 ?? null,
            cut_length_mm: metrics?.cut_length_mm ?? null,
            pierces: metrics?.pierces ?? null,
          }
        : null,
    bends: bendCount === null ? null : { count: bendCount, items: [] },
    bbox_mm: null,
    volume_mm3: null,
    warnings: boundedWarnings([...h.warnings, ...(o.warnings ?? [])]),
    versions: o.versions,
    duration_ms: Math.max(0, Math.round(o.duration_ms)),
  };
}

/** Result of a DXF flat pattern (inline): the drawing is the flat; thickness comes from the RFQ, not the file. */
export function resultFromDxf(a: Pick<DxfAnalysis, 'bendLines'>, metrics: DxfMetrics, o: { warnings?: string[]; duration_ms: number; versions: Record<string, string> }): CadResultV1 {
  const warnings = [...(o.warnings ?? [])];
  if (metrics.open_components > 0) warnings.push('dxf_open_outline');
  if (a.bendLines.length > 0) warnings.push('dxf_bend_angles_assumed_90');
  return {
    v: 1,
    kind: 'dxf',
    source: 'inline-ts',
    units: 'mm',
    thickness_mm: null,
    flat: {
      width_mm: metrics.width_mm,
      height_mm: metrics.height_mm,
      area_mm2: metrics.area_mm2,
      cut_length_mm: metrics.cut_length_mm,
      pierces: metrics.pierces,
    },
    bends: { count: a.bendLines.length, items: a.bendLines.map((b) => ({ angle_deg: b.angle, radius_mm: null })) },
    bbox_mm: null,
    volume_mm3: null,
    warnings: boundedWarnings(warnings),
    versions: o.versions,
    duration_ms: Math.max(0, Math.round(o.duration_ms)),
  };
}

/**
 * Result of an STL or CNC STEP model (inline): bounding box and volume; detected bend lines only as a warning. The
 * text STEP parser reports the bounding-box volume, not the solid's, so a STEP result has volume_mm3 null.
 */
export function resultFromMesh(kind: Extract<CadKind, 'stl' | 'step'>, m: Pick<MeshAnalysis, 'dimensions' | 'volume' | 'bendLines'>, o: { warnings?: string[]; duration_ms: number; versions: Record<string, string> }): CadResultV1 {
  const warnings = [...(o.warnings ?? [])];
  if (m.bendLines.length > 0) warnings.push(`bend_lines_detected:${m.bendLines.length}`);
  if (kind === 'step') warnings.push('step_volume_not_measured');
  const volume = kind === 'step' ? null : positive(m.volume);
  return {
    v: 1,
    kind,
    source: 'inline-ts',
    units: 'mm',
    thickness_mm: null,
    flat: null,
    bends: null,
    bbox_mm: { x: round(Math.abs(m.dimensions.x)), y: round(Math.abs(m.dimensions.y)), z: round(Math.abs(m.dimensions.z)) },
    volume_mm3: volume === null || volume === 0 ? null : round(volume, 2),
    warnings: boundedWarnings(warnings),
    versions: o.versions,
    duration_ms: Math.max(0, Math.round(o.duration_ms)),
  };
}

function isNumOrNull(v: unknown): boolean {
  return v === null || (typeof v === 'number' && Number.isFinite(v));
}

/** Shape check of a stored result (cad_jobs.result is jsonb written by this module; anything else is ignored). */
export function isCadResultV1(x: unknown): x is CadResultV1 {
  if (typeof x !== 'object' || x === null) return false;
  const r = x as Record<string, unknown>;
  if (r.v !== 1 || r.units !== 'mm' || !['step', 'stl', 'dxf', 'other'].includes(String(r.kind))) return false;
  if (!isNumOrNull(r.thickness_mm) || !isNumOrNull(r.volume_mm3)) return false;
  if (r.flat !== null) {
    const f = r.flat as Record<string, unknown> | undefined;
    if (!f || typeof f.width_mm !== 'number' || typeof f.height_mm !== 'number') return false;
    if (!isNumOrNull(f.area_mm2) || !isNumOrNull(f.cut_length_mm) || !isNumOrNull(f.pierces)) return false;
  }
  if (r.bends !== null) {
    const b = r.bends as Record<string, unknown> | undefined;
    if (!b || typeof b.count !== 'number' || !Array.isArray(b.items)) return false;
  }
  if (r.bbox_mm !== null) {
    const b = r.bbox_mm as Record<string, unknown> | undefined;
    if (!b || typeof b.x !== 'number' || typeof b.y !== 'number' || typeof b.z !== 'number') return false;
  }
  return Array.isArray(r.warnings);
}
