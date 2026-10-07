import { describe, expect, it } from 'vitest';
import { DecidingStep, harness, runCase } from './harness';
import { FILE_1, RFQ_ID } from './seed';

describe('R8 flag switched off while the quote waits for CAD', () => {
  it('the instance still calls the model twice, renders the PDF and enqueues CAD work before it first re-reads the flag', async () => {
    const h = harness();
    h.ports.db.tables.cad_jobs.splice(0);
    h.ports.db.tables.rfq_files[0].sha256 = null;
    h.ports.db.tables.rfq_files[0].file_size = null;
    await h.bucket.put(`rfq/${RFQ_ID}/${FILE_1}-bracket.step`, 'ISO-10303-21;\nHEADER;\nENDSEC;\n');
    const step = new DecidingStep();
    let llmBefore = -1;
    step.hook = async (type) => {
      if (type === 'cad-done') {
        // owner kill switch during the 2-hour CAD wait
        h.kv.setJson('agent.quote', { enabled: false, value: {}, rev: 2 });
        llmBefore = h.llm.calls.length;
        step.sendEvent('cad-done', { jobs: [] });
      }
    };
    const { result } = await runCase(h, { step });
    const trace = step.trace();
    const parkAt = trace.indexOf('park-flag-approval:ok');
    console.log('llm calls before switch-off', llmBefore, 'after', h.llm.calls.length, '| trace after await-cad:', JSON.stringify(trace.slice(trace.indexOf('await-cad:ok'), parkAt + 1)));
    expect(llmBefore).toBe(0);
    expect(h.llm.calls.length).toBe(2);
    expect(parkAt).toBeGreaterThan(trace.indexOf('cover-email:ok'));
    expect(result.outcome).toBe('cancelled');
  });
});
