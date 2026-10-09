// Port of xometry-bot/tests/test_models.py (12 test functions, all ported; titles keep the Python names), plus the
// pydantic lax-mode answers the parser reproduces beyond the golden vectors (each expected value was measured with
// the real models under pydantic 2).

import { describe, expect, it } from 'vitest';
import { dumpJobOffer, parseJobOffer, parseMoney, parseScanPage, pyDateFromIso, pyFloatText } from '../../../src/xometry/models';
import { XometrySchemaError } from '../../../src/xometry/types';
import { gqlPage, makeOffer, makePart, type Json } from './helpers';

function locsOf(fn: () => unknown): string[][] {
  try {
    fn();
  } catch (e) {
    if (e instanceof XometrySchemaError) return e.locs;
    throw e;
  }
  throw new Error('no schema error');
}

const base = { id: 1, code: 'C', parts: [] };
const offer = (over: Json) => parseJobOffer({ ...base, ...over });

describe('TestMoneySeam', () => {
  it('test_amount_currency', () => {
    expect(parseMoney({ amount: 123.45, currency: 'EUR' })).toEqual({ amount: 123.45, currency: 'EUR' });
  });

  it('test_value_currency_code', () => {
    expect(parseMoney({ value: 99.5, currencyCode: 'EUR' })).toEqual({ amount: 99.5, currency: 'EUR' });
  });

  it('test_bare_number', () => {
    expect(parseMoney(75).amount).toBe(75.0);
  });
});

describe('TestJobOffer', () => {
  it('test_full_payload', () => {
    const o = parseJobOffer(makeOffer());
    expect(o.code).toBe('HJO-21991-684');
    expect(o.cost?.amount).toBe(100.0);
    expect(o.allow_counteroffer_from).toBe(80.0);
    expect(o.leadtime).toBe('2026-06-18');
    expect(o.publication_end).toBe('2026-06-14T10:00:00Z');
    expect(o.parts[0].process_type).toBe('cnc_milling');
    expect(o.parts[0].tags[0].context).toBe('production_methods');
  });

  it('test_allow_counteroffer_from_as_money_object', () => {
    expect(parseJobOffer(makeOffer(undefined, { allowCounterofferFrom: { amount: 81.5, currency: 'EUR' } })).allow_counteroffer_from).toBe(81.5);
  });

  it('test_leadtime_iso_datetime', () => {
    expect(parseJobOffer(makeOffer(undefined, { leadtime: '2026-07-01T00:00:00Z' })).leadtime).toBe('2026-07-01');
  });

  it('test_leadtime_epoch_millis', () => {
    expect(parseJobOffer(makeOffer(undefined, { leadtime: Date.UTC(2026, 6, 1) })).leadtime).toBe('2026-07-01');
  });

  it('test_publication_epoch_millis', () => {
    expect(parseJobOffer(makeOffer(undefined, { publicationEnd: Date.UTC(2026, 5, 14, 10) })).publication_end).toBe('2026-06-14T10:00:00Z');
  });

  it('test_unknown_fields_ignored', () => {
    expect(parseJobOffer(makeOffer(undefined, { unexpectedField: { x: 1 } })).code).toBe('HJO-21991-684');
  });

  it('test_null_finish_coerced_to_empty', () => {
    expect(parseJobOffer(makeOffer(undefined, { parts: [makePart({ finish: null })] })).parts[0].finish).toBe('');
  });

  it('test_missing_optionals', () => {
    const o = parseJobOffer({ id: 1, code: 'HJO-1', parts: [] });
    expect(o.cost).toBeNull();
    expect(o.leadtime).toBeNull();
  });
});

describe('TestScanPage', () => {
  it('test_page_parses', () => {
    const page = parseScanPage((gqlPage([makeOffer()]).data as Json).gshJobOffers);
    expect(page.metadata.has_more).toBe(false);
    expect(page.offers).toHaveLength(1);
  });
});

describe('pydantic lax mode as measured (beyond the golden vectors)', () => {
  it('publicationEnd strings and numbers in pydantic JSON form', () => {
    const cases: Array<[unknown, string]> = [
      ['2026-06-14T10:00:00.5Z', '2026-06-14T10:00:00.500000Z'],
      ['2026-06-14T10:00:00.000Z', '2026-06-14T10:00:00Z'],
      ['2026-06-14', '2026-06-14T00:00:00'],
      ['2026-06-14T10:00Z', '2026-06-14T10:00:00Z'],
      ['2026-06-14 10:00:00Z', '2026-06-14T10:00:00Z'],
      ['2026-06-14T10:00:00-00:00', '2026-06-14T10:00:00Z'],
      ['2026-06-14T10:00:00+0200', '2026-06-14T10:00:00+02:00'],
      ['2026-06-14T10:00:00,5Z', '2026-06-14T10:00:00.500000Z'],
      ['2026-06-14T10:00:00.1234567Z', '2026-06-14T10:00:00.123456Z'],
      ['2026-06-14t10:00:00z', '2026-06-14T10:00:00Z'],
      ['2026-06-14T10:00:00-02:30', '2026-06-14T10:00:00-02:30'],
      ['1781431200', '2026-06-14T10:00:00Z'],
      ['1781431200.5', '2026-06-14T10:00:00.500000Z'],
      [1781431200.5, '2026-06-14T10:00:00.500000Z'],
      [0, '1970-01-01T00:00:00Z'],
      [-5, '1969-12-31T23:59:55Z'],
      [-1.5, '1969-12-31T23:59:58.500000Z'],
      [2e10, '2603-10-11T11:33:20Z'],
      [20000000001, '1970-08-20T11:33:20.001000Z'],
      [100000000001, '1973-03-03T09:46:40.001000Z'],
    ];
    for (const [input, expected] of cases) expect(offer({ publicationEnd: input }).publication_end, String(input)).toBe(expected);
    for (const bad of [true, 'x', '2026-06-14T24:00:00Z', '2026-06-14T10', '2026-06-14T10:00:00+02', '2026-06-14T10:00:00GMT', '2026-02-30T10:00:00Z', '2026-06-14T10:00:00.Z', '1e10', ' 2026-06-14T10:00:00Z', '2026-06-14T10:00:00+24:00']) {
      expect(locsOf(() => offer({ publicationEnd: bad })), String(bad)).toEqual([['publicationEnd']]);
    }
  });

  it('leadtime: date.fromisoformat of the first 10 characters; numbers and booleans are epoch seconds', () => {
    const cases: Array<[unknown, string]> = [
      ['20260701', '2026-07-01'],
      ['2026-W01-1', '2025-12-29'],
      ['2026-W01', '2025-12-29'],
      ['2026W011', '2025-12-29'],
      ['2026-07-01junk', '2026-07-01'],
      [1.5, '1970-01-01'],
      [true, '1970-01-01'],
      [false, '1970-01-01'],
    ];
    for (const [input, expected] of cases) expect(offer({ leadtime: input }).leadtime, String(input)).toBe(expected);
    for (const bad of [{ a: 1 }, '2026-7-1', '']) expect(locsOf(() => offer({ leadtime: bad })), JSON.stringify(bad)).toEqual([['leadtime']]);
  });

  it('Python 3.11 date.fromisoformat', () => {
    expect(pyDateFromIso('2026-W53-7')).toBe('2027-01-03');
    expect(pyDateFromIso('2026W53')).toBe('2026-12-28');
    expect(pyDateFromIso('2024-02-29')).toBe('2024-02-29');
    for (const bad of ['2026-W01-8', '2026-001', '2026-13-01', '2026-02-29', '0000-01-01', '2026-07-0', '2026-07-01 ', '2025-W53']) {
      expect(() => pyDateFromIso(bad), bad).toThrow(RangeError);
    }
  });

  it('int fields: integral floats, booleans and digit strings; fractions and other text refused', () => {
    const qty = (v: unknown) => offer({ parts: [{ quantity: v }] }).parts[0].quantity;
    const ok: Array<[unknown, number | null]> = [[true, 1], ['3', 3], ['3.0', 3], [' 3 ', 3], [3.0, 3], [null, null], ['1_000', 1000], ['+3', 3], ['-3', -3], ['3.00', 3], ['03', 3], ['-3.0', -3], ['3\n', 3]];
    for (const [input, expected] of ok) expect(qty(input), JSON.stringify(input)).toBe(expected);
    for (const bad of ['3e0', 'abc', '0x10', '3.5', '3.', '.0', '_1', '1__0', '1_', '\u0663', '\uff13']) {
      expect(locsOf(() => qty(bad)), JSON.stringify(bad)).toEqual([['parts', '0', 'quantity']]);
    }
  });

  it('float fields: Python float() text, inf and nan included', () => {
    const weight = (v: unknown) => offer({ parts: [{ weightKg: v }] }).parts[0].weight_kg;
    const ok: Array<[unknown, number]> = [[true, 1], [1, 1], ['1.5', 1.5], [' 1.5 ', 1.5], ['1e3', 1000], ['1_0', 10], ['.5', 0.5], ['5.', 5], ['1E5', 100000], ['-.5', -0.5], ['1_000.5', 1000.5], ['-Infinity', -Infinity]];
    for (const [input, expected] of ok) expect(weight(input), JSON.stringify(input)).toBe(expected);
    expect(weight('inf')).toBe(Infinity);
    expect(weight('nan')).toBeNaN();
    for (const bad of ['abc', '1e', '1__0', '_1', '0x10', '1.5f', '']) expect(locsOf(() => weight(bad)), JSON.stringify(bad)).toEqual([['parts', '0', 'weightKg']]);
    expect(pyFloatText('NaN')).toBeNaN();
  });

  it('bool fields: 0/1 and the pydantic words; other numbers refused', () => {
    const urgent = (v: unknown) => offer({ isUrgent: v }).is_urgent;
    for (const t of ['true', 'True', 'yes', '1', 1, 1.0, 't', 'y', 'on']) expect(urgent(t), String(t)).toBe(true);
    for (const f of ['0', 'off', 0, 'f', 'n']) expect(urgent(f), String(f)).toBe(false);
    for (const bad of [2, 0.5, null]) expect(locsOf(() => urgent(bad)), String(bad)).toEqual([['isUrgent']]);
  });

  it('int | str ids: strings stay strings, other values are read as int; failures name both branches', () => {
    const id = (v: unknown) => parseJobOffer({ id: v, code: 'C' }).id;
    expect(id(true)).toBe(1);
    expect(id(3.0)).toBe(3);
    expect(id('3')).toBe('3');
    for (const bad of [3.5, null, { a: 1 }, [1]]) expect(locsOf(() => id(bad)), JSON.stringify(bad)).toEqual([['id', 'int'], ['id', 'str']]);
    expect(parseJobOffer({ ...base, parts: [{ files: [{ id: true, name: 'a' }] }] }).parts[0].files[0].id).toBe(1);
  });

  it('str fields take strings only; lists only arrays; every error is reported in field order', () => {
    for (const bad of [1, 1.0, true, null, ['a']]) expect(locsOf(() => parseJobOffer({ id: 1, code: bad })), JSON.stringify(bad)).toEqual([['code']]);
    for (const bad of [null, 1, 's']) expect(locsOf(() => offer({ parts: [{ tags: bad }] }))).toEqual([['parts', '0', 'tags']]);
    expect(locsOf(() => offer({ parts: [{ tags: [1] }] }))).toEqual([['parts', '0', 'tags', '0']]);
    expect(locsOf(() => offer({ isUrgent: null, parts: [{ quantity: 3.5, tags: [{ id: 'x', name: 1 }] }] }))).toEqual([
      ['isUrgent'],
      ['parts', '0', 'quantity'],
      ['parts', '0', 'tags', '0', 'id'],
      ['parts', '0', 'tags', '0', 'name'],
    ]);
    expect(locsOf(() => offer({ parts: [{ files: [{ id: 1 }] }] }))).toEqual([['parts', '0', 'files', '0', 'name']]);
    expect(locsOf(() => offer({ parts: [{ finish: 5 }] }))).toEqual([['parts', '0', 'finish']]);
  });

  it('money and nested models: shapes and error locations', () => {
    expect(offer({ allowCounterofferFrom: { amount: null, value: 3 } }).allow_counteroffer_from).toBeNull();
    expect(offer({ allowCounterofferFrom: true }).allow_counteroffer_from).toBe(1);
    expect(locsOf(() => offer({ allowCounterofferFrom: 'x' }))).toEqual([['allowCounterofferFrom']]);
    expect(locsOf(() => offer({ cost: 'x' }))).toEqual([['cost']]);
    expect(locsOf(() => offer({ cost: [1] }))).toEqual([['cost']]);
    expect(locsOf(() => offer({ cost: { amount: 1, currency: null } }))).toEqual([['cost', 'currency']]);
    expect(locsOf(() => offer({ cost: { amount: 1, currencyCode: null } }))).toEqual([['cost', 'currency']]);
    expect(locsOf(() => offer({ cost: { amount: 'abc' } }))).toEqual([['cost', 'amount']]);
    expect(locsOf(() => offer({ job: 'x' }))).toEqual([['job']]);
    expect(offer({ job: null }).job).toBeNull();
    expect(locsOf(() => offer({ job: { jobState: 5 } }))).toEqual([['job', 'jobState']]);
    expect(locsOf(() => parseJobOffer('x'))).toEqual([[]]);
    expect(locsOf(() => parseMoney('5'))).toEqual([[]]);
    expect(locsOf(() => parseScanPage({ metadata: { hasMore: false }, offers: null }))).toEqual([['offers']]);
    expect(locsOf(() => parseScanPage({ metadata: { hasMore: false, limit: null }, offers: [] }))).toEqual([['metadata', 'limit']]);
    expect(locsOf(() => parseScanPage({ metadata: 'x', offers: [] }))).toEqual([['metadata']]);
  });

  it('aliases win over field names; field names are accepted alone (populate_by_name)', () => {
    expect(offer({ isUrgent: true, is_urgent: false }).is_urgent).toBe(true);
    expect(offer({ is_urgent: true }).is_urgent).toBe(true);
  });

  it('the dump never carries raw', () => {
    const o = parseJobOffer(makeOffer());
    o.raw = { code: 'X' };
    expect('raw' in dumpJobOffer(o)).toBe(false);
  });
});
