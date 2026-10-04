// Every same-origin /api/* call in the SPA goes through the helpers that add the
// session token (fetchWithAuth, openWithAuth, downloadWithAuth, callS3, apiCall)
// or the Turnstile token (fetchWithTurnstile). This guard fails when a caller
// starts using a bare fetch() or window.open() on an /api path again.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/** Repository root, from this test file's own path (<root>/tests/frontend-api/). */
function repoRoot(): string {
  const testPath = expect.getState().testPath;
  if (!testPath) throw new Error('test path unknown');
  return resolve(testPath, '../../..');
}

/** Callers that are not routed or never imported (no request reaches /api from them). */
const UNROUTED = new Set(['src/pages/Contact.tsx', 'src/components/quote-form/MicronsMultiStepForm.tsx']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const BARE_API_CALL = /\b(?:fetch|window\.open)\(\s*[`'"]\/api\b/;

describe('/api callers', () => {
  it('never call an /api path with a bare fetch() or window.open()', () => {
    const root = repoRoot();
    const offenders: string[] = [];
    const files = sourceFiles(join(root, 'src'));
    expect(files.length).toBeGreaterThan(100);
    for (const file of files) {
      const rel = relative(root, file);
      if (UNROUTED.has(rel)) continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (BARE_API_CALL.test(line)) offenders.push(`${rel}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it('send the session token, never the public anon key, as the Bearer of the funded-startups calls', () => {
    const page = readFileSync(join(repoRoot(), 'src/pages/dashboard/FundedStartupsPage.tsx'), 'utf8');
    expect(page).not.toMatch(/VITE_SUPABASE_ANON_KEY/);
    expect(page).not.toMatch(/Authorization:\s*`Bearer/);
    expect(page).toMatch(/fetchWithAuth\(/);
    expect(page).toMatch(/downloadWithAuth\(/);
  });

  it('offer "Sign in again" on the RFQ page after a 401', () => {
    const page = readFileSync(join(repoRoot(), 'src/pages/RfqDetails.tsx'), 'utf8');
    expect(page).toMatch(/const apiUnauthorized = useApiUnauthorized\(\);/);
    expect(page).toMatch(/\{apiUnauthorized && \(/);
    expect(page).toMatch(/to=\{`\/login\?returnTo=/);
  });

  it('pass the quote form Turnstile token to the RFQ mail and keep the widget inside the form', () => {
    const form = readFileSync(join(repoRoot(), 'src/components/quote-form/MultiStepQuoteForm.tsx'), 'utf8');
    expect(form).toMatch(/<TurnstileWidget ref=\{turnstileRef\} action="quote"/);
    expect(form).toMatch(/turnstile \? \(\) => turnstile\.getToken\(\) : undefined\);/);
    expect(form).toMatch(/finally \{\s*turnstile\?\.reset\(\);/);
    const formStart = form.indexOf('<Form>');
    const formEnd = form.indexOf('</Form>');
    const widgetAt = form.indexOf('<TurnstileWidget ref=');
    expect(widgetAt).toBeGreaterThan(formStart);
    expect(widgetAt).toBeLessThan(formEnd);
  });

  it('open inventory labels through a button, not a plain link', () => {
    for (const rel of ['components/inventory/SessionCompletionModal.tsx', 'pages/inventory/QRScanner.tsx']) {
      const source = readFileSync(join(repoRoot(), 'src', rel), 'utf8');
      expect(source).not.toMatch(/<a\s+href=\{getLabelUrl/);
      expect(source).toMatch(/openWithAuth\(getLabelUrl\(/);
    }
  });
});
