// Shared T1 set-up of the intake Workflow tests: one case per synthetic MIME fixture (test/fixtures/mime) with the
// hand-written model answers of its LLM fixtures, the mail seeding that mirrors microns-mail (raw MIME in R2 under
// email/<sha>/raw.eml and the inbound_emails row built with workers/mail/src/headers.ts), and a runner around
// runIntake with FakeStep and the fakes of test/helpers.
//
// LLM fixtures: test/fixtures/llm/<prompt id>/<first 16 hex of the content hash>.json, written by
// test/intake/llm-fixtures.test.ts with INTAKE_FIXTURES_WRITE=1 from the answers below (the content is whatever the
// Workflow builds for the case, so a change of the prompt input changes the hash and the case fails until the
// fixtures are written again). Every value is synthetic; addresses use example.com and example.de.

import { readFileSync } from 'node:fs';
import { authResultsOfRaw, inReplyToOf, messageIdTokens, parseFrom, rawHeaderValues, subjectOf, trimmedMessageId } from '../../../mail/src/headers';
import type { OpsEnv } from '../../src/env';
import { messageIdSha256 } from '../../src/agents/ids';
import type { ClassifyProcessV1, RfqExtractV1, TriageV1 } from '../../src/mail-in/intake';
import { runIntake, type IntakeDeps, type IntakeResult, type RfqIntakeParams } from '../../src/workflows/rfq-intake';
import { agentBindings, agentPorts, FakeKV, FakeR2Bucket, type AgentTestPorts } from '../helpers/agent-env';
import { FakeStep } from '../helpers/fake-step';
import { opsEnv } from '../helpers/ops';

export const TENANT = '00000000-0000-0000-0000-000000000001';
export const MIME_DIR = new URL('../fixtures/mime/', import.meta.url).pathname;

export type IntakeVerb = 'confirm_sheet_metal' | 'confirm_cnc' | 'confirm_mixed' | 'not_rfq';

export interface IntakeCase {
  file: string;
  outcome: IntakeResult['outcome'];
  /** Verb of the confirmation event (assist mode). */
  verb?: IntakeVerb;
  triage?: TriageV1;
  extract?: RfqExtractV1;
  classify?: ClassifyProcessV1;
  /** rfq_files rows and cad_jobs rows of a created RFQ. */
  files?: number;
  cadJobs?: number;
  source?: 'email' | 'techpilot';
}

const f = <T>(value: T | null, confidence: number) => ({ value, confidence });
const none = { value: null, confidence: 0 };

function extract(o: Partial<RfqExtractV1> & Pick<RfqExtractV1, 'parts'>): RfqExtractV1 {
  return {
    company: none,
    contact_first_name: none,
    contact_last_name: none,
    contact_email: none,
    phone: none,
    vat_id: none,
    country: none,
    deadline: none,
    language: 'en',
    notes: '',
    injection_suspected: false,
    ...o,
  };
}

function part(o: { name: string; qty: number | null; material: string | null; t?: number | null; finish?: string | null; tol?: string | null; hint: 'sheet_metal' | 'cnc' | 'unknown'; refs: number[]; c?: number }): RfqExtractV1['parts'][number] {
  const c = o.c ?? 0.95;
  return {
    name: o.name,
    quantity: o.qty === null ? none : f(o.qty, c),
    material: o.material === null ? none : f(o.material, c),
    thickness_mm: o.t ? f(o.t, c) : none,
    finish: o.finish ? f(o.finish, 0.9) : none,
    tolerance: o.tol ? f(o.tol, 0.9) : none,
    process_hint: o.hint,
    attachment_refs: o.refs,
  };
}

const rfq = (language: string, injection = false, confidence = 0.96): TriageV1 => ({ kind: 'rfq', language, injection_suspected: injection, confidence });

export const CASES: readonly IntakeCase[] = [
  {
    file: 'en-step-pdf.eml',
    outcome: 'rfq_created',
    verb: 'confirm_sheet_metal',
    triage: rfq('en'),
    extract: extract({
      company: f('Example Fabrication Ltd', 0.95),
      contact_first_name: f('Anna', 0.95),
      contact_last_name: f('Becker', 0.95),
      contact_email: f('anna.becker@example.com', 0.98),
      phone: f('+44 20 7946 0000', 0.95),
      vat_id: f('GB123456789', 0.95),
      country: f('GB', 0.9),
      deadline: f('2026-10-30', 0.9),
      parts: [part({ name: 'Bracket BR-100', qty: 50, material: 'S235JR', t: 2, finish: 'powder coated RAL 9005', tol: 'ISO 2768-m', hint: 'sheet_metal', refs: [1, 2] })],
    }),
    classify: { process: 'sheet_metal', confidence: 0.9, signals: ['laser-cut', '2 mm sheet'] },
    files: 2,
    cadJobs: 1,
  },
  {
    file: 'de-sheet-metal-step.eml',
    outcome: 'rfq_created',
    verb: 'confirm_sheet_metal',
    triage: rfq('de'),
    extract: extract({
      company: f('Beispiel Metallbau GmbH', 0.95),
      contact_first_name: f('Hans', 0.95),
      contact_last_name: f('Müller', 0.95),
      contact_email: f('h.mueller@example.de', 0.97),
      vat_id: f('DE123456789', 0.95),
      country: f('DE', 0.95),
      language: 'de',
      parts: [part({ name: 'Kantteil Winkel W-20', qty: 200, material: '1.4301', t: 1.5, finish: 'geschliffen', hint: 'sheet_metal', refs: [1] })],
    }),
    classify: { process: 'sheet_metal', confidence: 0.93, signals: ['Abkantung 90°', 'Blechdicke 1,5 mm'] },
    files: 1,
    cadJobs: 1,
  },
  {
    file: 'el-dxf.eml',
    outcome: 'rfq_created',
    verb: 'confirm_sheet_metal',
    triage: rfq('el'),
    extract: extract({
      company: f('Παράδειγμα Μεταλλικές Κατασκευές ΑΕ', 0.9),
      contact_first_name: f('Γιώργος', 0.9),
      contact_last_name: f('Παπαδόπουλος', 0.9),
      contact_email: f('g.papadopoulos@example.com', 0.97),
      country: f('GR', 0.8),
      language: 'el',
      parts: [part({ name: 'plate.dxf', qty: 30, material: '5754', t: 3, hint: 'sheet_metal', refs: [1] })],
    }),
    classify: { process: 'sheet_metal', confidence: 0.92, signals: ['κοπή laser', 'στράντζα', 'DXF'] },
    files: 1,
    cadJobs: 1,
  },
  {
    file: 'pl-stl-image.eml',
    outcome: 'rfq_created',
    verb: 'confirm_cnc',
    triage: rfq('pl'),
    extract: extract({
      company: f('Przykład Sp. z o.o.', 0.9),
      contact_first_name: f('Piotr', 0.9),
      contact_last_name: f('Nowak', 0.9),
      contact_email: f('p.nowak@example.com', 0.97),
      country: f('PL', 0.6),
      language: 'pl',
      parts: [part({ name: 'obudowa', qty: 10, material: '6082', tol: '±0,02 mm', hint: 'cnc', refs: [2, 3] })],
    }),
    classify: { process: 'cnc', confidence: 0.92, signals: ['frezowanie CNC', '±0,02 mm'] },
    files: 2,
    cadJobs: 1,
  },
  {
    file: 'en-zip.eml',
    outcome: 'rfq_created',
    verb: 'confirm_sheet_metal',
    triage: rfq('en'),
    extract: extract({
      company: f('Example Engineering Ltd', 0.95),
      contact_first_name: f('Olivia', 0.95),
      contact_last_name: f('Grant', 0.95),
      contact_email: f('olivia.grant@example.com', 0.97),
      parts: [
        part({ name: 'bracket.step', qty: 100, material: 'S355', t: 3, hint: 'sheet_metal', refs: [2] }),
        part({ name: 'plate.dxf', qty: 100, material: 'S355', t: 3, hint: 'sheet_metal', refs: [3] }),
      ],
    }),
    classify: { process: 'sheet_metal', confidence: 0.9, signals: ['laser cut and bent', '3 mm'] },
    files: 2,
    cadJobs: 2,
  },
  {
    file: 'en-no-attachment.eml',
    outcome: 'rfq_created',
    verb: 'confirm_cnc',
    triage: rfq('en'),
    extract: extract({
      company: f('Example Motion Ltd', 0.9),
      contact_first_name: f('Mark', 0.95),
      contact_last_name: f('Taylor', 0.95),
      contact_email: f('mark.taylor@example.com', 0.97),
      parts: [part({ name: 'turned shaft', qty: 500, material: '1.4305', tol: 'h7', hint: 'cnc', refs: [] })],
    }),
    classify: { process: 'cnc', confidence: 0.94, signals: ['turned shafts', 'h7'] },
    files: 0,
    cadJobs: 0,
  },
  {
    file: 'techpilot.eml',
    outcome: 'rfq_created',
    verb: 'confirm_cnc',
    triage: { kind: 'techpilot', language: 'de', injection_suspected: false, confidence: 0.9 },
    extract: extract({
      company: f('Muster Antriebstechnik GmbH', 0.95),
      contact_first_name: f('Petra', 0.9),
      contact_last_name: f('Schmidt', 0.9),
      contact_email: f('p.schmidt@example.de', 0.95),
      country: f('DE', 0.95),
      deadline: f('2026-10-20', 0.9),
      language: 'de',
      parts: [part({ name: 'Drehteile', qty: 1000, material: '1.0718', hint: 'cnc', refs: [] })],
    }),
    classify: { process: 'cnc', confidence: 0.9, signals: ['Drehteile'] },
    files: 0,
    cadJobs: 0,
    source: 'techpilot',
  },
  {
    file: 'injection.eml',
    outcome: 'rfq_created',
    verb: 'confirm_sheet_metal',
    triage: rfq('en', true, 0.9),
    extract: extract({
      company: f('Example Covers Ltd', 0.9),
      contact_first_name: f('Sam', 0.95),
      contact_last_name: f('Carter', 0.95),
      contact_email: f('sam.carter@example.com', 0.97),
      parts: [part({ name: 'cover plate', qty: 20, material: 'EN AW-5083', t: 4, hint: 'sheet_metal', refs: [] })],
      injection_suspected: true,
    }),
    classify: { process: 'sheet_metal', confidence: 0.85, signals: ['laser cut', '4 mm'] },
    files: 0,
    cadJobs: 0,
  },
  {
    file: 'no-message-id.eml',
    outcome: 'rfq_created',
    verb: 'confirm_cnc',
    triage: rfq('en', false, 0.93),
    extract: extract({
      company: f('Example Plastics AS', 0.9),
      contact_first_name: f('Nina', 0.95),
      contact_last_name: f('Larsen', 0.95),
      contact_email: f('nina.larsen@example.com', 0.97),
      parts: [part({ name: 'spacer', qty: 1000, material: 'POM-C', hint: 'unknown', refs: [] })],
    }),
    classify: { process: 'cnc', confidence: 0.6, signals: ['spacers', 'POM-C'] },
    files: 0,
    cadJobs: 0,
  },
  { file: 'auto-reply.eml', outcome: 'auto_reply' },
  { file: 'bounce.eml', outcome: 'auto_reply' },
  { file: 'dmarc-fail.eml', outcome: 'other', triage: { kind: 'other', language: 'en', injection_suspected: false, confidence: 0.55 } },
  { file: 'reply-known-quote.eml', outcome: 'reply', triage: { kind: 'reply', language: 'en', injection_suspected: false, confidence: 0.95 } },
];

export function caseOf(file: string): IntakeCase {
  const c = CASES.find((x) => x.file === file);
  if (!c) throw new Error(`no intake case ${file}`);
  return c;
}

/** Messages API response body of a structured output. */
export function messagesResponse(model: string, value: unknown, usage: { input: number; output: number; cacheRead?: number; cacheWrite?: number }): Record<string, unknown> {
  return {
    id: 'msg_fixture',
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text: JSON.stringify(value) }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: usage.input, output_tokens: usage.output, cache_read_input_tokens: usage.cacheRead ?? 0, cache_creation_input_tokens: usage.cacheWrite ?? 0 },
  };
}

export const MODELS = { classify: 'claude-haiku-4-5-20251001', extract: 'claude-sonnet-5-5' } as const;

/** Response body of a case for a prompt id. */
export function caseResponse(c: IntakeCase, prompt: string): Record<string, unknown> | null {
  if (prompt === 'rfq_intake.triage@v1' && c.triage) return messagesResponse(MODELS.classify, c.triage, { input: 640, output: 38 });
  if (prompt === 'rfq_intake.extract@v1' && c.extract) return messagesResponse(MODELS.extract, c.extract, { input: 1400, output: 520, cacheWrite: 1050 });
  if (prompt === 'rfq_intake.classify_process@v1' && c.classify) return messagesResponse(MODELS.classify, c.classify, { input: 610, output: 30 });
  return null;
}

// ----- environment and mail seeding -----

export interface IntakeHarness {
  env: OpsEnv;
  ports: AgentTestPorts;
  kv: FakeKV;
  bucket: FakeR2Bucket;
}

export function harness(o: { flag?: Record<string, unknown> | null; quoteFlag?: boolean } = {}): IntakeHarness {
  const bucket = new FakeR2Bucket();
  const env = opsEnv({ ...agentBindings({ PRIVATE_FILES: bucket as unknown as R2Bucket }) }) as OpsEnv;
  const kv = env.FLAGS as unknown as FakeKV;
  if (o.flag !== null) kv.setJson('agent.rfq_intake', o.flag ?? { enabled: true, value: { mode: 'assist' }, rev: 1 });
  if (o.quoteFlag) kv.setJson('agent.quote', { enabled: true, value: { mode: 'assist' }, rev: 1 });
  const ports = agentPorts({ bucket });
  return { env, ports, kv, bucket };
}

export interface SeededMail {
  id: string;
  sha: string;
  params: RfqIntakeParams;
  instanceId: string;
}

/** Stores a fixture as microns-mail does (R2 raw MIME + inbound_emails row) and returns the Workflow params. */
export async function seedMail(h: IntakeHarness, file: string, o: { mailbox?: 'rfq' | 'replies'; receivedAt?: string } = {}): Promise<SeededMail> {
  const raw = new Uint8Array(readFileSync(`${MIME_DIR}${file}`));
  const header = (name: string) => rawHeaderValues(raw, name)[0] ?? null;
  const messageId = trimmedMessageId(header('message-id'));
  const sha = await messageIdSha256(messageId, raw);
  await h.bucket.put(`email/${sha}/raw.eml`, raw, { httpMetadata: { contentType: 'message/rfc822' } });
  const from = parseFrom(header('from'), 'envelope@example.com');
  const [row] = await h.ports.db.insert<{ id: string }>(
    'inbound_emails',
    {
      tenant_id: TENANT,
      message_id: messageId ?? sha,
      message_id_sha256: sha,
      mailbox: o.mailbox ?? 'rfq',
      source: 'email_routing',
      from_email: from.email,
      from_name: from.name,
      to_email: 'rfq@rfq.micronshub.eu',
      subject: subjectOf(header('subject')),
      in_reply_to: inReplyToOf(header('in-reply-to')),
      references_ids: messageIdTokens(header('references')),
      received_at: o.receivedAt ?? '2026-10-05T09:00:00.000Z',
      raw_r2_key: `email/${sha}/raw.eml`,
      raw_size_bytes: raw.byteLength,
      auth_results: authResultsOfRaw(raw),
      status: 'received',
    },
    { returning: 'id' },
  );
  const params: RfqIntakeParams = { v: 1, inbound_email_id: row.id, message_id_sha256: sha, tenant_id: TENANT };
  return { id: row.id, sha, params, instanceId: `rfq-intake-${sha.slice(0, 32)}` };
}

export const STAFF = 'user:0b7c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c3';

/** Runs the Workflow once; confirmation events are buffered on the step before the run when `verb` is given. */
export async function runCase(h: IntakeHarness, mail: SeededMail, o: { step?: FakeStep; verb?: string; deps?: Partial<IntakeDeps> } = {}): Promise<{ result: IntakeResult; step: FakeStep }> {
  const step = o.step ?? new FakeStep();
  if (o.verb) step.sendEvent('intake-confirmed', { verb: o.verb, actor: STAFF, channel: 'dashboard' });
  const result = await runIntake(mail.params, mail.instanceId, { env: h.env, ports: h.ports, step, ...o.deps });
  return { result, step };
}

/** Every e-mail-address-shaped string in a JSON value. */
export function addressesIn(value: unknown): string[] {
  return JSON.stringify(value ?? null).match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g) ?? [];
}
