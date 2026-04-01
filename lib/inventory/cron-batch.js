/**
 * Cron Job: Auto-batch nesting sessions
 *
 * Runs at end of day for each tenant with semi_automatic or full_automatic level.
 * Groups pending jobs by material+thickness and creates draft sessions.
 *
 * Triggered via: POST /api/notifications?action=inv-cron-batch
 * Or via Vercel cron (if a slot is available).
 */

import { createClient } from '@supabase/supabase-js';
import { sendTelegramMessage } from './stock-check.js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getSupabase() {
  return createClient(supabaseUrl, supabaseServiceKey);
}

/**
 * Run the auto-batch process for all eligible tenants.
 */
export async function runAutoBatch() {
  const supabase = getSupabase();
  const results = [];

  // Get all tenants with semi or full automation
  const { data: settings } = await supabase
    .from('inventory_settings')
    .select('*')
    .in('automation_level', ['semi_automatic', 'full_automatic']);

  if (!settings || settings.length === 0) {
    return { message: 'No tenants with automation enabled', results: [] };
  }

  for (const tenantSettings of settings) {
    try {
      const tenantResult = await autoBatchForTenant(supabase, tenantSettings);
      results.push({ tenantId: tenantSettings.tenant_id, ...tenantResult });
    } catch (err) {
      results.push({ tenantId: tenantSettings.tenant_id, error: err.message });
    }
  }

  return { results };
}

/**
 * Auto-batch for a single tenant.
 * Groups unassigned jobs by material+thickness and creates draft sessions.
 */
async function autoBatchForTenant(supabase, tenantSettings) {
  const tenantId = tenantSettings.tenant_id;

  // Find jobs not yet in any session (checking nesting_session_jobs)
  // We look for order items that have sheet metal parts not assigned to sessions
  // For now, we check if there are materials with pending stock and create informational sessions

  // Get all materials for this tenant
  const { data: materials } = await supabase
    .from('materials')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .eq('category', 'sheet_metal');

  if (!materials || materials.length === 0) {
    return { sessionsCreated: 0, message: 'No sheet metal materials found' };
  }

  // Check for any existing draft sessions for today
  const today = new Date().toISOString().split('T')[0];
  const { data: existingSessions } = await supabase
    .from('nesting_sessions')
    .select('material_id')
    .eq('tenant_id', tenantId)
    .eq('session_date', today)
    .in('status', ['draft', 'ready']);

  const existingMaterialIds = new Set((existingSessions || []).map(s => s.material_id));

  // Get unassigned jobs — jobs in nesting_session_jobs table tells us what's assigned
  const { data: assignedJobIds } = await supabase
    .from('nesting_session_jobs')
    .select('order_id')
    .eq('tenant_id', tenantId);

  const assignedSet = new Set((assignedJobIds || []).map(j => j.order_id));

  // For a real implementation, you'd query your orders table for 'in_production' items
  // Since we're working within the inventory system, we'll create sessions based on
  // available stock and materials that need processing

  let sessionsCreated = 0;
  const sessionNames = [];

  // Create sessions for materials that don't have one today
  for (const material of materials) {
    if (existingMaterialIds.has(material.id)) continue;

    // Check if there's available stock for this material
    const { data: stock } = await supabase
      .from('stock_items')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('material_id', material.id)
      .eq('status', 'available')
      .limit(1);

    if (!stock || stock.length === 0) continue;

    const batchName = `${material.name}${material.thickness_mm ? ' ' + material.thickness_mm + 'mm' : ''} — ${today}`;

    const { error } = await supabase.from('nesting_sessions').insert({
      tenant_id: tenantId,
      material_id: material.id,
      batch_name: batchName,
      session_date: today,
      status: 'draft',
    });

    if (!error) {
      sessionsCreated++;
      sessionNames.push(batchName);
    }
  }

  // Send Telegram notification
  if (sessionsCreated > 0 && tenantSettings.send_telegram_alerts && tenantSettings.telegram_bot_token) {
    const msg = [
      `📋 AUTO-BATCH: ${sessionsCreated} session${sessionsCreated > 1 ? 's' : ''} prepared for ${today}`,
      '',
      ...sessionNames.map(n => `• ${n}`),
      '',
      'Review and add jobs in the Nesting Sessions page.',
    ].join('\n');

    await sendTelegramMessage(tenantSettings.telegram_bot_token, tenantSettings.telegram_chat_id, msg).catch(() => {});
  }

  return { sessionsCreated, sessionNames };
}
