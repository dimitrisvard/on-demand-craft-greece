// K-3 rules of scripts/check-bundle.mjs on synthetic metafiles: the Phase 2 qrcode rule is kept; one copy each of
// pdf-lib, @supabase/supabase-js and zod; the required agent packages; no test/ or eval/ input; no T2-only var in the
// production wrangler.jsonc (which this test also reads).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface CheckBundle {
  T2_ONLY_VARS: string[];
  bundleProblems(meta: unknown): string[];
  phase4Problems(meta: unknown, config: unknown): string[];
  forbiddenVars(config: unknown): string[];
  packageOf(input: string): { name: string; root: string } | null;
  parseJsonc(text: string): Record<string, unknown>;
}

const SCRIPT: string = new URL('../../scripts/check-bundle.mjs', import.meta.url).href;
const mod = (await import(/* @vite-ignore */ SCRIPT)) as CheckBundle;

const input = (imports: Array<{ path: string; original?: string }> = []) => ({ bytes: 1, imports });
const qrcode = {
  'lib/inventory/labels.js': input([{ path: '../../node_modules/qrcode/lib/server.js', original: 'qrcode' }]),
  '../../node_modules/qrcode/lib/server.js': input([{ path: '../../node_modules/qrcode/lib/browser.js' }]),
};
const required = {
  'node_modules/@anthropic-ai/sdk/index.mjs': input(),
  '../../node_modules/postal-mime/src/postal-mime.js': input(),
  'node_modules/@pdf-lib/fontkit/dist/fontkit.es.js': input(),
  'node_modules/agents/dist/mcp/index.js': input(),
  'node_modules/zod/v4/index.js': input(),
  '../../node_modules/pdf-lib/es/index.js': input(),
  '../../node_modules/@supabase/supabase-js/dist/module/index.js': input(),
};

describe('check-bundle Phase 4 rules', () => {
  it('a complete bundle passes; the Phase 2 qrcode rule still applies', () => {
    const meta = { inputs: { ...qrcode, ...required, 'src/index.ts': input() } };
    expect(mod.bundleProblems(meta)).toEqual([]);
    expect(mod.phase4Problems(meta, { vars: { SITE_ORIGIN: 'x' } })).toEqual([]);
    expect(mod.bundleProblems({ inputs: { 'src/index.ts': input() } })).toEqual(['no qrcode import found (the inventory label code is missing from the bundle)']);
  });

  it('two copies of a single-copy package fail', () => {
    const meta = { inputs: { ...required, 'node_modules/agents/node_modules/zod/v4/index.js': input(), 'node_modules/pdf-lib/cjs/index.js': input() } };
    expect(mod.phase4Problems(meta, {})).toEqual([
      expect.stringMatching(/^pdf-lib is bundled 2 times/),
      expect.stringMatching(/^zod is bundled 2 times/),
    ]);
  });

  it('a missing required package fails; test/ and eval/ inputs fail; node_modules test folders do not', () => {
    const { 'node_modules/agents/dist/mcp/index.js': _agents, ...rest } = required;
    const meta = { inputs: { ...rest, 'test/helpers/memory-db.ts': input(), 'eval/run-eval.ts': input(), 'node_modules/foo/test/x.js': input() } };
    expect(mod.phase4Problems(meta, {})).toEqual(['agents is not in the bundle', 'test or eval input in the bundle: test/helpers/memory-db.ts', 'test or eval input in the bundle: eval/run-eval.ts']);
  });

  it('T2-only vars (and any *_API_BASE) are refused; the production wrangler.jsonc has none', () => {
    expect(mod.forbiddenVars({ vars: { AGENT_STUBS: 'llm', FOO_API_BASE: 'x', SITE_ORIGIN: 'y' } })).toEqual(['AGENT_STUBS', 'FOO_API_BASE']);
    expect(mod.T2_ONLY_VARS).toEqual(['AGENT_STUBS', 'AGENT_LLM_BASE_URL', 'RESEND_API_BASE', 'TELEGRAM_API_BASE', 'GMAIL_API_BASE', 'GOOGLE_TOKEN_URL']);
    const production = mod.parseJsonc(readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8'));
    expect(mod.forbiddenVars(production)).toEqual([]);
  });

  it('packageOf reads scoped and nested package roots', () => {
    expect(mod.packageOf('../../node_modules/@supabase/supabase-js/dist/x.js')).toEqual({ name: '@supabase/supabase-js', root: '../../node_modules/@supabase/supabase-js' });
    expect(mod.packageOf('node_modules/agents/node_modules/zod/v4/a.js')).toEqual({ name: 'zod', root: 'node_modules/agents/node_modules/zod' });
    expect(mod.packageOf('src/index.ts')).toBeNull();
  });
});
