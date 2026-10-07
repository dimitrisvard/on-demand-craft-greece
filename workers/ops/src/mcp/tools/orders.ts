// New remote tools over orders and stock (default tenant only, reads):
//   list_orders, get_order (order, items, partner name, production status), get_stock_summary
//   (rpc/get_stock_summary(p_tenant_id), the function of supabase/migrations/20260401_create_inventory_system.sql:569).

import { z } from 'zod';
import { daysAgoIso, isoDate, isoTime } from '../format';
import { tool, type ToolDef, type ToolResult } from '../registry';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const err = (message: string): ToolResult => ({ text: `Error: ${message}`, isError: true });

export const ORDER_LIST_COLUMNS = 'id,po_number,title,status,production_status,total_amount,currency,partner_id,rfq_id,delivery_date,created_at';

export const listOrders = tool({
  name: 'list_orders',
  description: 'List recent orders with PO number, status, production status, total, partner and delivery date.',
  cls: 'R',
  stage: 's1',
  shape: {
    status: z.string().optional().describe('Order status, e.g. new, in_production, shipped'),
    days_back: z.number().optional().default(30),
    limit: z.number().optional().default(20).describe('At most 100'),
  },
  async run({ status, days_back, limit }, ctx) {
    let query = ctx.sb()
      .from('orders')
      .select(ORDER_LIST_COLUMNS)
      .eq('tenant_id', ctx.tenantId)
      .gte('created_at', daysAgoIso(days_back, ctx.deps.now()))
      .order('created_at', { ascending: false })
      .limit(Math.max(1, Math.min(100, Math.floor(limit) || 20)));
    if (status) query = query.eq('status', status);
    const { data, error } = await query;
    if (error) return err(error.message);
    if (!data || data.length === 0) return { text: 'No orders found matching the criteria.' };
    const lines = (data as Array<Record<string, any>>).map((o) =>
      `${o.po_number || o.title || '-'} | ${o.status}${o.production_status ? `/${o.production_status}` : ''} | ${o.total_amount ?? '-'} ${o.currency || ''} | delivery ${isoDate(o.delivery_date, '-')} | partner ${o.partner_id ? 'assigned' : 'none'}\n   ID: ${o.id}`);
    return { text: `Found ${data.length} orders:\n\n${lines.join('\n')}` };
  },
});

export const getOrder = tool({
  name: 'get_order',
  description: 'Get one order by id or PO number: items, partner, production status and dates.',
  cls: 'R',
  stage: 's1',
  shape: { order_id: z.string().optional().describe('Order UUID'), po_number: z.string().optional().describe('PO number') },
  async run({ order_id, po_number }, ctx) {
    if (!order_id && !po_number) return err('order_id or po_number is required');
    if (order_id && !UUID_RE.test(order_id)) return { text: `Order not found: ${order_id}` };
    const sb = ctx.sb();
    let query = sb.from('orders').select('*').eq('tenant_id', ctx.tenantId);
    query = order_id ? query.eq('id', order_id) : query.eq('po_number', po_number as string);
    const { data: order, error } = await query.limit(1).maybeSingle();
    if (error) return err(error.message);
    if (!order) return { text: `Order not found: ${order_id ?? po_number}` };
    const [items, partner] = await Promise.all([
      sb.from('order_items').select('product_name,description,quantity,unit_price,total_price').eq('order_id', order.id).limit(200),
      order.partner_id ? sb.from('production_partners').select('company_name,country').eq('id', order.partner_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const p = partner.data as Record<string, any> | null;
    const text = [
      '=== ORDER ===',
      `ID: ${order.id}`,
      `PO: ${order.po_number || order.title || '-'} | From RFQ: ${order.from_rfq_number || '-'}`,
      `Status: ${order.status} | Production: ${order.production_status || '-'}`,
      `Total: ${order.total_amount ?? '-'} ${order.currency || ''}`,
      `Start: ${isoDate(order.start_date, '-')} | Delivery: ${isoDate(order.delivery_date, '-')}`,
      `Partner: ${p ? `${p.company_name} (${p.country || '-'})` : 'none'}`,
      `Created: ${isoTime(order.created_at)}`,
      '',
      `=== ITEMS (${(items.data ?? []).length}) ===`,
      ...((items.data ?? []) as Array<Record<string, any>>).map((i, n) => `  ${n + 1}. ${i.product_name || '-'} x${i.quantity} | unit ${i.unit_price} | total ${i.total_price}`),
    ].join('\n');
    return { text };
  },
});

export const getStockSummary = tool({
  name: 'get_stock_summary',
  description: 'Stock levels per material: full sheets, remnants, area and quantity on hand, value and low-stock flags.',
  cls: 'R',
  stage: 's1',
  shape: {},
  async run(_args, ctx) {
    const { data, error } = await ctx.sb().rpc('get_stock_summary', { p_tenant_id: ctx.tenantId });
    if (error) return err(error.message);
    const rows = (data ?? []) as Array<Record<string, any>>;
    if (rows.length === 0) return { text: 'No stock on record.' };
    const lines = rows.map((m) =>
      `${m.is_low_stock ? '[LOW] ' : ''}${m.material_name} (${m.category || '-'}${m.grade ? ` ${m.grade}` : ''}${m.thickness_mm ? ` ${m.thickness_mm} mm` : ''}) | sheets ${m.full_sheets} | remnants ${m.remnant_count} | area ${m.total_area_mm2} mm2 | qty ${m.total_quantity} ${m.base_unit || ''} | value ${m.total_value}`);
    return { text: `Stock summary (${rows.length} materials):\n\n${lines.join('\n')}` };
  },
});

export const ORDER_TOOLS: readonly ToolDef[] = [listOrders, getOrder, getStockSummary];
