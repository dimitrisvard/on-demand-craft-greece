/**
 * Inventory API Handler
 *
 * Consolidated handler for all inventory operations.
 * Routed via `action` parameter from the main notifications API.
 */

import { createClient } from '@supabase/supabase-js';
import { processSessionCompletion, selectStockForSession, receiveStock } from './consume-session.js';
import { checkLowStockAlerts } from './stock-check.js';
import { generateRemnantLabelPdf, generateBatchLabels } from './remnant-qr.js';
import { runAutoBatch } from './cron-batch.js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getSupabase() {
  return createClient(supabaseUrl, supabaseServiceKey);
}

const DEFAULT_TENANT = '00000000-0000-0000-0000-000000000001';

function getTenantId(req) {
  return req.body?.tenantId || req.query?.tenantId || DEFAULT_TENANT;
}

// ─── Materials CRUD ─────────────────────────────────────────────────────────

async function handleMaterials(req, res) {
  const supabase = getSupabase();
  const tenantId = getTenantId(req);

  if (req.method === 'GET') {
    const { category, active_only } = req.query || {};
    let query = supabase.from('materials').select('*').eq('tenant_id', tenantId);
    if (category) query = query.eq('category', category);
    if (active_only !== 'false') query = query.eq('is_active', true);
    query = query.order('name');

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ data });
  }

  if (req.method === 'POST') {
    const body = { ...req.body, tenant_id: tenantId };
    delete body.action;
    delete body.tenantId;
    const { data, error } = await supabase.from('materials').insert(body).select().single();
    if (error) return res.status(400).json({ error: error.message });
    return res.status(201).json({ data });
  }

  if (req.method === 'PUT') {
    const { id, ...updates } = req.body;
    delete updates.action;
    delete updates.tenantId;
    if (!id) return res.status(400).json({ error: 'Missing material id' });
    const { data, error } = await supabase.from('materials').update(updates).eq('id', id).eq('tenant_id', tenantId).select().single();
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// ─── Stock Items ────────────────────────────────────────────────────────────

async function handleStock(req, res) {
  const supabase = getSupabase();
  const tenantId = getTenantId(req);

  if (req.method === 'GET') {
    const { material_id, status, origin, limit: lim } = req.query || {};
    let query = supabase.from('stock_items').select('*, material:materials(*)').eq('tenant_id', tenantId);
    if (material_id) query = query.eq('material_id', material_id);
    if (status) query = query.eq('status', status);
    if (origin) query = query.eq('origin', origin);
    query = query.order('created_at', { ascending: false }).limit(parseInt(lim) || 200);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ data });
  }

  if (req.method === 'PUT') {
    const { id, ...updates } = req.body;
    delete updates.action;
    delete updates.tenantId;
    if (!id) return res.status(400).json({ error: 'Missing stock item id' });
    const { data, error } = await supabase.from('stock_items').update(updates).eq('id', id).eq('tenant_id', tenantId).select().single();
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleStockReceive(req, res) {
  const tenantId = getTenantId(req);
  const { materialId, quantity, widthMm, heightMm, batchNumber, location, costPerUnit, notes, performedBy } = req.body;

  if (!materialId || !quantity) {
    return res.status(400).json({ error: 'materialId and quantity are required' });
  }

  try {
    const items = await receiveStock(tenantId, {
      materialId, quantity, widthMm, heightMm,
      batchNumber, location, costPerUnit, notes, performedBy,
    });
    return res.status(201).json({ data: items, count: items.length });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function handleStockAdjust(req, res) {
  const supabase = getSupabase();
  const tenantId = getTenantId(req);
  const { id, adjustmentMm2, adjustmentQty, reason, performedBy } = req.body;

  if (!id) return res.status(400).json({ error: 'Missing stock item id' });

  const { data: item, error: fetchErr } = await supabase
    .from('stock_items').select('*').eq('id', id).eq('tenant_id', tenantId).single();
  if (fetchErr || !item) return res.status(404).json({ error: 'Stock item not found' });

  const updates = {};
  if (adjustmentMm2 != null) {
    updates.used_area_mm2 = Math.max(0, (item.used_area_mm2 || 0) - adjustmentMm2);
  }
  if (adjustmentQty != null) {
    updates.remaining_quantity = Math.max(0, (item.remaining_quantity || 0) + adjustmentQty);
  }

  const { error: updateErr } = await supabase.from('stock_items').update(updates).eq('id', id);
  if (updateErr) return res.status(500).json({ error: updateErr.message });

  await supabase.from('stock_transactions').insert({
    tenant_id: tenantId,
    stock_item_id: id,
    type: 'adjust',
    area_change_mm2: adjustmentMm2 || null,
    quantity_change: adjustmentQty || null,
    reason: reason || 'Manual adjustment',
    performed_by: performedBy || 'operator',
  });

  await checkLowStockAlerts(tenantId, item.material_id);

  return res.status(200).json({ success: true });
}

async function handleStockSummary(req, res) {
  const supabase = getSupabase();
  const tenantId = getTenantId(req);

  const { data, error } = await supabase.rpc('get_stock_summary', { p_tenant_id: tenantId });
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ data });
}

async function handleStockRemnants(req, res) {
  const supabase = getSupabase();
  const tenantId = getTenantId(req);

  const { data, error } = await supabase
    .from('stock_items')
    .select('*, material:materials(*)')
    .eq('tenant_id', tenantId)
    .eq('origin', 'remnant')
    .eq('status', 'available')
    .order('remaining_area_mm2', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ data });
}

async function handleStockScan(req, res) {
  const supabase = getSupabase();
  const { qrCode } = req.query || req.body || {};

  if (!qrCode) return res.status(400).json({ error: 'qrCode is required' });

  const { data, error } = await supabase
    .from('stock_items')
    .select('*, material:materials(*)')
    .eq('qr_code', qrCode)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Stock item not found' });
  return res.status(200).json({ data });
}

// ─── Nesting Sessions ───────────────────────────────────────────────────────

async function handleSessions(req, res) {
  const supabase = getSupabase();
  const tenantId = getTenantId(req);

  if (req.method === 'GET') {
    const { status, material_id, date } = req.query || {};
    let query = supabase
      .from('nesting_sessions')
      .select('*, material:materials(*), jobs:nesting_session_jobs(*), sheets:nesting_session_sheets(*)')
      .eq('tenant_id', tenantId);
    if (status) query = query.eq('status', status);
    if (material_id) query = query.eq('material_id', material_id);
    if (date) query = query.eq('session_date', date);
    query = query.order('created_at', { ascending: false }).limit(50);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ data });
  }

  if (req.method === 'POST') {
    const { material_id, batch_name, session_date } = req.body;
    if (!material_id) return res.status(400).json({ error: 'material_id is required' });

    const { data, error } = await supabase.from('nesting_sessions').insert({
      tenant_id: tenantId,
      material_id,
      batch_name: batch_name || null,
      session_date: session_date || new Date().toISOString().split('T')[0],
      status: 'draft',
    }).select('*, material:materials(*)').single();

    if (error) return res.status(400).json({ error: error.message });
    return res.status(201).json({ data });
  }

  if (req.method === 'PUT') {
    const { id, ...updates } = req.body;
    delete updates.action;
    delete updates.tenantId;
    if (!id) return res.status(400).json({ error: 'Missing session id' });
    const { data, error } = await supabase.from('nesting_sessions').update(updates).eq('id', id).eq('tenant_id', tenantId).select().single();
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleSessionAddJobs(req, res) {
  const supabase = getSupabase();
  const tenantId = getTenantId(req);
  const { sessionId, jobs } = req.body;

  if (!sessionId || !jobs || !Array.isArray(jobs)) {
    return res.status(400).json({ error: 'sessionId and jobs array required' });
  }

  const rows = jobs.map(j => ({
    tenant_id: tenantId,
    session_id: sessionId,
    order_id: j.orderId,
    order_item_id: j.orderItemId || null,
    part_name: j.partName,
    quantity: j.quantity,
    part_area_mm2: j.partAreaMm2 || null,
    total_area_mm2: j.partAreaMm2 ? j.partAreaMm2 * j.quantity : null,
    dxf_file_url: j.dxfFileUrl || null,
  }));

  const { data, error } = await supabase.from('nesting_session_jobs').insert(rows).select();
  if (error) return res.status(400).json({ error: error.message });

  // Update session total area
  const totalArea = rows.reduce((sum, r) => sum + (r.total_area_mm2 || 0), 0);
  await supabase.from('nesting_sessions').update({
    total_part_area_mm2: totalArea,
    updated_at: new Date().toISOString(),
  }).eq('id', sessionId);

  return res.status(201).json({ data });
}

async function handleSessionRemoveJob(req, res) {
  const supabase = getSupabase();
  const tenantId = getTenantId(req);
  const { sessionId, jobId } = req.body;

  if (!sessionId || !jobId) {
    return res.status(400).json({ error: 'sessionId and jobId required' });
  }

  const { error } = await supabase
    .from('nesting_session_jobs')
    .delete()
    .eq('id', jobId)
    .eq('session_id', sessionId)
    .eq('tenant_id', tenantId);

  if (error) return res.status(400).json({ error: error.message });
  return res.status(200).json({ success: true });
}

async function handleSessionStart(req, res) {
  const supabase = getSupabase();
  const tenantId = getTenantId(req);
  const { sessionId } = req.body;

  const { data, error } = await supabase
    .from('nesting_sessions')
    .update({ status: 'cutting', updated_at: new Date().toISOString() })
    .eq('id', sessionId)
    .eq('tenant_id', tenantId)
    .in('status', ['draft', 'ready'])
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  return res.status(200).json({ data });
}

async function handleSessionComplete(req, res) {
  const tenantId = getTenantId(req);
  const { sessionId, sheets, operatorNotes, completedBy } = req.body;

  if (!sessionId || !sheets || !Array.isArray(sheets)) {
    return res.status(400).json({ error: 'sessionId and sheets array required' });
  }

  try {
    const result = await processSessionCompletion(tenantId, sessionId, sheets, operatorNotes, completedBy || 'operator');
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function handleSessionSelectStock(req, res) {
  const tenantId = getTenantId(req);
  const { materialId, sheetsNeeded, minWidth, minHeight } = req.body;

  if (!materialId || !sheetsNeeded) {
    return res.status(400).json({ error: 'materialId and sheetsNeeded required' });
  }

  try {
    const stocks = await selectStockForSession(tenantId, materialId, sheetsNeeded, minWidth, minHeight);
    return res.status(200).json({ data: stocks, available: stocks.length, needed: sheetsNeeded, shortage: Math.max(0, sheetsNeeded - stocks.length) });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

// ─── Alerts ─────────────────────────────────────────────────────────────────

async function handleAlerts(req, res) {
  const supabase = getSupabase();
  const tenantId = getTenantId(req);

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('low_stock_alerts')
      .select('*, material:materials(*)')
      .eq('tenant_id', tenantId)
      .eq('resolved', false)
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleAlertResolve(req, res) {
  const supabase = getSupabase();
  const tenantId = getTenantId(req);
  const { alertId } = req.body;

  if (!alertId) return res.status(400).json({ error: 'alertId required' });

  const { error } = await supabase
    .from('low_stock_alerts')
    .update({ resolved: true, resolved_at: new Date().toISOString() })
    .eq('id', alertId)
    .eq('tenant_id', tenantId);

  if (error) return res.status(400).json({ error: error.message });
  return res.status(200).json({ success: true });
}

// ─── Labels ─────────────────────────────────────────────────────────────────

async function handleLabel(req, res) {
  const supabase = getSupabase();
  const { stockItemId } = req.body || req.query || {};

  if (!stockItemId) return res.status(400).json({ error: 'stockItemId required' });

  const { data: item } = await supabase
    .from('stock_items')
    .select('*, material:materials(*)')
    .eq('id', stockItemId)
    .single();

  if (!item) return res.status(404).json({ error: 'Stock item not found' });

  try {
    const pdfBytes = await generateRemnantLabelPdf(item, item.material, 'micronshub.eu');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="label-${item.qr_code}.pdf"`);
    return res.status(200).send(Buffer.from(pdfBytes));
  } catch (err) {
    return res.status(500).json({ error: `Label generation failed: ${err.message}` });
  }
}

// ─── Settings ───────────────────────────────────────────────────────────────

async function handleSettings(req, res) {
  const supabase = getSupabase();
  const tenantId = getTenantId(req);

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('inventory_settings')
      .select('*')
      .eq('tenant_id', tenantId)
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ data });
  }

  if (req.method === 'PUT') {
    const updates = { ...req.body };
    delete updates.action;
    delete updates.tenantId;
    delete updates.id;
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('inventory_settings')
      .update(updates)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// ─── Transactions log ───────────────────────────────────────────────────────

async function handleTransactions(req, res) {
  const supabase = getSupabase();
  const tenantId = getTenantId(req);
  const { stock_item_id, session_id, limit: lim } = req.query || {};

  let query = supabase
    .from('stock_transactions')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(parseInt(lim) || 100);

  if (stock_item_id) query = query.eq('stock_item_id', stock_item_id);
  if (session_id) query = query.eq('nesting_session_id', session_id);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ data });
}

// ─── Main Router ────────────────────────────────────────────────────────────

export async function handleInventoryAction(action, req, res) {
  switch (action) {
    // Materials
    case 'inv-materials':
      return handleMaterials(req, res);

    // Stock
    case 'inv-stock':
      return handleStock(req, res);
    case 'inv-stock-receive':
      return handleStockReceive(req, res);
    case 'inv-stock-adjust':
      return handleStockAdjust(req, res);
    case 'inv-stock-summary':
      return handleStockSummary(req, res);
    case 'inv-stock-remnants':
      return handleStockRemnants(req, res);
    case 'inv-stock-scan':
      return handleStockScan(req, res);

    // Sessions
    case 'inv-sessions':
      return handleSessions(req, res);
    case 'inv-session-add-jobs':
      return handleSessionAddJobs(req, res);
    case 'inv-session-remove-job':
      return handleSessionRemoveJob(req, res);
    case 'inv-session-start':
      return handleSessionStart(req, res);
    case 'inv-session-complete':
      return handleSessionComplete(req, res);
    case 'inv-session-select-stock':
      return handleSessionSelectStock(req, res);

    // Alerts
    case 'inv-alerts':
      return handleAlerts(req, res);
    case 'inv-alert-resolve':
      return handleAlertResolve(req, res);

    // Labels
    case 'inv-label':
      return handleLabel(req, res);

    // Settings
    case 'inv-settings':
      return handleSettings(req, res);

    // Transactions
    case 'inv-transactions':
      return handleTransactions(req, res);

    // Cron
    case 'inv-cron-batch':
      try {
        const cronResult = await runAutoBatch();
        return res.status(200).json(cronResult);
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }

    default:
      return res.status(400).json({ error: `Unknown inventory action: ${action}` });
  }
}
