/**
 * W-5: the agent dashboard pages (/dashboard/approvals, /dashboard/rfq-inbox) against a local `vite preview` of the
 * production build, with every backend answer mocked in the browser:
 *
 *   npx vite build && (npx vite preview --port 4173 --strictPort &) && \
 *     BASE_URL=http://localhost:4173 npx playwright test tests/e2e/agent-dashboard.spec.ts
 *
 * | Rule | Detail |
 * |---|---|
 * | Hosts | BASE_URL must be http://localhost:<port> or http://127.0.0.1:<port>, else every test stops in beforeAll (playwright.config.ts defaults to production) |
 * | Network | Requests to the BASE_URL origin go to the preview, except /api/agent/* (mocked per test). Every other host is answered by the mocks of this file (Supabase /rest/v1 and /auth/v1 paths) or aborted; WebSockets are closed without connecting |
 * | Session | A signed-in staff session is placed where supabase-js reads it (an init script answers its storage key); the access token is a made-up JWT built at run time and never valid anywhere |
 * | Cases | tables missing -> "not installed", no polling past the 30 s / 60 s intervals (page clock advanced), no action; tables present -> both lists polled (control); staff with data -> lists and nav entries render; status probe answered by the SPA shell -> actions disabled with a hint; a decision -> one POST with run_id + token_sha256 (no raw token); 409 -> toast and reload; quote approval with an edited price -> edits in the POST; non-staff -> /login; e-mail text rendered as text |
 */
import { test, expect, type Page, type Route } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? '';
const LOCAL_RE = /^http:\/\/(localhost|127\.0\.0\.1):\d+\/?$/;
const IS_LOCAL = LOCAL_RE.test(BASE_URL);

test.describe.configure({ retries: 0 });

test.beforeAll(() => {
  if (!IS_LOCAL) {
    throw new Error('agent-dashboard.spec.ts runs only against a local preview: set BASE_URL to http://localhost:<port> or http://127.0.0.1:<port>');
  }
});

const USER_ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const RUN_INTAKE = '3f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b';
const RUN_QUOTE = '4a2d3b5f-6c7e-4f80-9bac-1d2e3f4a5b6c';
const QUOTE_ID = '5b3e4c6a-7d8f-4091-8cbd-2e3f4a5b6c7d';
const RFQ_ID = '6c4f5d7b-8e9a-41a2-9dce-3f4a5b6c7d8e';
const MAIL_ID = '7d5a6e8c-9fab-42b3-8edf-4a5b6c7d8e9f';
const HASH_INTAKE = '270036a11a9956bd2b1ca5ea43f02902928e49dc3fc3cbc342c7afb0197048a1';
const HASH_QUOTE = '8f3c2a1b0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b';

function base64Url(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A made-up session in the shape supabase-js stores (the token is not signed by anything). */
function fakeSession() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({ sub: USER_ID, role: 'authenticated', aud: 'authenticated', exp, email: 'staff@example.com' }));
  return {
    access_token: `${header}.${payload}.${base64Url('not-a-signature')}`,
    refresh_token: 'refresh-fixture-value',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: exp,
    user: { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'staff@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
  };
}

interface Scenario {
  role: string;
  tablesMissing?: boolean;
  /** /api/agent/status answer; undefined = not mocked (the preview answers with the SPA shell, as Vercel does). */
  status?: unknown;
  decision?: { status: number; body: unknown };
}

interface Recorder {
  rest: string[];
  decisions: Array<Record<string, unknown>>;
  aborted: string[];
}

const PENDING_RUNS = [
  {
    id: RUN_INTAKE,
    agent: 'rfq_intake',
    subject_type: 'inbound_email',
    subject_id: MAIL_ID,
    workflow_instance_id: 'rfq-intake-abc',
    started_at: '2026-10-05T08:00:00Z',
    updated_at: '2026-10-05T08:01:00Z',
    approval_token_sha256: HASH_INTAKE,
    output: {
      card_kind: 'intake',
      allowed_verbs: ['confirm_sheet_metal', 'confirm_cnc', 'confirm_mixed', 'not_rfq'],
      card: {
        v: 1,
        kind: 'intake',
        run_id: RUN_INTAKE,
        title: 'RFQ from Example GmbH (DE)',
        lines: [{ label: 'Parts', value: '3' }],
        flags: ['low_confidence'],
        allowed_verbs: ['confirm_sheet_metal', 'confirm_cnc', 'confirm_mixed', 'not_rfq'],
        open_url: 'https://www.micronshub.eu/dashboard/rfq-inbox?email=x',
      },
      telegram_message_id: 101,
    },
  },
  {
    id: RUN_QUOTE,
    agent: 'quote',
    subject_type: 'rfq',
    subject_id: RFQ_ID,
    workflow_instance_id: `quote-${RFQ_ID}-v1`,
    started_at: '2026-10-05T08:10:00Z',
    updated_at: '2026-10-05T08:12:00Z',
    approval_token_sha256: HASH_QUOTE,
    output: {
      card_kind: 'quote',
      allowed_verbs: ['approve', 'reject'],
      quote_workflow_id: QUOTE_ID,
      line_count: 1,
      card: { v: 1, kind: 'quote', run_id: RUN_QUOTE, title: 'RFQ-20261005-1 · Example GmbH (DE)', lines: [{ label: 'Total net', value: 'EUR 250.00' }], flags: [], allowed_verbs: ['approve', 'reject'], open_url: 'https://www.micronshub.eu/dashboard/approvals?run=x' },
      telegram_message_id: 102,
    },
  },
];

const QUOTE_ROW = {
  id: QUOTE_ID,
  rfq_id: RFQ_ID,
  quote_version: 1,
  status: 'awaiting_approval',
  currency: 'EUR',
  quote_pdf_r2_key: `quotes/${RFQ_ID}/v1/quote.pdf`,
  pricing: {
    currency: 'EUR',
    lines: [{ line_no: 1, product_name: 'Bracket', process: 'sheet_metal', qty: 10, material: { text: 'S235 2 mm' }, suggested_unit_price: 25, unit_price: 25, line_total: 250, manual: false, manual_reasons: [] }],
    shipping: 0,
    total_net: 250,
  },
  drafts: { subject: 'Your quote RFQ-20261005-1', body_text: 'Dear customer, please find our offer attached.' },
};

const INBOUND = {
  id: MAIL_ID,
  received_at: '2026-10-05T07:59:00Z',
  mailbox: 'rfq',
  source: 'email_routing',
  from_name: 'Hans Example',
  from_email: 'hans.example@example.de',
  subject: 'Request for 10 brackets',
  kind: 'rfq',
  status: 'parsed',
  parse_confidence: 0.62,
  classification: { process: 'sheet_metal', confidence: 0.9 },
  auth_results: { trusted: true, dmarc: 'pass' },
  attachments: [{ n: 1, r2_key: `email/${'ab'.repeat(32)}/att/1-drawing.pdf`, filename: 'drawing.pdf', size_bytes: 20480, kind: 'pdf' }],
  parsed: { company: 'Example GmbH', injection_suspected: false },
  raw_r2_key: `email/${'ab'.repeat(32)}/raw.eml`,
  rfq_id: null,
  agent_run_id: RUN_INTAKE,
  error: null,
};

const FLAGS = [
  { key: 'agent.quote', enabled: false, value: { mode: 'assist' }, description: 'Quote drafts', rev: 3, kv_synced_rev: 3, kv_seed_pending: false, updated_at: '2026-10-05T08:00:00Z' },
  { key: 'seo.strict_404', enabled: true, value: {}, description: 'SEO', rev: 1, kv_synced_rev: 1, kv_seed_pending: false, updated_at: '2026-10-05T08:00:00Z' },
];

const STATUS_STAFF = { v: 1, ok: true, actions: ['decision', 'start', 'file'], principal: 'STAFF' };

function json(route: Route, status: number, body: unknown) {
  return route.fulfill({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
}

function restAnswer(table: string, url: URL, s: Scenario): { status: number; body: unknown } {
  if (table === 'user_roles') return { status: 200, body: [{ role: s.role }] };
  if (table === 'user_tenant_roles') return { status: 200, body: [] };
  const agentTables = ['inbound_emails', 'agent_runs', 'feature_flags', 'quote_workflows', 'rfqs'];
  if (agentTables.includes(table) && s.tablesMissing) {
    return { status: 404, body: { code: 'PGRST205', details: null, hint: null, message: `Could not find the table 'public.${table}' in the schema cache` } };
  }
  const q = url.searchParams;
  switch (table) {
    case 'agent_runs':
      if (q.get('subject_type') === 'eq.inbound_email') return { status: 200, body: [PENDING_RUNS[0]] };
      if (q.get('status') === 'eq.waiting_human') return { status: 200, body: PENDING_RUNS };
      return { status: 200, body: [] };
    case 'inbound_emails':
      if (q.get('select') === 'body_excerpt') return { status: 200, body: [{ body_excerpt: 'Hello,\n<img src=x onerror=alert(1)> please quote.' }] };
      return { status: 200, body: [INBOUND] };
    case 'quote_workflows':
      if (q.get('id') === `eq.${QUOTE_ID}`) return { status: 200, body: [QUOTE_ROW] };
      return { status: 200, body: [] };
    case 'feature_flags':
      return { status: 200, body: FLAGS };
    case 'rfqs':
      return { status: 200, body: [] };
    default:
      return { status: 200, body: [] };
  }
}

async function setup(page: Page, s: Scenario, signedIn = true): Promise<Recorder> {
  const rec: Recorder = { rest: [], decisions: [], aborted: [] };
  const origin = new URL(BASE_URL).origin;
  if (signedIn) {
    await page.addInitScript((session) => {
      const original = Storage.prototype.getItem;
      Storage.prototype.getItem = function (this: Storage, key: string) {
        if (/^sb-[A-Za-z0-9]+-auth-token$/.test(key)) return JSON.stringify(session);
        return original.call(this, key);
      };
    }, fakeSession());
  }
  await page.routeWebSocket(/.*/, (ws) => ws.close());
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) {
      if (url.pathname === '/api/agent/status' && s.status !== undefined) return json(route, 200, s.status);
      if (url.pathname === '/api/agent/decision') {
        rec.decisions.push(JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>);
        const d = s.decision ?? { status: 200, body: { v: 1, ok: true, run_id: RUN_INTAKE, verb: 'confirm_sheet_metal', outcome: 'event_sent', label: 'Confirmed as sheet metal' } };
        return json(route, d.status, d.body);
      }
      if (url.pathname.startsWith('/api/agent/') && s.status !== undefined) return json(route, 404, { error: 'not_found' });
      return route.continue();
    }
    const rest = /^\/rest\/v1\/([a-z_]+)$/.exec(url.pathname);
    if (rest) {
      rec.rest.push(`${rest[1]}?${url.searchParams.toString()}`);
      if (route.request().method() !== 'GET') return json(route, 405, { message: 'read-only test' });
      const a = restAnswer(rest[1], url, s);
      return json(route, a.status, a.body);
    }
    if (url.pathname.startsWith('/auth/v1/')) return json(route, 200, fakeSession().user);
    rec.aborted.push(url.host);
    return route.abort();
  });
  return rec;
}

/** Reads of a table so far (the list reads the pages poll: pending approvals and the inbox list). */
function readsOf(rec: Recorder, table: 'agent_runs' | 'inbound_emails', marker: string): number {
  return rec.rest.filter((r) => r.startsWith(`${table}?`) && r.includes(marker)).length;
}
const PENDING_READ = 'status=eq.waiting_human';
// The inbox list is ordered by received_at; the drawer's single-row reads are not.
const INBOX_READ = 'order=received_at';
// The page clock is advanced past each poll interval (approvals 30 s, inbox 60 s); requests a timer starts reach
// the recorder shortly after, so each check waits this long in real time first.
const SETTLE_MS = 1000;

test.describe('agent dashboard pages', () => {
  test('tables missing -> "not installed" on both pages, no polling past the 30 s / 60 s intervals, no action', async ({ page }) => {
    const rec = await setup(page, { role: 'admin', tablesMissing: true, status: STATUS_STAFF });
    await page.clock.install();
    await page.goto('/dashboard/approvals');
    await expect(page.getByTestId('agent-not-installed').first()).toBeVisible();
    await expect(page.getByTestId('approval-card')).toHaveCount(0);
    const reads = readsOf(rec, 'agent_runs', PENDING_READ);
    expect(reads).toBe(1);
    await page.clock.runFor(31_000);
    await page.clock.runFor(31_000);
    await page.waitForTimeout(SETTLE_MS);
    expect(readsOf(rec, 'agent_runs', PENDING_READ)).toBe(reads);

    await page.goto('/dashboard/rfq-inbox');
    await expect(page.getByTestId('agent-not-installed')).toBeVisible();
    const inboxReads = readsOf(rec, 'inbound_emails', INBOX_READ);
    expect(inboxReads).toBe(1);
    await page.clock.runFor(61_000);
    await page.clock.runFor(61_000);
    await page.waitForTimeout(SETTLE_MS);
    expect(readsOf(rec, 'inbound_emails', INBOX_READ)).toBe(inboxReads);
    expect(rec.decisions).toEqual([]);
  });

  test('tables present -> both lists are read again after their poll interval (control for the test above)', async ({ page }) => {
    const rec = await setup(page, { role: 'admin', status: STATUS_STAFF });
    await page.clock.install();
    await page.goto('/dashboard/approvals');
    await expect(page.getByTestId('approval-card')).toHaveCount(2);
    const reads = readsOf(rec, 'agent_runs', PENDING_READ);
    expect(reads).toBeGreaterThanOrEqual(1);
    await page.clock.runFor(31_000);
    await expect.poll(() => readsOf(rec, 'agent_runs', PENDING_READ)).toBeGreaterThan(reads);

    await page.goto('/dashboard/rfq-inbox');
    await expect(page.getByText('Request for 10 brackets')).toBeVisible();
    const inboxReads = readsOf(rec, 'inbound_emails', INBOX_READ);
    expect(inboxReads).toBeGreaterThanOrEqual(1);
    await page.clock.runFor(61_000);
    await expect.poll(() => readsOf(rec, 'inbound_emails', INBOX_READ)).toBeGreaterThan(inboxReads);
    expect(rec.decisions).toEqual([]);
  });

  test('staff with data: nav entries, pending cards and the inbox list render; sender masked in the list', async ({ page }) => {
    await setup(page, { role: 'sales_rep', status: STATUS_STAFF });
    await page.goto('/dashboard/approvals');
    await expect(page.getByRole('button', { name: 'RFQ Inbox' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approvals' }).first()).toBeVisible();
    await expect(page.getByTestId('approval-card')).toHaveCount(2);
    await expect(page.getByText('RFQ from Example GmbH (DE)')).toBeVisible();
    await expect(page.getByTestId('verb-confirm_sheet_metal')).toBeEnabled();
    await page.goto('/dashboard/rfq-inbox');
    await expect(page.getByTestId('rfq-inbox')).toBeVisible();
    await expect(page.getByText('Request for 10 brackets')).toBeVisible();
    await expect(page.getByText('h***@example.de')).toBeVisible();
    await expect(page.getByTestId('rfq-inbox').getByText('hans.example@example.de')).toHaveCount(0);
  });

  test('status answered by the SPA shell -> actions disabled with a hint; nothing is posted', async ({ page }) => {
    const rec = await setup(page, { role: 'admin' });
    await page.goto('/dashboard/approvals');
    await expect(page.getByTestId('agent-api-absent')).toContainText('Actions need the Cloudflare API; use the Telegram card.');
    await expect(page.getByTestId('approval-card')).toHaveCount(2);
    await expect(page.getByTestId('verb-confirm_sheet_metal')).toBeDisabled();
    await expect(page.getByTestId('verb-approve-review')).toBeDisabled();
    expect(rec.decisions).toEqual([]);
  });

  test('a decision sends one POST with run_id + token_sha256 and no raw token', async ({ page }) => {
    const rec = await setup(page, { role: 'admin', status: STATUS_STAFF });
    await page.goto(`/dashboard/approvals?run=${RUN_INTAKE}`);
    await page.getByTestId('verb-confirm_sheet_metal').click();
    await expect(page.getByText('Confirmed as sheet metal')).toBeVisible();
    expect(rec.decisions).toEqual([{ v: 1, run_id: RUN_INTAKE, token_sha256: HASH_INTAKE, verb: 'confirm_sheet_metal' }]);
  });

  test('409 already_decided -> toast and the pending list is read again', async ({ page }) => {
    const rec = await setup(page, { role: 'admin', status: STATUS_STAFF, decision: { status: 409, body: { error: 'already_decided' } } });
    await page.goto('/dashboard/approvals');
    await expect(page.getByTestId('approval-card')).toHaveCount(2);
    const before = rec.rest.filter((r) => r.startsWith('agent_runs') && r.includes('status=eq.waiting_human')).length;
    await page.getByTestId('verb-not_rfq').click();
    await expect(page.getByText('Already decided')).toBeVisible();
    await expect.poll(() => rec.rest.filter((r) => r.startsWith('agent_runs') && r.includes('status=eq.waiting_human')).length).toBeGreaterThan(before);
    expect(rec.decisions).toHaveLength(1);
  });

  test('quote approval: an edited price is sent as an override with the token hash', async ({ page }) => {
    const rec = await setup(page, { role: 'admin', status: STATUS_STAFF, decision: { status: 200, body: { v: 1, ok: true, run_id: RUN_QUOTE, verb: 'approve', outcome: 'event_sent', label: 'Approved' } } });
    await page.goto('/dashboard/approvals');
    await page.getByTestId('verb-approve-review').click();
    const editor = page.getByTestId('quote-editor');
    await expect(editor.getByText('Bracket')).toBeVisible();
    await editor.getByLabel('Unit price of line 1').fill('99.90');
    await editor.getByTestId('quote-approve').click();
    await expect(page.getByText('Approved').first()).toBeVisible();
    expect(rec.decisions).toEqual([{ v: 1, run_id: RUN_QUOTE, token_sha256: HASH_QUOTE, verb: 'approve', edits: { overrides: [{ line_no: 1, unit_price: 99.9 }] } }]);
  });

  test('a signed-in customer is sent to /login', async ({ page }) => {
    await setup(page, { role: 'customer', status: STATUS_STAFF });
    await page.goto('/dashboard/approvals');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('the e-mail text is shown as text in the inbox drawer (markup not rendered)', async ({ page }) => {
    await setup(page, { role: 'admin', status: STATUS_STAFF });
    await page.goto(`/dashboard/rfq-inbox?email=${MAIL_ID}`);
    const excerpt = page.getByTestId('inbound-excerpt');
    await expect(excerpt).toContainText('<img src=x onerror=alert(1)> please quote.');
    await expect(excerpt.locator('img')).toHaveCount(0);
    await expect(page.getByTestId('inbound-detail').getByText('hans.example@example.de', { exact: false })).toBeVisible();
  });
});
