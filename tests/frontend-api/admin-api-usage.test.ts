// Browser code runs with the public Supabase key only (src/integrations/supabase/client.ts), so it never calls
// the Supabase admin API (auth.admin.*); user administration belongs to server code holding the service key.
// Globals: describe/it/expect (tests/frontend-api/vitest.config.mjs).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/** Repository root, from this test file's own path (<root>/tests/frontend-api/). */
function repoRoot(): string {
  const testPath = expect.getState().testPath;
  if (!testPath) throw new Error('test path unknown');
  return resolve(testPath, '../../..');
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const ADMIN_API = /\bauth\s*\.\s*admin\b/;

describe('Supabase admin API', () => {
  it('browser code never calls the Supabase admin API', () => {
    const root = repoRoot();
    const files = sourceFiles(join(root, 'src'));
    expect(files.length).toBeGreaterThan(100);
    const hits: string[] = [];
    for (const file of files) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (ADMIN_API.test(line)) hits.push(`${relative(root, file)}:${i + 1}`);
        });
    }
    expect(hits).toEqual([]);
  });
});
