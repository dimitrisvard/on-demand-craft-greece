#!/usr/bin/env node
// DNS parity check for the Cloudflare zone move (docs/migration/PLAN.md §6.2 S5, S7, S9, S16; P3-1).
// Compares the answers of two sources name × type and exits 0 only when they are equal after normalisation.
//
//   node scripts/dns-parity.mjs --zone micronshub.eu --a ns:dns1.papaki.gr --b ns:<assigned>.ns.cloudflare.com
//   node scripts/dns-parity.mjs --zone micronshub.eu --a zone:papaki.zone --b cfapi:cf-records.json --expect-dns-only
//   node scripts/dns-parity.mjs ds --zone micronshub.eu --via doh:google --expect absent
//   node scripts/dns-parity.mjs --zone micronshub.eu --a cfapi:cf-records.json --b doh:cloudflare \
//     --expect-proxied www,@,*,api --forbid-target vercel-dns.com --forbid-target vercel-dns-017.com --forbid-target 216.198.79.1   (Phase 6)
//
// Exit codes: 0 equal (allowed and expected differences only) · 1 differences · 2 incomplete (a query failed,
// timed out, was answered without AA by an ns: source, or a source could not be read) · 64 usage error.
// Sources and options: `--help`. No dependencies; Node >= 20. Behind an HTTP proxy, DoH needs NODE_USE_ENV_PROXY=1.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { outcome } from './dns-parity/lib/compare.mjs';
import { DEFAULT_TYPES } from './dns-parity/lib/defaults.mjs';
import { jsonReport, textReport } from './dns-parity/lib/report.mjs';
import { buildNameList, normaliseTarget, runParity } from './dns-parity/lib/run.mjs';
import { openSource, SourceError } from './dns-parity/lib/sources.mjs';
import { TYPES, typeName } from './dns-parity/lib/types.mjs';
import { ZoneParseError } from './dns-parity/lib/zonefile.mjs';

const HELP = `usage: dns-parity.mjs --zone <zone> --a <source> --b <source> [options]
       dns-parity.mjs ds --zone <zone> --via <doh:… | ns:<parent server>> --expect absent|present [--key-tag <n>]
       dns-parity.mjs names --zone <zone> [--a <source>] [--b <source>] [--names <file>]

sources: ns:<host>[:port] | ns+tcp:<host>[:port] | doh:<url|cloudflare|google|quad9>
         zone:<file> (RFC 4592 semantics) | zone+cf:<file> (Cloudflare export) | cfapi:<file> | capture:<file>
options:
  --names <file>          extra names, one per line: "<name> [TYPE,TYPE]" ('#' comments, '@' = apex)
  --no-default-names      only --names and the owners of zone/cfapi sources
  --types <list>          default ${DEFAULT_TYPES.join(',')}
  --probe-seed <s>        seed of the random wildcard probes (default: dns-parity)
  --ttl ignore|exact|max:<n>   default ignore
  --txt join|chunks       default join (TXT strings concatenated)
  --follow-cname          also compare the records a resolver chased behind a CNAME
  --flatten-via <source>  resolve a flattened apex CNAME through this source
  --expect-dns-only       fail on any proxied record in a cfapi:/zone+cf: source (runbook S4-S5)
  --expect-proxied <list> names proxied on side B (S11-S14): A/AAAA/HTTPS answer Cloudflare data and no CNAME,
                          other types of a former CNAME are empty; '*' = the wildcard and every name it answers
  --allow <file>          expected differences: [{"id","name","type","statuses","reason","expires"}]
  --include-infra         also compare apex NS, SOA and DNSSEC types
  --forbid-target <t>     repeatable: any answer (either side) or zone/cfapi record whose RDATA equals or ends
                          with <t> (a host suffix or an address) is a DIFF "forbidden target", even if allow-listed
  --json <file>           write the full report as JSON
  --verbose               list matching rows too
  --timeout <ms>          per query, default 3000 (ns) / 5000 (doh)
  --retries <n>           default 2
  --concurrency <n>       default 4`;

function usage(msg) {
  if (msg) process.stderr.write(`dns-parity: ${msg}\n`);
  process.stderr.write(`${HELP}\n`);
  process.exit(64);
}

function readNames(file) {
  const out = [];
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const [name, types] = line.split(/\s+/);
    out.push({ name, types: types ? types.split(',') : undefined, why: `--names ${file}` });
  }
  return out;
}

async function main(argv) {
  const mode = argv[0] === 'ds' || argv[0] === 'names' ? argv.shift() : 'diff';
  let args;
  try {
    ({ values: args } = parseArgs({
      args: argv,
      options: {
        zone: { type: 'string' }, a: { type: 'string' }, b: { type: 'string' }, via: { type: 'string' },
        expect: { type: 'string' }, 'key-tag': { type: 'string' }, names: { type: 'string' },
        'no-default-names': { type: 'boolean' }, types: { type: 'string' }, 'probe-seed': { type: 'string' },
        ttl: { type: 'string' }, txt: { type: 'string' }, 'follow-cname': { type: 'boolean' },
        'flatten-via': { type: 'string' }, 'expect-dns-only': { type: 'boolean' }, 'expect-proxied': { type: 'string' },
        allow: { type: 'string' }, 'include-infra': { type: 'boolean' }, 'forbid-target': { type: 'string', multiple: true },
        json: { type: 'string' },
        verbose: { type: 'boolean' }, timeout: { type: 'string' }, retries: { type: 'string' },
        concurrency: { type: 'string' }, help: { type: 'boolean' },
      },
      strict: true,
    }));
  } catch (e) {
    usage(e.message);
  }
  if (args.help) { process.stdout.write(`${HELP}\n`); return 0; }
  if (!args.zone) usage('--zone is required');
  const common = {
    zone: args.zone,
    timeoutMs: args.timeout ? Number(args.timeout) : undefined,
    retries: args.retries !== undefined ? Number(args.retries) : undefined,
  };
  const open = (spec) => {
    try { return openSource(spec, common); } catch (e) {
      if (e instanceof SourceError) usage(e.message);
      if (e instanceof ZoneParseError || e instanceof SyntaxError) {
        process.stderr.write(`dns-parity: cannot read ${spec}: ${e.message}\n`);
        process.exit(2);
      }
      throw e;
    }
  };

  if (mode === 'ds') {
    if (!args.via || !['absent', 'present'].includes(args.expect ?? '')) usage('ds needs --via and --expect absent|present');
    const via = open(args.via);
    const ans = await via.query(args.zone, TYPES.DS);
    const o = outcome(ans, args.zone, TYPES.DS, {});
    if (o.kind === 'ERROR') { process.stdout.write(`DS ${args.zone}: ERROR ${o.error}\n`); return 2; }
    const present = o.kind === 'DATA';
    const tags = present ? o.values.map((v) => Number(String(v).split(' ')[1])) : [];
    process.stdout.write(`DS ${args.zone} via ${args.via}: ${present ? o.values.join(' ; ') : o.kind}${ans.ad ? ' (AD: validated)' : ''}\n`);
    if (args.expect === 'absent') return present ? 1 : 0;
    if (!present) return 1;
    if (args['key-tag'] && !tags.includes(Number(args['key-tag']))) return 1;
    return 0;
  }

  const a = args.a ? open(args.a) : null;
  const b = args.b ? open(args.b) : null;
  const names = args.names ? readNames(args.names) : [];
  const types = args.types ? args.types.split(',') : undefined;
  if (mode === 'names') {
    const list = buildNameList({ zone: args.zone, defaultNames: !args['no-default-names'], extra: names, types, probeSeed: args['probe-seed'], sources: [a, b].filter(Boolean), includeInfra: !!args['include-infra'] });
    for (const e of list) process.stdout.write(`${e.name}\t${e.types.map(typeName).join(',')}\t${e.why.join('; ')}\n`);
    return 0;
  }
  if (!a || !b) usage('--a and --b are required');
  let ttl = 'ignore';
  if (args.ttl === 'exact') ttl = 'exact';
  else if (args.ttl?.startsWith('max:')) ttl = Number(args.ttl.slice(4));
  else if (args.ttl && args.ttl !== 'ignore') usage('--ttl must be ignore, exact or max:<seconds>');
  if (args.txt && !['join', 'chunks'].includes(args.txt)) usage('--txt must be join or chunks');
  const forbidTargets = args['forbid-target'] ?? [];
  if (forbidTargets.some((t) => !normaliseTarget(t))) usage('--forbid-target needs a host name, a host suffix or an address');
  const allow = args.allow ? JSON.parse(readFileSync(args.allow, 'utf8')) : [];
  const report = await runParity({
    zone: args.zone, a, b, names, defaultNames: !args['no-default-names'], types, probeSeed: args['probe-seed'],
    ttl, txt: args.txt ?? 'join', follow: !!args['follow-cname'],
    flattenVia: args['flatten-via'] ? open(args['flatten-via']) : null,
    expectProxied: args['expect-proxied'] ? args['expect-proxied'].split(',') : [],
    expectDnsOnly: !!args['expect-dns-only'], allow, includeInfra: !!args['include-infra'], forbidTargets,
    concurrency: args.concurrency ? Number(args.concurrency) : 4,
  });
  process.stdout.write(`${textReport(report, { verbose: !!args.verbose })}\n`);
  if (args.json) writeFileSync(args.json, `${jsonReport(report)}\n`);
  return report.exitCode;
}

main(process.argv.slice(2)).then((code) => process.exit(code), (e) => {
  process.stderr.write(`dns-parity: ${e.stack ?? e}\n`);
  process.exit(2);
});
