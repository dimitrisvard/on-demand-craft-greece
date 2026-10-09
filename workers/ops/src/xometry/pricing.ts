// Pricing and lead-time math, ported from xometry-bot/xometry_bot/pricing.py (pure; no I/O).
//
//   suggested = max(buyer_price * (1 - DISCOUNT), your_cost * (1 + MIN_MARGIN)), rounded like Python's round(x, 2)
//   lead time = max(Xometry's required date, today + 10 business days)
//
// Rules
//   - Dates are 'YYYY-MM-DD' strings with UTC calendar arithmetic; business days skip Saturday, Sunday and the
//     given holidays.
//   - compute() never guesses: an implausible input lands in needs_review with an explanatory flag; a ratio flag
//     prints the ratio as Python's f"{ratio:.2f}".
//   - submitGuard() lists the reasons a submit must be refused (empty = OK), with Python's number formatting.

import { DISCOUNT, LEADTIME_BUSINESS_DAYS, MIN_MARGIN, PLAUSIBLE_BUYER_TO_PARTNER_RATIO } from './config';
import { pyFixed, pyPercent0, pyRound } from './pyfmt';

const DAY_MS = 86_400_000;

function toUtcMs(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new RangeError(`not an ISO date: ${iso}`);
  const t = new Date(Date.UTC(2000, Number(m[2]) - 1, Number(m[3])));
  t.setUTCFullYear(Number(m[1]));
  return t.getTime();
}

function toIso(ms: number): string {
  const t = new Date(ms);
  return `${String(t.getUTCFullYear()).padStart(4, '0')}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/** n business days after start (Saturday, Sunday and holidays skipped); n < 0 throws. */
export function addBusinessDays(startIso: string, n: number, holidays: ReadonlySet<string> = new Set()): string {
  if (n < 0) throw new RangeError('n must be >= 0');
  let t = toUtcMs(startIso);
  let remaining = n;
  while (remaining > 0) {
    t += DAY_MS;
    const weekday = new Date(t).getUTCDay();
    if (weekday >= 1 && weekday <= 5 && !holidays.has(toIso(t))) remaining -= 1;
  }
  return toIso(t);
}

export function suggestedPrice(buyerPrice: number, yourCost: number, o: { discount?: number; minMargin?: number } = {}): number {
  const discount = o.discount ?? DISCOUNT;
  const minMargin = o.minMargin ?? MIN_MARGIN;
  const a = buyerPrice * (1 - discount);
  const b = yourCost * (1 + minMargin);
  return pyRound(b > a ? b : a, 2);
}

/** Never earlier than today + N business days, even when Xometry asked for sooner. */
export function suggestedLeadtime(xoIso: string | null, o: { today: string; businessDays?: number; holidays?: ReadonlySet<string> }): string {
  const floor = addBusinessDays(o.today, o.businessDays ?? LEADTIME_BUSINESS_DAYS, o.holidays);
  return xoIso !== null && xoIso > floor ? xoIso : floor;
}

/** Quote-engine hook of the Python bot: no engine wired, so the cost floor falls back to partner_cost. */
export function estimateCost(_row: Record<string, unknown>): number | null {
  return null;
}

export interface ComputeResult {
  suggested_price: number | null;
  suggested_leadtime: string;
  status: 'ready' | 'needs_review';
  flags: string[];
}

export function compute(i: {
  buyer_price: number | null;
  partner_cost: number | null;
  your_cost: number | null;
  xo_leadtime: string | null;
  today: string;
  holidays?: ReadonlySet<string>;
}): ComputeResult {
  const lead = suggestedLeadtime(i.xo_leadtime, { today: i.today, holidays: i.holidays });
  const flags: string[] = [];
  const cost = i.your_cost !== null ? i.your_cost : i.partner_cost;
  if (i.buyer_price === null || i.buyer_price <= 0 || cost === null) {
    if (i.buyer_price !== null && i.buyer_price <= 0) flags.push('price_implausible:buyer_price<=0');
    if (i.buyer_price !== null && i.buyer_price > 0 && cost === null) flags.push('no_cost_floor');
    return { suggested_price: null, suggested_leadtime: lead, status: 'needs_review', flags };
  }
  if (i.partner_cost !== null && i.partner_cost > 0) {
    const ratio = i.buyer_price / i.partner_cost;
    const [lo, hi] = PLAUSIBLE_BUYER_TO_PARTNER_RATIO;
    if (!(lo <= ratio && ratio <= hi)) flags.push(`price_implausible:buyer/partner_ratio=${pyFixed(ratio, 2)}`);
  }
  const price = suggestedPrice(i.buyer_price, cost);
  const status = price <= i.buyer_price && flags.length === 0 ? 'ready' : 'needs_review';
  return { suggested_price: price, suggested_leadtime: lead, status, flags };
}

/** Reasons a submit must be refused; [] = OK to send. */
export function submitGuard(i: {
  final_price: number;
  final_leadtime: string;
  allow_counter_from: number | null;
  your_cost: number | null;
  today: string;
  min_margin?: number;
  business_days?: number;
  holidays?: ReadonlySet<string>;
}): string[] {
  const minMargin = i.min_margin ?? MIN_MARGIN;
  const businessDays = i.business_days ?? LEADTIME_BUSINESS_DAYS;
  const reasons: string[] = [];
  if (i.allow_counter_from !== null && i.final_price < i.allow_counter_from) {
    reasons.push(`price ${pyFixed(i.final_price, 2)} is below Xometry's counteroffer floor ${pyFixed(i.allow_counter_from, 2)} (allowCounterofferFrom)`);
  }
  if (i.your_cost !== null && i.final_price < i.your_cost * (1 + minMargin)) {
    reasons.push(
      `price ${pyFixed(i.final_price, 2)} is below cost floor ${pyFixed(i.your_cost * (1 + minMargin), 2)} (cost ${pyFixed(i.your_cost, 2)} + ${pyPercent0(minMargin)})`,
    );
  }
  const floor = addBusinessDays(i.today, businessDays, i.holidays);
  if (i.final_leadtime < floor) {
    reasons.push(`lead time ${i.final_leadtime} is earlier than ${floor} (today + ${businessDays} business days)`);
  }
  return reasons;
}
