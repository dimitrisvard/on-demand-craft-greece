// K-2 core: need() and ConfigMissingError; readFlag fail-closed matrix; identifiers; prices -> cost_cents; the
// Analytics Engine data-point layout.

import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { ConfigMissingError, isConfigMissing, need } from '../../src/agents/config';
import { BLOB_FIELDS, DOUBLE_FIELDS, toDataPoint, writeEvent } from '../../src/agents/events';
import { FLAG_CACHE_TTL_SECONDS, flagKvKey, readAgentFlag, readFlag, type AgentFlagKey } from '../../src/agents/flags';
import {
  INSTANCE_ID_MAX,
  INSTANCE_ID_RE,
  base32,
  cadJobKey,
  canonicalJson,
  isAlreadyExists,
  messageIdSha256,
  newApprovalToken,
  outboundMessageId,
  postOrderInstanceId,
  quoteInstanceId,
  rfqIntakeInstanceId,
  safeName,
  sha256hex,
} from '../../src/agents/ids';
import { LLM_PRICES, PRICES_VERSION, costCents, embedCostUsd, llmCostUsd, modelPrice } from '../../src/agents/prices';
import type { OpsEnv } from '../../src/env';
import { FakeDataset, FakeKV, agentBindings } from '../helpers/agent-env';
import { opsEnv } from '../helpers/ops';

const UUID = '3f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b';

describe('need()', () => {
  it('passes when every name has a value and narrows the type', () => {
    const env = opsEnv({ AI_GATEWAY_TOKEN: 'x', CAD_UNFOLD_URL: 'https://unfold.example.test' });
    need(env, 'AI_GATEWAY_TOKEN', 'CAD_UNFOLD_URL');
    expectTypeOf(env.AI_GATEWAY_TOKEN).toEqualTypeOf<string>();
  });

  it('throws ConfigMissingError naming every missing field (names only, never values)', () => {
    const env = opsEnv({ AI_GATEWAY_TOKEN: '', CAD_SHARED_SECRET: 'present-value' });
    let caught: unknown;
    try {
      need(env, 'AI_GATEWAY_TOKEN', 'CAD_UNFOLD_URL', 'CAD_SHARED_SECRET');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConfigMissingError);
    const error = caught as ConfigMissingError;
    expect(error.code).toBe('config_missing');
    expect(error.names).toEqual(['AI_GATEWAY_TOKEN', 'CAD_UNFOLD_URL']);
    expect(error.message).toBe('config_missing: AI_GATEWAY_TOKEN, CAD_UNFOLD_URL');
    expect(error.message).not.toContain('present-value');
    expect(isConfigMissing(error)).toBe(true);
    expect(isConfigMissing(new Error('x'))).toBe(false);
  });
});

describe('readFlag() fail-closed matrix', () => {
  const OFF = { enabled: false, mode: 'shadow', value: {} };

  function envWith(kv: FakeKV, extra: Partial<OpsEnv> = {}): OpsEnv {
    return opsEnv({ ...agentBindings({ FLAGS: kv as unknown as KVNamespace }), ...extra });
  }

  it('a well-formed record is read with cacheTtl 30 and value.mode first', async () => {
    const kv = new FakeKV();
    kv.setJson('agent.rfq_intake', { enabled: true, value: { mode: 'assist', max_runs_per_day: 5 }, updated_at: '2026-10-05T07:00:00Z', rev: 7, mode: 'shadow' });
    expect(await readFlag(envWith(kv), 'agent.rfq_intake')).toEqual({ enabled: true, mode: 'assist', value: { mode: 'assist', max_runs_per_day: 5 }, rev: 7 });
    expect(kv.gets).toEqual([{ key: 'agent.rfq_intake', options: { type: 'json', cacheTtl: 30 } }]);
    expect(FLAG_CACHE_TTL_SECONDS).toBe(30);
  });

  it('mode falls back to the record mode, then shadow; an unknown mode reads shadow', async () => {
    const kv = new FakeKV();
    kv.setJson('agent.quote', { enabled: true, value: {}, mode: 'auto' });
    kv.setJson('agent.post_order', { enabled: true });
    kv.setJson('mcp.remote', { enabled: true, value: { mode: 'yolo', writes: true } });
    const env = envWith(kv);
    expect((await readFlag(env, 'agent.quote')).mode).toBe('auto');
    expect(await readFlag(env, 'agent.post_order')).toEqual({ enabled: true, mode: 'shadow', value: {} });
    expect(await readFlag(env, 'mcp.remote')).toEqual({ enabled: true, mode: 'shadow', value: { mode: 'yolo', writes: true } });
  });

  it.each([
    ['binding missing', () => opsEnv({ ...agentBindings(), FLAGS: undefined })],
    ['key missing', () => envWith(new FakeKV())],
    ['malformed JSON', () => {
      const kv = new FakeKV();
      kv.store.set('agent.rfq_intake', '{"enabled": tru');
      return envWith(kv);
    }],
    ['enabled not a boolean', () => {
      const kv = new FakeKV();
      kv.setJson('agent.rfq_intake', { enabled: 'true', value: {} });
      return envWith(kv);
    }],
    ['value not an object', () => {
      const kv = new FakeKV();
      kv.setJson('agent.rfq_intake', { enabled: true, value: [1, 2] });
      return envWith(kv);
    }],
    ['record not an object', () => {
      const kv = new FakeKV();
      kv.setJson('agent.rfq_intake', true);
      return envWith(kv);
    }],
    ['KV throws', () => {
      const kv = new FakeKV();
      kv.setJson('agent.rfq_intake', { enabled: true });
      kv.failWith = new Error('KV GET failed: 500');
      return envWith(kv);
    }],
  ])('%s -> off', async (_name, make) => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await readFlag(make(), 'agent.rfq_intake')).toEqual(OFF);
    errors.mockRestore();
  });

  it('seo.* and api.* keys are refused by type and read as off at run time', async () => {
    const kv = new FakeKV();
    kv.setJson('seo.strict_404', { enabled: true });
    kv.setJson('api.forward_to_vercel', { enabled: true });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    // @ts-expect-error seo.* belongs to microns-site
    expect(await readFlag(envWith(kv), 'seo.strict_404')).toEqual(OFF);
    // @ts-expect-error api.* belongs to microns-site
    expect(await readFlag(envWith(kv), 'api.forward_to_vercel')).toEqual(OFF);
    expect(kv.gets).toEqual([]);
    errors.mockRestore();
    expectTypeOf<'mcp.remote'>().toMatchTypeOf<AgentFlagKey>();
  });

  it('readAgentFlag is the same read; tenants other than the default use t:<tenant>:<key>', async () => {
    const kv = new FakeKV();
    kv.setJson('agent.quote', { enabled: true });
    kv.setJson('t:11111111-1111-4111-8111-111111111111:agent.quote', { enabled: false });
    const env = envWith(kv);
    expect((await readAgentFlag(env, 'agent.quote')).enabled).toBe(true);
    expect((await readFlag(env, 'agent.quote', '11111111-1111-4111-8111-111111111111')).enabled).toBe(false);
    expect(flagKvKey('agent.quote', '00000000-0000-0000-0000-000000000001')).toBe('agent.quote');
  });
});

describe('identifiers', () => {
  const sha = 'ab'.repeat(32);

  it('instance ids are at most 100 characters and match the Workflows pattern', () => {
    const ids = [rfqIntakeInstanceId(sha), quoteInstanceId(UUID, 1), quoteInstanceId(UUID, 9999), postOrderInstanceId(UUID)];
    expect(ids).toEqual([`rfq-intake-${'ab'.repeat(16)}`, `quote-${UUID}-v1`, `quote-${UUID}-v9999`, `post-order-${UUID}`]);
    expect(ids[0]).toHaveLength(43);
    for (const id of ids) {
      expect(id.length).toBeLessThanOrEqual(INSTANCE_ID_MAX);
      expect(id).toMatch(INSTANCE_ID_RE);
    }
  });

  it('builders refuse malformed input', () => {
    expect(() => rfqIntakeInstanceId('AB'.repeat(32))).toThrow();
    expect(() => quoteInstanceId('not-a-uuid', 1)).toThrow();
    expect(() => quoteInstanceId(UUID, 0)).toThrow();
    expect(() => postOrderInstanceId(`${UUID}/x`)).toThrow();
  });

  it('approval tokens are 26 base32 characters of 128 random bits; only the hash is derived', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const { token, sha256 } = newApprovalToken();
      expect(token).toMatch(/^[A-Z2-7]{26}$/);
      expect(await sha256).toBe(await sha256hex(token));
      seen.add(token);
    }
    expect(seen.size).toBe(50);
    // RFC 4648 test vector.
    expect(base32(new TextEncoder().encode('foobar'))).toBe('MZXW6YTBOI');
  });

  it('outbound Message-ID format', () => {
    expect(outboundMessageId(UUID, 0, 'rfq.micronshub.eu')).toBe(`<q.${UUID}.0@rfq.micronshub.eu>`);
    expect(outboundMessageId(UUID, 2, 'rfq.micronshub.eu')).toBe(`<q.${UUID}.2@rfq.micronshub.eu>`);
    expect(() => outboundMessageId(UUID, -1, 'rfq.micronshub.eu')).toThrow();
  });

  it('sha256hex and message_id_sha256 (trimmed header, else raw bytes)', async () => {
    expect(await sha256hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const raw = new TextEncoder().encode('From: a\r\n\r\nbody');
    expect(await messageIdSha256('  <Abc@Example.COM> ', raw)).toBe(await sha256hex('<Abc@Example.COM>'));
    expect(await messageIdSha256(null, raw)).toBe(await sha256hex(raw));
    expect(await messageIdSha256('   ', raw)).toBe(await sha256hex(raw));
  });

  it('cadJobKey uses the canonical JSON of the params (key order does not matter)', async () => {
    const a = await cadJobKey(sha, 'analyse', { material: 'S235', thickness_override: 2, nested: { b: 1, a: 2 } });
    const b = await cadJobKey(sha, 'analyse', { nested: { a: 2, b: 1 }, thickness_override: 2, material: 'S235' });
    expect(a).toBe(b);
    expect(a).toMatch(new RegExp(`^${sha}:analyse:[0-9a-f]{64}$`));
    expect(canonicalJson({ b: 1, a: [{ d: 1, c: undefined }] })).toBe('{"a":[{"d":1}],"b":1}');
  });

  it('safeName: NFC, last segment, allowed characters, 100 characters with the extension kept', () => {
    expect(safeName('Bracket v2 (final).STEP')).toBe('Bracket_v2__final_.STEP');
    expect(safeName('../../etc/passwd')).toBe('passwd');
    expect(safeName('C:\\Users\\x\\Zeichnung Ä.dxf')).toBe('Zeichnung__.dxf');
    expect(safeName('e\u0301.pdf')).toBe('_.pdf');
    expect(safeName('a\u0000b\u001f.txt')).toBe('ab.txt');
    expect(safeName('..')).toBe('file');
    expect(safeName('')).toBe('file');
    const long = safeName(`${'x'.repeat(150)}.step`);
    expect(long).toHaveLength(100);
    expect(long.endsWith('.step')).toBe(true);
  });

  it("isAlreadyExists matches the Workflows create error 'instance.already_exists'", () => {
    expect(isAlreadyExists(new Error('(instance.already_exists) Workflow instance with id "x" already exists'))).toBe(true);
    expect(isAlreadyExists(new Error('instance.not_found'))).toBe(false);
    expect(isAlreadyExists('instance.already_exists')).toBe(true);
  });
});

describe('prices -> cost', () => {
  it('Sonnet 5.5 and Haiku 4.5 list prices (USD per MTok)', () => {
    expect(PRICES_VERSION).toBe('2026-09-25');
    expect(LLM_PRICES['claude-sonnet-5-5']).toEqual({ input: 2, output: 10, cache_read: 0.2, cache_write: 2.5 });
    expect(LLM_PRICES['claude-haiku-4-5']).toEqual({ input: 1, output: 5, cache_read: 0.1, cache_write: 1.25 });
    expect(modelPrice('claude-haiku-4-5-20251001')).toEqual(LLM_PRICES['claude-haiku-4-5']);
    expect(modelPrice('claude-sonnet-5-5-20260101')).toEqual(LLM_PRICES['claude-sonnet-5-5']);
    expect(modelPrice('gpt-unknown')).toBeNull();
  });

  it('one call: input, output, cache read and cache write are priced separately', () => {
    const usd = llmCostUsd('claude-sonnet-5-5', { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 2000, cache_creation_input_tokens: 400 });
    expect(usd).toBeCloseTo((1000 * 2 + 500 * 10 + 2000 * 0.2 + 400 * 2.5) / 1e6, 12);
    expect(llmCostUsd('nope', { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })).toBeNull();
    expect(embedCostUsd('@cf/baai/bge-m3', 1_000_000)).toBeCloseTo(0.0118, 12);
  });

  it('cost_cents rounds up to 4 decimals, so any priced spend is > 0', () => {
    expect(costCents(0)).toBe(0);
    expect(costCents(-1)).toBe(0);
    expect(costCents(Number.NaN)).toBe(0);
    expect(costCents(0.03)).toBe(3);
    expect(costCents(0.0123456)).toBe(1.2346);
    expect(costCents(1e-6)).toBe(0.0001);
    expect(costCents(1e-9)).toBe(0.0001);
  });
});

describe('Analytics Engine data point', () => {
  it('fixed layout: index run_id, 9 blobs, 8 doubles; missing blobs empty, missing doubles 0', () => {
    expect(BLOB_FIELDS).toEqual(['event', 'agent', 'step', 'route', 'model', 'outcome', 'prompt_version', 'tenant_id', 'workflow_instance_id']);
    expect(DOUBLE_FIELDS).toEqual(['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'cost_usd', 'latency_ms', 'attempt', 'bytes']);
    const point = toDataPoint({ event: 'llm_call', run_id: UUID, agent: 'rfq_intake', step: 'extract', route: 'extract', model: 'claude-sonnet-5-5', outcome: 'ok', prompt_version: 'rfq_intake.extract@v1', input_tokens: 10, cost_usd: 0.5, latency_ms: 12, attempt: 1 });
    expect(point).toEqual({
      indexes: [UUID],
      blobs: ['llm_call', 'rfq_intake', 'extract', 'extract', 'claude-sonnet-5-5', 'ok', 'rfq_intake.extract@v1', '', ''],
      doubles: [10, 0, 0, 0, 0.5, 12, 1, 0],
    });
    expect(toDataPoint({ event: 'step', run_id: 'r'.repeat(200), agent: 'x', input_tokens: Number.POSITIVE_INFINITY }).indexes?.[0]).toHaveLength(96);
  });

  it('writeEvent is a no-op without the binding and never throws', () => {
    expect(() => writeEvent(undefined, { event: 'step', run_id: UUID, agent: 'x' })).not.toThrow();
    const ds = new FakeDataset();
    writeEvent(ds as unknown as AnalyticsEngineDataset, { event: 'run_end', run_id: UUID, agent: 'x' });
    expect(ds.points).toHaveLength(1);
    const throwing = { writeDataPoint: () => { throw new Error('limit'); } } as unknown as AnalyticsEngineDataset;
    expect(() => writeEvent(throwing, { event: 'run_end', run_id: UUID, agent: 'x' })).not.toThrow();
  });
});
