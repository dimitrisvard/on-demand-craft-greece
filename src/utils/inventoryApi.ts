/**
 * Inventory API Client
 *
 * All inventory operations go through /api/notifications with action=inv-*
 * This avoids creating additional Vercel serverless functions.
 */

import type {
  Material, StockItem, NestingSession, NestingSessionJob,
  StockSummaryRow, SessionCompletionSheetInput, SessionCompletionResult,
  LowStockAlert, InventorySettings, StockTransaction, SelectedStock,
} from '@/types/inventory';

const API_BASE = '/api/notifications';

async function apiCall<T>(action: string, options: {
  method?: string;
  body?: Record<string, unknown>;
  query?: Record<string, string>;
} = {}): Promise<T> {
  const { method = 'POST', body, query } = options;

  const params = new URLSearchParams({ action, ...(query || {}) });
  const url = `${API_BASE}?${params.toString()}`;

  const fetchOpts: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };

  if (body || method === 'POST' || method === 'PUT') {
    fetchOpts.body = JSON.stringify({ action, ...body });
  }

  const res = await fetch(url, fetchOpts);
  const json = await res.json();

  if (!res.ok) {
    throw new Error(json.error || `API error: ${res.status}`);
  }

  return json;
}

// ─── Materials ──────────────────────────────────────────────────────────────

export async function getMaterials(category?: string): Promise<Material[]> {
  const res = await apiCall<{ data: Material[] }>('inv-materials', {
    method: 'POST',
    body: { ...(category ? {} : {}) },
    query: { ...(category ? { category } : {}) },
  });
  return res.data;
}

export async function createMaterial(material: Partial<Material>): Promise<Material> {
  const res = await apiCall<{ data: Material }>('inv-materials', {
    method: 'POST',
    body: material as Record<string, unknown>,
  });
  return res.data;
}

export async function updateMaterial(id: string, updates: Partial<Material>): Promise<Material> {
  const res = await apiCall<{ data: Material }>('inv-materials', {
    method: 'PUT',
    body: { id, ...updates } as Record<string, unknown>,
  });
  return res.data;
}

// ─── Stock Items ────────────────────────────────────────────────────────────

export async function getStockItems(filters?: {
  material_id?: string;
  status?: string;
  origin?: string;
}): Promise<StockItem[]> {
  const res = await apiCall<{ data: StockItem[] }>('inv-stock', {
    method: 'POST',
    body: {},
    query: filters as Record<string, string> || {},
  });
  return res.data;
}

export async function receiveStock(input: {
  materialId: string;
  quantity: number;
  widthMm?: number;
  heightMm?: number;
  batchNumber?: string;
  location?: string;
  costPerUnit?: number;
  notes?: string;
}): Promise<StockItem[]> {
  const res = await apiCall<{ data: StockItem[] }>('inv-stock-receive', {
    body: input as Record<string, unknown>,
  });
  return res.data;
}

export async function adjustStock(input: {
  id: string;
  adjustmentMm2?: number;
  adjustmentQty?: number;
  reason: string;
}): Promise<void> {
  await apiCall('inv-stock-adjust', { body: input as Record<string, unknown> });
}

export async function getStockSummary(): Promise<StockSummaryRow[]> {
  const res = await apiCall<{ data: StockSummaryRow[] }>('inv-stock-summary', { body: {} });
  return res.data;
}

export async function getStockRemnants(): Promise<StockItem[]> {
  const res = await apiCall<{ data: StockItem[] }>('inv-stock-remnants', { body: {} });
  return res.data;
}

export async function scanStockQr(qrCode: string): Promise<StockItem> {
  const res = await apiCall<{ data: StockItem }>('inv-stock-scan', {
    body: { qrCode },
  });
  return res.data;
}

// ─── Nesting Sessions ───────────────────────────────────────────────────────

export async function getSessions(filters?: {
  status?: string;
  material_id?: string;
  date?: string;
}): Promise<NestingSession[]> {
  const res = await apiCall<{ data: NestingSession[] }>('inv-sessions', {
    method: 'POST',
    body: {},
    query: filters as Record<string, string> || {},
  });
  return res.data;
}

export async function createSession(input: {
  material_id: string;
  batch_name?: string;
  session_date?: string;
}): Promise<NestingSession> {
  const res = await apiCall<{ data: NestingSession }>('inv-sessions', {
    body: input as Record<string, unknown>,
  });
  return res.data;
}

export async function updateSession(id: string, updates: Partial<NestingSession>): Promise<NestingSession> {
  const res = await apiCall<{ data: NestingSession }>('inv-sessions', {
    method: 'PUT',
    body: { id, ...updates } as Record<string, unknown>,
  });
  return res.data;
}

export async function addJobsToSession(sessionId: string, jobs: Array<{
  orderId: string;
  orderItemId?: string;
  partName: string;
  quantity: number;
  partAreaMm2?: number;
  dxfFileUrl?: string;
}>): Promise<NestingSessionJob[]> {
  const res = await apiCall<{ data: NestingSessionJob[] }>('inv-session-add-jobs', {
    body: { sessionId, jobs },
  });
  return res.data;
}

export async function removeJobFromSession(sessionId: string, jobId: string): Promise<void> {
  await apiCall('inv-session-remove-job', { body: { sessionId, jobId } });
}

export async function startSession(sessionId: string): Promise<NestingSession> {
  const res = await apiCall<{ data: NestingSession }>('inv-session-start', {
    body: { sessionId },
  });
  return res.data;
}

export async function completeSession(input: {
  sessionId: string;
  sheets: SessionCompletionSheetInput[];
  operatorNotes?: string;
  completedBy: string;
}): Promise<SessionCompletionResult> {
  return apiCall<SessionCompletionResult>('inv-session-complete', {
    body: input as Record<string, unknown>,
  });
}

export async function selectStockForSession(input: {
  materialId: string;
  sheetsNeeded: number;
  minWidth?: number;
  minHeight?: number;
}): Promise<{ data: SelectedStock[]; available: number; needed: number; shortage: number }> {
  return apiCall('inv-session-select-stock', {
    body: input as Record<string, unknown>,
  });
}

// ─── Alerts ─────────────────────────────────────────────────────────────────

export async function getAlerts(): Promise<LowStockAlert[]> {
  const res = await apiCall<{ data: LowStockAlert[] }>('inv-alerts', { body: {} });
  return res.data;
}

export async function resolveAlert(alertId: string): Promise<void> {
  await apiCall('inv-alert-resolve', { body: { alertId } });
}

// ─── Labels ─────────────────────────────────────────────────────────────────

export function getLabelUrl(stockItemId: string): string {
  return `${API_BASE}?action=inv-label&stockItemId=${stockItemId}`;
}

// ─── Settings ───────────────────────────────────────────────────────────────

export async function getInventorySettings(): Promise<InventorySettings> {
  const res = await apiCall<{ data: InventorySettings }>('inv-settings', { body: {} });
  return res.data;
}

export async function updateInventorySettings(updates: Partial<InventorySettings>): Promise<InventorySettings> {
  const res = await apiCall<{ data: InventorySettings }>('inv-settings', {
    method: 'PUT',
    body: updates as Record<string, unknown>,
  });
  return res.data;
}

// ─── Transactions ───────────────────────────────────────────────────────────

export async function getTransactions(filters?: {
  stock_item_id?: string;
  session_id?: string;
}): Promise<StockTransaction[]> {
  const res = await apiCall<{ data: StockTransaction[] }>('inv-transactions', {
    body: {},
    query: filters as Record<string, string> || {},
  });
  return res.data;
}
