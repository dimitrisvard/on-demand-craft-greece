import { describe, expect, it, vi } from 'vitest';
import { InlineBackend } from '../../src/cad/backends/inline';

const dxf = ['0', 'SECTION', '2', 'ENTITIES', '0', 'LINE', '8', 'Kunde erika.beispiel@example.de', '10', '0', '20', '0', '11', '100', '21', '0', '0', 'LINE', '8', 'OUTLINE', '10', '100', '20', '0', '11', '100', '21', '50', '0', 'ENDSEC', '0', 'EOF', ''].join('\n');

describe('R7 parser log lines', () => {
  it('an inline DXF job logs the layer names of the customer file, without the [microns-ops] prefix', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const bytes = new TextEncoder().encode(dxf);
    const job = { v: 1, job_id: 'j', job_type: 'analyse', params: { process: 'sheet_metal' } } as never;
    const out = await new InlineBackend().run(job, { fileName: 'part.dxf', kind: 'dxf', contentType: 'application/dxf', sizeBytes: bytes.byteLength, sha256: 'x', open: async () => bytes.buffer as ArrayBuffer }, new AbortController().signal);
    const lines = spy.mock.calls.map((c) => String(c[0]));
    spy.mockRestore();
    console.info('outcome ok:', out.ok, '| logged:', JSON.stringify(lines));
    expect(lines.some((l) => l.includes('erika.beispiel@example.de') && !l.startsWith('[microns-ops]'))).toBe(true);
  });
});
