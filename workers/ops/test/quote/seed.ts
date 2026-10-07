// Canonical synthetic data of the quote Workflow tests (T1 here, T2 in test/t2/quote.t2.ts through the
// mini-PostgREST's /__stub/seed): one RFQ with a sheet-metal bracket (STEP, a succeeded analyse job) and,
// optionally, a CNC block without a CAD result; owner-style pricing rules and catalogue rows with made-up values;
// the quote row of version 1 with a fixed creation time, so the cover e-mail input (offer date) and with it the LLM
// fixture hashes are the same in both tiers. Every value is synthetic; addresses use example.de.

import type { CadResultV1 } from '../../src/cad/types';

export const TENANT = '00000000-0000-0000-0000-000000000001';
export const RFQ_ID = '7c1e5b2a-4d0f-4a8e-9b10-000000000001';
export const QWID = '7c1e5b2a-4d0f-4a8e-9b10-0000000000a1';
export const PART_1 = '7c1e5b2a-4d0f-4a8e-9b10-0000000000b1';
export const PART_2 = '7c1e5b2a-4d0f-4a8e-9b10-0000000000b2';
export const FILE_1 = '7c1e5b2a-4d0f-4a8e-9b10-0000000000c1';
export const JOB_1 = '7c1e5b2a-4d0f-4a8e-9b10-0000000000d1';
export const RFQ_NUMBER = 'RFQ-05102026-7';
export const QUOTE_CREATED_AT = '2026-10-05T09:00:00.000Z';
export const CONTACT_EMAIL = 'erika.beispiel@example.de';
export const INPUT_SHA = 'a1'.repeat(32);
export const PARAMS_SHA = 'b2'.repeat(32);

export const BRACKET_RESULT: CadResultV1 = {
  v: 1,
  kind: 'step',
  source: 'unfold-service',
  units: 'mm',
  thickness_mm: 2,
  flat: { width_mm: 200, height_mm: 100, area_mm2: 18000, cut_length_mm: 700, pierces: 2 },
  bends: { count: 2, items: [{ angle_deg: 90, radius_mm: 2 }, { angle_deg: 90, radius_mm: 2 }] },
  bbox_mm: null,
  volume_mm3: null,
  warnings: [],
  versions: { service: 'stub' },
  duration_ms: 120,
};

export function part1(): Record<string, unknown> {
  return {
    id: PART_1,
    rfq_id: RFQ_ID,
    product_name: 'Part 1',
    description: 'Process: Sheet Metal\nMaterial: Steel (S235JR)\nSurface Treatment: Powder coating\nThickness: 2 mm\nComments: deburr all edges',
    quantity: 20,
    unit_price: 0,
    total_price: 0,
    created_at: '2026-10-04T08:00:00.000Z',
    updated_at: '2026-10-04T08:00:00.000Z',
    original_values: { process: 'sheet-metal', materialLabel: 'Steel', materialSubtypeLabel: 'S235JR', surfaceTreatment: 'powder-coating', thickness: '2', comments: 'deburr all edges' },
  };
}

export function part2(): Record<string, unknown> {
  return {
    id: PART_2,
    rfq_id: RFQ_ID,
    product_name: 'Part 2',
    description: 'Process: CNC Machining\nMaterial: Aluminium (6082)',
    quantity: 5,
    unit_price: 0,
    total_price: 0,
    created_at: '2026-10-04T08:00:00.000Z',
    updated_at: '2026-10-04T08:00:00.000Z',
    original_values: { process: 'cnc-machining', materialLabel: 'Aluminium', materialSubtypeLabel: '6082' },
  };
}

export interface SeedOptions {
  /** Add the CNC part (a manual line: no CAD result). */
  cncPart?: boolean;
  country?: string;
  /** Leave out the shipping rule (the draft is then incomplete). */
  noShipping?: boolean;
}

/** Rows per table (plain JSON). */
export function seedRows(o: SeedOptions = {}): Record<string, Array<Record<string, unknown>>> {
  const parts = o.cncPart ? [part1(), part2()] : [part1()];
  let rule = 0;
  const r = (process: string, rule_key: string, value: number, unit: string) => ({
    id: `7c1e5b2a-4d0f-4a8e-9b10-${String(++rule).padStart(12, 'e')}`,
    tenant_id: TENANT,
    process,
    rule_key,
    material_match: null,
    qty_min: null,
    qty_max: null,
    value,
    unit,
    currency: 'EUR',
    version: 1,
    valid_from: '2026-01-01',
    valid_to: null,
    is_active: true,
  });
  const rules = [
    r('sheet_metal', 'sheet_scrap_factor', 1.15, 'factor'),
    r('sheet_metal', 'laser_cut_speed_mm_min', 3000, 'mm/min'),
    r('sheet_metal', 'laser_pierce_s', 1, 's'),
    r('sheet_metal', 'laser_rate_per_h', 120, 'EUR/h'),
    r('sheet_metal', 'bend_per_hit', 1.5, 'EUR/hit'),
    r('sheet_metal', 'bend_setup', 30, 'EUR'),
    r('sheet_metal', 'setup_fixed', 20, 'EUR'),
    r('sheet_metal', 'margin_pct', 25, 'pct'),
    r('finishing', 'finish_powder_coating_per_m2', 12, 'EUR/m2'),
    r('global', 'min_order_value', 150, 'EUR'),
    ...(o.noShipping ? [] : [r('shipping', 'shipping_flat', 35, 'EUR')]),
  ];
  return {
    rfqs: [
      {
        id: RFQ_ID,
        tenant_id: TENANT,
        rfq_number: RFQ_NUMBER,
        title: `${RFQ_NUMBER} - Example Metall GmbH`,
        company_name: 'Example Metall GmbH',
        contact_first_name: 'Erika',
        contact_last_name: 'Beispiel',
        contact_email: CONTACT_EMAIL,
        contact_phone: '+49 30 0000000',
        address: 'Musterstrasse 1',
        city: 'Berlin',
        zip_code: '10115',
        country: o.country ?? 'DE',
        status: 'draft',
        currency: 'EUR',
        description: 'Please quote 20 brackets, powder coated RAL 9005.',
        parts_details: parts,
        customer_id: null,
        total_amount: 0,
        shipping_cost: 0,
        source: 'web',
        inbound_email_id: null,
        created_at: '2026-10-04T08:00:00.000Z',
      },
    ],
    rfq_files: [
      {
        id: FILE_1,
        rfq_id: RFQ_ID,
        file_name: 'bracket.step',
        file_path: `${RFQ_ID}/${FILE_1}-bracket.step`,
        file_type: 'application/step',
        file_size: 2048,
        part_id: PART_1,
        source: 'web',
        r2_key: `rfq/${RFQ_ID}/${FILE_1}-bracket.step`,
        sha256: INPUT_SHA,
        content_type: 'application/step',
        tenant_id: TENANT,
        created_at: '2026-10-04T08:00:00.000Z',
      },
    ],
    cad_jobs: [
      {
        id: JOB_1,
        tenant_id: TENANT,
        idempotency_key: `${INPUT_SHA}:analyse:${PARAMS_SHA}`,
        job_type: 'analyse',
        backend: 'vps',
        rfq_id: RFQ_ID,
        rfq_file_id: FILE_1,
        quote_workflow_id: null,
        input_r2_key: `rfq/${RFQ_ID}/${FILE_1}-bracket.step`,
        input_sha256: INPUT_SHA,
        params: { material: 'steel', thickness_override: 2, k_factor_override: 0, drawing_size: 'A3', process: 'sheet_metal' },
        output_r2_keys: [`cad/${JOB_1}/output/result.json`, `cad/${JOB_1}/output/flat.dxf`],
        result: BRACKET_RESULT,
        status: 'succeeded',
        attempts: 1,
        created_at: '2026-10-04T08:05:00.000Z',
        finished_at: '2026-10-04T08:06:00.000Z',
      },
    ],
    pricing_rules: rules,
    catalog_materials: [
      { id: '7c1e5b2a-4d0f-4a8e-9b10-0000000000f1', tenant_id: TENANT, name: 'Sheet S235JR 2 mm', material_grade: 'S235JR', form_factor: 'sheet', dimensions: { thickness_mm: 2 }, weight_per_unit: null, stock_unit: 'sheet', price_per_unit: null, price_per_kg: 1.2, currency: 'EUR', is_available: true },
    ],
    quote_workflows: [
      { id: QWID, tenant_id: TENANT, rfq_id: RFQ_ID, quote_version: 1, workflow_instance_id: `quote-${RFQ_ID}-v1`, status: 'started', created_at: QUOTE_CREATED_AT, updated_at: QUOTE_CREATED_AT },
    ],
  };
}

/** Canned model answers of the quote prompts (structured outputs as the schemas define them). */
export const NOTES_ANSWER = {
  assumptions: ['Material read as S235JR from the part description.', 'Powder coating priced on both faces of the flat part.'],
  risks: ['The RAL colour is named only in the RFQ text.'],
  suggestions: [],
  injection_suspected: false,
};

export const COVER_ANSWER = {
  language: 'de',
  subject: `Ihr Angebot ${RFQ_NUMBER}`,
  body_text: `Sehr geehrte Frau Beispiel,\n\nvielen Dank fuer Ihre Anfrage. Im Anhang finden Sie unser Angebot ${RFQ_NUMBER}, gueltig bis 2026-10-19.\n\nBitte antworten Sie auf diese E-Mail, um das Angebot anzunehmen oder Aenderungen zu besprechen.\n\nMicrons Hub`,
  followup_1: { subject: `Re: Ihr Angebot ${RFQ_NUMBER}`, body_text: 'Sehr geehrte Frau Beispiel,\n\nist unser Angebot gut angekommen? Wir beantworten gern Ihre Fragen.\n\nMicrons Hub' },
  followup_2: { subject: `Re: Ihr Angebot ${RFQ_NUMBER}`, body_text: 'Sehr geehrte Frau Beispiel,\n\nunser Angebot ist bis 2026-10-19 gueltig. Melden Sie sich gern bei Fragen.\n\nMicrons Hub' },
};

/** A customer reply stored as microns-mail would (raw MIME in R2 + inbound_emails row). */
export function replyMime(o: { subject: string; text: string; messageId?: string; inReplyTo?: string | null }): string {
  const inReplyTo = o.inReplyTo === undefined ? `<q.${QWID}.0@rfq.micronshub.eu>` : o.inReplyTo;
  return [
    'From: Erika Beispiel <erika.beispiel@example.de>',
    'To: replies@rfq.micronshub.eu',
    `Subject: ${o.subject}`,
    `Message-ID: ${o.messageId ?? '<reply-1@example.de>'}`,
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`] : []),
    'Date: Wed, 07 Oct 2026 10:00:00 +0200',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    o.text,
    '',
    'Am 05.10.2026 schrieb MicronsHub Quotations:',
    '> Sehr geehrte Frau Beispiel, im Anhang finden Sie unser Angebot.',
    '',
  ].join('\r\n');
}
