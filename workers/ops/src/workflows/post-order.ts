// PostOrderWorkflow ('post-order'): one instance per order (id 'post-order-<order_id>'): traveller PDF, stock holds,
// partner hand-off with a human approval, reorder draft.
//
//   open-run           agent_runs row (agent post_order, key = order id); a final run exits; prompts pinned
//   daily-cap          above value.max_runs_per_day: run 'skipped' (daily_cap), no LLM call
//   flag-start         agent.post_order off -> run parked (flag_off) until 'agent-resumed' (7 days, then cancelled)
//   load               order, items, RFQ parts, files and CAD results; each item is matched to its RFQ part and quote
//                      line by product name (the portal copies part.product_name into order_items); the partner
//                      suggestion (production_partners). Unmatched items are listed
//   traveller-notes    post_order.traveller_notes@v1 in the partner's language (notes and QA checks, no prices)
//   build-traveller    orders/<order_id>/traveler.pdf (pdf/traveller-pdf.ts, deterministic)
//   shadow-notice      shadow mode: a notice card, the run closes 'succeeded'; nothing is held or sent
//   reserve-stock      items whose material maps to exactly one active materials row: MaterialStock
//                      ('<tenant>:<material>').reserve(order item, need); area = flat blank x quantity, else the
//                      quantity; then each material's check() (held above remaining -> shown on the card)
//   request-handoff    hand-off card (send_partner, hold; change_partner on the dashboard)
//   wait-handoff       'handoff-approved' 7 days -> reminder -> 7 days; no decision: run 'cancelled', nothing sent
//                      change_partner re-reads the order's partner and asks again (at most 3 rounds)
//   handoff            flag gate; orders.partner_id set (only while empty or the same); Resend mail to the partner with
//                      signed 7-day links to the traveller and the drawings (Idempotency-Key order/<order_id>/handoff)
//   reorder            shortfall or open low-stock alerts of the order's materials: flag read again (flag_off park),
//                      post_order.reorder_draft@v1 with
//                      supplier data from catalog_materials, a reorder card (approve_draft, dismiss), 'reorder-approved'
//                      7 days -> reminder -> 7 days; an approved draft is kept on the run for the staff member (no
//                      supplier address is stored, nothing is sent)
//   close              closeRun 'succeeded' with usage
// Rules
//   - 'auto' is never honoured for partner sends: every hand-off waits for a human decision.
//   - Every step runs inside one try/catch: a step that throws ends in step 'fail-run', which puts the run behind a
//     failure card (Retry restarts the instance from that step). LLM steps park the run as 'budget' (gateway 429) or
//     'llm_unavailable' (retries used up), and every side-effecting step re-reads the flag first (flag_off park).
//   - Prompt data blocks (<order_items>, <partner>, <reorder>) hold JSON whose '<' and '>' are written as \u003c and
//     \u003e (blockJson), so no value can end its block or open another one.
//   - Step results carry ids, numbers and short business fields only: the partner's address and the customer's
//     texts are read by the step that needs them and never returned. Nothing here logs an address or a token.

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep, type WorkflowStepConfig, type WorkflowTimeoutDuration } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import { formatLogLine } from '../../../shared/src/http/log';
import { isWaitTimeout, request, waitWithReminder } from '../agents/approval';
import { handoffCard, handoffNotice, type HandoffCardInput } from '../agents/cards/handoff';
import { reorderCard, type ReorderMaterial } from '../agents/cards/reorder';
import { isConfigMissing, need } from '../agents/config';
import type { DecisionEventPayload } from '../agents/decision';
import { readFlag } from '../agents/flags';
import { loadPrompt, registerPromptSource, selectPrompt, type PromptId } from '../agents/prompts/registry';
import { addUsage, applyDailyCap, checkpointRun, closeRun, EMPTY_USAGE, failRun, isFinal, openRun, parkRun, type UsageAcc } from '../agents/runs';
import { DbError, type Db } from '../db/postgrest';
import { cadOutputsOf, getOrder, orderItems, partnerKeysOf, setOrderPartner } from '../db/repos/orders';
import { activePartners, partnerAddress, partnerLanguage, suggestPartner, type PartnerMatch } from '../db/repos/partners';
import { activeMaterials, mapMaterial, num, openLowStockAlerts, stockObjectName, supplierOf } from '../db/repos/stock';
import type { StockHoldResult } from '../do/material-stock';
import { LOG_PREFIX, type OpsEnv } from '../env';
import { handoffIdempotencyKey } from '../mail-out/mime-ids';
import { plainMail } from '../mail-out/templates';
import { renderTravellerPdf } from '../pdf/traveller-pdf';
import { makePorts, type JsonSchemaObject, type LlmContent, type LlmUsage, type Ports } from '../ports/index';
import { buildLines, filesByPart, isSurchargePart, type FileRow, type JobRow, type PartRow } from '../pricing/lines';
import { recogniseMaterial } from '../pricing/materials';
import { signedFileUrl } from '../routes/agent';
import { DB, LLM_EXTRACT, NOTIFY, PDF, SEND } from './steps';
import travellerPrompt from '../agents/prompts/post_order/traveller_notes.v1.md';
import travellerSchema from '../agents/prompts/post_order/traveller_notes.v1.schema.json';
import reorderPrompt from '../agents/prompts/post_order/reorder_draft.v1.md';
import reorderSchema from '../agents/prompts/post_order/reorder_draft.v1.schema.json';

registerPromptSource('post_order.traveller_notes@v1', travellerPrompt, travellerSchema as Record<string, unknown>);
registerPromptSource('post_order.reorder_draft@v1', reorderPrompt, reorderSchema as Record<string, unknown>);

export interface PostOrderParams {
  v: 1;
  order_id: string;
  tenant_id: string;
  source: 'quote' | 'portal' | 'dashboard';
}

export type PostOrderOutcome = 'exists' | 'daily_cap' | 'cancelled' | 'shadow' | 'handed_off' | 'held' | 'timed_out' | 'failed';

export interface PostOrderResult {
  outcome: PostOrderOutcome;
  run_id: string;
  failed_step?: string;
}

export interface PostOrderDeps {
  env: OpsEnv;
  ports: Ports;
  step: WorkflowStep;
}

const AGENT = 'post_order' as const;
const FLAG = 'agent.post_order' as const;
export const PARK_TIMEOUT: WorkflowTimeoutDuration = '7 days';
export const HANDOFF_FIRST: WorkflowTimeoutDuration = '7 days';
export const HANDOFF_SECOND: WorkflowTimeoutDuration = '7 days';
export const REORDER_FIRST: WorkflowTimeoutDuration = '7 days';
export const REORDER_SECOND: WorkflowTimeoutDuration = '7 days';
export const LINK_DAYS = 7;
export const MAX_HANDOFF_ROUNDS = 3;
const DAY_MS = 86_400_000;
const NOTE_CHARS = 300;
const MAX_NOTES = 8;
const DESCRIPTION_CHARS = 600;
const DRAFT_SUBJECT_CHARS = 200;
const DRAFT_BODY_CHARS = 4000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isPostOrderParams(p: unknown): p is PostOrderParams {
  const x = p as Record<string, unknown> | null;
  return typeof x === 'object' && x !== null && x.v === 1 && typeof x.order_id === 'string' && UUID.test(x.order_id) && typeof x.tenant_id === 'string' && UUID.test(x.tenant_id) && (x.source === 'quote' || x.source === 'portal' || x.source === 'dashboard');
}

/** One order item as the later steps need it (no customer text). */
export interface ItemSnap {
  id: string;
  pos: number;
  product_name: string;
  quantity: number;
  /** Index of the matching RFQ part (null when no part has the item's name). */
  part_index: number | null;
  process: 'sheet_metal' | 'cnc' | 'other' | null;
  material: string | null;
  grade: string | null;
  thickness_mm: number | null;
  finish: string | null;
  tolerance: string | null;
  blank_mm2: number | null;
  geometry: string | null;
  files: string[];
  partner_keys: string[];
}

export interface OrderSnap {
  order: { id: string; po_number: string; rfq_id: string | null; rfq_number: string | null; company: string | null; country: string | null; due_date: string | null; created_at: string; partner_id: string | null; tenant_id: string };
  items: ItemSnap[];
  unmatched: number;
  partner: { id: string; company_name: string; country: string | null; matched_by: PartnerMatch } | null;
  language: string;
}

interface Notes {
  language: string;
  notes: string[];
  qa_checks: string[];
  injection_suspected: boolean;
}

interface StockOutcome {
  items: Array<{ id: string; material_id: string | null; status: 'held' | 'already_held' | 'shortfall' | 'not_stocked'; missing?: { area_mm2?: number; quantity?: number } }>;
  over_held: number;
}

/** Ends the run early with a result (passed through by the top-level catch). */
class Halt {
  constructor(readonly result: PostOrderResult) {}
}

type LlmStepResult<T> = { ok: true; value: T; usage: LlmUsage } | { ok: false; park: 'budget'; usage: LlmUsage | null };

/** Error code written to the run: a fixed code found in the error, else the error's name; never other text. */
export function errorCode(e: unknown): string {
  if (isConfigMissing(e)) return `config_missing: ${e.names.join(', ')}`.slice(0, 200);
  if (e instanceof DbError) return `db_error ${e.status}${e.code ? ` ${e.code}` : ''}`;
  const message = e instanceof Error ? e.message : String(e);
  const known = /\b(config_missing: [A-Z0-9_]+(?:, [A-Z0-9_]+)*|llm_(?:refusal|max_tokens|schema|provider_4xx|provider_5xx|timeout|budget|unavailable)|order_missing|partner_changed|partner_address_missing|send_[0-9]{3}|invalid_params)\b/.exec(message) ??
    /postgrest [a-z]+ [a-z_./]+: ([0-9]{3}(?: [A-Za-z0-9_]+)?)/.exec(message);
  if (known) return (known[0].startsWith('postgrest') ? `db_error ${known[1]}` : known[1]).slice(0, 200);
  const name = e instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,59}$/.test(e.name) ? e.name : 'Error';
  return name === 'Error' ? 'error' : name;
}

/** JSON for a prompt data block: '<' and '>' as JSON escapes (same data, no tag-like text). */
export function blockJson(value: unknown, indent?: number): string {
  return JSON.stringify(value, null, indent).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

function clip(text: unknown, max: number): string {
  return String(text ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function geometryText(g: { flat?: { width_mm: number; height_mm: number } | null; bends?: { count: number } | null; bbox_mm?: { x: number; y: number; z: number } | null } | null): string | null {
  if (!g) return null;
  const parts: string[] = [];
  if (g.flat) parts.push(`flat ${Math.round(g.flat.width_mm)} x ${Math.round(g.flat.height_mm)} mm`);
  if (g.bends) parts.push(`${g.bends.count} bend(s)`);
  if (!g.flat && g.bbox_mm) parts.push(`bounding box ${Math.round(g.bbox_mm.x)} x ${Math.round(g.bbox_mm.y)} x ${Math.round(g.bbox_mm.z)} mm`);
  return parts.length ? parts.join(', ') : null;
}

function norm(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** The RFQ row of an order (number, company, country and parts_details), inside a step. */
async function rfqRow(db: Db, rfqId: string | null): Promise<{ parts: PartRow[]; rfq: { rfq_number: string | null; company_name: string | null; country: string | null } | null }> {
  if (!rfqId) return { parts: [], rfq: null };
  const rfqs = await db.select<{ rfq_number: string | null; company_name: string | null; country: string | null; parts_details: unknown }>('rfqs', { columns: 'rfq_number,company_name,country,parts_details', filters: [['id', 'eq', rfqId]], limit: 1 });
  const rfq = rfqs[0] ?? null;
  const parts = Array.isArray(rfq?.parts_details) ? (rfq.parts_details as PartRow[]) : [];
  return { parts, rfq: rfq ? { rfq_number: rfq.rfq_number, company_name: rfq.company_name, country: rfq.country } : null };
}

/** Reads the RFQ parts, files and CAD jobs of an order's RFQ (inside a step). */
async function rfqParts(db: Db, rfqId: string | null): Promise<{ parts: PartRow[]; files: FileRow[]; jobs: JobRow[]; rfq: { rfq_number: string | null; company_name: string | null; country: string | null } | null }> {
  const { parts, rfq } = await rfqRow(db, rfqId);
  if (!rfqId) return { parts, files: [], jobs: [], rfq };
  const files = await db.select<FileRow & Record<string, unknown>>('rfq_files', { columns: 'id,file_name,part_id,r2_key,sha256,content_type,file_type', filters: [['rfq_id', 'eq', rfqId]], limit: 500 });
  const jobs = await db.select<JobRow & Record<string, unknown>>('cad_jobs', { columns: 'id,rfq_file_id,job_type,status,result,error', filters: [['rfq_id', 'eq', rfqId]], limit: 500 });
  return { parts, files, jobs, rfq };
}

/** The production entry point: ports from the environment, then runPostOrder(). */
export class PostOrderWorkflow extends WorkflowEntrypoint<OpsEnv, PostOrderParams> {
  async run(event: Readonly<WorkflowEvent<PostOrderParams>>, step: WorkflowStep): Promise<unknown> {
    return runPostOrder(event.payload, event.instanceId, { env: this.env, ports: makePorts(this.env), step });
  }
}

export async function runPostOrder(p: PostOrderParams, instanceId: string, d: PostOrderDeps): Promise<PostOrderResult> {
  if (!isPostOrderParams(p)) throw new NonRetryableError('invalid_params');
  const { env, ports, step } = d;
  const db = ports.db;
  const orderId = p.order_id;
  const tenant = p.tenant_id;
  let acc: UsageAcc = { ...EMPTY_USAGE, by_step: {} };
  let current = 'open-run';

  const run = <T>(name: string, cfg: WorkflowStepConfig, fn: () => Promise<T>): Promise<T> => {
    current = name;
    return step.do(name, cfg, fn as () => Promise<Rpc.Serializable<T>>) as Promise<T>;
  };
  const log = (outcome: string) => console.log(formatLogLine(LOG_PREFIX, 'post order', { order_id: orderId, outcome }));

  // 0 open-run
  const opened = await run('open-run', DB, async () => {
    const flag = await readFlag(env, FLAG, tenant);
    const prompts = { traveller: selectPrompt('post_order.traveller_notes', flag), reorder: selectPrompt('post_order.reorder_draft', flag) };
    const r = await openRun(db, {
      agent: AGENT,
      trigger: p.source === 'dashboard' ? 'dashboard' : 'queue',
      idempotency_key: orderId,
      workflow_name: 'post-order',
      workflow_instance_id: instanceId,
      subject_type: 'order',
      subject_id: orderId,
      prompt_version: `${prompts.traveller},${prompts.reorder}`,
      tenant_id: tenant,
    });
    return { run_id: r.run_id, final: isFinal(r.status), prompts };
  });
  const run_id = opened.run_id;
  if (opened.final) {
    log('exists');
    return { outcome: 'exists', run_id };
  }
  const prompts = opened.prompts as { traveller: PromptId; reorder: PromptId };

  // 0b daily-cap
  const capped = await run('daily-cap', DB, async () => applyDailyCap(env, ports, { run_id, agent: AGENT, flag: await readFlag(env, FLAG, tenant) }));
  if (capped) {
    log('daily_cap');
    return { outcome: 'daily_cap', run_id };
  }

  // ----- helpers that need the run -----

  const parkAndWait = async (name: string, reason: 'flag_off' | 'budget' | 'llm_unavailable'): Promise<void> => {
    await run(`park-${name}`, DB, async () => {
      await checkpointRun(db, run_id, acc);
      await parkRun(db, run_id, reason);
      return true;
    });
    try {
      await step.waitForEvent(`resume-${name}`, { type: 'agent-resumed', timeout: PARK_TIMEOUT });
    } catch (error) {
      if (!isWaitTimeout(error)) throw error;
      await run(`park-expired-${name}`, DB, async () => {
        await closeRun(db, run_id, { status: 'cancelled', error: reason }, acc);
        return true;
      });
      log('cancelled');
      throw new Halt({ outcome: 'cancelled', run_id });
    }
    await run(`resumed-${name}`, DB, async () => {
      await checkpointRun(db, run_id, acc, { status: 'running' });
      return true;
    });
  };

  /** Re-reads agent.post_order; while it is off the run is parked (flag_off). 'auto' counts as 'assist'. */
  const flagGate = async (name: string): Promise<'shadow' | 'assist'> => {
    for (let k = 1; ; k++) {
      const stepName = k === 1 ? `flag-${name}` : `flag-${name}-${k}`;
      const r = await run(stepName, DB, async () => {
        const flag = await readFlag(env, FLAG, tenant);
        return { enabled: flag.enabled, mode: flag.mode === 'shadow' ? ('shadow' as const) : ('assist' as const) };
      });
      if (r.enabled) return r.mode;
      await parkAndWait(stepName, 'flag_off');
    }
  };

  const llmStep = async <V, R>(base: string, prompt: PromptId, input: () => Promise<LlmContent[]>, after: (value: V) => R): Promise<R> => {
    for (let k = 1; ; k++) {
      const name = k === 1 ? base : `${base}-${k}`;
      let reason: 'budget' | 'llm_unavailable';
      try {
        const res = await run<LlmStepResult<R>>(name, LLM_EXTRACT, async () => {
          const loaded = await loadPrompt(prompt);
          const r = await ports.llm.call<V>({
            prompt,
            route: loaded.entry.route,
            system: loaded.system,
            user: await input(),
            schema: loaded.schema as unknown as JsonSchemaObject,
            maxTokens: loaded.entry.max_tokens,
            meta: { agent: AGENT, run_id, tenant_id: tenant, step: base },
          });
          if (r.ok) return { ok: true, value: after(r.value), usage: r.usage };
          if (r.code === 'budget') return { ok: false, park: 'budget', usage: r.usage ?? null };
          if (r.retryable) throw new Error(`llm_unavailable: ${r.code}`);
          throw new NonRetryableError(`llm_${r.code}`);
        });
        if (res.usage) acc = addUsage(acc, res.usage, base);
        if (res.ok) return res.value;
        reason = res.park;
      } catch (error) {
        if (!(error instanceof Error && error.message.includes('llm_unavailable'))) throw error;
        reason = 'llm_unavailable';
      }
      await parkAndWait(name, reason);
    }
  };

  try {
    await flagGate('start');

    // 1 load
    const snap = await run<OrderSnap>('load', DB, async () => {
      const order = await getOrder(db, orderId);
      if (!order) throw new NonRetryableError('order_missing');
      const items = await orderItems(db, orderId);
      const { parts, files, jobs, rfq } = await rfqParts(db, order.rfq_id);
      // Quote lines are rebuilt from the RFQ parts as the quote built them (pricing/lines.ts); line j belongs to
      // the j-th part that is not a minimum-order surcharge.
      const real = parts.map((pt, i) => ({ pt, i })).filter(({ pt }) => !isSurchargePart(pt));
      const lines = buildLines({ parts: real.map((r) => r.pt), files, jobs });
      const byPart = filesByPart(real.map((r) => r.pt), files);
      const outputs = order.rfq_id ? await cadOutputsOf(db, order.rfq_id) : [];
      const taken = new Set<number>();
      const snapItems: ItemSnap[] = [];
      for (const it of items) {
        const hit = parts.findIndex((pt, i) => !taken.has(i) && typeof pt.product_name === 'string' && norm(pt.product_name) === norm(it.product_name));
        if (hit >= 0) taken.add(hit);
        // a minimum-order surcharge is not a manufactured part
        if (hit >= 0 && isSurchargePart(parts[hit])) continue;
        const j = hit >= 0 ? real.findIndex((r) => r.i === hit) : -1;
        const line = j >= 0 ? lines[j] : undefined;
        const partFiles = j >= 0 ? byPart.get(String(real[j].pt.id ?? '')) ?? [] : [];
        const keys = partFiles.flatMap((f) => partnerKeysOf(outputs, f.id));
        const qty = num(it.quantity) ?? 0;
        const blank = line?.geometry?.flat ? line.geometry.flat.width_mm * line.geometry.flat.height_mm : null;
        snapItems.push({
          id: it.id,
          pos: snapItems.length + 1,
          product_name: clip(it.product_name, 120),
          quantity: qty,
          part_index: hit >= 0 ? hit : null,
          process: line?.process ?? null,
          material: line?.material_text ? clip(line.material_text, 80) : null,
          grade: line?.grade ?? null,
          thickness_mm: line?.thickness_mm ?? null,
          finish: line?.finish_code ?? null,
          tolerance: line?.tolerance ? clip(line.tolerance, 60) : null,
          blank_mm2: blank !== null && blank > 0 ? Math.round(blank * 100) / 100 : null,
          geometry: geometryText(line?.geometry ?? null),
          files: (line?.files ?? []).map((f) => clip(f, 100)),
          partner_keys: [...new Set(keys)],
        });
      }
      const partners = await activePartners(db);
      const processes = snapItems.map((i) => i.process ?? 'other');
      const suggestion = suggestPartner(partners, { order_partner_id: order.partner_id, processes });
      const partner = suggestion ? { id: suggestion.partner.id, company_name: clip(suggestion.partner.company_name, 120), country: suggestion.partner.country, matched_by: suggestion.matched_by } : null;
      return {
        order: {
          id: order.id,
          po_number: clip(order.po_number ?? order.title ?? order.id, 60),
          rfq_id: order.rfq_id,
          rfq_number: rfq?.rfq_number ?? order.from_rfq_number ?? null,
          company: rfq?.company_name ? clip(rfq.company_name, 120) : null,
          country: rfq?.country ? clip(rfq.country, 40) : null,
          due_date: order.delivery_date,
          created_at: order.created_at ?? new Date(0).toISOString(),
          partner_id: order.partner_id,
          tenant_id: order.tenant_id ?? tenant,
        },
        items: snapItems,
        unmatched: snapItems.filter((i) => i.part_index === null).length,
        partner,
        language: partnerLanguage(partner?.country),
      };
    });

    // 2 traveller-notes
    const notes = await llmStep<Notes, Notes>(
      'traveller-notes',
      prompts.traveller,
      async () => {
        const { parts } = await rfqRow(db, snap.order.rfq_id);
        const items = snap.items.map((it) => ({
          pos: it.pos,
          part: it.product_name,
          quantity: it.quantity,
          process: it.process,
          material: it.material,
          thickness_mm: it.thickness_mm,
          finish: it.finish,
          tolerance: it.tolerance,
          geometry: it.geometry,
          description: it.part_index !== null ? clip(parts[it.part_index]?.description, DESCRIPTION_CHARS) || null : null,
        }));
        return [
          { type: 'text', text: `<order_items>\n${blockJson(items, 1)}\n</order_items>` },
          { type: 'text', text: `<partner>\n${blockJson({ language: snap.language, due_date: snap.order.due_date ? snap.order.due_date.slice(0, 10) : null })}\n</partner>` },
        ];
      },
      (v) => ({
        language: clip(v.language, 8) || snap.language,
        notes: (v.notes ?? []).slice(0, MAX_NOTES).map((n) => clip(n, NOTE_CHARS)).filter(Boolean),
        qa_checks: (v.qa_checks ?? []).slice(0, MAX_NOTES).map((n) => clip(n, NOTE_CHARS)).filter(Boolean),
        injection_suspected: v.injection_suspected === true,
      }),
    );

    // 3 build-traveller
    const traveller = await run('build-traveller', PDF, async () => {
      const pdf = await renderTravellerPdf({
        po_number: snap.order.po_number,
        order_date: new Date(snap.order.created_at),
        due_date: snap.order.due_date,
        partner: snap.partner ? { company_name: snap.partner.company_name, country: snap.partner.country } : null,
        items: snap.items.map((it) => ({
          pos: it.pos,
          product_name: it.product_name,
          quantity: it.quantity,
          process: it.process,
          material: it.material,
          thickness_mm: it.thickness_mm,
          finish: it.finish,
          tolerance: it.tolerance,
          drawings: [...it.files, ...it.partner_keys.map((k) => k.slice(k.lastIndexOf('/') + 1))],
        })),
        notes: notes.notes,
        qa_checks: notes.qa_checks,
      });
      await ports.blob.put(`orders/${orderId}/traveler.pdf`, pdf.bytes.slice().buffer as ArrayBuffer, { contentType: 'application/pdf', sha256: pdf.sha256 });
      return { sha256: pdf.sha256, pages: pdf.pages };
    });

    const mode = await flagGate('stock');
    const cardBase = (stock: StockOutcome): Omit<HandoffCardInput, 'partner' | 'variant'> => ({
      run_id,
      site_origin: env.SITE_ORIGIN,
      po_number: snap.order.po_number,
      company: snap.order.company,
      country: snap.order.country,
      items: snap.items.length,
      unmatched_items: snap.unmatched,
      stock: {
        held: stock.items.filter((s) => s.status === 'held' || s.status === 'already_held').length,
        shortfall: stock.items.filter((s) => s.status === 'shortfall').length,
        not_stocked: stock.items.filter((s) => s.status === 'not_stocked').length,
      },
      over_held: stock.over_held,
      due_date: snap.order.due_date,
      traveller_pages: traveller.pages,
      injection_suspected: notes.injection_suspected,
    });

    if (mode === 'shadow') {
      await run('shadow-notice', NOTIFY, async () => {
        await closeRun(db, run_id, { status: 'succeeded', output: { mode: 'shadow', items: snap.items.length, unmatched: snap.unmatched, traveller_sha256: traveller.sha256, partner_suggested: snap.partner !== null } }, acc);
        try {
          await ports.telegram.sendCard(handoffNotice({ run_id, site_origin: env.SITE_ORIGIN, po_number: snap.order.po_number, company: snap.order.company, country: snap.order.country, text: 'Shadow mode: traveller ready, nothing was held or sent' }), null);
        } catch {
          console.error(formatLogLine(LOG_PREFIX, 'card send failed', { run_id, kind: 'handoff' }));
        }
        return true;
      });
      log('shadow');
      return { outcome: 'shadow', run_id };
    }

    // 4 reserve-stock
    const stock = await run<StockOutcome>('reserve-stock', DB, async () => {
      const materials = await activeMaterials(db, tenant);
      const out: StockOutcome = { items: [], over_held: 0 };
      const used = new Set<string>();
      for (const it of snap.items) {
        const m = mapMaterial(materials, { grade: it.grade, thickness_mm: it.thickness_mm });
        if (!m || it.quantity <= 0) {
          out.items.push({ id: it.id, material_id: null, status: 'not_stocked' });
          continue;
        }
        need(env, 'MATERIAL_STOCK');
        const stub = env.MATERIAL_STOCK.get(env.MATERIAL_STOCK.idFromName(stockObjectName(tenant, m.id))) as unknown as { reserve(id: string, n: { area_mm2?: number; quantity?: number }): Promise<StockHoldResult> };
        const needed = it.blank_mm2 !== null ? { area_mm2: Math.round(it.blank_mm2 * it.quantity * 100) / 100 } : { quantity: it.quantity };
        const r = await stub.reserve(it.id, needed);
        used.add(m.id);
        out.items.push(r.status === 'shortfall' ? { id: it.id, material_id: m.id, status: 'shortfall', missing: r.missing } : { id: it.id, material_id: m.id, status: r.status });
      }
      for (const materialId of used) {
        const stub = env.MATERIAL_STOCK!.get(env.MATERIAL_STOCK!.idFromName(stockObjectName(tenant, materialId))) as unknown as { check(): Promise<{ over_held: string[] }> };
        out.over_held += (await stub.check()).over_held.length;
      }
      return out;
    });

    // 5-6 request-handoff, wait-handoff (change_partner: another round)
    let partner = snap.partner;
    let decision: DecisionEventPayload | null = null;
    let lastVerb = 'none';
    for (let round = 1; round <= MAX_HANDOFF_ROUNDS; round++) {
      const suffix = round === 1 ? '' : `-${round}`;
      if (round > 1) {
        partner = await run(`reload-partner${suffix}`, DB, async () => {
          const order = await getOrder(db, orderId);
          const s = suggestPartner(await activePartners(db), { order_partner_id: order?.partner_id ?? null, processes: snap.items.map((i) => i.process ?? 'other') });
          return s ? { id: s.partner.id, company_name: clip(s.partner.company_name, 120), country: s.partner.country, matched_by: s.matched_by } : null;
        });
      }
      const card = (variant: HandoffCardInput['variant']) => handoffCard({ ...cardBase(stock), partner: partner ? { company_name: partner.company_name, country: partner.country, matched_by: partner.matched_by } : null, variant });
      await run(`request-handoff${suffix}`, NOTIFY, async () => {
        await checkpointRun(db, run_id, acc);
        const r = await request(env, ports, { run_id, card: card(round === 1 ? 'first' : 'changed') }, { output: { order_id: orderId, partner_id: partner?.id ?? null, traveller_sha256: traveller.sha256, stock: { items: stock.items.length, over_held: stock.over_held } } });
        return { telegram_message_id: r.telegram_message_id };
      });
      const waited = await waitWithReminder<DecisionEventPayload>(step, {
        run_id,
        type: 'handoff-approved',
        first: HANDOFF_FIRST,
        second: HANDOFF_SECOND,
        card: () => card('reminder'),
        onTimeout: async () => {
          await run(`handoff-expired${suffix}`, DB, async () => {
            await closeRun(db, run_id, { status: 'cancelled', error: 'no_decision', output: { handoff: 'expired', traveller_sha256: traveller.sha256 } }, acc);
            return true;
          });
        },
      }, { env, ports });
      if ('timedOut' in waited) {
        log('timed_out');
        return { outcome: 'timed_out', run_id };
      }
      decision = waited.event;
      lastVerb = decision.verb;
      if (decision.verb !== 'change_partner') break;
      decision = null;
    }

    let handedOff = false;
    if (decision?.verb === 'send_partner' && partner) {
      // 7 handoff
      await flagGate('handoff');
      const chosen = partner;
      await run('handoff', SEND, async () => {
        need(env, 'AGENT_APPROVAL_SECRET', 'QUOTE_FROM');
        if (!(await setOrderPartner(db, orderId, chosen.id))) throw new NonRetryableError('partner_changed');
        const to = await partnerAddress(db, chosen.id);
        if (!to) throw new NonRetryableError('partner_address_missing');
        const now = ports.clock.now();
        const expires = new Date(now.getTime() + LINK_DAYS * DAY_MS);
        const travellerUrl = await signedFileUrl(env, `orders/${orderId}/traveler.pdf`, expires, now);
        const drawingLines: string[] = [];
        for (const it of snap.items) {
          for (const key of it.partner_keys) drawingLines.push(`- ${it.pos}. ${it.product_name}, ${key.slice(key.lastIndexOf('/') + 1)}: ${await signedFileUrl(env, key, expires, now)}`);
        }
        const partLines = snap.items.map((it) => `${it.pos}. ${it.product_name} · qty ${it.quantity}${it.material ? ` · ${it.material}` : ''}${it.thickness_mm !== null ? ` ${it.thickness_mm} mm` : ''}${it.finish ? ` · finish ${it.finish}` : ''}`);
        const text = [
          'Hello,',
          '',
          `please find our production order ${snap.order.po_number}.`,
          '',
          'Parts:',
          ...partLines,
          '',
          `Due date: ${snap.order.due_date ? snap.order.due_date.slice(0, 10) : 'to be agreed'}`,
          '',
          `Production traveller (PDF): ${travellerUrl}`,
          ...(drawingLines.length ? ['', 'Drawings and CAD files:', ...drawingLines] : []),
          '',
          `The links are valid until ${expires.toISOString().slice(0, 10)}.`,
          'Please confirm the order and the delivery date by replying to this e-mail.',
          '',
          'Kind regards',
          'Microns Hub',
        ].join('\n');
        const sent = await ports.mailer.send(plainMail({ from: env.QUOTE_FROM, to: [to], subject: `Production order ${snap.order.po_number}`, text, tags: [{ name: 'agent', value: 'post_order' }], idempotency_key: handoffIdempotencyKey(orderId) }));
        if (!sent.ok) {
          if (sent.retryable) throw new Error(`send_${sent.status}`);
          throw new NonRetryableError(`send_${sent.status}`);
        }
        return { provider_id: sent.provider_id, links: 1 + drawingLines.length };
      });
      handedOff = true;
    }

    // 8 reorder (shortfall or open low-stock alerts of the order's materials)
    const reorder = await run('reorder-input', DB, async () => {
      const materialIds = [...new Set(stock.items.map((s) => s.material_id).filter((m): m is string => m !== null))];
      const alerts = await openLowStockAlerts(db, materialIds);
      const materials = await activeMaterials(db, tenant);
      const list: Array<ReorderMaterial & { grade: string | null; thickness_mm: number | null; missing: string; supplier_sku: string | null; low_stock_alert: boolean }> = [];
      for (const id of materialIds) {
        const short = stock.items.filter((s) => s.material_id === id && s.status === 'shortfall');
        const alert = alerts.some((a) => a.material_id === id);
        if (!short.length && !alert) continue;
        const m = materials.find((x) => x.id === id);
        const thickness = num(m?.thickness_mm);
        const grade = m?.grade ?? null;
        const area = short.reduce((s, x) => s + (x.missing?.area_mm2 ?? 0), 0);
        const qty = short.reduce((s, x) => s + (x.missing?.quantity ?? 0), 0);
        const missing = area > 0 ? `${Math.round(area / 10_000) / 100} m2 missing` : qty > 0 ? `${qty} pcs missing` : 'low stock alert';
        const supplier = await supplierOf(db, tenant, { grade: recogniseMaterial(grade ?? m?.name ?? '').grade, thickness_mm: thickness });
        list.push({ label: clip([m?.name, grade, thickness !== null ? `${thickness} mm` : null].filter(Boolean).join(' · ') || 'material', 80), need: missing, supplier: supplier?.supplier ? clip(supplier.supplier, 80) : null, grade, thickness_mm: thickness, missing, supplier_sku: supplier?.supplier_sku ? clip(supplier.supplier_sku, 60) : null, low_stock_alert: alert });
      }
      return list;
    });

    let reorderOutcome: 'none' | 'approved' | 'dismissed' | 'expired' = 'none';
    let approvedDraft: { subject: string; body_text: string } | null = null;
    if (reorder.length > 0) {
      // the hand-off wait can last 14 days: the flag is read again before the draft and its card
      await flagGate('reorder');
      const draft = await llmStep<{ subject: string; body_text: string }, { subject: string; body_text: string }>(
        'reorder-draft',
        prompts.reorder,
        async () => [{ type: 'text', text: `<reorder>\n${blockJson({ po_number: snap.order.po_number, materials: reorder.map((r) => ({ name: r.label, grade: r.grade, thickness_mm: r.thickness_mm, missing: r.missing, low_stock_alert: r.low_stock_alert, supplier: r.supplier, supplier_sku: r.supplier_sku })) }, 1)}\n</reorder>` }],
        (v) => ({ subject: clip(v.subject, DRAFT_SUBJECT_CHARS), body_text: String(v.body_text ?? '').slice(0, DRAFT_BODY_CHARS) }),
      );
      const card = (reminder: boolean) => reorderCard({ run_id, site_origin: env.SITE_ORIGIN, po_number: snap.order.po_number, materials: reorder, reminder });
      await run('request-reorder', NOTIFY, async () => {
        await checkpointRun(db, run_id, acc);
        await request(env, ports, { run_id, card: card(false) }, { output: { order_id: orderId, reorder_draft: draft, handoff: handedOff ? 'sent' : lastVerb } });
        return true;
      });
      const waited = await waitWithReminder<DecisionEventPayload>(step, { run_id, type: 'reorder-approved', first: REORDER_FIRST, second: REORDER_SECOND, card: () => card(true), onTimeout: async () => {} }, { env, ports });
      reorderOutcome = 'timedOut' in waited ? 'expired' : waited.event.verb === 'approve_draft' ? 'approved' : 'dismissed';
      if (reorderOutcome === 'approved') {
        approvedDraft = draft;
        await run('keep-reorder-draft', DB, async () => {
          await checkpointRun(db, run_id, acc, { output: { order_id: orderId, reorder_draft: { ...draft, status: 'approved' }, handoff: handedOff ? 'sent' : lastVerb } });
          return true;
        });
      }
    }

    // 9 close
    await run('close', DB, async () => {
      await closeRun(db, run_id, {
        status: 'succeeded',
        output: {
          order_id: orderId,
          handoff: handedOff ? 'sent' : lastVerb,
          partner_id: handedOff ? partner?.id ?? null : null,
          items: snap.items.length,
          unmatched: snap.unmatched,
          stock: stock.items.map((s) => s.status),
          traveller_sha256: traveller.sha256,
          reorder: reorderOutcome,
          // the approved draft stays on the run for the staff member (no supplier address is stored, nothing is sent)
          ...(approvedDraft ? { reorder_draft: { ...approvedDraft, status: 'approved' } } : {}),
        },
      }, acc);
      return true;
    });
    const outcome: PostOrderOutcome = handedOff ? 'handed_off' : 'held';
    log(outcome);
    return { outcome, run_id };
  } catch (error) {
    if (error instanceof Halt) return error.result;
    const failedStep = current;
    const code = errorCode(error);
    await step.do('fail-run', DB, async () => {
      await failRun(env, ports, run_id, { error: code, failed_step: failedStep, restartable: true }, acc);
      return true;
    });
    console.error(formatLogLine(LOG_PREFIX, 'post order failed', { order_id: orderId, step: failedStep, error: code }));
    return { outcome: 'failed', run_id, failed_step: failedStep };
  }
}
