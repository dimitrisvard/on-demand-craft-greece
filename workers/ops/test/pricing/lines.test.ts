// Quote lines from rfqs.parts_details, rfq_files and cad_jobs: process, material, thickness and finish from the web
// form and intake shapes, files per part, geometry choice and the reason geometry is missing; the embedded text.
import { describe, expect, it } from 'vitest';
import type { CadResultV1 } from '../../src/cad/types';
import { analysableFiles, buildLines, lineEmbeddingText, partProcess, type FileRow, type JobRow, type PartRow } from '../../src/pricing/lines';

const flat: CadResultV1 = {
  v: 1, kind: 'step', source: 'unfold-service', units: 'mm', thickness_mm: 2,
  flat: { width_mm: 200, height_mm: 100, area_mm2: 18000, cut_length_mm: 700, pierces: 2 },
  bends: { count: 2, items: [] }, bbox_mm: null, volume_mm3: null, warnings: [], versions: {}, duration_ms: 1,
};
const solid: CadResultV1 = { ...flat, source: 'inline-ts', thickness_mm: null, flat: null, bends: null, bbox_mm: { x: 50, y: 40, z: 20 }, volume_mm3: 30000 };

function webPart(id: string, over: Record<string, unknown> = {}): PartRow {
  return {
    id,
    product_name: 'Part 1',
    description: 'Process: Sheet Metal\nMaterial: Steel (S235JR)\n\nThickness: 3 mm\n',
    quantity: 20,
    unit_price: 0,
    total_price: 0,
    original_values: { process: 'sheet-metal', materialLabel: 'Steel', materialSubtypeLabel: 'S235JR', thickness: '3', surfaceTreatment: 'powder-coating', toleranceLabel: 'ISO 2768-m', ...over },
  };
}

const file = (id: string, part_id: string | null, name: string, r2 = true): FileRow => ({ id, file_name: name, part_id, r2_key: r2 ? `rfq/r/${id}-${name}` : null, sha256: r2 ? 'a'.repeat(64) : null, content_type: null });
const job = (id: string, rfq_file_id: string, status: string, result: CadResultV1 | null, error: string | null = null): JobRow => ({ id, rfq_file_id, job_type: 'analyse', status, result, error });

describe('buildLines', () => {
  it('web-form part with a STEP file: sheet metal, grade from the subtype, CAD thickness wins, finish code', () => {
    const [l] = buildLines({ parts: [webPart('p1')], files: [file('f1', 'p1', 'bracket.step')], jobs: [job('j1', 'f1', 'succeeded', flat)] });
    expect(l).toMatchObject({ line_no: 1, part_id: 'p1', qty: 20, process: 'sheet_metal', grade: 'S235JR', family: 'steel', thickness_mm: 2, finish_code: 'powder_coating', tolerance: 'ISO 2768-m', cad_job_id: 'j1', geometry_problem: null, files: ['bracket.step'] });
  });

  it('thickness from the part when the geometry has none; description lines are read when original_values are absent', () => {
    const part: PartRow = { id: 'p1', product_name: 'Part 1', description: 'Process: Laser Cutting\nMaterial: 1.4301\nThickness: 1,5 mm', quantity: '4' };
    const [l] = buildLines({ parts: [part], files: [], jobs: [] });
    expect(l).toMatchObject({ process: 'sheet_metal', grade: 'AISI 304', thickness_mm: 1.5, qty: 4, geometry_problem: 'geometry_missing', finish_code: null });
  });

  it('files without a part belong to the only part; with two parts they belong to none', () => {
    const files = [file('f1', null, 'a.dxf')];
    expect(buildLines({ parts: [webPart('p1')], files, jobs: [] })[0].files).toEqual(['a.dxf']);
    const two = buildLines({ parts: [webPart('p1'), webPart('p2')], files, jobs: [] });
    expect(two.map((l) => l.files)).toEqual([[], []]);
  });

  it('geometry problems: pending, inline_too_large, failed, legacy-only file', () => {
    const parts = [webPart('p1')];
    expect(buildLines({ parts, files: [file('f1', 'p1', 'a.step')], jobs: [job('j1', 'f1', 'running', null)] })[0].geometry_problem).toBe('cad_pending');
    expect(buildLines({ parts, files: [file('f1', 'p1', 'a.stl')], jobs: [job('j1', 'f1', 'failed', null, 'too_large: inline_too_large')] })[0].geometry_problem).toBe('inline_too_large');
    expect(buildLines({ parts, files: [file('f1', 'p1', 'a.step')], jobs: [job('j1', 'f1', 'timed_out', null, 'timeout: x')] })[0].geometry_problem).toBe('cad_failed');
    expect(buildLines({ parts, files: [file('f1', 'p1', 'a.step', false)], jobs: [] })[0].geometry_problem).toBe('geometry_missing');
  });

  it('chooses the result that fits the process; mixed or unknown is decided by the geometry', () => {
    const files = [file('f1', 'p1', 'a.stl'), file('f2', 'p1', 'a.dxf')];
    const jobs = [job('j1', 'f1', 'succeeded', solid), job('j2', 'f2', 'succeeded', flat)];
    expect(buildLines({ parts: [webPart('p1')], files, jobs })[0].cad_job_id).toBe('j2');
    expect(buildLines({ parts: [webPart('p1', { process: 'cnc-machining' })], files, jobs })[0]).toMatchObject({ process: 'cnc', cad_job_id: 'j1' });
    const mixed = webPart('p1', { process: 'mixed' });
    expect(buildLines({ parts: [mixed], files: [files[0]], jobs: [jobs[0]] })[0].process).toBe('cnc');
    expect(buildLines({ parts: [mixed], files: [], jobs: [] })[0].process).toBe('other');
    expect(buildLines({ parts: [mixed], files: [], jobs: [], quoteProcess: 'sheet_metal' })[0].process).toBe('sheet_metal');
  });

  it("skips the agent's own surcharge part", () => {
    const parts = [webPart('p1'), { id: 's1', product_name: 'Minimum order surcharge', quantity: 1, original_values: { source: 'quote_surcharge' } }];
    expect(buildLines({ parts, files: [], jobs: [] })).toHaveLength(1);
  });

  it('maps web form and intake process values', () => {
    const p = (process: string) => partProcess({ original_values: { process } });
    expect(['sheet-metal', 'laser-cutting', 'sheet_metal'].map(p)).toEqual(['sheet_metal', 'sheet_metal', 'sheet_metal']);
    expect(['cnc-machining', 'turning', 'cnc'].map(p)).toEqual(['cnc', 'cnc', 'cnc']);
    expect(['3d-printing', 'casting'].map(p)).toEqual(['other', 'other']);
    expect(['mixed', 'unknown', ''].map(p)).toEqual([null, null, null]);
  });
});

describe('analysable files and embedded text', () => {
  it('only R2-stored CAD kinds are analysed', () => {
    const files = [file('f1', null, 'a.step'), file('f2', null, 'b.pdf'), file('f3', null, 'c.stl', false), file('f4', null, 'd.DXF')];
    expect(analysableFiles(files).map((f) => f.id)).toEqual(['f1', 'f4']);
  });

  it('the embedded text carries technical fields only', () => {
    const [l] = buildLines({ parts: [webPart('p1', { comments: 'Example GmbH, ship to Berlin' })], files: [file('f1', 'p1', 'secret-customer-name.step')], jobs: [job('j1', 'f1', 'succeeded', flat)] });
    const text = lineEmbeddingText(l);
    expect(text).toBe('process=sheet_metal; material=steel S235JR; thickness_mm=2; qty=20; flat_mm=200x100; bends=2; cut_mm=700; bbox_mm=-; finish=powder_coating; tolerance=ISO 2768-m');
    expect(text).not.toMatch(/Example|secret|Berlin/);
  });
});
