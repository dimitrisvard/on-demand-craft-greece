// Shared row shape for the xometry_offers table (see ../../../schema.sql).

export type XometryOfferStatus =
  | 'new'
  | 'priced'
  | 'ready'
  | 'needs_manual'
  | 'needs_review'
  | 'excluded_secondary_ops'
  | 'submitting'
  | 'submitted'
  | 'skipped'
  | 'error';

export interface PartFileRef {
  name: string;
  downloadUrl: string | null;
}

export interface XometryOfferRow {
  code: string;
  offer_id: string;
  is_urgent: boolean | null;
  process_type: string | null;
  material: string | null;
  quantity: number | null;
  dimensions: string | null;
  tags: string[] | null;
  tolerance: string | null;
  roughness: string | null;
  finish: string | null;
  threads_present: boolean | null;
  inspection_needed: boolean | null;
  excluded_reason: string | null;
  part_files: PartFileRef[] | null;
  local_files: string[] | null;
  production_remark: string | null;
  partner_cost: number | null;
  allow_counter_from: number | null;
  buyer_price: number | null;
  buyer_quote_id: string | null;
  suggested_price: number | null;
  xo_leadtime: string | null;
  publication_end: string | null;
  suggested_leadtime: string | null;
  status: XometryOfferStatus;
  flags: string[] | null;
  final_price: number | null;
  final_leadtime: string | null;
  submitted_at: string | null;
}

// Explicit column list — `raw` (the full offer dump) stays server-side.
export const OFFER_COLUMNS =
  'code, offer_id, is_urgent, process_type, material, quantity, dimensions, tags, ' +
  'tolerance, roughness, finish, threads_present, inspection_needed, excluded_reason, ' +
  'part_files, local_files, production_remark, partner_cost, allow_counter_from, ' +
  'buyer_price, buyer_quote_id, suggested_price, xo_leadtime, publication_end, ' +
  'suggested_leadtime, status, flags, final_price, final_leadtime, submitted_at';
