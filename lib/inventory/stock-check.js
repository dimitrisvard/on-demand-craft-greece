/**
 * Low Stock Alert Checker
 *
 * Checks material stock levels against thresholds and triggers alerts.
 * Called after every stock-changing transaction.
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getSupabase() {
  return createClient(supabaseUrl, supabaseServiceKey);
}

/**
 * Check if a material's stock has fallen below the low-stock threshold.
 * Creates an alert if needed, resolves existing alerts if stock is replenished.
 *
 * @param {string} tenantId
 * @param {string} materialId
 * @returns {Promise<{alertCreated: boolean, alertResolved: boolean, currentStock: number}>}
 */
export async function checkLowStockAlerts(tenantId, materialId) {
  const supabase = getSupabase();

  // Get material info
  const { data: material, error: matErr } = await supabase
    .from('materials')
    .select('*')
    .eq('id', materialId)
    .eq('tenant_id', tenantId)
    .single();

  if (matErr || !material) {
    console.error('checkLowStockAlerts: material not found', matErr);
    return { alertCreated: false, alertResolved: false, currentStock: 0 };
  }

  if (material.low_stock_threshold == null) {
    return { alertCreated: false, alertResolved: false, currentStock: 0 };
  }

  // Calculate total available stock
  let currentStock = 0;

  if (material.base_unit === 'm2') {
    const { data: items } = await supabase
      .from('stock_items')
      .select('remaining_area_mm2')
      .eq('tenant_id', tenantId)
      .eq('material_id', materialId)
      .eq('status', 'available');

    const totalMm2 = (items || []).reduce((sum, i) => sum + (i.remaining_area_mm2 || 0), 0);
    currentStock = totalMm2 / 1_000_000; // convert to m²
  } else {
    const { data: items } = await supabase
      .from('stock_items')
      .select('remaining_quantity')
      .eq('tenant_id', tenantId)
      .eq('material_id', materialId)
      .eq('status', 'available');

    currentStock = (items || []).reduce((sum, i) => sum + (i.remaining_quantity || 0), 0);
  }

  const threshold = material.low_stock_threshold;
  let alertCreated = false;
  let alertResolved = false;

  if (currentStock < threshold) {
    // Check if unresolved alert already exists
    const { data: existing } = await supabase
      .from('low_stock_alerts')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('material_id', materialId)
      .eq('resolved', false)
      .limit(1);

    if (!existing || existing.length === 0) {
      // Create new alert
      await supabase.from('low_stock_alerts').insert({
        tenant_id: tenantId,
        material_id: materialId,
        current_stock: currentStock,
        threshold: threshold,
        base_unit: material.base_unit,
      });
      alertCreated = true;
    }
  } else {
    // Stock is above threshold — resolve any unresolved alerts
    const { data: unresolvedAlerts } = await supabase
      .from('low_stock_alerts')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('material_id', materialId)
      .eq('resolved', false);

    if (unresolvedAlerts && unresolvedAlerts.length > 0) {
      for (const alert of unresolvedAlerts) {
        await supabase
          .from('low_stock_alerts')
          .update({ resolved: true, resolved_at: new Date().toISOString() })
          .eq('id', alert.id);
      }
      alertResolved = true;
    }
  }

  return { alertCreated, alertResolved, currentStock };
}

/**
 * Build a Telegram alert message for low stock.
 */
export function buildLowStockMessage(material, currentStock, fullSheets, remnants) {
  const unit = material.base_unit === 'm2' ? 'm²' : material.base_unit;
  const thicknessStr = material.thickness_mm ? ` — ${material.thickness_mm}mm` : '';
  const supplierStr = material.supplier ? `\nAction: Reorder from ${material.supplier}` : '';
  const reorderStr = material.reorder_quantity ? ` (${material.reorder_quantity} ${unit})` : '';

  return [
    `📦 LOW STOCK ALERT`,
    `Material: ${material.name}${material.grade ? ' ' + material.grade : ''}${thicknessStr}`,
    `Current stock: ${currentStock.toFixed(2)} ${unit} (threshold: ${material.low_stock_threshold} ${unit})`,
    `Full sheets: ${fullSheets} remaining`,
    `Remnants: ${remnants.length}${remnants.length > 0 ? ' (' + remnants.map(r => `${(r.remaining_area_mm2 / 1_000_000).toFixed(2)}m²`).join(' + ') + ')' : ''}`,
    `${supplierStr}${reorderStr}`,
  ].join('\n');
}

/**
 * Build a Telegram message for session completion.
 */
export function buildSessionCompleteMessage(session, material, result) {
  const thicknessStr = material.thickness_mm ? ` ${material.thickness_mm}mm` : '';
  const remnantInfo = result.newRemnants.length > 0
    ? `Remnants created: ${result.newRemnants.length} (${result.newRemnants.map(r => `${r.width}×${r.height}mm`).join(', ')})`
    : 'Remnants created: 0';

  return [
    `✅ SESSION COMPLETED`,
    `Session: ${material.name}${thicknessStr} — ${session.batch_name || session.session_date}`,
    `Sheets used: ${result.sheetsUsed}`,
    `Total consumed: ${(result.totalConsumedMm2 / 1_000_000).toFixed(3)} m²`,
    `${remnantInfo}`,
  ].join('\n');
}

/**
 * Send a Telegram message using a bot token and chat ID.
 */
export async function sendTelegramMessage(botToken, chatId, text) {
  if (!botToken || !chatId) return null;

  try {
    const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    });
    return resp.json();
  } catch (err) {
    console.error('sendTelegramMessage error:', err);
    return null;
  }
}

/**
 * Get tenant's inventory notification settings.
 */
export async function getTenantSettings(tenantId) {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('inventory_settings')
    .select('*')
    .eq('tenant_id', tenantId)
    .single();
  return data;
}
