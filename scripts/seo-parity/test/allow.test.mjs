import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { startSite, tmpDir, writeUrls, writeAllow, run, diffsOf, FIXTURE_ENTRIES } from './helpers.mjs';
import { validateAllowList, loadAllowList, isSeoPath } from '../lib/allow.mjs';
import { addDays, isoDate } from '../lib/util.mjs';
import { REPO_ROOT } from '../lib/cli.mjs';

const TODAY = isoDate(new Date());
const approved = (over = {}) => ({
  id: 'AL-901', url: '/client-only', match: 'exact', field: 'response',
  expected: { base: { status: 200 }, candidate: { status: 308, location: '/en' } },
  justification: 'test', applies_to: ['preview', 'production'],
  expires: addDays(TODAY, 30), approver: 'Dimitris', approved_on: TODAY, ...over,
});

async function pairWithAllow(allowEntries, candOpts, args = [], entries = FIXTURE_ENTRIES) {
  const base = await startSite();
  const cand = await startSite(candOpts);
  const dir = tmpDir();
  try {
    return await run(['--base', base.origin, '--candidate', cand.origin, '--urls', writeUrls(dir, entries), '--out', path.join(dir, 'out'), '--allow', writeAllow(dir, allowEntries), '--recheck-after', '0', ...args]);
  } finally { await base.close(); await cand.close(); }
}

test('response entry with exact expected values → allowed, exit 0, signable', async () => {
  const r = await pairWithAllow([approved()], { clientOnlyRedirect: '/en' });
  assert.equal(r.code, 0, r.out + r.err);
  const res = r.report.results.find((x) => x.id === 'G6-002');
  assert.equal(res.outcome, 'allowed');
  assert.ok(res.diffs.every((d) => d.allow === 'AL-901' && d.allow_status === 'approved'));
  // Only the window override makes it unsignable here.
  assert.deepEqual(r.report.unsignable_reasons, ['PARITY_IGNORE_WINDOW=1']);
});

test('response entry, different Location → fail', async () => {
  const r = await pairWithAllow([approved()], { clientOnlyRedirect: '/robots.txt' });
  assert.equal(r.code, 1);
  assert.equal(r.report.results.find((x) => x.id === 'G6-002').outcome, 'fail');
});

test('expired entry → its difference fails', async () => {
  const r = await pairWithAllow([approved({ approved_on: '2025-01-01', expires: '2025-03-01' })], { clientOnlyRedirect: '/en' });
  assert.equal(r.code, 1);
  const res = r.report.results.find((x) => x.id === 'G6-002');
  assert.equal(res.outcome, 'fail');
  assert.ok(res.diffs.every((d) => d.allow_status === 'expired'));
});

test('pending entry → allowed, run valid but not signable', async () => {
  const r = await pairWithAllow([approved({ approved_on: 'pending' })], { clientOnlyRedirect: '/en' });
  assert.equal(r.code, 0);
  assert.equal(r.report.valid, true);
  assert.equal(r.report.signable, false);
  assert.deepEqual(r.report.allow_list.pending_used, ['AL-901']);
});

test('field-level entry: exact value → allowed; other value → fail', async () => {
  const entry = {
    id: 'AL-902', url: '/en', match: 'exact', field: 'F11', sub: 'x-frame-options',
    expected: { base: null, candidate: 'DENY' }, justification: 'test', applies_to: ['production'],
    expires: addDays(TODAY, 10), approver: 'Dimitris', approved_on: TODAY,
  };
  // HEAD carries the header too (F4, sub F11:x-frame-options); the F11 entry covers it with the same values.
  const head = { ...entry, id: 'AL-903', url: '/unrelated' };
  // /old redirects to /en, so it would see the header at hop 1 under another URL: test /en alone.
  const only = FIXTURE_ENTRIES.filter((e) => e.id === 'G1-001');
  const ok = await pairWithAllow([entry, head], { xFrameOptions: 'DENY' }, [], only);
  assert.equal(ok.code, 0, JSON.stringify(diffsOf(ok.report, 'G1-001')));
  assert.equal(ok.report.results.find((x) => x.id === 'G1-001').outcome, 'allowed');
  const bad = await pairWithAllow([entry, head], { xFrameOptions: 'SAMEORIGIN' }, [], only);
  assert.equal(bad.code, 1);
  // Entry restricted to production does not apply to a preview run.
  const role = await pairWithAllow([entry, head], { xFrameOptions: 'DENY', robotsTag: 'noindex' }, ['--candidate-role', 'preview'], only);
  assert.equal(role.code, 1);
});

test('validator: forbidden and malformed entries → exit 2', async () => {
  const bad = (over) => validateAllowList({ version: 1, entries: [approved(over)] }, TODAY);
  assert.deepEqual(bad({}), []);
  assert.ok(bad({ field: '*' }).some((e) => /forbidden/.test(e)));
  assert.ok(bad({ url: undefined }).some((e) => /url is required/.test(e)));
  assert.ok(bad({ field: 'F6', expected: { base: 'a', candidate: 'b' }, url: '/en/services' }).some((e) => /F6/.test(e)));
  assert.ok(bad({ field: 'F9', expected: { base: 'db', candidate: 'i18n' }, url: '/en', match: 'exact' }).some((e) => /F9/.test(e)));
  assert.deepEqual(bad({ field: 'F6', expected: { base: 'a', candidate: 'b' }, url: '/robots.txt' }), []);
  assert.ok(bad({ expires: addDays(TODAY, 121) }).some((e) => /120 days/.test(e)));
  assert.deepEqual(bad({ expires: addDays(TODAY, 120) }), []);
  assert.ok(bad({ approver: 'Someone' }).some((e) => /approver/.test(e)));
  assert.ok(bad({ justification: '' }).some((e) => /justification/.test(e)));
  assert.ok(bad({ expected: { base: { status: 200 }, candidate: { status: 200 } } }).some((e) => /differs/.test(e)));
  assert.ok(bad({ approved_on: 'soon' }).some((e) => /approved_on/.test(e)));
  assert.ok(bad({ applies_to: ['staging'] }).some((e) => /applies_to/.test(e)));
  const dir = tmpDir();
  const r = await run(['--base', 'http://127.0.0.1:9', '--candidate', 'http://127.0.0.1:9', '--urls', writeUrls(dir), '--out', path.join(dir, 'o'), '--allow', writeAllow(dir, [approved({ field: '*' })])]);
  assert.equal(r.code, 2);
  assert.match(r.err, /does not validate/);
});

test('isSeoPath follows the middleware matcher', () => {
  assert.equal(isSeoPath('/en'), true);
  assert.equal(isSeoPath('/fi/palvelut'), true);
  assert.equal(isSeoPath('/EN'), false);
  assert.equal(isSeoPath('/english'), false);
  assert.equal(isSeoPath('/robots.txt'), false);
});

test('the committed allow-list validates; AL-001…AL-004 present and pending', () => {
  const file = path.join(REPO_ROOT, 'scripts', 'seo-parity.allow.json');
  const list = loadAllowList(file, TODAY);
  assert.deepEqual(list.entries.map((e) => e.id), ['AL-001', 'AL-002', 'AL-003', 'AL-004']);
  assert.deepEqual(list.pending, ['AL-001', 'AL-002', 'AL-003', 'AL-004']);
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(doc.entries[2].url, '/pl/wyko%C5%84czenie-powierzchni');
});
