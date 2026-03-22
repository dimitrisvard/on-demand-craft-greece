// ─────────────────────────────────────────────────────────────
// TENDER MONITOR — TypeScript Types
// ─────────────────────────────────────────────────────────────

export interface Tender {
  id: string;
  country_code: string;
  country_name: string;
  portal_name: string;
  portal_url?: string;
  tender_reference?: string;
  title: string;
  description?: string;
  buyer_name?: string;
  buyer_type?: string;
  cpv_codes?: string[];
  cpv_descriptions?: string[];
  nature_of_contract?: string;
  estimated_value_eur?: number;
  estimated_value_original?: number;
  currency?: string;
  publication_date?: string;
  submission_deadline?: string;
  place_of_performance?: string;
  nuts_code?: string;
  latitude?: number;
  longitude?: number;
  procedure_type?: string;
  relevance_score: number;
  matched_keywords?: string[];
  matched_cpv?: string[];
  is_relevant: boolean;
  status: TenderStatus;
  notes?: string;
  original_language?: string;
  raw_data?: any;
  discovered_at: string;
  updated_at: string;
}

export type TenderStatus =
  | 'new'
  | 'reviewed'
  | 'interested'
  | 'bidding'
  | 'won'
  | 'lost'
  | 'expired'
  | 'not_relevant';

export interface TenderConnector {
  id: number;
  country_code: string;
  country_name: string;
  portal_name: string;
  portal_base_url: string;
  access_method: 'api' | 'rss' | 'open_data' | 'scrape' | 'email_alert';
  scan_frequency_hours: number;
  is_active: boolean;
  requires_auth: boolean;
  last_scan_at?: string;
  last_scan_count?: number;
  last_error?: string;
  notes?: string;
  map_lat: number;
  map_lng: number;
}

export interface TenderScanLog {
  id: number;
  country_code: string;
  tenders_found: number;
  tenders_new: number;
  tenders_relevant: number;
  errors?: string[];
  duration_ms?: number;
  started_at: string;
  completed_at?: string;
}

export interface TenderFilters {
  country: string;        // 'all' or ISO code
  cpvPrefix: string;      // 'all' or '42', '44', etc.
  valueRange: string;     // 'all', '<10k', '10-50k', '50-200k', '>200k'
  deadline: string;       // 'all', '7days', '30days', 'active'
  status: string;         // 'all' or TenderStatus
  score: string;          // 'all', '80+', '50-79', '20-49', '<20'
  search: string;
  relevantOnly: boolean;
}

export interface TenderStats {
  total: number;
  relevant: number;
  thisWeek: number;
  active: number;          // submission_deadline in future
  byCountry: Record<string, number>;
  byScore: { high: number; medium: number; low: number };
  byStatus: Record<string, number>;
  newToday: number;
}

// Normalized tender shape returned by country connectors (before DB insert)
export interface NormalizedTender {
  countryCode: string;
  countryName: string;
  portalName: string;
  portalUrl: string;
  tenderReference: string;
  title: string;
  description?: string;
  buyerName?: string;
  buyerType?: string;
  cpvCodes?: string[];
  natureOfContract?: string;
  estimatedValueEur?: number;
  estimatedValueOriginal?: number;
  currency?: string;
  publicationDate?: string;
  submissionDeadline?: string;
  placeOfPerformance?: string;
  nutsCode?: string;
  procedureType?: string;
  originalLanguage: string;
  rawData?: any;
}
