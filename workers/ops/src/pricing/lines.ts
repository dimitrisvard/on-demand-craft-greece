// Quote lines before pricing: one line per part of rfqs.parts_details, with the part's process, material, thickness,
// finish and tolerance as the web form or the intake wrote them, its files (rfq_files.part_id) and the geometry of
// their CAD 'analyse' jobs. Also the normalised line text embedded for similar-quote retrieval.
//
// Rules
//   - Parts the agent added itself (original_values.source 'quote_surcharge') are not quote lines.
//   - Files: the part's rfq_files rows; when the RFQ has exactly one part, files without a part also belong to it.
//   - Geometry: the first succeeded analyse job of the part's files whose result fits the process (a flat pattern for
//     sheet metal, a bounding box and volume for CNC); otherwise the reason it is missing: 'cad_pending' (a job is not
//     final yet), 'inline_too_large' (the file is above its inline cap), 'cad_failed' or 'geometry_missing' (no file
//     stored in R2: files only in the legacy store are never fetched).
//   - Process: the part's own process (web form values such as 'sheet-metal', 'laser-cutting', 'cnc-machining';
//     intake values 'sheet_metal', 'cnc'); 'mixed' or unknown is decided by the geometry (flat pattern -> sheet metal,
//     solid -> CNC), else 'other' (priced by hand).
//   - Thickness: the CAD result's thickness, else the part's thickness value or its 'Thickness: <n> mm' line.
//   - The embedded text carries technical fields only (no customer, company or file name).

import { cadKindOf, isFinalCadStatus, type CadResultV1 } from '../cad/types';
import { recogniseMaterial } from './materials';
import type { LineInput, LineProcess, QuoteProcess } from './types';

/** A part of rfqs.parts_details as read for pricing. */
export interface PartRow {
  id?: string | null;
  product_name?: string | null;
  description?: string | null;
  quantity?: number | string | null;
  unit_price?: number | string | null;
  total_price?: number | string | null;
  original_values?: Record<string, unknown> | null;
  [key: string]: unknown;
}

/** rfq_files columns used for pricing. */
export interface FileRow {
  id: string;
  file_name: string;
  part_id: string | null;
  r2_key: string | null;
  sha256: string | null;
  content_type: string | null;
  file_type?: string | null;
  file_size?: number | null;
}

/** cad_jobs columns used for pricing. */
export interface JobRow {
  id: string;
  rfq_file_id: string | null;
  job_type: string;
  status: string;
  result: CadResultV1 | null;
  error: string | null;
}

export const SURCHARGE_SOURCE = 'quote_surcharge';

const SHEET_PROCESSES = new Set(['sheet-metal', 'sheet_metal', 'sheet metal', 'laser-cutting', 'laser_cutting', 'plasma-cutting', 'bending', 'sheetmetal']);
const CNC_PROCESSES = new Set(['cnc', 'cnc-machining', 'cnc_machining', 'cnc-milling', 'cnc_milling', 'milling', 'turning', 'cnc-turning']);

function str(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function numberFrom(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const m = /-?\d+(?:[.,]\d+)?/.exec(v);
  return m ? Number(m[0].replace(',', '.')) : null;
}

/** Value of a 'Label: value' line of a part description. */
function descriptionField(description: string, label: string): string | null {
  const re = new RegExp(`^\\s*${label}\\s*:\\s*(.+?)\\s*$`, 'im');
  return re.exec(description)?.[1] ?? null;
}

export function isSurchargePart(p: PartRow): boolean {
  return (p.original_values ?? {})['source'] === SURCHARGE_SOURCE;
}

/** The process a part asks for, or null when it does not say (or says 'mixed'). */
export function partProcess(p: PartRow): LineProcess | null {
  const ov = p.original_values ?? {};
  const raw = (str(ov['process']) ?? descriptionField(String(p.description ?? ''), 'Process') ?? '').toLowerCase();
  if (!raw || raw === 'mixed' || raw === 'unknown') return null;
  if (SHEET_PROCESSES.has(raw) || /sheet|laser|bend|plasma/.test(raw)) return 'sheet_metal';
  if (CNC_PROCESSES.has(raw) || /cnc|mill|turn/.test(raw)) return 'cnc';
  return 'other';
}

function materialText(p: PartRow): string {
  const ov = p.original_values ?? {};
  const label = str(ov['materialLabel']) ?? str(ov['material']);
  const subtype = str(ov['materialSubtypeLabel']) ?? str(ov['materialSubtype']);
  if (label) return subtype ? `${label} (${subtype})` : label;
  return descriptionField(String(p.description ?? ''), 'Material') ?? '';
}

function finishCode(p: PartRow): string | null {
  const ov = p.original_values ?? {};
  let raw = str(ov['surfaceTreatment']) ?? str(ov['finish']);
  if (raw === 'other') raw = str(ov['surfaceTreatmentOther']);
  if (!raw || /^(none|no|-|n\/a)$/i.test(raw)) return null;
  const code = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return code || null;
}

function partThickness(p: PartRow): number | null {
  const ov = p.original_values ?? {};
  const t = numberFrom(ov['thickness']) ?? numberFrom(descriptionField(String(p.description ?? ''), 'Thickness'));
  return t !== null && t > 0 ? t : null;
}

function fitsProcess(r: CadResultV1 | null, process: LineProcess | null): boolean {
  if (!r) return false;
  const hasFlat = r.flat !== null && r.flat.width_mm > 0 && r.flat.height_mm > 0;
  const hasSolid = r.bbox_mm !== null && r.volume_mm3 !== null && r.volume_mm3 > 0;
  if (process === 'sheet_metal') return hasFlat;
  if (process === 'cnc') return hasSolid;
  return hasFlat || hasSolid;
}

/** Files of each part (see the rules above). */
export function filesByPart(parts: readonly PartRow[], files: readonly FileRow[]): Map<string, FileRow[]> {
  const out = new Map<string, FileRow[]>();
  const ids = parts.map((p) => String(p.id ?? ''));
  for (const id of ids) out.set(id, []);
  for (const f of files) {
    const target = f.part_id && out.has(f.part_id) ? f.part_id : !f.part_id && ids.length === 1 ? ids[0] : null;
    if (target !== null) out.get(target)?.push(f);
  }
  return out;
}

/** CAD files of the RFQ that the agent can analyse (stored in R2, a CAD kind). */
export function analysableFiles(files: readonly FileRow[]): FileRow[] {
  return files.filter((f) => f.r2_key !== null && f.r2_key !== '' && cadKindOf(f.file_name, f.content_type ?? f.file_type ?? '') !== 'other');
}

/** The lines of a quote (see the rules above). */
export function buildLines(o: { parts: readonly PartRow[]; files: readonly FileRow[]; jobs: readonly JobRow[]; quoteProcess?: QuoteProcess | null }): LineInput[] {
  const parts = o.parts.filter((p) => !isSurchargePart(p));
  const byPart = filesByPart(parts, o.files);
  const analyse = o.jobs.filter((j) => j.job_type === 'analyse');
  return parts.map((p, i) => {
    const partFiles = byPart.get(String(p.id ?? '')) ?? [];
    const fileIds = new Set(partFiles.map((f) => f.id));
    const jobs = analyse.filter((j) => j.rfq_file_id !== null && fileIds.has(j.rfq_file_id));
    let process = partProcess(p);
    if (process === null && (o.quoteProcess === 'sheet_metal' || o.quoteProcess === 'cnc')) process = o.quoteProcess;
    const succeeded = jobs.filter((j) => j.status === 'succeeded' && j.result);
    let job = succeeded.find((j) => fitsProcess(j.result, process)) ?? null;
    if (!job && process === null) job = succeeded[0] ?? null;
    const geometry = job?.result ?? null;
    if (process === null) {
      if (geometry?.flat) process = 'sheet_metal';
      else if (geometry?.bbox_mm && geometry.volume_mm3) process = 'cnc';
      else process = 'other';
    }
    let geometry_problem: string | null = null;
    if (!geometry) {
      if (jobs.some((j) => !isFinalCadStatus(j.status))) geometry_problem = 'cad_pending';
      else if (jobs.some((j) => /inline_too_large/.test(j.error ?? ''))) geometry_problem = 'inline_too_large';
      else if (jobs.length > 0) geometry_problem = 'cad_failed';
      else geometry_problem = 'geometry_missing';
    }
    const material_text = materialText(p);
    const recognised = recogniseMaterial(material_text);
    const quantity = numberFrom(p.quantity);
    const ov = p.original_values ?? {};
    return {
      line_no: i + 1,
      part_id: str(p.id),
      product_name: str(p.product_name) ?? `Part ${i + 1}`,
      description: String(p.description ?? ''),
      qty: quantity !== null && Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 0,
      process,
      material_text,
      grade: recognised.grade,
      family: recognised.family,
      thickness_mm: geometry?.thickness_mm && geometry.thickness_mm > 0 ? geometry.thickness_mm : partThickness(p),
      finish_code: finishCode(p),
      tolerance: str(ov['toleranceLabel']) ?? str(ov['tolerance']) ?? descriptionField(String(p.description ?? ''), 'Tolerance'),
      geometry,
      cad_job_id: job?.id ?? null,
      geometry_problem,
      files: partFiles.map((f) => f.file_name),
    };
  });
}

function fmt(n: number | null | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? String(Math.round(n * 10) / 10) : '-';
}

/** Text embedded for a line (technical fields only). */
export function lineEmbeddingText(l: LineInput): string {
  const g = l.geometry;
  return [
    `process=${l.process}`,
    `material=${l.family ?? 'unknown'} ${l.grade ?? ''}`.trimEnd(),
    `thickness_mm=${fmt(l.thickness_mm)}`,
    `qty=${l.qty}`,
    `flat_mm=${g?.flat ? `${fmt(g.flat.width_mm)}x${fmt(g.flat.height_mm)}` : '-'}`,
    `bends=${g?.bends ? g.bends.count : '-'}`,
    `cut_mm=${fmt(g?.flat?.cut_length_mm)}`,
    `bbox_mm=${g?.bbox_mm ? `${fmt(g.bbox_mm.x)}x${fmt(g.bbox_mm.y)}x${fmt(g.bbox_mm.z)}` : '-'}`,
    `finish=${l.finish_code ?? 'none'}`,
    `tolerance=${l.tolerance ?? '-'}`,
  ].join('; ');
}
