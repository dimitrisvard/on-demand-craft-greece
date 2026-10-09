// Every constant of the Xometry port and the GraphQL query text equal the values the Python modules hold
// (golden.json "config", generated from xometry_bot/config.py, filters.py and partner_client.py).

import { describe, expect, it } from 'vitest';
import * as config from '../../../src/xometry/config';
import { SOURCE_BASES } from '../../../src/ports/p5';
import { loadGolden } from './helpers';

const C = loadGolden().config;

const sorted = (s: Iterable<string | number>) => [...s].sort((a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a) < String(b) ? -1 : 1));

describe('Xometry constants equal the Python config', () => {
  it('endpoint, presets and scan settings', () => {
    expect(config.PARTNER_GRAPHQL_URL).toBe(C.PARTNER_GRAPHQL_URL);
    expect(`${SOURCE_BASES.xometry}${config.PARTNER_GRAPHQL_PATH}`).toBe(C.PARTNER_GRAPHQL_URL);
    const presets = Object.fromEntries(Object.entries(config.PRESETS).map(([k, p]) => [k, { include: sorted(p.include), exclude: sorted(p.exclude) }]));
    expect(presets).toEqual(C.PRESETS);
    expect([...config.ACTIVE_PRESETS]).toEqual(C.ACTIVE_PRESETS);
    expect({ ...config.SCAN_FILTER }).toEqual(C.SCAN_FILTER);
    expect(config.SCAN_PAGE_LIMIT).toBe(C.SCAN_PAGE_LIMIT);
    expect(config.SCAN_MAX_PAGES).toBe(C.SCAN_MAX_PAGES);
  });

  it('regular-expression texts', () => {
    expect(config.PY_PATTERNS.SECONDARY_OP_RE).toBe(C.SECONDARY_OP_RE);
    expect(config.PY_PATTERNS.BORDERLINE_RE).toBe(C.BORDERLINE_RE);
    expect(config.PY_PATTERNS.TOLERANCE_RE).toBe(C.TOLERANCE_RE);
    expect(config.PY_PATTERNS.ROUGHNESS_RE).toBe(C.ROUGHNESS_RE);
    expect(config.PY_PATTERNS.THREAD_RISK_RE).toBe(C.THREAD_RISK_RE);
    expect(config.SECONDARY_OP_RE.source).toBe(C.SECONDARY_OP_RE);
    expect(config.BORDERLINE_RE.source).toBe(C.BORDERLINE_RE);
    expect(config.THREAD_RISK_RE.source).toBe(C.THREAD_RISK_RE);
    for (const re of [config.SECONDARY_OP_RE, config.BORDERLINE_RE, config.TOLERANCE_RE, config.ROUGHNESS_RE, config.THREAD_RISK_RE]) expect(re.flags).toBe('iu');
  });

  it('file formats, pricing constants and the query text', () => {
    expect(sorted(config.INSTANT_QUOTE_EXTS)).toEqual(C.INSTANT_QUOTE_EXTS);
    expect(sorted(config.MANUAL_ONLY_EXTS)).toEqual(C.MANUAL_ONLY_EXTS);
    expect([...config.PREFERRED_QUOTE_EXTS]).toEqual(C.PREFERRED_QUOTE_EXTS);
    expect(config.DISCOUNT).toBe(C.DISCOUNT);
    expect(config.MIN_MARGIN).toBe(C.MIN_MARGIN);
    expect(config.LEADTIME_BUSINESS_DAYS).toBe(C.LEADTIME_BUSINESS_DAYS);
    expect([...config.PLAUSIBLE_BUYER_TO_PARTNER_RATIO]).toEqual(C.PLAUSIBLE_BUYER_TO_PARTNER_RATIO);
    expect(config.GSH_JOB_OFFERS_QUERY).toBe(C.QUERY);
  });

  it('PY_SPACE holds exactly the characters of Python str.isspace()', () => {
    const python = [0x9, 0xa, 0xb, 0xc, 0xd, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000];
    const re = new RegExp(`^${config.PY_SPACE}$`, 'u');
    const found: number[] = [];
    for (let c = 0; c <= 0xffff; c++) if (re.test(String.fromCharCode(c))) found.push(c);
    expect(found).toEqual(python);
  });
});
