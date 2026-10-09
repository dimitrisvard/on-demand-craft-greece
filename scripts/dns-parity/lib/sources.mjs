// Answer sources. Each source exposes { spec, kind, enumerable, owners(), ents(), query(name, type) }.
//   ns:<host|ip>[:port]       authoritative server, UDP with EDNS(1232), TCP when truncated; RD=0; AA required
//   ns+tcp:<host|ip>[:port]   same, TCP only
//   doh:<url>|cloudflare|google  RFC 8484 GET (application/dns-message), RD=1, recursive answer
//   zone:<file>               BIND zone file, RFC 4592 wildcard semantics (Papaki export, runbook S3)
//   zone+cf:<file>            BIND zone file exported by Cloudflare, Cloudflare wildcard semantics and cf-proxied tags
//   cfapi:<file>              Cloudflare API JSON export (runbook S4), Cloudflare semantics
//   capture:<file>            the 2026-09-30 DoH capture text (lossy: no owners, no TTLs, values cut at 120 chars)
// Network access is injectable (opts.udp, opts.tcp, opts.fetch, opts.lookup) so tests never touch the network.
import dgram from 'node:dgram';
import dnsPromises from 'node:dns/promises';
import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import net from 'node:net';
import { readCfApi } from './cfapi.mjs';
import { canonName } from './names.mjs';
import { typeName, typeNumber, TYPES } from './types.mjs';
import { decodeMessage, encodeQuery } from './wire.mjs';
import { parseZone } from './zonefile.mjs';
import { ZoneModel } from './zonesim.mjs';

export class SourceError extends Error {}

const DOH_ALIASES = {
  cloudflare: 'https://cloudflare-dns.com/dns-query',
  google: 'https://dns.google/dns-query',
  quad9: 'https://dns.quad9.net/dns-query',
};

function withTimeout(promise, ms, what) {
  let t;
  return Promise.race([
    promise.finally(() => clearTimeout(t)),
    new Promise((_, rej) => { t = setTimeout(() => rej(new SourceError(`${what}: timeout after ${ms} ms`)), ms); }),
  ]);
}

function defaultUdp(buf, host, port, timeoutMs) {
  return withTimeout(new Promise((resolve, reject) => {
    const sock = dgram.createSocket(isIP(host) === 6 ? 'udp6' : 'udp4');
    sock.once('error', (e) => { sock.close(); reject(e); });
    sock.once('message', (m) => { sock.close(); resolve(m); });
    sock.send(buf, port, host);
  }), timeoutMs, `udp ${host}:${port}`);
}

function defaultTcp(buf, host, port, timeoutMs) {
  return withTimeout(new Promise((resolve, reject) => {
    const sock = net.connect({ host, port });
    const len = Buffer.alloc(2);
    len.writeUInt16BE(buf.length, 0);
    let acc = Buffer.alloc(0);
    sock.once('error', reject);
    sock.on('connect', () => sock.write(Buffer.concat([len, buf])));
    sock.on('data', (d) => {
      acc = Buffer.concat([acc, d]);
      if (acc.length >= 2 && acc.length >= 2 + acc.readUInt16BE(0)) {
        sock.end();
        resolve(acc.subarray(2, 2 + acc.readUInt16BE(0)));
      }
    });
    sock.on('end', () => reject(new SourceError(`tcp ${host}:${port}: closed before a full message`)));
  }), timeoutMs, `tcp ${host}:${port}`);
}

/** Turn a decoded message into the common answer shape; checks id and question. */
function toAnswer(msg, id, name, type, { requireAa }) {
  if (!msg.qr || msg.id !== id) throw new SourceError('response id or QR flag does not match the query');
  const q = msg.question[0];
  if (!q || canonName(q.name) !== canonName(name) || q.type !== type) throw new SourceError('response question does not match the query');
  const status = msg.rcodeName;
  if ((status === 'NOERROR' || status === 'NXDOMAIN') && requireAa && !msg.aa) {
    return { status: 'ERROR', error: 'answer is not authoritative (AA=0): wrong server, a referral, or an intercepting resolver', rrs: [] };
  }
  return { status, aa: msg.aa, ad: msg.ad, rrs: msg.answer.filter((r) => r.type !== TYPES.OPT), authority: msg.authority };
}

function parseHostPort(s) {
  const m = /^\[([^\]]+)\](?::(\d+))?$/.exec(s) || /^([^:]+)(?::(\d+))?$/.exec(s);
  if (!m) throw new SourceError(`bad server ${s}`);
  return { host: m[1], port: Number(m[2] ?? 53) };
}

function nsSource(spec, arg, opts, tcpOnly) {
  const { host, port } = parseHostPort(arg);
  let ip = null;
  const udp = opts.udp ?? defaultUdp;
  const tcp = opts.tcp ?? defaultTcp;
  const lookup = opts.lookup ?? (async (h) => (await dnsPromises.lookup(h)).address);
  const timeoutMs = opts.timeoutMs ?? 3000;
  const retries = opts.retries ?? 2;
  return {
    spec, kind: 'ns', enumerable: false, semantics: 'live',
    owners: () => [], ents: () => [],
    async query(name, type) {
      try {
        ip = ip ?? (isIP(host) ? host : await lookup(host));
      } catch (e) {
        return { status: 'ERROR', error: `cannot resolve ${host}: ${e.message}`, rrs: [] };
      }
      let lastErr = null;
      for (let attempt = 0; attempt <= retries; attempt++) {
        const { id, buf } = encodeQuery(name, type, { rd: false, id: opts.idFor?.(name, type, attempt) });
        try {
          let raw = tcpOnly ? await tcp(buf, ip, port, timeoutMs) : await udp(buf, ip, port, timeoutMs);
          let msg = decodeMessage(raw);
          if (msg.tc && !tcpOnly) {
            raw = await tcp(buf, ip, port, timeoutMs);
            msg = decodeMessage(raw);
          }
          const a = toAnswer(msg, id, name, type, { requireAa: true });
          if (a.status === 'SERVFAIL' && attempt < retries) { lastErr = 'SERVFAIL'; continue; }
          return a;
        } catch (e) {
          lastErr = e.message;
        }
      }
      return { status: 'ERROR', error: lastErr ?? 'no answer', rrs: [] };
    },
  };
}

function dohSource(spec, arg, opts) {
  const url = DOH_ALIASES[arg] ?? arg;
  if (!/^https:\/\//.test(url)) throw new SourceError(`doh: needs an https URL or one of ${Object.keys(DOH_ALIASES).join(', ')}`);
  const doFetch = opts.fetch ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? 5000;
  const retries = opts.retries ?? 2;
  return {
    spec, kind: 'doh', enumerable: false, semantics: 'live',
    owners: () => [], ents: () => [],
    async query(name, type) {
      let lastErr = null;
      for (let attempt = 0; attempt <= retries; attempt++) {
        // RFC 8484 §4.1: use id 0 for cache friendliness.
        const { id, buf } = encodeQuery(name, type, { rd: true, id: 0 });
        try {
          const u = `${url}?dns=${buf.toString('base64url')}`;
          const res = await withTimeout(doFetch(u, { headers: { accept: 'application/dns-message' } }), timeoutMs, `doh ${url}`);
          if (!res.ok) throw new SourceError(`HTTP ${res.status}`);
          const msg = decodeMessage(Buffer.from(await res.arrayBuffer()));
          const a = toAnswer(msg, id, name, type, { requireAa: false });
          if (a.status === 'SERVFAIL' && attempt < retries) { lastErr = 'SERVFAIL'; continue; }
          return a;
        } catch (e) {
          lastErr = e.message;
        }
      }
      return { status: 'ERROR', error: lastErr, rrs: [] };
    },
  };
}

function modelSource(spec, kind, zone, mode) {
  const model = new ZoneModel(zone, mode);
  return {
    spec, kind, enumerable: true, semantics: mode, model,
    owners: () => model.ownerNames(), ents: () => model.emptyNonTerminals(),
    async query(name, type) { return model.answer(name, type); },
  };
}

/** The doh.py capture: '== TYPE name' then 'N:data | N:data' or '(no answer)'; N is the RR type number. */
export function parseCapture(text) {
  const map = new Map();
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^== (\S+) (\S+)\s*$/.exec(lines[i]);
    if (!m) continue;
    const qtype = typeNumber(m[1]);
    const qname = canonName(m[2]);
    const body = (lines[i + 1] ?? '').trim();
    const key = `${qname}|${qtype}`;
    if (body === '(no answer)') { map.set(key, { status: 'EMPTY', rrs: [] }); continue; }
    if (body.startsWith('ERR')) { map.set(key, { status: 'ERROR', error: body, rrs: [] }); continue; }
    const items = body.split(' | ').map((p) => {
      const k = p.indexOf(':');
      return { type: Number(p.slice(0, k)), text: p.slice(k + 1) };
    });
    map.set(key, { status: 'NOERROR', capture: items });
  }
  return map;
}

function captureSource(spec, file) {
  const map = parseCapture(readFileSync(file, 'utf8'));
  return {
    spec, kind: 'capture', enumerable: false, semantics: 'capture', lossy: true,
    owners: () => [...new Set([...map.keys()].map((k) => k.split('|')[0]))], ents: () => [],
    captured: map,
    async query(name, type) {
      const a = map.get(`${canonName(name)}|${type}`);
      if (!a) return { status: 'SKIP', rrs: [], note: `not in the capture (${typeName(type)})` };
      return a;
    },
  };
}

/**
 * @param {string} spec e.g. 'ns:dns1.papaki.gr', 'doh:cloudflare', 'zone:papaki.zone'
 * @param {{zone:string, udp?, tcp?, fetch?, lookup?, timeoutMs?, retries?}} opts
 */
export function openSource(spec, opts) {
  const k = spec.indexOf(':');
  if (k === -1) throw new SourceError(`source ${spec}: expected <kind>:<value>`);
  const kind = spec.slice(0, k);
  const arg = spec.slice(k + 1);
  switch (kind) {
    case 'ns': return nsSource(spec, arg, opts, false);
    case 'ns+tcp': return nsSource(spec, arg, opts, true);
    case 'doh': return dohSource(spec, arg, opts);
    case 'zone': return modelSource(spec, 'zone', parseZone(readFileSync(arg), { origin: opts.zone }), 'rfc4592');
    case 'zone+cf': return modelSource(spec, 'zone', parseZone(readFileSync(arg), { origin: opts.zone }), 'cloudflare');
    case 'cfapi': return modelSource(spec, 'cfapi', readCfApi(arg, opts.zone), 'cloudflare');
    case 'capture': return captureSource(spec, arg);
    default: throw new SourceError(`unknown source kind ${kind}`);
  }
}
