// K-1: the /api/agent/* contract. Verb codes are unique per card kind and every approval button fits Telegram's
// callback_data limit; every shared fixture in test/fixtures/agent-api/ is accepted ('<Type>.<case>.json') or
// refused ('<Type>.reject-<case>.json') by its type guard.

import { describe, expect, it } from 'vitest';
import {
  AGENT_API_GUARDS,
  CALLBACK_DATA_RE,
  CARD_KINDS,
  VERB_CODES,
  VERB_LABELS,
  callbackData,
  codeForVerb,
  isDecisionBodyDashboard,
  isDecisionBodyRelay,
  isQuoteEdits,
  isStartBody,
  parseCallbackData,
  verbForCode,
  type AgentApiTypeName,
  type CardKind,
} from '../src/agent-api';

const NODE_FS: string = 'node:fs';
const FIXTURE_DIR = new URL('./fixtures/agent-api/', (import.meta as unknown as { url: string }).url).pathname;

interface FsLike {
  readdirSync(path: string): string[];
  readFileSync(path: string, encoding: 'utf8'): string;
}

async function fixtures(): Promise<Array<{ file: string; type: string; reject: boolean; value: unknown }>> {
  const fs = (await import(/* @vite-ignore */ NODE_FS)) as FsLike;
  return fs
    .readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => {
      const [type, caseName] = file.split('.');
      return { file, type, reject: caseName.startsWith('reject-'), value: JSON.parse(fs.readFileSync(FIXTURE_DIR + file, 'utf8')) as unknown };
    });
}

// A token of the maximum shape: 26 base32 characters.
const TOKEN = 'ABCDEFGHIJKLMNOPQRSTUVWX27';

describe('VERB_CODES', () => {
  it('covers every card kind', () => {
    expect(Object.keys(VERB_CODES).sort()).toEqual([...CARD_KINDS].sort());
  });

  it.each(CARD_KINDS)('codes of %s are unique, 1-4 chars of [a-z0-9], and map back to their verb', (kind) => {
    const codes = Object.values(VERB_CODES[kind]).filter((c): c is string => c !== null);
    expect(new Set(codes).size).toBe(codes.length);
    for (const [verb, code] of Object.entries(VERB_CODES[kind])) {
      expect(verb).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(VERB_LABELS[verb], `label of ${verb}`).toBeTypeOf('string');
      if (code === null) {
        expect(codeForVerb(kind, verb)).toBeNull();
        continue;
      }
      expect(code).toMatch(/^[a-z0-9]{1,4}$/);
      expect(verbForCode(kind, code)).toBe(verb);
      expect(codeForVerb(kind, verb)).toBe(code);
    }
  });

  it('has no edit verb (a quote is approved with optional edits) and only dashboard-only change_partner', () => {
    expect(Object.keys(VERB_CODES.quote)).toEqual(['approve', 'reject']);
    const dashboardOnly = CARD_KINDS.flatMap((k) => Object.entries(VERB_CODES[k]).filter(([, c]) => c === null).map(([v]) => `${k}.${v}`));
    expect(dashboardOnly).toEqual(['handoff.change_partner']);
  });

  it('answers null for an unknown code or a code of another kind', () => {
    expect(verbForCode('test', 'rty')).toBeNull();
    expect(verbForCode('quote', 'csm')).toBeNull();
    expect(verbForCode('failure' as CardKind, '')).toBeNull();
    expect(codeForVerb('quote', 'edit')).toBeNull();
  });
});

describe('callback_data', () => {
  it('every button of every kind is at most 34 bytes and matches CALLBACK_DATA_RE', () => {
    let longest = 0;
    for (const kind of CARD_KINDS) {
      for (const code of Object.values(VERB_CODES[kind])) {
        if (code === null) continue;
        const data = callbackData(TOKEN, code);
        const bytes = new TextEncoder().encode(data).length;
        longest = Math.max(longest, bytes);
        expect(bytes).toBeLessThanOrEqual(34);
        expect(bytes).toBeGreaterThanOrEqual(1);
        expect(data).toMatch(CALLBACK_DATA_RE);
        expect(parseCallbackData(data)).toEqual({ token: TOKEN, code });
      }
    }
    expect(longest).toBe(34);
  });

  it('refuses malformed tokens and codes', () => {
    expect(() => callbackData(TOKEN.toLowerCase(), 'dis')).toThrow();
    expect(() => callbackData(TOKEN.slice(1), 'dis')).toThrow();
    expect(() => callbackData(TOKEN, 'abcde')).toThrow();
    expect(() => callbackData(TOKEN, 'DIS')).toThrow();
    expect(parseCallbackData(`ap:${TOKEN}:abcde`)).toBeNull();
    expect(parseCallbackData(`xp:${TOKEN}:dis`)).toBeNull();
    expect(parseCallbackData(`ap:${TOKEN}0:dis`)).toBeNull();
  });
});

describe('shared fixtures', () => {
  it('every fixture names a known type and has at least one accepted case per type', async () => {
    const all = await fixtures();
    expect(all.length).toBeGreaterThanOrEqual(20);
    for (const f of all) expect(Object.keys(AGENT_API_GUARDS), f.file).toContain(f.type);
    for (const type of Object.keys(AGENT_API_GUARDS)) {
      expect(all.some((f) => f.type === type && !f.reject), `accepted fixture for ${type}`).toBe(true);
    }
  });

  it('every fixture parses into its type guard (reject-* cases are refused)', async () => {
    for (const f of await fixtures()) {
      const guard = AGENT_API_GUARDS[f.type as AgentApiTypeName] as (x: unknown) => boolean;
      expect(guard(f.value), f.file).toBe(!f.reject);
    }
  });
});

describe('type guards', () => {
  const base = { v: 1, run_id: '3f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b', token_sha256: 'a'.repeat(64), verb: 'approve' };

  it('dashboard body: v, uuid, 64-hex hash and verb shape; no raw token; note <= 500 chars', () => {
    expect(isDecisionBodyDashboard(base)).toBe(true);
    expect(isDecisionBodyDashboard({ ...base, note: 'x'.repeat(500) })).toBe(true);
    expect(isDecisionBodyDashboard({ ...base, note: 'x'.repeat(501) })).toBe(false);
    expect(isDecisionBodyDashboard({ ...base, run_id: 'not-a-uuid' })).toBe(false);
    expect(isDecisionBodyDashboard({ ...base, token_sha256: 'a'.repeat(63) })).toBe(false);
    expect(isDecisionBodyDashboard({ ...base, verb: 'Approve' })).toBe(false);
    expect(isDecisionBodyDashboard({ ...base, token: TOKEN })).toBe(false);
    expect(isDecisionBodyDashboard({ ...base, edits: { overrides: [{ line_no: 1.5, unit_price: 1 }] } })).toBe(false);
    expect(isDecisionBodyDashboard(null)).toBe(false);
    expect(isDecisionBodyDashboard([base])).toBe(false);
  });

  it('relay body: token, code and integer tg ids only', () => {
    const relay = { v: 1, token: TOKEN, code: 'ok', tg: { user_id: 1, chat_id: -100, message_id: 7 } };
    expect(isDecisionBodyRelay(relay)).toBe(true);
    expect(isDecisionBodyRelay({ ...relay, verb: 'approve' })).toBe(false);
    expect(isDecisionBodyRelay({ ...relay, tg: { ...relay.tg, user_id: '1' } })).toBe(false);
    expect(isDecisionBodyRelay({ ...relay, tg: { ...relay.tg, extra: 1 } })).toBe(false);
    expect(isDecisionBodyRelay({ ...relay, tg: { user_id: 1, chat_id: 1 } })).toBe(false);
  });

  it('quote edits: declared keys only, numbers finite', () => {
    expect(isQuoteEdits({ shipping: Number.NaN })).toBe(false);
    expect(isQuoteEdits({ drafts: { subject: 'S', html: '<b>' } })).toBe(false);
    expect(isQuoteEdits({ overrides: [{ line_no: 1, unit_price: 2, note: 'n' }] })).toBe(true);
  });

  it('start body: one shape per kind', () => {
    expect(isStartBody({ v: 1, kind: 'test_card' })).toBe(true);
    expect(isStartBody({ v: 1, kind: 'quote', rfq_id: 'x' })).toBe(false);
    expect(isStartBody({ v: 1, kind: 'quote' })).toBe(false);
  });
});
