// MaterialStock: one Durable Object per tenant and material (idFromName('<tenant_id>:<material_id>')). Serialises
// stock holds of order items; the truth is public.stock_reservations, written only through rpc/stock_hold,
// rpc/stock_commit and rpc/stock_release.
//
// Rules
//   - reserve is idempotent per order item; holds expire after 14 days (daily alarm releases them as 'expired').
//   - Remaining stock is re-read on every call; holds above the remaining stock raise a card.

import { DurableObject } from 'cloudflare:workers';
import type { OpsEnv } from '../env';

export interface StockHold {
  stock_item_id: string | null;
  area_mm2: number | null;
  quantity: number | null;
  expires_at: string;
}

export type StockHoldResult =
  | { status: 'held' | 'already_held'; holds: StockHold[] }
  | { status: 'shortfall'; holds: StockHold[]; missing: { area_mm2?: number; quantity?: number } }
  | { status: 'not_stocked' };

export interface StockCheck {
  material_id: string;
  items: Array<{
    stock_item_id: string;
    remaining_area_mm2: number | null;
    remaining_quantity: number | null;
    held_area_mm2: number;
    held_quantity: number;
  }>;
  /** stock_item ids whose holds exceed the remaining stock. */
  over_held: string[];
}

export class MaterialStock extends DurableObject<OpsEnv> {
  async reserve(orderItemId: string, need: { area_mm2?: number; quantity?: number }): Promise<StockHoldResult> {
    throw new Error('not implemented: RP');
  }

  async commit(orderItemId: string, nestingSessionId: string): Promise<void> {
    throw new Error('not implemented: RP');
  }

  async release(orderItemId: string, reason: 'cancelled' | 'consumed' | 'expired' | 'manual'): Promise<void> {
    throw new Error('not implemented: RP');
  }

  async check(): Promise<StockCheck> {
    throw new Error('not implemented: RP');
  }

  async alarm(): Promise<void> {
    throw new Error('not implemented: RP');
  }
}
