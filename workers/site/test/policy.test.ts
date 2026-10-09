// Gate policy table: every action ID has a rule, machine callers per ID, rate scopes and their bindings, and the
// API_GATES_MODE parser.

import { describe, expect, it } from 'vitest';
import { bindingFor, rateKey } from '../../shared/src/auth/rate-limit';
import { ACTION_RULES, ALL_ACTION_IDS, machinesFor, parseGateModes, userScopeOf, type ActionId } from '../src/auth/policy';

describe('ACTION_RULES', () => {
  it('has a rule for each of the 43 action IDs (34 of Phase 2, AG-1…AG-7 of Phase 4, MK-8 and CD-1 of Phase 5)', () => {
    expect(ALL_ACTION_IDS).toHaveLength(43);
    expect(new Set(ALL_ACTION_IDS).size).toBe(43);
  });

  it('allows machine callers exactly as listed', () => {
    const machines: Partial<Record<ActionId, string[]>> = {};
    for (const id of ALL_ACTION_IDS) if (ACTION_RULES[id].machines) machines[id] = [...ACTION_RULES[id].machines!];
    expect(machines).toEqual({ 'TD-1': ['mcp'], 'TS-1': ['collector', 'mcp'], 'FS-2': ['mcp'], 'SC-1': ['mcp'], 'SC-3': ['mcp'] });
    expect(machinesFor('TD-1', 'export')).toEqual(['mcp']);
    expect(machinesFor('TD-1', 'list')).toEqual([]);
    expect(machinesFor('SC-2', 'post')).toEqual([]);
    expect(machinesFor('NT-7', 'inv-cron-batch')).toEqual([]);
  });

  it('public, Turnstile and admin access per ID', () => {
    const byAccess = (access: string) => ALL_ACTION_IDS.filter((id) => ACTION_RULES[id].access === access).sort();
    expect(byAccess('public')).toEqual(['MK-1', 'MK-2', 'MK-4', 'MK-6']);
    expect(byAccess('turnstile')).toEqual(['EM-1', 'EM-2']);
    expect(byAccess('turnstile-or-staff')).toEqual(['EM-3']);
    expect(byAccess('admin')).toEqual(['AG-4', 'MK-5', 'NT-7']);
    expect(byAccess('admin-json')).toEqual(['MK-3']);
    expect(byAccess('files')).toEqual(['S3-1', 'S3-2', 'S3-3']);
    expect(byAccess('relay')).toEqual(['AG-2']);
    expect(byAccess('signed-link')).toEqual(['AG-3']);
  });

  it('Turnstile actions: contact form and quote form on email, contact only on contact, quote on rfq', () => {
    expect(ACTION_RULES['EM-1'].turnstileActions).toEqual(['contact', 'quote']);
    expect(ACTION_RULES['EM-2'].turnstileActions).toEqual(['contact']);
    expect(ACTION_RULES['EM-3'].turnstileActions).toEqual(['quote']);
  });
});

describe('rate scopes and bindings', () => {
  const bulk: ActionId[] = ['S3-1', 'S3-2', 'S3-5', 'TD-1', 'FS-1', 'NT-5'];

  it('idempotent reads and upload presigns use the bulk binding; other signed-in keys the default one', () => {
    for (const id of ALL_ACTION_IDS) {
      const scope = userScopeOf(id, 'POST');
      if (!scope) continue;
      const binding = bindingFor(rateKey('u', 'uid', scope));
      expect([id, binding]).toEqual([id, bulk.includes(id) ? 'bulk' : 'default']);
    }
  });

  it('inventory reads (GET) are bulk, inventory writes default', () => {
    expect(bindingFor(rateKey('u', 'uid', userScopeOf('NT-4', 'GET')!))).toBe('bulk');
    expect(bindingFor(rateKey('u', 'uid', userScopeOf('NT-4', 'PUT')!))).toBe('default');
  });

  it('nest and rfq-pdf keys', () => {
    expect(rateKey('u', 'uid', userScopeOf('NT-3', 'POST')!)).toBe('u:uid:nest');
    expect(rateKey('u', 'uid', userScopeOf('S3-1', 'POST')!)).toBe('u:uid:s3:up');
    expect(rateKey('u', 'uid', userScopeOf('S3-2', 'POST')!)).toBe('u:uid:s3:r');
  });

  it('machine keys use the default binding', () => {
    expect(bindingFor(rateKey('m', 'collector', 'tender-scan'))).toBe('default');
    expect(bindingFor(rateKey('m', 'mcp', 'tenders'))).toBe('default');
  });
});

describe('parseGateModes', () => {
  const enforceAll = { auth: 'enforce', turnstile: 'enforce', rate: 'enforce', recipient: 'enforce', redirect: 'enforce', data: 'enforce' };

  it('absent or empty var: recipient=report, everything else enforce', () => {
    expect(parseGateModes(undefined)).toEqual({ ...enforceAll, recipient: 'report' });
    expect(parseGateModes('  ')).toEqual({ ...enforceAll, recipient: 'report' });
  });

  it('a set var enforces every class it does not name', () => {
    expect(parseGateModes('redirect=report')).toEqual({ ...enforceAll, redirect: 'report' });
    expect(parseGateModes('recipient=report')).toEqual({ ...enforceAll, recipient: 'report' });
  });

  it('reads a comma list, ignoring case, spaces, unknown classes and unknown modes', () => {
    expect(parseGateModes(' Turnstile = REPORT , redirect=report,bogus=report,rate=maybe,auth')).toEqual({ ...enforceAll, turnstile: 'report', redirect: 'report' });
  });
});

describe('Phase 4 rows AG-1…AG-7 (/api/agent/*)', () => {
  const AG: ActionId[] = ['AG-1', 'AG-2', 'AG-3', 'AG-4', 'AG-5', 'AG-6', 'AG-7'];

  it('access per row; no machine caller of the policy', () => {
    expect(Object.fromEntries(AG.map((id) => [id, ACTION_RULES[id].access]))).toEqual({
      'AG-1': 'staff', 'AG-2': 'relay', 'AG-3': 'signed-link', 'AG-4': 'admin', 'AG-5': 'staff', 'AG-6': 'staff', 'AG-7': 'staff',
    });
    for (const id of AG) expect(ACTION_RULES[id].machines, id).toBeUndefined();
  });

  it('signed-in rows count against u:<uid>:agent on the default binding; relay and link rows have no user scope', () => {
    for (const id of ['AG-1', 'AG-4', 'AG-5', 'AG-6', 'AG-7'] as ActionId[]) {
      expect(rateKey('u', 'uid', userScopeOf(id, 'POST')!), id).toBe('u:uid:agent');
      expect(bindingFor(rateKey('u', 'uid', userScopeOf(id, 'GET')!)), id).toBe('default');
    }
    expect(userScopeOf('AG-2', 'POST')).toBeUndefined();
    expect(userScopeOf('AG-3', 'GET')).toBeUndefined();
    expect(bindingFor(rateKey('m', 'telegram', 'agent'))).toBe('default');
    expect(bindingFor(['file', '203.0.113.9'].join(':'))).toBe('default');
  });
});
