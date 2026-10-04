import { beforeEach, describe, expect, it } from 'vitest';
import { parseMachineMap, resetAccessCertsCache, verifyAccessAssertion } from '../../src/auth/access-jwt';
import { accessKeyPair, es256KeyPair, jwksBody, mintAccessJwt, nowSec, type SigningKey } from '../helpers/jwt';

const TEAM = 'microns-test.cloudflareaccess.com';
const ISS = `https://${TEAM}`;
const AUD = 'aud-tag-preview-test';
const CLIENT_ID = 'collector-client-id.access';

beforeEach(() => {
  resetAccessCertsCache();
});

function certsEndpoint(...keys: SigningKey[]) {
  const urls: string[] = [];
  let current = jwksBody(...keys);
  const fetchImpl = (async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify(current), { status: 200 });
  }) as unknown as typeof fetch;
  return { urls, fetchImpl, publish: (...k: SigningKey[]) => { current = jwksBody(...k); } };
}

function headersWith(token: string): Headers {
  return new Headers({ 'Cf-Access-Jwt-Assertion': token });
}

describe('verifyAccessAssertion', () => {
  it('verifies an RS256 service-token assertion against the team certs and returns common_name', async () => {
    const key = await accessKeyPair();
    const certs = certsEndpoint(key);
    const token = await mintAccessJwt(key, { iss: ISS, aud: [AUD], commonName: CLIENT_ID });
    const result = await verifyAccessAssertion(headersWith(token), { teamDomain: TEAM, audiences: [AUD], fetchImpl: certs.fetchImpl });
    expect(result).toEqual({ ok: true, commonName: CLIENT_ID, email: null });
    expect(certs.urls).toEqual([`https://${TEAM}/cdn-cgi/access/certs`]);
  });

  it('returns the e-mail of a human identity and no common name', async () => {
    const key = await accessKeyPair();
    const certs = certsEndpoint(key);
    const token = await mintAccessJwt(key, { iss: ISS, aud: AUD, email: 'owner@example.test' });
    expect(await verifyAccessAssertion(headersWith(token), { teamDomain: TEAM, audiences: [AUD], fetchImpl: certs.fetchImpl }))
      .toEqual({ ok: true, commonName: null, email: 'owner@example.test' });
  });

  it('uses an http(s) team domain as the origin (local stub)', async () => {
    const key = await accessKeyPair();
    const certs = certsEndpoint(key);
    const token = await mintAccessJwt(key, { iss: 'http://127.0.0.1:9999', aud: AUD, commonName: CLIENT_ID });
    const result = await verifyAccessAssertion(headersWith(token), { teamDomain: 'http://127.0.0.1:9999/', audiences: [AUD], fetchImpl: certs.fetchImpl });
    expect(result.ok).toBe(true);
    expect(certs.urls).toEqual(['http://127.0.0.1:9999/cdn-cgi/access/certs']);
  });

  it('accepts any configured audience', async () => {
    const key = await accessKeyPair();
    const certs = certsEndpoint(key);
    const token = await mintAccessJwt(key, { iss: ISS, aud: 'aud-machine-app', commonName: CLIENT_ID });
    expect((await verifyAccessAssertion(headersWith(token), { teamDomain: TEAM, audiences: [AUD, 'aud-machine-app'], fetchImpl: certs.fetchImpl })).ok).toBe(true);
  });

  it('rejects a missing header', async () => {
    expect(await verifyAccessAssertion(new Headers(), { teamDomain: TEAM, audiences: [AUD] }))
      .toEqual({ ok: false, reason: 'missing_assertion' });
  });

  it('rejects another audience, another issuer and an expired assertion', async () => {
    const key = await accessKeyPair();
    const certs = certsEndpoint(key);
    const cfg = { teamDomain: TEAM, audiences: [AUD], fetchImpl: certs.fetchImpl };
    const otherAud = await mintAccessJwt(key, { iss: ISS, aud: 'other-aud', commonName: CLIENT_ID });
    expect((await verifyAccessAssertion(headersWith(otherAud), cfg)).ok).toBe(false);
    const otherIss = await mintAccessJwt(key, { iss: 'https://other.cloudflareaccess.com', aud: AUD, commonName: CLIENT_ID });
    expect((await verifyAccessAssertion(headersWith(otherIss), cfg)).ok).toBe(false);
    const expired = await mintAccessJwt(key, { iss: ISS, aud: AUD, commonName: CLIENT_ID, exp: nowSec() - 10 });
    expect((await verifyAccessAssertion(headersWith(expired), cfg)).ok).toBe(false);
  });

  it('rejects a token signed by a key the team does not publish', async () => {
    const published = await accessKeyPair('kid-1');
    const attacker = await accessKeyPair('kid-1');
    const certs = certsEndpoint(published);
    const token = await mintAccessJwt(attacker, { iss: ISS, aud: AUD, commonName: CLIENT_ID });
    expect((await verifyAccessAssertion(headersWith(token), { teamDomain: TEAM, audiences: [AUD], fetchImpl: certs.fetchImpl })).ok).toBe(false);
  });

  it('accepts only RS256 (an ES256 key in the certs is ignored)', async () => {
    const ec = await es256KeyPair('ec-kid');
    const certs = certsEndpoint(ec);
    const token = await mintAccessJwt(ec, { iss: ISS, aud: AUD, commonName: CLIENT_ID });
    expect((await verifyAccessAssertion(headersWith(token), { teamDomain: TEAM, audiences: [AUD], fetchImpl: certs.fetchImpl })).ok).toBe(false);
  });

  it('refetches the certs once when a token names an unknown key (rotation)', async () => {
    const oldKey = await accessKeyPair('old');
    const newKey = await accessKeyPair('new');
    const certs = certsEndpoint(oldKey);
    const cfg = { teamDomain: TEAM, audiences: [AUD], fetchImpl: certs.fetchImpl };
    expect((await verifyAccessAssertion(headersWith(await mintAccessJwt(oldKey, { iss: ISS, aud: AUD, commonName: CLIENT_ID })), cfg)).ok).toBe(true);
    certs.publish(oldKey, newKey);
    // The cached set is younger than the cool-down, so the unknown kid is not refetched immediately.
    expect((await verifyAccessAssertion(headersWith(await mintAccessJwt(newKey, { iss: ISS, aud: AUD, commonName: CLIENT_ID })), cfg)).ok).toBe(false);
    resetAccessCertsCache();
    expect((await verifyAccessAssertion(headersWith(await mintAccessJwt(newKey, { iss: ISS, aud: AUD, commonName: CLIENT_ID })), cfg)).ok).toBe(true);
  });

  it('reports unavailable certs', async () => {
    const key = await accessKeyPair();
    const fetchImpl = (async () => new Response('down', { status: 502 })) as unknown as typeof fetch;
    const token = await mintAccessJwt(key, { iss: ISS, aud: AUD, commonName: CLIENT_ID });
    expect(await verifyAccessAssertion(headersWith(token), { teamDomain: TEAM, audiences: [AUD], fetchImpl }))
      .toEqual({ ok: false, reason: 'certs_unavailable' });
  });

  it('refuses an empty audience list', async () => {
    expect(await verifyAccessAssertion(headersWith('a.b.c'), { teamDomain: TEAM, audiences: [' '] }))
      .toEqual({ ok: false, reason: 'no_audience' });
  });
});

describe('parseMachineMap', () => {
  it('maps client ids to machine names', () => {
    const map = parseMachineMap(' a.access = collector , b.access=mcp');
    expect([...map.entries()]).toEqual([['a.access', 'collector'], ['b.access', 'mcp']]);
  });

  it('ignores unknown names, empty entries and malformed pairs', () => {
    const map = parseMachineMap('a=ci,=mcp,b,,c=MCP,d=mcp');
    expect([...map.entries()]).toEqual([['d', 'mcp']]);
  });

  it('is empty for undefined or empty input', () => {
    expect(parseMachineMap(undefined).size).toBe(0);
    expect(parseMachineMap('').size).toBe(0);
  });
});
