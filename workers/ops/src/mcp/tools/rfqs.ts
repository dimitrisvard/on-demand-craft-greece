// New remote tools over RFQs, inbound e-mails and quote workflows (default tenant only).
//   list_rfqs, get_rfq, list_inbound_emails, get_quote_workflow: reads (service role).
//   start_quote: the logic of POST /api/agent/start kind 'quote', run in-process with the caller's staff principal
//   (flag agent.quote on, RFQ exists, no active quote, next version, Workflow create; "already exists" = created
//   false).
// Personal data: lists mask sender addresses; get_rfq shows the RFQ's own contact fields and the linked e-mails'
// subjects and excerpt length only (never e-mail bodies; the excerpt stays in the dashboard).

import { z } from 'zod';
import { daysAgoIso, isoTime, maskEmail } from '../format';
import { tool, type ToolDef, type ToolResult } from '../registry';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const err = (message: string): ToolResult => ({ text: `Error: ${message}`, isError: true });

export const RFQ_LIST_COLUMNS = 'id,rfq_number,company_name,country,status,source,total_amount,currency,created_at';

export const listRfqs = tool({
  name: 'list_rfqs',
  description: 'List recent RFQs (request for quotation) with number, company, country, status, source and total. Filter by status and source.',
  cls: 'R',
  stage: 's1',
  shape: {
    status: z.string().optional().describe('RFQ status, e.g. pending, quoted, approved'),
    source: z.enum(['web', 'email', 'techpilot', 'manual']).optional(),
    days_back: z.number().optional().default(30),
    limit: z.number().optional().default(20).describe('At most 100'),
  },
  async run({ status, source, days_back, limit }, ctx) {
    let query = ctx.sb()
      .from('rfqs')
      .select(RFQ_LIST_COLUMNS)
      .eq('tenant_id', ctx.tenantId)
      .gte('created_at', daysAgoIso(days_back, ctx.deps.now()))
      .order('created_at', { ascending: false })
      .limit(Math.max(1, Math.min(100, Math.floor(limit) || 20)));
    if (status) query = query.eq('status', status);
    if (source) query = query.eq('source', source);
    const { data, error } = await query;
    if (error) return err(error.message);
    if (!data || data.length === 0) return { text: 'No RFQs found matching the criteria.' };
    const lines = (data as Array<Record<string, any>>).map((r) =>
      `${r.rfq_number} | ${r.company_name || '-'} (${r.country || '-'}) | ${r.status} | ${r.source || 'web'} | ${r.total_amount ?? '-'} ${r.currency || ''} | ${isoTime(r.created_at)}\n   ID: ${r.id}`);
    return { text: `Found ${data.length} RFQs:\n\n${lines.join('\n')}` };
  },
});

export const getRfq = tool({
  name: 'get_rfq',
  description: 'Get one RFQ by id or RFQ number: contact, parts summary, files, latest quote workflow and linked inbound e-mails.',
  cls: 'R',
  stage: 's1',
  shape: { rfq_id: z.string().optional().describe('RFQ UUID'), rfq_number: z.string().optional().describe('RFQ number, e.g. RFQ-20261004-1') },
  async run({ rfq_id, rfq_number }, ctx) {
    if (!rfq_id && !rfq_number) return err('rfq_id or rfq_number is required');
    if (rfq_id && !UUID_RE.test(rfq_id)) return { text: `RFQ not found: ${rfq_id}` };
    const sb = ctx.sb();
    let query = sb.from('rfqs').select('*').eq('tenant_id', ctx.tenantId);
    query = rfq_id ? query.eq('id', rfq_id) : query.eq('rfq_number', rfq_number as string);
    const { data: rfq, error } = await query.limit(1).maybeSingle();
    if (error) return err(error.message);
    if (!rfq) return { text: `RFQ not found: ${rfq_id ?? rfq_number}` };
    const [files, quotes, mails] = await Promise.all([
      sb.from('rfq_files').select('file_name,file_type,file_size,source').eq('rfq_id', rfq.id).limit(50),
      sb.from('quote_workflows').select('quote_version,status,total_amount,currency,approved_at,sent_at').eq('rfq_id', rfq.id).order('quote_version', { ascending: false }).limit(1),
      sb.from('inbound_emails').select('id,subject,status,received_at,from_email').eq('rfq_id', rfq.id).order('received_at', { ascending: false }).limit(10),
    ]);
    const parts = Array.isArray(rfq.parts_details) ? (rfq.parts_details as Array<Record<string, any>>) : [];
    const q = (quotes.data ?? [])[0] as Record<string, any> | undefined;
    const text = [
      '=== RFQ ===',
      `ID: ${rfq.id}`,
      `Number: ${rfq.rfq_number}`,
      `Status: ${rfq.status} | Source: ${rfq.source || 'web'}`,
      `Company: ${rfq.company_name || '-'} (${rfq.country || '-'})`,
      `Contact: ${[rfq.contact_first_name, rfq.contact_last_name].filter(Boolean).join(' ') || '-'} ${rfq.contact_email ? `<${rfq.contact_email}>` : ''}`.trimEnd(),
      `Total: ${rfq.total_amount ?? '-'} ${rfq.currency || ''} | Shipping: ${rfq.shipping_cost ?? '-'}`,
      `Created: ${isoTime(rfq.created_at)}`,
      '',
      `=== PARTS (${parts.length}) ===`,
      ...parts.slice(0, 50).map((p, i) => `  ${i + 1}. ${p.product_name || p.name || 'part'} x${p.quantity ?? '?'}${p.material ? ` | ${p.material}` : ''}${p.unit_price !== undefined ? ` | unit ${p.unit_price}` : ''}`),
      '',
      `=== FILES (${(files.data ?? []).length}) ===`,
      ...((files.data ?? []) as Array<Record<string, any>>).map((f) => `  ${f.file_name} (${f.file_type || '-'}, ${f.file_size ?? '?'} bytes, ${f.source || 'web'})`),
      '',
      '=== LATEST QUOTE ===',
      q ? `  v${q.quote_version} ${q.status} | ${q.total_amount ?? '-'} ${q.currency || ''} | approved ${isoTime(q.approved_at, '-')} | sent ${isoTime(q.sent_at, '-')}` : '  none',
      '',
      '=== INBOUND E-MAILS ===',
      ...((mails.data ?? []) as Array<Record<string, any>>).map((m) => `  ${isoTime(m.received_at)} ${m.status} | ${m.from_email || '-'} | ${m.subject || '(no subject)'}\n     ID: ${m.id}`),
    ].join('\n');
    return { text };
  },
});

export const listInboundEmails = tool({
  name: 'list_inbound_emails',
  description: 'List recent inbound e-mails of the RFQ and reply mailboxes with status, kind and linked RFQ. Sender addresses are masked.',
  cls: 'R',
  stage: 's1',
  shape: {
    status: z.enum(['received', 'parsed', 'needs_review', 'rfq_created', 'attached', 'matched', 'rejected', 'duplicate', 'spam', 'failed']).optional(),
    mailbox: z.enum(['rfq', 'replies', 'gmail']).optional(),
    days_back: z.number().optional().default(7),
    limit: z.number().optional().default(20).describe('At most 100'),
  },
  async run({ status, mailbox, days_back, limit }, ctx) {
    let query = ctx.sb()
      .from('inbound_emails')
      .select('id,mailbox,kind,status,from_email,subject,received_at,rfq_id,parse_confidence')
      .eq('tenant_id', ctx.tenantId)
      .gte('received_at', daysAgoIso(days_back, ctx.deps.now()))
      .order('received_at', { ascending: false })
      .limit(Math.max(1, Math.min(100, Math.floor(limit) || 20)));
    if (status) query = query.eq('status', status);
    if (mailbox) query = query.eq('mailbox', mailbox);
    const { data, error } = await query;
    if (error) return err(error.message);
    if (!data || data.length === 0) return { text: 'No inbound e-mails found matching the criteria.' };
    const lines = (data as Array<Record<string, any>>).map((m) =>
      `${isoTime(m.received_at)} [${m.mailbox}] ${m.status}${m.kind ? `/${m.kind}` : ''} | ${maskEmail(m.from_email)} | ${m.subject || '(no subject)'}${m.rfq_id ? ` | RFQ ${m.rfq_id}` : ''}\n   ID: ${m.id}`);
    return { text: `Found ${data.length} inbound e-mails:\n\n${lines.join('\n')}` };
  },
});

export const getQuoteWorkflow = tool({
  name: 'get_quote_workflow',
  description: 'Get the quote workflow of an RFQ (latest version unless one is given): status, totals, line summary and approvals.',
  cls: 'R',
  stage: 's1',
  shape: { rfq_id: z.string().describe('RFQ UUID'), version: z.number().optional().describe('Quote version (default: latest)') },
  async run({ rfq_id, version }, ctx) {
    if (!UUID_RE.test(rfq_id)) return { text: `No quote workflow for RFQ ${rfq_id}` };
    let query = ctx.sb().from('quote_workflows').select('*').eq('tenant_id', ctx.tenantId).eq('rfq_id', rfq_id);
    if (version !== undefined) query = query.eq('quote_version', version);
    const { data, error } = await query.order('quote_version', { ascending: false }).limit(1);
    if (error) return err(error.message);
    const q = (data ?? [])[0] as Record<string, any> | undefined;
    if (!q) return { text: `No quote workflow for RFQ ${rfq_id}${version !== undefined ? ` version ${version}` : ''}` };
    const lines = Array.isArray(q.pricing?.lines) ? (q.pricing.lines as Array<Record<string, any>>) : [];
    const text = [
      `=== QUOTE WORKFLOW v${q.quote_version} ===`,
      `ID: ${q.id}`,
      `Status: ${q.status}${q.current_step ? ` (step ${q.current_step})` : ''} | Process: ${q.process || '-'}`,
      `Total: ${q.total_amount ?? '-'} ${q.currency}`,
      `Approved: ${q.approved_by ? `${q.approved_by} via ${q.approved_via || '-'} at ${isoTime(q.approved_at)}` : 'no'}`,
      `Sent: ${isoTime(q.sent_at, 'no')} | Follow-ups sent: ${q.follow_ups_sent ?? 0}`,
      q.outcome_reason ? `Outcome: ${q.outcome_reason}` : '',
      q.error ? `Error: ${q.error}` : '',
      '',
      `=== LINES (${lines.length}) ===`,
      ...lines.slice(0, 50).map((l, i) => `  ${l.line_no ?? i + 1}. ${l.description || l.product_name || 'line'} x${l.qty ?? l.quantity ?? '?'} | unit ${l.unit_price ?? 'manual'} | total ${l.line_total ?? l.total ?? '-'}${l.manual ? ' (manual price)' : ''}`),
    ].filter((x) => x !== '').join('\n');
    return { text };
  },
});

export const startQuote = tool({
  name: 'start_quote',
  description: 'Start the quote agent for an RFQ (next quote version). Needs flag agent.quote on and no active quote for the RFQ.',
  cls: 'W',
  stage: 'opt',
  idempotent: true,
  shape: { rfq_id: z.string().describe('RFQ UUID') },
  async run({ rfq_id }, ctx) {
    if (!UUID_RE.test(rfq_id)) return err('rfq_id must be a UUID');
    const resp = await ctx.deps.inprocess(ctx, { endpoint: 'agent', action: 'start', functionUrl: '/api/agent/start', method: 'POST', body: { v: 1, kind: 'quote', rfq_id } });
    const body = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    if (!resp.ok) return err(`start refused (${resp.status} ${typeof body.error === 'string' ? body.error : 'error'})`);
    return { text: `Quote agent ${body.created ? 'started' : 'already running'}: instance ${String(body.instance_id)}` };
  },
});

export const RFQ_TOOLS: readonly ToolDef[] = [listRfqs, getRfq, listInboundEmails, getQuoteWorkflow, startQuote];
