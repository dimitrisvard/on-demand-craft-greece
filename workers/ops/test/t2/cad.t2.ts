// CQ-5 / D-4: the CAD path in real workerd. A web-form RFQ with a sheet-metal STEP file in R2 and no CAD job; the
// quote instance 'quote-<rfq>-v1' (started through the Local Explorer) queues the 'analyse' job and waits for
// cad-done; the cad-jobs consumer runs it on the HTTP unfold backend against the stub (stubs/unfold.mjs):
//   - the stub's /api/v1/unfold is called once for the file, with X-API-Key = the harness's dummy value and exactly
//     the form fields of the unfold contract, the file sent as an upload
//   - R2 holds cad/<job>/output/flat.dxf (the stub's DXF) and result.json (CadResultV1 from the X-Part-* headers)
//   - cad_jobs.status = succeeded with both output keys and the result; the job's agent run succeeded
//   - RfqThread sends cad-done to the waiting quote instance: the quote leaves cad_pending long before its 2-hour
//     timeout and prices the line with the stub's geometry (no geometry reason on the line)
// What the quote does after pricing is Q-5's subject (test/t2/quote.t2.ts); here it has no model fixtures.

import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { part1, seedRows, TENANT } from '../quote/seed';
import { flagValue, globalUrls, r2Get, r2Put, restoreFlag, rows, seed, setFlag, sha256hex, startInstance, unfoldCalls, until, type Row } from '../quote/t2-helpers';

const U = globalUrls();
const RFQ = '7c1e5b2a-4d0f-4a8e-9b10-0000000004d4';
const PART = '7c1e5b2a-4d0f-4a8e-9b10-0000000004b1';
const FILE = '7c1e5b2a-4d0f-4a8e-9b10-0000000004c1';
const FILE_NAME = 'bracket-sheet.step';
const KEY = `rfq/${RFQ}/${FILE}-${FILE_NAME}`;
const INSTANCE = `quote-${RFQ}-v1`;
const STEP = new Uint8Array(readFileSync(new URL('../fixtures/cad/bracket-sheet.step', import.meta.url)));
const FLAT_DXF = new Uint8Array(readFileSync(new URL('../fixtures/cad/unfold-flat.dxf', import.meta.url)));
const STEP_SHA = sha256hex(STEP);
const GEOMETRY_REASONS = ['cad_pending', 'cad_failed', 'geometry_missing', 'inline_too_large', 'flat_size_missing'];

function rfqRow(): Row {
  const base = seedRows().rfqs[0];
  return { ...base, id: RFQ, rfq_number: 'RFQ-05102026-8', title: 'RFQ-05102026-8 - Example Metall GmbH', parts_details: [{ ...part1(), id: PART, rfq_id: RFQ }] };
}

function fileRow(): Row {
  return {
    id: FILE,
    rfq_id: RFQ,
    file_name: FILE_NAME,
    file_path: `${RFQ}/${FILE}-${FILE_NAME}`,
    file_type: 'application/step',
    file_size: STEP.byteLength,
    part_id: PART,
    source: 'web',
    r2_key: KEY,
    sha256: STEP_SHA,
    content_type: 'application/step',
    tenant_id: TENANT,
    created_at: '2026-10-04T08:00:00.000Z',
  };
}

const analyseCalls = async () => (await unfoldCalls(U)).filter((c) => c.path === '/api/v1/unfold' && c.file?.sha256 === STEP_SHA && c.fields?.output_format === 'dxf');

describe.skipIf(!U.site || !U.stub)('CAD analyse through the unfold stub (D-4)', () => {
  let savedFlag: string | null = null;

  beforeAll(async () => {
    savedFlag = await flagValue(U, 'agent.quote');
    await setFlag(U, 'agent.quote', { enabled: true, value: { mode: 'assist' }, rev: 20 });
    await r2Put(U, KEY, STEP);
    await seed(U, { rfqs: [rfqRow()], rfq_files: [fileRow()] });
  });

  // the flag goes back to what the run had before this file (other files read and sync the same key)
  afterAll(async () => {
    await restoreFlag(U, 'agent.quote', savedFlag);
  });

  it('analyse STEP: one unfold call with the dummy key, outputs in R2, job succeeded, cad-done to the waiting quote', async () => {
    const started = Date.now();
    await startInstance(U, 'quote', INSTANCE, { v: 1, rfq_id: RFQ, quote_version: 1, tenant_id: TENANT, trigger: 'dashboard' });

    // the quote queued exactly one analyse job for the file and waits for it
    const job = await until('the analyse job succeeded', async () => {
      const jobs = (await rows(U, 'cad_jobs')).filter((r) => r.rfq_id === RFQ && r.job_type === 'analyse');
      return jobs.length === 1 && ['succeeded', 'failed', 'timed_out', 'dead_letter'].includes(String(jobs[0].status)) ? jobs[0] : null;
    }, 90_000);
    expect(job).toMatchObject({ status: 'succeeded', rfq_file_id: FILE, input_r2_key: KEY, input_sha256: STEP_SHA, backend: 'vps', attempts: 1, tenant_id: TENANT });
    expect(job.params).toMatchObject({ material: 'steel', thickness_override: 2, k_factor_override: 0, drawing_size: 'A3', process: 'sheet_metal' });

    // one unfold call for the file, with the dummy key and the contract's form fields
    const calls = await analyseCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      api_key: 'expected',
      fields: { material: 'steel', thickness_override: '2', k_factor_override: '0', output_format: 'dxf', drawing_size: 'A3' },
      part_names: ['material', 'thickness_override', 'k_factor_override', 'output_format', 'drawing_size', 'file'],
      file: { filename: FILE_NAME, size: STEP.byteLength, sha256: STEP_SHA },
    });

    // outputs in R2 and on the row
    const id = String(job.id);
    expect(sorted(job.output_r2_keys as string[])).toEqual([`cad/${id}/output/flat.dxf`, `cad/${id}/output/result.json`]);
    expect(Buffer.from((await r2Get(U, `cad/${id}/output/flat.dxf`)) ?? new Uint8Array()).equals(Buffer.from(FLAT_DXF))).toBe(true);
    const stored = JSON.parse(Buffer.from((await r2Get(U, `cad/${id}/output/result.json`)) ?? new Uint8Array()).toString('utf8')) as Row;
    expect(stored).toMatchObject({ v: 1, kind: 'step', source: 'unfold-service', units: 'mm', thickness_mm: 2, flat: { width_mm: 180, height_mm: 120 }, bends: { count: 2 } });
    expect(job.result).toMatchObject({ flat: { width_mm: 180, height_mm: 120 }, bends: { count: 2 } });
    const cadRun = (await rows(U, 'agent_runs')).find((r) => r.agent === 'cad' && r.idempotency_key === id);
    expect(cadRun).toMatchObject({ status: 'succeeded', trigger: 'queue' });

    // RfqThread sent cad-done: the quote left the 2-hour CAD wait and priced the line with the stub's geometry
    const quote = await until('the quote past the CAD wait', async () => {
      const q = (await rows(U, 'quote_workflows')).find((r) => r.rfq_id === RFQ && r.quote_version === 1);
      return q && q.pricing && !['started', 'cad_pending'].includes(String(q.status)) ? q : null;
    }, 90_000);
    expect(Date.now() - started).toBeLessThan(10 * 60_000);
    expect(quote.workflow_instance_id).toBe(INSTANCE);
    const line = (quote.pricing as { lines: Array<{ manual_reasons: string[] }> }).lines[0];
    expect(line.manual_reasons.filter((r) => GEOMETRY_REASONS.includes(r))).toEqual([]);
    // still one analyse call (the quote's later drawing job asks for a PDF, not a DXF)
    expect(await analyseCalls()).toHaveLength(1);
  });
});

function sorted(list: string[]): string[] {
  return [...list].sort();
}
