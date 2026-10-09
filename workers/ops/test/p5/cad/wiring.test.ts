// CadContainer wiring against the real @cloudflare/containers 0.3.7 (no alias; the Phase 4 'cloudflare:workers'
// stub provides DurableObject and WorkerEntrypoint), PHASE5_SPEC §5.8:
//   (a) the ContainerProxy exported by src/index.ts is the object of the package that CadContainer extends (one
//       module instance, so the proxy reads the registry CadContainer filled)
//   (b) the outbound handler is registered through the inherited static setter, not as an own class field
//   (c) ContainerProxy routes http://cad-input.internal/u/<b64> to fetchCompatInput and answers 520 for any other host
// plus the class configuration (port, sleepAfter, no internet, ping path, envVars names and values).

import * as lib from '@cloudflare/containers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CadContainer, CAD_SERVICE_PORT, cadEnvVars } from '../../../src/cad-container/cad-container';
import { encodeInputUrl, fetchCompatInput, INPUT_HOST } from '../../../src/cad-container/input-proxy';
import * as index from '../../../src/index';
import type { OpsEnv } from '../../../src/env';
import { containerState, TEST_KEY } from './helpers';

const HOSTS = 'files.example.test';
const ORIGINAL = 'https://files.example.test/rfq/part.step?X-Amz-Signature=abc';

function proxy(className: string, env: Partial<OpsEnv>) {
  const Proxy = lib.ContainerProxy as unknown as new (ctx: unknown, env: unknown) => { fetch(r: Request): Promise<Response> };
  return new Proxy({ props: { className, containerId: 't', enableInternet: false, interceptAll: false } }, env);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CadContainer wiring (real @cloudflare/containers)', () => {
  it('(a) one module instance: index ContainerProxy is the package object and CadContainer extends its Container', () => {
    expect(index.ContainerProxy).toBe(lib.ContainerProxy);
    expect(index.CadContainer).toBe(CadContainer);
    expect(Object.getPrototypeOf(CadContainer.prototype)).toBe(lib.Container.prototype);
    expect(CadContainer.prototype instanceof lib.Container).toBe(true);
  });

  it('(b) the handler is registered through the inherited setter, never as an own static field', () => {
    expect(Object.hasOwn(CadContainer, 'outboundByHost')).toBe(false);
    expect(CadContainer.outboundByHost?.[INPUT_HOST]).toBe(fetchCompatInput);
    expect(Object.keys(CadContainer.outboundByHost ?? {})).toEqual([INPUT_HOST]);
  });

  it('(c) ContainerProxy routes cad-input.internal to fetchCompatInput; any other host answers 520', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return new Response('STEP-BYTES', { status: 200, headers: { 'content-type': 'application/octet-stream', 'content-length': '10' } });
    });
    const p = proxy('CadContainer', { CAD_INPUT_HOSTS: HOSTS });
    const ok = await p.fetch(new Request(encodeInputUrl(ORIGINAL)));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('STEP-BYTES');
    expect(seen).toEqual([ORIGINAL]);
    for (const other of ['http://files.example.test/x', 'http://example.org/', 'http://cad-input.internal.evil.test/u/x', 'http://169.254.169.254/latest']) {
      const refused = await p.fetch(new Request(other));
      expect(refused.status, other).toBe(520);
    }
    // the same host in another form reaches the handler, which refuses it without an upstream request
    expect((await p.fetch(new Request('https://cad-input.internal/u/x'))).status).toBe(403);
    expect(seen).toHaveLength(1);
  });

  it('a class-field registration would not route (why the assignment form is required)', async () => {
    class FieldForm extends lib.Container {
      static outboundByHost = { [INPUT_HOST]: fetchCompatInput };
    }
    void FieldForm;
    const refused = await proxy('FieldForm', { CAD_INPUT_HOSTS: HOSTS }).fetch(new Request(encodeInputUrl(ORIGINAL)));
    expect(refused.status).toBe(520);
  });
});

describe('CadContainer configuration', () => {
  it('port 8000, sleeps after 10 minutes, no internet, pings the open health path', async () => {
    const state = containerState('cad-0');
    const c = new CadContainer(state as unknown as DurableObjectState<{}>, { CAD_SHARED_SECRET: TEST_KEY, CAD_PROCESSING_TIMEOUT_S: '120' } as OpsEnv);
    await Promise.resolve();
    expect(c.defaultPort).toBe(8000);
    expect(CAD_SERVICE_PORT).toBe(8000);
    expect(c.sleepAfter).toBe('10m');
    expect(c.enableInternet).toBe(false);
    expect(c.pingEndpoint).toBe('localhost/health');
    expect(c.interceptHttps).toBe(false);
    expect(c.allowedHosts).toBeUndefined();
    expect(Object.keys(c.envVars ?? {}).sort()).toEqual(['API_KEY', 'PROCESSING_TIMEOUT', 'REQUIRE_API_KEY']);
    expect(c.envVars).toEqual({ API_KEY: TEST_KEY, REQUIRE_API_KEY: '1', PROCESSING_TIMEOUT: '120' });
    // the constructor never starts the container
    expect(state.container.calls).toEqual([]);
  });

  it('envVars: no API_KEY without the secret (the service then refuses keyed routes), timeout default and validation', () => {
    expect(cadEnvVars({})).toEqual({ REQUIRE_API_KEY: '1', PROCESSING_TIMEOUT: '120' });
    expect(cadEnvVars({ CAD_SHARED_SECRET: '' })).toEqual({ REQUIRE_API_KEY: '1', PROCESSING_TIMEOUT: '120' });
    expect(cadEnvVars({ CAD_PROCESSING_TIMEOUT_S: '90' }).PROCESSING_TIMEOUT).toBe('90');
    expect(cadEnvVars({ CAD_PROCESSING_TIMEOUT_S: '0.05' }).PROCESSING_TIMEOUT).toBe('0.05');
    for (const bad of ['', '0', '-1', 'abc', '1e3', '120s', '99999']) expect(cadEnvVars({ CAD_PROCESSING_TIMEOUT_S: bad }).PROCESSING_TIMEOUT, bad).toBe('120');
  });

  it('logs stops and errors with the [microns-cad] prefix and no message text', () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => void logs.push(String(line)));
    vi.spyOn(console, 'error').mockImplementation((line: unknown) => void logs.push(String(line)));
    const c = new CadContainer(containerState('cad-1') as unknown as DurableObjectState<{}>, { CAD_SHARED_SECRET: TEST_KEY } as OpsEnv);
    c.onStop({ exitCode: 137, reason: 'runtime_signal' });
    expect(() => c.onError(new Error(`boom ${TEST_KEY}`))).toThrow();
    vi.restoreAllMocks();
    expect(logs[0]).toBe('[microns-cad] container stopped exit=137 reason=runtime_signal');
    expect(logs[1]).toBe('[microns-cad] container error error=Error');
    expect(logs.join('\n')).not.toContain(TEST_KEY);
  });
});
