// Port of xometry-bot/tests/test_pricing.py (22 test functions, all ported; titles keep the Python names), plus the
// Python number formatting the port relies on.

import { describe, expect, it } from 'vitest';
import { addBusinessDays, compute, submitGuard, suggestedLeadtime, suggestedPrice } from '../../../src/xometry/pricing';
import { pyFixed, pyPercent0, pyRound } from '../../../src/xometry/pyfmt';

const TODAY = '2026-06-11'; // Thursday

describe('TestAddBusinessDays', () => {
  it('test_golden_case_from_spec', () => {
    expect(addBusinessDays(TODAY, 10)).toBe('2026-06-25');
  });

  it('test_skips_weekend', () => {
    expect(addBusinessDays('2026-06-12', 1)).toBe('2026-06-15');
  });

  it('test_skips_holidays', () => {
    expect(addBusinessDays('2026-06-12', 1, new Set(['2026-06-15']))).toBe('2026-06-16');
  });

  it('test_zero_days', () => {
    expect(addBusinessDays(TODAY, 0)).toBe(TODAY);
  });

  it('test_negative_raises', () => {
    expect(() => addBusinessDays(TODAY, -1)).toThrow(RangeError);
  });
});

describe('TestSuggestedPrice', () => {
  it('test_buyer_discount_wins', () => {
    expect(suggestedPrice(1000.0, 100.0)).toBe(800.0);
  });

  it('test_cost_floor_wins', () => {
    expect(suggestedPrice(1000.0, 900.0)).toBe(1035.0);
  });

  it('test_rounding', () => {
    expect(suggestedPrice(333.33, 1.0)).toBe(266.66);
  });
});

describe('TestSuggestedLeadtime', () => {
  it('test_xometry_date_later_than_floor', () => {
    expect(suggestedLeadtime('2026-07-20', { today: TODAY })).toBe('2026-07-20');
  });

  it('test_floor_wins_when_xometry_asks_sooner', () => {
    expect(suggestedLeadtime('2026-06-18', { today: TODAY })).toBe('2026-06-25');
  });

  it('test_no_xometry_date', () => {
    expect(suggestedLeadtime(null, { today: TODAY })).toBe('2026-06-25');
  });
});

describe('TestCompute', () => {
  it('test_ready', () => {
    const res = compute({ buyer_price: 1000.0, partner_cost: 700.0, your_cost: null, xo_leadtime: '2026-06-18', today: TODAY });
    expect(res).toEqual({ suggested_price: 805.0, suggested_leadtime: '2026-06-25', status: 'ready', flags: [] });
  });

  it('test_your_cost_overrides_partner_cost', () => {
    const res = compute({ buyer_price: 1000.0, partner_cost: 700.0, your_cost: 900.0, xo_leadtime: null, today: TODAY });
    expect(res.suggested_price).toBe(1035.0);
    expect(res.status).toBe('needs_review');
  });

  it('test_floor_above_buyer_needs_review', () => {
    const res = compute({ buyer_price: 100.0, partner_cost: 95.0, your_cost: null, xo_leadtime: null, today: TODAY });
    expect(res.suggested_price).toBeCloseTo(109.25, 10);
    expect(res.status).toBe('needs_review');
  });

  it('test_no_buyer_price', () => {
    const res = compute({ buyer_price: null, partner_cost: 100.0, your_cost: null, xo_leadtime: null, today: TODAY });
    expect(res.status).toBe('needs_review');
    expect(res.suggested_price).toBeNull();
  });

  it('test_zero_buyer_price_flagged', () => {
    const res = compute({ buyer_price: 0.0, partner_cost: 100.0, your_cost: null, xo_leadtime: null, today: TODAY });
    expect(res.status).toBe('needs_review');
    expect(res.flags).toContain('price_implausible:buyer_price<=0');
  });

  it('test_implausible_ratio_flagged', () => {
    const res = compute({ buyer_price: 1000.0, partner_cost: 100.0, your_cost: null, xo_leadtime: null, today: TODAY });
    expect(res.status).toBe('needs_review');
    expect(res.flags.some((f) => f.startsWith('price_implausible:buyer/partner_ratio'))).toBe(true);
  });

  it('test_no_cost_floor_flagged', () => {
    const res = compute({ buyer_price: 500.0, partner_cost: null, your_cost: null, xo_leadtime: null, today: TODAY });
    expect(res.status).toBe('needs_review');
    expect(res.flags).toContain('no_cost_floor');
  });
});

describe('TestSubmitGuard', () => {
  it('test_all_clear', () => {
    expect(submitGuard({ final_price: 800.0, final_leadtime: '2026-06-25', allow_counter_from: 500.0, your_cost: 600.0, today: TODAY })).toEqual([]);
  });

  it('test_below_xometry_floor', () => {
    const reasons = submitGuard({ final_price: 400.0, final_leadtime: '2026-06-25', allow_counter_from: 500.0, your_cost: null, today: TODAY });
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('counteroffer floor');
  });

  it('test_below_cost_floor', () => {
    const reasons = submitGuard({ final_price: 600.0, final_leadtime: '2026-06-25', allow_counter_from: null, your_cost: 600.0, today: TODAY });
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('cost floor');
  });

  it('test_leadtime_too_early', () => {
    const reasons = submitGuard({ final_price: 800.0, final_leadtime: '2026-06-24', allow_counter_from: null, your_cost: null, today: TODAY });
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('business days');
  });
});

describe('Python number formatting (ties to even on the exact binary value)', () => {
  it('round(x, 2) differs from JavaScript toFixed exactly on the binary ties', () => {
    expect(pyRound(0.125, 2)).toBe(0.12);
    expect((0.125).toFixed(2)).toBe('0.13');
    expect(pyRound(0.375, 2)).toBe(0.38);
    expect(pyRound(2.675, 2)).toBe(2.67);
    expect(pyRound(-0.125, 2)).toBe(-0.12);
    expect(Object.is(pyRound(-0.001, 2), -0)).toBe(true);
    expect(pyRound(1e22, 2)).toBe(1e22);
    expect(pyRound(Infinity, 2)).toBe(Infinity);
  });

  it('f"{x:.2f}", f"{x:.0f}" and f"{x:.0%}"', () => {
    expect(pyFixed(5.125, 2)).toBe('5.12');
    expect((5.125).toFixed(2)).toBe('5.13');
    expect(pyFixed(2.5, 0)).toBe('2');
    expect(pyFixed(3.5, 0)).toBe('4');
    expect(pyFixed(-0.001, 2)).toBe('-0.00');
    expect(pyFixed(NaN, 2)).toBe('nan');
    expect(pyFixed(-Infinity, 2)).toBe('-inf');
    expect(pyFixed(1e21, 2)).toBe('1000000000000000000000.00');
    expect(pyPercent0(0.15)).toBe('15%');
    expect(pyPercent0(0.125)).toBe('12%');
  });

  it('the buyer/partner ratio of 41/8 prints as 5.12 (JavaScript would print 5.13)', () => {
    expect(compute({ buyer_price: 41, partner_cost: 8, your_cost: null, xo_leadtime: null, today: TODAY }).flags).toEqual(['price_implausible:buyer/partner_ratio=5.12']);
  });
});
