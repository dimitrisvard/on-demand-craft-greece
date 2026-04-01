/**
 * Session Completion Business Logic
 *
 * Orchestrates the completion of a nesting session:
 * 1. Calls the PostgreSQL atomic function
 * 2. Checks low stock alerts
 * 3. Sends Telegram notifications
 */

import { createClient } from '@supabase/supabase-js';
import {
  checkLowStockAlerts,
  buildSessionCompleteMessage,
  buildLowStockMessage,
  sendTelegramMessage,
  getTenantSettings,
} from './stock-check.js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getSupabase() {
  return createClient(supabaseUrl, supabaseServiceKey);
}

/**
 * Process nesting session completion — the main entry point.
 *
 * @param {string} tenantId
 * @param {string} sessionId
 * @param {Array} sheets - per-sheet decisions from the operator
 * @param {string} operatorNotes
 * @param {string} completedBy
 * @returns {Promise<object>} completion result
 */
export async function processSessionCompletion(tenantId, sessionId, sheets, operatorNotes, completedBy) {
  const supabase = getSupabase();

  // 1. Call the atomic PostgreSQL function
  const { data: result, error } = await supabase.rpc('complete_nesting_session', {
    p_tenant_id: tenantId,
    p_session_id: sessionId,
    p_sheets: sheets,
    p_operator_notes: operatorNotes || null,
    p_completed_by: completedBy,
  });

  if (error) {
    throw new Error(`Session completion failed: ${error.message}`);
  }

  // 2. Get material info for notifications
  const materialId = result.materialId;
  const { data: material } = await supabase
    .from('materials')
    .select('*')
    .eq('id', materialId)
    .single();

  const { data: session } = await supabase
    .from('nesting_sessions')
    .select('*')
    .eq('id', sessionId)
    .single();

  // 3. Check low stock threshold
  const alertResult = await checkLowStockAlerts(tenantId, materialId);

  // 4. Send Telegram notifications (async, non-blocking)
  const settings = await getTenantSettings(tenantId);

  if (settings && settings.send_telegram_alerts && settings.telegram_bot_token && settings.telegram_chat_id) {
    // Session completion notification
    if (material && session) {
      const sessionMsg = buildSessionCompleteMessage(session, material, result);
      sendTelegramMessage(settings.telegram_bot_token, settings.telegram_chat_id, sessionMsg).catch(() => {});
    }

    // Low stock alert
    if (alertResult.alertCreated && material) {
      // Get details for the alert message
      const { data: stockItems } = await supabase
        .from('stock_items')
        .select('remaining_area_mm2, origin')
        .eq('tenant_id', tenantId)
        .eq('material_id', materialId)
        .eq('status', 'available');

      const fullSheets = (stockItems || []).filter(s => s.origin !== 'remnant').length;
      const remnants = (stockItems || []).filter(s => s.origin === 'remnant');

      const alertMsg = buildLowStockMessage(material, alertResult.currentStock, fullSheets, remnants);
      sendTelegramMessage(settings.telegram_bot_token, settings.telegram_chat_id, alertMsg).catch(() => {});

      // Mark alert as sent
      await supabase
        .from('low_stock_alerts')
        .update({ alert_sent: true, alert_sent_at: new Date().toISOString(), alert_channel: 'telegram' })
        .eq('tenant_id', tenantId)
        .eq('material_id', materialId)
        .eq('resolved', false);
    }
  }

  return result;
}

/**
 * Auto-select stock items for a nesting session.
 * Uses the PostgreSQL function that prefers remnants over full sheets.
 */
export async function selectStockForSession(tenantId, materialId, sheetsNeeded, minWidth, minHeight) {
  const supabase = getSupabase();

  const { data, error } = await supabase.rpc('select_stock_for_session', {
    p_tenant_id: tenantId,
    p_material_id: materialId,
    p_sheets_needed: sheetsNeeded,
    p_min_width_mm: minWidth || 0,
    p_min_height_mm: minHeight || 0,
  });

  if (error) {
    throw new Error(`Stock selection failed: ${error.message}`);
  }

  return data || [];
}

/**
 * Receive new stock items (purchase).
 * Creates individual stock_item rows for each unit.
 */
export async function receiveStock(tenantId, input) {
  const supabase = getSupabase();
  const {
    materialId, quantity, widthMm, heightMm,
    batchNumber, location, costPerUnit, notes, performedBy
  } = input;

  // Get material info
  const { data: material } = await supabase
    .from('materials')
    .select('*')
    .eq('id', materialId)
    .eq('tenant_id', tenantId)
    .single();

  if (!material) throw new Error('Material not found');

  const items = [];
  const isSheet = material.category === 'sheet_metal' && widthMm && heightMm;
  const count = isSheet ? quantity : 1;

  for (let i = 0; i < count; i++) {
    const qrCode = 'STK-' + Array.from(crypto.getRandomValues(new Uint8Array(6)))
      .map(b => b.toString(16).padStart(2, '0')).join('');

    const item = {
      tenant_id: tenantId,
      material_id: materialId,
      origin: 'purchased',
      batch_number: batchNumber || null,
      location: location || null,
      qr_code: qrCode,
      received_date: new Date().toISOString().split('T')[0],
      notes: notes || null,
      status: 'available',
    };

    if (isSheet) {
      item.width_mm = widthMm;
      item.height_mm = heightMm;
      item.total_area_mm2 = widthMm * heightMm;
      item.used_area_mm2 = 0;
      item.quantity = 1;
      item.purchase_cost = costPerUnit || null;
      item.cost_per_mm2 = costPerUnit ? costPerUnit / (widthMm * heightMm) : null;
    } else {
      item.quantity = isSheet ? 1 : quantity;
      item.remaining_quantity = isSheet ? 1 : quantity;
      item.purchase_cost = costPerUnit ? costPerUnit * quantity : null;
    }

    items.push(item);
  }

  const { data: inserted, error } = await supabase
    .from('stock_items')
    .insert(items)
    .select();

  if (error) throw new Error(`Stock receive failed: ${error.message}`);

  // Log transactions
  for (const item of inserted) {
    await supabase.from('stock_transactions').insert({
      tenant_id: tenantId,
      stock_item_id: item.id,
      type: 'receive',
      area_change_mm2: item.total_area_mm2 || null,
      quantity_change: isSheet ? null : item.quantity,
      reason: `Received from ${material.supplier || 'supplier'}${batchNumber ? ' batch ' + batchNumber : ''}`,
      performed_by: performedBy || 'system',
    });
  }

  // Check if this resolves any low stock alerts
  await checkLowStockAlerts(tenantId, materialId);

  return inserted;
}
