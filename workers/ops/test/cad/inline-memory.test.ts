// Memory case of the inline CAD caps (CQ-1): the unchanged edge-function parsers (the inline copies equal them apart
// from their import lines, checked by the CQ-3 diff) parse synthetic worst-case inputs at twice each inline cap
// (STEP 10 MB, DXF 6 MB, binary STL 1.5 MB) under a 96 MB V8 heap, a stand-in for the 128 MB isolate. A control
// input far above the STL cap must fail under the same heap cap, so the limit is known to be in force.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { INLINE_CAPS, MB } from '../../src/cad/types';

const CHILD = fileURLToPath(new URL('./inline-memory.child.mjs', import.meta.url));
const HEAP_MB = 96;

function parseUnderCap(kind: 'step' | 'dxf' | 'stl', mib: number): { status: number | null; stdout: string } {
  const r = spawnSync(process.execPath, [`--max-old-space-size=${HEAP_MB}`, '--no-warnings', CHILD, kind, String(mib)], { encoding: 'utf8', timeout: 120_000 });
  return { status: r.status, stdout: r.stdout };
}

describe('inline parsers under a 96 MB heap', () => {
  for (const kind of ['step', 'dxf', 'stl'] as const) {
    const mib = (2 * INLINE_CAPS[kind]) / MB;
    it(`${kind.toUpperCase()} at twice its cap (${mib} MB) parses`, () => {
      const r = parseUnderCap(kind, mib);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain(`parsed ${kind}`);
    }, 120_000);
  }

  it('control: a binary STL of 4 MB runs out of memory under the same cap', () => {
    const r = parseUnderCap('stl', 4);
    expect(r.status).not.toBe(0);
  }, 120_000);
});
