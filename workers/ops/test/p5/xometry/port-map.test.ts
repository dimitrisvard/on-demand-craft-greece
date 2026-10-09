// The test port of xometry-bot (PHASE5_SPEC X-4, xometry-cad §2.9): each of the 95 Python test functions is either
// ported (72; a TS test title starts with the Python name) or listed here as not applicable with its reason (23).
// The inventory is read from the Python files, so a new or renamed Python test fails this check until it is mapped.
// Also checks the repository-variable guard of .github/workflows/xometry-scan.yml (X-5).

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './helpers';

/** Python tests with no TypeScript counterpart, and why. */
const NOT_APPLICABLE: Readonly<Record<string, string>> = {
  // test_partner_client.py
  test_downloads_and_skips_existing: 'the Worker never downloads part files (XB_DOWNLOAD_FILES=0 in the Action, X-4)',
  test_counteroffer_mutation_not_implemented: 'counteroffer submission stays in the xometry-review edge function',
  // test_pipeline.py TestPricingPass: Playwright buyer pricing is not ported (Q8)
  test_not_confirmed_skips_quietly: 'buyer pricing not ported',
  test_prices_row: 'buyer pricing not ported',
  test_config_mismatch_goes_needs_review: 'buyer pricing not ported',
  test_pricing_error_sets_status: 'buyer pricing not ported',
  // test_review_api.py: the FastAPI review box; submit and skip run in xometry-review on Supabase (PLAN.md:392); the
  // guard math is covered by pricing.test.ts (TestSubmitGuard) and the golden submit_guard vectors
  test_health_is_open: 'review API not ported',
  test_pending_requires_token: 'review API not ported',
  test_submit_requires_token: 'review API not ported',
  test_empty_token_refused_at_startup: 'review API not ported',
  test_sorted_by_expiry_and_raw_omitted: 'review API not ported',
  test_statuses_filter: 'review API not ported',
  test_happy_path: 'review API not ported',
  test_double_submit_blocked: 'review API not ported',
  test_operator_can_edit_price_and_leadtime: 'review API not ported',
  test_guard_blocks_below_xometry_floor: 'review API not ported',
  test_guard_blocks_below_cost_floor: 'review API not ported',
  test_guard_blocks_early_leadtime: 'review API not ported',
  test_needs_review_requires_explicit_override: 'review API not ported',
  test_unpriced_row_needs_explicit_values: 'review API not ported',
  test_unknown_code_404: 'review API not ported',
  test_submitter_failure_parks_row_in_error: 'review API not ported',
  test_skip_then_terminal: 'review API not ported',
};

const PORTED_FILES = ['filters.test.ts', 'pricing.test.ts', 'models.test.ts', 'partner-client.test.ts', 'pipeline.test.ts'];

function pythonTests(): string[] {
  const dir = new URL('xometry-bot/tests/', REPO_ROOT);
  const names: string[] = [];
  for (const file of readdirSync(dir).filter((f) => /^test_.*\.py$/.test(f)).sort()) {
    for (const m of readFileSync(new URL(file, dir), 'utf8').matchAll(/^\s*def (test_\w+)\(/gm)) names.push(m[1]);
  }
  return names;
}

function portedTitles(): Set<string> {
  const names = new Set<string>();
  for (const file of PORTED_FILES) {
    const text = readFileSync(new URL(file, import.meta.url), 'utf8');
    for (const m of text.matchAll(/\bit(?:\.each\([\s\S]*?\))?\(\s*'(test_\w+)/g)) names.add(m[1]);
  }
  return names;
}

describe('port map of the Python test suite', () => {
  it('95 Python test functions = 72 ported + 23 not applicable, each name exactly once', () => {
    const python = pythonTests();
    expect(python).toHaveLength(95);
    expect(new Set(python).size).toBe(95);
    const ported = portedTitles();
    const na = new Set(Object.keys(NOT_APPLICABLE));
    for (const name of ported) expect(na.has(name), `${name} is both ported and not applicable`).toBe(false);
    for (const name of python) expect(ported.has(name) || na.has(name), `${name} is neither ported nor listed`).toBe(true);
    for (const name of [...ported, ...na]) expect(python, `${name} is not a Python test`).toContain(name);
    expect(ported.size).toBe(72);
    expect(na.size).toBe(23);
  });
});

describe('.github/workflows/xometry-scan.yml (X-5)', () => {
  const text = readFileSync(new URL('.github/workflows/xometry-scan.yml', REPO_ROOT), 'utf8');

  it('the job skips scheduled runs when the repository variable XOMETRY_SCAN_SCHEDULE is off', () => {
    expect(text).toMatch(/\njobs:\n {2}scan:\n(?: {4}#.*\n)* {4}if: github\.event_name != 'schedule' \|\| vars\.XOMETRY_SCAN_SCHEDULE != 'off'\n {4}runs-on: ubuntu-latest\n/);
  });

  it('keeps workflow_dispatch, the schedule and the scan step unchanged', () => {
    expect(text).toContain('  workflow_dispatch: {}\n');
    expect(text).toContain('    - cron: "0 6,8,10,12,14,16,18 * * *"\n');
    expect(text).toContain('        run: python -m xometry_bot.pipeline');
    expect(text.match(/^\s+if:/gm)).toHaveLength(4);
  });
});
