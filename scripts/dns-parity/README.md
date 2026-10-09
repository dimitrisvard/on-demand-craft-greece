# DNS parity check (`scripts/dns-parity.mjs`)

Compares the DNS answers of two sources name by name and type by type and exits 0 only when they are equal after normalisation. It is the check behind every DNS step of the Phase 3 cutover (`docs/migration/PLAN.md` P3-1, P3-2, runbook §6.2 S2-S16) and the record check before the Vercel project is deleted (Phase 6). Contract: `docs/migration/specs/PHASE36_SPEC.md` §4.1. The tool only reads: it never changes a record, and the owner runs it at the step the runbook names.

No dependencies: Node 20 or later (`node:dgram`, `node:net`, `fetch`, `node:test`). Nothing to install.

## Usage

```sh
node scripts/dns-parity.mjs --zone micronshub.eu --a <source> --b <source> [options]
node scripts/dns-parity.mjs ds --zone micronshub.eu --via <doh:… | ns:<parent server>> --expect absent|present [--key-tag <n>]
node scripts/dns-parity.mjs names --zone micronshub.eu [--a <source>] [--b <source>] [--names <file>]
node scripts/dns-parity.mjs --help
```

- The diff form queries every name of the name list with every type of `--types` on both sides and prints one line per difference.
- `ds` reads the DS record of the zone at the parent and prints whether a validating resolver set the AD bit.
- `names` prints the name list a diff run would query, with the reason for each name.

## Sources

| Source | What it is | Semantics |
|---|---|---|
| `ns:<host>[:port]` | An authoritative server over UDP (EDNS 1232), TCP when the answer is truncated; recursion off | Live. Every answer must carry the AA bit, otherwise the row is `ERROR "not authoritative"` |
| `ns+tcp:<host>[:port]` | The same over TCP only | Live |
| `doh:<url>`, `doh:cloudflare`, `doh:google`, `doh:quad9` | RFC 8484 GET (`application/dns-message`) to a public resolver | Live, recursive; TTLs count down |
| `zone:<file>` | A BIND zone file, for example the Papaki export (runbook S3) | RFC 4592 wildcards, as Papaki's servers answer |
| `zone+cf:<file>` | A BIND zone file exported by Cloudflare (DNS → Records → Import and Export → Export) | Cloudflare wildcards; `cf_tags=cf-proxied:true` comments mark proxied records |
| `cfapi:<file>` | The JSON of `GET /zones/<zone id>/dns_records` (one envelope, a bare array, or an array of saved pages) | Cloudflare wildcards; `proxied`; TTL `1` (automatic) counts as unknown |
| `capture:<file>` | A text capture in the `doh.py` format (`== TYPE name`, then `N:data \| N:data` or `(no answer)`) | Lossy: values cut at 120 characters are compared by prefix; questions the capture lacks are `SKIPPED` |

Zone-file and API sources are answered by a simulated authoritative server: exact names, a CNAME for every type, NODATA, NXDOMAIN, wildcard synthesis with the owner rewritten, and both empty-non-terminal rules. In Cloudflare semantics a proxied name answers A, AAAA and HTTPS with Cloudflare's own data and never shows its CNAME, and a CNAME at the apex is flattened.

Cloudflare API export (a token with DNS Read on the zone; the zone holds fewer than 100 records, so one page is the whole zone; check that `result_info.total_pages` is 1):

```sh
curl -sS "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?per_page=100" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" > cf-records.json
```

## Name list

Built in for `micronshub.eu` (`lib/defaults.mjs`): the apex, `www`, the literal wildcard owner `*`, `_dmarc`, `resend._domainkey`, `google._domainkey`, the empty non-terminal `_domainkey` and `x._domainkey` below it, `send`, `_vercel`, the tenant hosts `laserkritis` and `micronshub`, `rfq`, `api`, `files`, `mcp`, `random-probe-xyz`, and three seeded probes (`zz-dnsparity-<h>`, `a.zz-dnsparity-<h>`, `_zz-dnsparity-<h>`; `<h>` comes from `--probe-seed`, so a report can be repeated). Every owner name and empty non-terminal of a `zone:`, `zone+cf:` or `cfapi:` source is added, which catches records an import added. `--names <file>` adds names (`<name> [TYPE,TYPE]` per line, `#` comments, `@` = apex); `--no-default-names` keeps only those and the source owners. Apex NS, SOA and the DNSSEC types are compared only with `--include-infra`.

## Comparison rules

| Rule | Behaviour |
|---|---|
| Compared set | The RRset owned by the question name; for a non-CNAME question at a CNAME owner, the CNAME. Records a resolver chased behind a CNAME depend on the resolver's location and are ignored unless `--follow-cname` |
| Order, case | RRsets are sets; names lower case without the trailing dot |
| TTL | Ignored by default; `--ttl exact` compares, `--ttl max:<s>` checks that each side is at most `<s>` (use `max:` with DoH, whose TTLs count down) |
| TXT | The strings of one record are joined (`--txt join`, default; RFC 7208 §3.3); `--txt chunks` compares the exact split |
| Addresses | IPv6 in RFC 5952 form |
| Unknown types | RFC 3597 `\# <len> <hex>`; zone-file text of a type the tool cannot encode is `UNCOMPARABLE` (exit 2, never a silent match) |
| Apex CNAME flattening | `FLATTENED_UNVERIFIED` unless `--flatten-via <source>` resolves the target and compares the addresses |
| `--expect-dns-only` | Any proxied record in a `cfapi:`/`zone+cf:` source is a difference (runbook S4: every record DNS only) |
| `--expect-proxied <names>` | For the listed names (`*` = the wildcard and every name it answers) side B must answer A/AAAA with addresses only and no CNAME (HTTPS: Cloudflare's own record or none); every other type of a listed name that was a CNAME on side A must be empty on side B. Records added next to the proxied record, and every name not listed, are compared as usual |
| Empty non-terminal | One side NODATA/NXDOMAIN at or below an empty non-terminal while the other answers exactly what its own wildcard answers: `EXPECTED_ENT` (Papaki follows RFC 4592, Cloudflare applies the wildcard there) |
| `--allow <file>` | Expected differences, `[{"id", "name", "type", "statuses", "reason", "expires"}]`; an expired entry is ignored |
| `--forbid-target <t>` | Repeatable. Any answer on either side, and any record of a `zone:`, `zone+cf:` or `cfapi:` source (proxied ones included), whose RDATA (the CNAME, NS or MX target, the address) equals or ends with `<t>` is a `DIFF` with the reason `forbidden target`; an allow-list entry does not accept it |

## Statuses and exit codes

| Status | Exit |
|---|---|
| `MATCH`, `EXPECTED_ENT`, `EXPECTED_PROXIED`, `ALLOWED`, `SKIPPED`, `FLATTENED_UNVERIFIED` | do not fail |
| `DIFF`, `TTL_DIFF` | 1 |
| `ERROR` (timeout, SERVFAIL, REFUSED, AA missing, malformed answer), `UNCOMPARABLE` | 2 (incomplete; wins over 1; the report still lists the differences) |
| usage error | 64; an unreadable source file exits 2 |

The text report groups the types that share a name, status and answers on one line; `--json <file>` writes every row for the runbook log; `--verbose` lists the matching rows too.

## Where to run it

`ns:` sources need UDP and TCP port 53 straight to the authoritative servers: run those commands from the owner's machine. A network that answers port 53 itself (some CI runners, containers and captive networks) returns answers without the AA bit; the tool reports them as `ERROR "not authoritative"` and exits 2, never as a match. `doh:`, `zone:`, `zone+cf:`, `cfapi:` and `capture:` work anywhere; behind an HTTP proxy, DoH needs `NODE_USE_ENV_PROXY=1` (Node 22).

## Runbook commands (owner's machine)

Every command starts with `node scripts/dns-parity.mjs --zone micronshub.eu`; pass = exit 0 unless the row says otherwise. Keep the printed report (or `--json`) in the runbook log.

| Step | Arguments | Pass |
|---|---|---|
| S2 TTLs | `--a ns:dns1.papaki.gr --b ns:dns2.papaki.gr --ttl max:300 --no-default-names --names ttl-names.txt` (file below) | both Papaki servers equal and every TTL at most 300 s, once the old TTLs have elapsed |
| S3/S4 export vs import | `--a zone:papaki.zone --b cfapi:cf-records.json --expect-dns-only` (or `--b zone+cf:cf-export.txt`) | `EXPECTED_ENT` rows only for `_domainkey`, `x._domainkey` |
| S5, S7 | `--a ns:dns1.papaki.gr --b ns:<assigned>.ns.cloudflare.com` | as S4; if the pending zone answers REFUSED (exit 2), run the S4 command instead |
| S6, S7 DS removed | `ds --via doh:google --expect absent` | no DS at the parent |
| S9 (T + 1 h, T + 24 h) | `--a zone:papaki.zone --b doh:google`, then the same with `--b doh:cloudflare` | as S4 |
| S10 DNSSEC on | `ds --via doh:google --expect present --key-tag <key tag Cloudflare shows>` | the DS with that key tag; the line ends with `(AD: validated)` |
| S11 (`api` record proxied) | `--a zone:papaki.zone --b ns:<assigned>.ns.cloudflare.com --expect-proxied api` | every other name unchanged |
| S12 (`www` flipped) | the same with `--expect-proxied www,api` | MX, SPF, DKIM, DMARC, `send` and the verification TXT unchanged |
| S13 (apex flipped) | `--expect-proxied www,@,api` | as S12 |
| S14-S16 (wildcard flipped) | `--expect-proxied www,@,*,api` | as S12 (Phase 3 gate item 5) |
| Later checks | `--a cfapi:<today's export> --b doh:cloudflare --expect-proxied www,@,*,api` | the export of the agreed state is the reference once the Papaki export is out of date |
| Before the Vercel project is deleted (Phase 6, OW6-11) | `--a cfapi:<today's export> --b doh:cloudflare --expect-proxied www,@,*,api --forbid-target vercel-dns.com --forbid-target vercel-dns-017.com --forbid-target 216.198.79.1` | no record of the zone, proxied or not, and no live answer points at a Vercel target |

`--expect-proxied` lists exactly the names whose record is proxied at that step, so the list grows with S11-S14: a name listed before its flip still answers its old record and is a `DIFF`, a name left out after its flip answers Cloudflare addresses and is a `DIFF`.

`ttl-names.txt` for S2 (the records whose TTL S2 lowers):

```sh
cat > ttl-names.txt <<'EOF'
@ A,MX,TXT
www CNAME
* CNAME
EOF
```

`<assigned>.ns.cloudflare.com` stands for each of the two nameservers Cloudflare assigned at S1; run the command once per nameserver.

## Tests

```sh
node --test scripts/dns-parity/test/*.test.mjs
```

28 cases, no network (every `ns:` and `doh:` source in the tests gets an injected transport built from a zone model): wire format round trip with compression, pointer loops, truncation and RFC 5952; zone-file parser features and line-numbered errors; RFC 4592 and Cloudflare wildcard rules, proxied names and flattening; `ns:` over a fake server (TC → TCP, AA missing → ERROR, timeout → exit 2), `doh:` over an injected fetch, the capture prefix match, allow-list expiry, `--expect-proxied` before and after a flip (the list of each step; a listed name keeps its other records compared), `--expect-dns-only`, `--forbid-target` (with the command of the Phase 6 row above), and the CLI exit codes 0, 1, 2 and 64. The fixtures hold synthetic values only (`papaki.zone`, `cloudflare.json`, `cloudflare-drift.json`, `capture.txt`) and one recorded public DoH answer (`doh-micronshub-mx.bin`, the MX set of the zone).

## Files

| Path | What |
|---|---|
| `scripts/dns-parity.mjs` | CLI |
| `lib/types.mjs`, `lib/names.mjs`, `lib/rdata.mjs` | Type tables, name helpers, canonical RDATA |
| `lib/wire.mjs` | DNS wire format (query encoder, response decoder; a response encoder for tests) |
| `lib/zonefile.mjs`, `lib/cfapi.mjs` | BIND zone-file parser, Cloudflare API export reader |
| `lib/zonesim.mjs` | Simulated authoritative answers from a record list (RFC 4592 and Cloudflare modes) |
| `lib/sources.mjs` | The source kinds above |
| `lib/compare.mjs`, `lib/run.mjs`, `lib/report.mjs` | Outcome comparison, the run (name list, queries, statuses, exit code), text and JSON report |
| `lib/defaults.mjs` | Built-in names and types for `micronshub.eu` |

## Limits

Delegations below the apex are compared as NS data only. `HTTPS`/`SVCB` records in a zone file need the RFC 3597 `\#` form, otherwise they are `UNCOMPARABLE`. AXFR is not attempted. A `ds` check through `ns:` needs a server of the parent zone (`.eu`), not one of the zone's own servers.
