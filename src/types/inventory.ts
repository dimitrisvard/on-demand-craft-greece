// ─── Inventory & Material Management Types ──────────────────────────────────

export type MaterialCategory = 'sheet_metal' | 'billet' | 'rod' | 'tube' | 'filament' | 'resin' | 'powder' | 'other';
export type BaseUnit = 'm2' | 'kg' | 'L' | 'm' | 'pcs';
export type StockStatus = 'available' | 'reserved' | 'in_use' | 'depleted' | 'scrapped';
export type StockOrigin = 'purchased' | 'remnant' | 'returned' | 'transferred';
export type SessionStatus = 'draft' | 'ready' | 'cutting' | 'completed' | 'cancelled';
export type TransactionType = 'receive' | 'consume' | 'remnant_create' | 'remnant_consume' | 'scrap' | 'adjust' | 'reserve' | 'unreserve' | 'transfer';
export type RemnantShape = 'rectangle' | 'L_shape' | 'irregular';
export type LeftoverAction = 'remnant_created' | 'scrapped' | 'fully_consumed' | 'pending';
export type AutomationLevel = 'manual' | 'semi_automatic' | 'full_automatic';

export interface Material {
  id: string;
  tenant_id: string;
  name: string;
  category: MaterialCategory;
  grade: string | null;
  thickness_mm: number | null;
  base_unit: BaseUnit;
  density_kg_per_m3: number | null;
  cost_per_unit: number | null;
  currency: string;
  supplier: string | null;
  supplier_sku: string | null;
  lead_time_days: number | null;
  low_stock_threshold: number | null;
  reorder_quantity: number | null;
  min_remnant_area_mm2: number | null;
  kerf_scrap_factor: number;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface StockItem {
  id: string;
  tenant_id: string;
  material_id: string;
  sku: string | null;
  batch_number: string | null;
  origin: StockOrigin;
  parent_stock_id: string | null;
  width_mm: number | null;
  height_mm: number | null;
  quantity: number;
  remaining_quantity: number | null;
  total_area_mm2: number | null;
  used_area_mm2: number;
  remaining_area_mm2: number | null;
  remnant_shape: RemnantShape | null;
  remnant_polygon: Record<string, unknown> | null;
  location: string | null;
  qr_code: string | null;
  qr_label_url: string | null;
  status: StockStatus;
  purchase_cost: number | null;
  cost_per_mm2: number | null;
  received_date: string | null;
  expiry_date: string | null;
  depleted_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  material?: Material;
}

export interface NestingSession {
  id: string;
  tenant_id: string;
  material_id: string;
  session_date: string;
  batch_name: string | null;
  nesting_result: Record<string, unknown> | null;
  total_part_area_mm2: number | null;
  total_sheets_needed: number | null;
  avg_utilization: number | null;
  actual_sheets_used: number | null;
  actual_utilization: number | null;
  operator_notes: string | null;
  completed_by: string | null;
  status: SessionStatus;
  preview_urls: string[] | null;
  nested_dxf_urls: string[] | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  // Joined fields
  material?: Material;
  jobs?: NestingSessionJob[];
  sheets?: NestingSessionSheet[];
}

export interface NestingSessionJob {
  id: string;
  tenant_id: string;
  session_id: string;
  order_id: string;
  order_item_id: string | null;
  part_name: string;
  quantity: number;
  part_area_mm2: number | null;
  total_area_mm2: number | null;
  dxf_file_url: string | null;
  created_at: string;
}

export interface NestingSessionSheet {
  id: string;
  tenant_id: string;
  session_id: string;
  stock_item_id: string;
  sheet_index: number;
  area_consumed_mm2: number;
  utilization: number | null;
  leftover_action: LeftoverAction | null;
  remnant_stock_id: string | null;
  scrap_weight_kg: number | null;
  created_at: string;
  // Joined
  stock_item?: StockItem;
}

export interface StockTransaction {
  id: string;
  tenant_id: string;
  stock_item_id: string;
  type: TransactionType;
  quantity_change: number | null;
  area_change_mm2: number | null;
  nesting_session_id: string | null;
  order_id: string | null;
  reason: string | null;
  performed_by: string | null;
  created_at: string;
}

export interface LowStockAlert {
  id: string;
  tenant_id: string;
  material_id: string;
  current_stock: number;
  threshold: number;
  base_unit: string | null;
  alert_sent: boolean;
  alert_sent_at: string | null;
  alert_channel: string | null;
  resolved: boolean;
  resolved_at: string | null;
  created_at: string;
  // Joined
  material?: Material;
}

export interface InventorySettings {
  id: string;
  tenant_id: string;
  automation_level: AutomationLevel;
  auto_batch_time: string;
  timezone: string;
  default_sheet_width_mm: number;
  default_sheet_height_mm: number;
  auto_scrap_threshold_utilization: number;
  max_remnant_depth: number;
  telegram_chat_id: string | null;
  telegram_bot_token: string | null;
  send_telegram_alerts: boolean;
  send_email_alerts: boolean;
  alert_email: string | null;
  created_at: string;
  updated_at: string;
}

// ─── API Request/Response Types ─────────────────────────────────────────────

export interface StockSummaryRow {
  material_id: string;
  material_name: string;
  category: string;
  grade: string | null;
  thickness_mm: number | null;
  base_unit: string;
  full_sheets: number;
  remnant_count: number;
  total_area_mm2: number;
  total_quantity: number;
  total_value: number;
  low_stock_threshold: number | null;
  is_low_stock: boolean;
}

export interface SessionCompletionSheetInput {
  sheetIndex: number;
  stockItemId: string;
  consumedAreaMm2: number;
  utilization: number;
  leftoverAction: 'remnant' | 'scrap' | 'fully_consumed';
  remnantWidthMm?: number;
  remnantHeightMm?: number;
  remnantLocation?: string;
  scrapWeightKg?: number;
}

export interface SessionCompletionInput {
  sessionId: string;
  sheets: SessionCompletionSheetInput[];
  operatorNotes?: string;
  completedBy: string;
}

export interface SessionCompletionResult {
  materialId: string;
  totalConsumedMm2: number;
  newRemnants: Array<{
    id: string;
    width: number;
    height: number;
    qrCode: string;
    location: string;
  }>;
  sheetsUsed: number;
  jobIds: string[];
}

export interface StockReceiveInput {
  materialId: string;
  quantity: number;
  widthMm?: number;
  heightMm?: number;
  batchNumber?: string;
  supplier?: string;
  costPerUnit?: number;
  location?: string;
  notes?: string;
}

export interface SelectedStock {
  stock_item_id: string;
  is_remnant: boolean;
  width_mm: number;
  height_mm: number;
  remaining_area_mm2: number;
  location: string;
}
