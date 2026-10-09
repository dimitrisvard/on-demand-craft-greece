// leads-api (Supabase edge function) accepts only a signed-in staff user's access token from P6-4 on
// (supabase/functions/leads-api/staff-auth.ts). Its one browser caller must send the session token, never the
// public anon key, as the Bearer. The request shape stays compatible with the function version deployed today, so
// this change merges first and the function is deployed afterwards (docs/migration/PLAN.md P6-4).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

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

describe('leads-api callers', () => {
  it('only LeadMonitorPage calls leads-api', () => {
    const root = repoRoot();
    const callers = sourceFiles(join(root, 'src'))
      .filter((file) => readFileSync(file, 'utf8').includes('functions/v1/leads-api'))
      .map((file) => relative(root, file));
    expect(callers).toEqual(['src/pages/dashboard/LeadMonitorPage.tsx']);
  });

  it('every leads-api fetch sends the session token through leadsApiHeaders, never the anon key as Bearer', () => {
    const page = readFileSync(join(repoRoot(), 'src/pages/dashboard/LeadMonitorPage.tsx'), 'utf8');
    const calls = [...page.matchAll(/fetch\(\s*`\$\{supabaseUrl\}\/functions\/v1\/leads-api[\s\S]*?\n\s*\);/g)].map((m) => m[0]);
    expect(calls.length).toBe(3);
    for (const call of calls) {
      expect(call).toMatch(/headers: await leadsApiHeaders\(/);
      expect(call).not.toMatch(/Bearer \$\{supabaseKey\}/);
    }
    expect(page).toMatch(/import \{ apiAuthHeaders \} from "@\/utils\/apiAuth";/);
    expect(page).toMatch(/async function leadsApiHeaders\([^)]*\)[^{]*\{\n\s+return \{ apikey: import\.meta\.env\.VITE_SUPABASE_ANON_KEY, \.\.\.\(await apiAuthHeaders\(\)\), \.\.\.extra \};/);
  });
});
