// Synthetic seed rows of the post-order tests (example.* addresses, fictitious companies), shared by the T1
// harness (test/post-order/harness.ts) and the T2 test (test/t2/post-order.t2.ts, through the mini-PostgREST).
// Plain data only: no import of src/, so the T2 runner (Node, no cloudflare:* modules) can load it.

export const TENANT = '00000000-0000-0000-0000-000000000001';
export const ORDER = '4a000000-0000-4000-8000-0000000000a1';
export const RFQ = '0a000000-0000-4000-8000-0000000000a1';
export const PART_BRACKET = 'b1000000-0000-4000-8000-000000000001';
export const PART_COVER = 'b1000000-0000-4000-8000-000000000002';
export const PART_SURCHARGE = 'b1000000-0000-4000-8000-000000000003';
export const ITEM_BRACKET = 'c1000000-0000-4000-8000-000000000001';
export const ITEM_COVER = 'c1000000-0000-4000-8000-000000000002';
export const ITEM_WASHER = 'c1000000-0000-4000-8000-000000000003';
export const ITEM_SURCHARGE = 'c1000000-0000-4000-8000-000000000004';
export const FILE_BRACKET = 'd1000000-0000-4000-8000-000000000001';
export const JOB_ANALYSE = 'e1000000-0000-4000-8000-000000000001';
export const JOB_DRAWING = 'e1000000-0000-4000-8000-000000000002';
export const PARTNER_LASER = 'f1000000-0000-4000-8000-000000000001';
export const PARTNER_CNC = 'f1000000-0000-4000-8000-000000000002';
export const MATERIAL = 'a2000000-0000-4000-8000-000000000001';
export const SHEET = 'a3000000-0000-4000-8000-000000000001';
export const STAFF = 'user:11111111-1111-4111-8111-111111111111';
export const INSTANCE = `post-order-${ORDER}`;
export const PARTNER_LASER_EMAIL = 'orders@laser-partner.example.gr';
export const PARTNER_CNC_EMAIL = 'auftrag@cnc-partner.example.de';

export interface SeedOptions {
  /** Area of the one stock sheet (mm x mm); null = no stock item. */
  sheet?: [number, number] | null;
  /** Partner already set on the order. */
  orderPartner?: string | null;
  lowStockAlert?: boolean;
}

export type SeedRows = Record<string, Array<Record<string, unknown>>>;

/** Rows per table of an order of a quoted RFQ (and the R2 objects of its CAD outputs). */
export function seedRows(o: SeedOptions = {}): { tables: SeedRows; objects: Record<string, string> } {
  const tables: SeedRows = {};
  const db = { seed: (table: string, rows: Array<Record<string, unknown>>) => void (tables[table] = [...(tables[table] ?? []), ...rows]) };
  db.seed('rfqs', [
    {
      id: RFQ,
      company_name: 'Example Fabrication GmbH',
      country: 'DE',
      rfq_number: 'RFQ-01102026-7',
      contact_email: 'erika.beispiel@example.de',
      tenant_id: TENANT,
      parts_details: [
        { id: PART_BRACKET, product_name: 'Bracket', quantity: 10, description: 'Process: Sheet Metal\nMaterial: Steel (S235JR)\nThickness: 2 mm\nComments: deburr all edges, powder coat after bending', original_values: { process: 'sheet-metal', material: 'S235JR', thickness: '2', surfaceTreatment: 'powder coating', tolerance: 'ISO 2768-m' } },
        { id: PART_COVER, product_name: 'Cover', quantity: 5, description: 'Process: CNC\nMaterial: EN AW-6082', original_values: { process: 'cnc', material: 'EN AW-6082', thickness: '10', tolerance: '±0.05 mm' } },
        { id: PART_SURCHARGE, product_name: 'Minimum order surcharge', quantity: 1, description: 'Minimum order value', original_values: { source: 'quote_surcharge' } },
      ],
    },
  ]);
  db.seed('orders', [{ id: ORDER, title: 'PO-1001', po_number: 'PO-1001', from_rfq_number: 'RFQ-01102026-7', rfq_id: RFQ, status: 'new', currency: 'EUR', delivery_date: '2026-10-20T00:00:00.000Z', created_at: '2026-10-05T08:00:00.000Z', partner_id: o.orderPartner ?? null, tenant_id: TENANT }]);
  db.seed('order_items', [
    { id: ITEM_BRACKET, order_id: ORDER, product_name: 'Bracket', description: 'Bracket', quantity: 10, unit_price: 11.5, total_price: 115, created_at: '2026-10-05T08:00:00.000Z', tenant_id: TENANT },
    { id: ITEM_COVER, order_id: ORDER, product_name: 'Cover', description: 'Cover', quantity: 5, unit_price: 40, total_price: 200, created_at: '2026-10-05T08:00:01.000Z', tenant_id: TENANT },
    { id: ITEM_WASHER, order_id: ORDER, product_name: 'Spare washer', description: '', quantity: 3, unit_price: 0, total_price: 0, created_at: '2026-10-05T08:00:02.000Z', tenant_id: TENANT },
    { id: ITEM_SURCHARGE, order_id: ORDER, product_name: 'Minimum order surcharge', description: '', quantity: 1, unit_price: 20, total_price: 20, created_at: '2026-10-05T08:00:03.000Z', tenant_id: TENANT },
  ]);
  db.seed('rfq_files', [{ id: FILE_BRACKET, rfq_id: RFQ, part_id: PART_BRACKET, file_name: 'bracket.step', file_path: `${RFQ}/${FILE_BRACKET}-bracket.step`, file_type: 'model/step', file_size: 365, r2_key: `rfq/${RFQ}/${FILE_BRACKET}-bracket.step`, sha256: 'a'.repeat(64), content_type: 'model/step', source: 'email', tenant_id: TENANT }]);
  db.seed('cad_jobs', [
    { id: JOB_ANALYSE, rfq_id: RFQ, rfq_file_id: FILE_BRACKET, idempotency_key: `${'a'.repeat(64)}:analyse:${'b'.repeat(64)}`, job_type: 'analyse', input_r2_key: `rfq/${RFQ}/${FILE_BRACKET}-bracket.step`, input_sha256: 'a'.repeat(64), status: 'succeeded', output_r2_keys: [`cad/${JOB_ANALYSE}/output/result.json`, `cad/${JOB_ANALYSE}/output/flat.dxf`], result: { v: 1, kind: 'step', source: 'unfold-service', units: 'mm', thickness_mm: 2, flat: { width_mm: 200, height_mm: 150, area_mm2: 28000, cut_length_mm: 900, pierces: 3 }, bends: { count: 2, items: [] }, bbox_mm: null, volume_mm3: null, warnings: [], versions: {}, duration_ms: 1200 }, tenant_id: TENANT, created_at: '2026-10-02T08:00:00.000Z' },
    { id: JOB_DRAWING, rfq_id: RFQ, rfq_file_id: FILE_BRACKET, idempotency_key: `${'a'.repeat(64)}:drawing_pdf:${'c'.repeat(64)}`, job_type: 'drawing_pdf', input_r2_key: `rfq/${RFQ}/${FILE_BRACKET}-bracket.step`, input_sha256: 'a'.repeat(64), status: 'succeeded', output_r2_keys: [`cad/${JOB_DRAWING}/output/drawing.pdf`], result: null, tenant_id: TENANT, created_at: '2026-10-02T08:01:00.000Z' },
  ]);
  db.seed('production_partners', [
    { id: PARTNER_LASER, company_name: 'Laser Partner AE', contact_name: 'Partner contact', country: 'GR', email: PARTNER_LASER_EMAIL, phone: null, specializations: ['laser_cutting', 'bending'], active: true },
    { id: PARTNER_CNC, company_name: 'CNC Partner GmbH', contact_name: 'Partner contact', country: 'DE', email: PARTNER_CNC_EMAIL, phone: null, specializations: ['cnc_milling'], active: true },
  ]);
  db.seed('materials', [{ id: MATERIAL, tenant_id: TENANT, name: 'Steel sheet', category: 'sheet_metal', grade: 'S235JR', thickness_mm: 2, base_unit: 'm2', is_active: true }]);
  const sheet = o.sheet === undefined ? ([1000, 1000] as [number, number]) : o.sheet;
  if (sheet) db.seed('stock_items', [{ id: SHEET, material_id: MATERIAL, origin: 'purchased', width_mm: sheet[0], height_mm: sheet[1], created_at: '2026-09-01T00:00:00.000Z', tenant_id: TENANT }]);
  db.seed('catalog_materials', [{ id: 'a4000000-0000-4000-8000-000000000001', tenant_id: TENANT, name: 'S235JR sheet 2 mm', material_grade: 'S235JR', form_factor: 'sheet', dimensions: { thickness_mm: 2 }, is_available: true, supplier: 'Example Steel Supply', supplier_sku: 'S235-2-1000' }]);
  if (o.lowStockAlert) db.seed('low_stock_alerts', [{ id: 'a5000000-0000-4000-8000-000000000001', tenant_id: TENANT, material_id: MATERIAL, current_stock: 1, threshold: 5, base_unit: 'm2', resolved: false }]);
  const objects = Object.fromEntries([`cad/${JOB_ANALYSE}/output/flat.dxf`, `cad/${JOB_DRAWING}/output/drawing.pdf`].map((k) => [k, 'cad output']));
  return { tables, objects };
}

