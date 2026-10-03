// Whether a compare run can be gate evidence (SEO_PARITY.md §1).
//
// The §1 stages compare two different deployments:
//  - live vs live, two origins: Vercel production with a preview (Phases 1-2,
//    S11), Cloudflare production with a new version's preview (Phases 4-6);
//  - snapshot vs live, one origin, two platforms: the S11 capture of Vercel
//    against www after the DNS flip (S12-S16, daily C+1 … C+14);
//  - snapshot vs live, one origin, one platform: from S17 a capture of
//    Cloudflare production is the reference for Phases 4-7, so a Phase 7 re-run
//    after a change on Cloudflare itself (PLAN.md P7-8: the SEO handler's data
//    backend switch) compares Cloudflare with an earlier capture of Cloudflare.
//    The responses cannot show whether something changed since the capture,
//    so the operator states it with --changed-since-capture; without it the
//    run is not signable.
//
// Never signable, whatever its result (the run still executes and reports):
//  - live vs live with the same origin on both sides (self-diff);
//  - snapshot vs snapshot of the same directory or a copy of it (self-diff);
//    of two captures of one origin (the B6 noise-floor run of §4); of two
//    origins (no §1 stage compares two stored captures);
//  - snapshot vs live where the candidate is the snapshot's own origin and
//    answers from Vercel as at capture (self-diff: the S11 capture against
//    www before the flip; no §1 stage compares Vercel with its own capture,
//    so --changed-since-capture does not lift it);
//  - snapshot vs live, same origin and the same non-Vercel platform set as at
//    capture, without --changed-since-capture.

import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { sha256 } from './util.mjs';

/** Platform that answered a response, from its recorded headers. */
export function hopPlatform(hop) {
  const h = hop?.headers || {};
  if (Object.prototype.hasOwnProperty.call(h, 'cf-ray')) return 'cloudflare';
  if (Object.prototype.hasOwnProperty.call(h, 'x-vercel-id') || String(h.server || '').trim().toLowerCase() === 'vercel') return 'vercel';
  return 'unknown';
}

/**
 * Platforms seen on one side: first response of every method of every entry
 * requested at that side's origin (absolute entries go to other hosts and
 * are left out).
 * @param items [{ entry, b, c }] from the compare loop; side 'b' or 'c'
 */
export function sidePlatforms(items, side) {
  const seen = new Set();
  for (const it of items) {
    if (!it || !it[side] || /^https?:\/\//.test(it.entry.url)) continue;
    for (const m of Object.values(it[side].methods || {})) {
      const hop = m?.hops?.[0];
      if (hop) seen.add(hopPlatform(hop));
    }
  }
  return [...seen].sort();
}

const realDir = (d) => { try { return realpathSync(d); } catch { return path.resolve(d); } };
const manifestSha = (d) => { try { return sha256(readFileSync(path.join(d, 'manifest.json'))); } catch { return null; } };

/**
 * @param o { mode, baseOrigin, candOrigin, baseDir, candDir, platforms: { base, candidate },
 *   changedSinceCapture: operator's statement (--changed-since-capture) or null }
 * @returns { selfDiff: { kind, detail } | null, reasons: string[], banners: string[] }
 */
export function evidenceCheck(o) {
  let selfDiff = null;
  const reasons = [];
  const banners = [];
  if (o.mode === 'live-vs-live' && o.baseOrigin === o.candOrigin) {
    selfDiff = { kind: 'same-origin', detail: `base and candidate are the same origin ${o.baseOrigin}` };
  }
  if (o.mode === 'snapshot-vs-snapshot') {
    if (realDir(o.baseDir) === realDir(o.candDir)) {
      selfDiff = { kind: 'same-snapshot', detail: `base and candidate are the same snapshot directory ${o.baseDir}` };
    } else {
      const a = manifestSha(o.baseDir);
      if (a && a === manifestSha(o.candDir)) selfDiff = { kind: 'same-capture', detail: `${o.baseDir} and ${o.candDir} hold the same capture (identical manifest.json)` };
    }
    if (!selfDiff && o.baseOrigin === o.candOrigin) {
      reasons.push('snapshot vs snapshot: no deployment under test (noise-floor run, SEO_PARITY.md §4 B6; not gate evidence)');
      banners.push('Snapshot vs snapshot: two stored captures, no deployment under test (noise-floor run, SEO_PARITY.md §4 B6). NOT gate evidence, NOT SIGNABLE.');
    } else if (!selfDiff) {
      const which = `two origins (${o.baseOrigin} and ${o.candOrigin})`;
      reasons.push(`snapshot vs snapshot of ${which}: two stored captures, no deployment under test; not gate evidence`);
      banners.push(`Snapshot vs snapshot of ${which}: two stored captures, no deployment under test. NOT gate evidence, NOT SIGNABLE.`);
    }
  }
  if (o.mode === 'snapshot-vs-live' && o.baseOrigin === o.candOrigin) {
    const b = o.platforms?.base || [];
    const c = o.platforms?.candidate || [];
    const shown = c.join(', ') || 'no response';
    if (b.join(',') === c.join(',')) {
      if (c.includes('vercel') && !c.includes('cloudflare')) {
        selfDiff = {
          kind: 'same-origin-same-platform',
          detail: `the candidate is the snapshot's own origin ${o.candOrigin} and answers from Vercel as at capture (${shown})`,
        };
        if (o.changedSinceCapture) banners.push('--changed-since-capture does not apply to a Vercel capture compared with Vercel (no SEO_PARITY.md §1 stage does this); the statement is recorded only.');
      } else if (!o.changedSinceCapture) {
        reasons.push(`same origin and platform as the capture (${shown}): the tool cannot tell another deployment from the captured one; not gate evidence unless --changed-since-capture states what changed`);
        banners.push(`SAME ORIGIN AND PLATFORM AS THE CAPTURE (${shown}): ${o.candOrigin} answers from the platform the snapshot recorded. Evidence only of a change made since the capture (S17 reference, PLAN.md P7-8): NOT SIGNABLE unless --changed-since-capture states that change.`);
      } else {
        banners.push(`Same origin and platform as the capture (${shown}); changed since the capture, as stated by the operator: ${o.changedSinceCapture}`);
      }
    }
  }
  if (selfDiff) {
    reasons.unshift(`self-diff (${selfDiff.kind}): ${selfDiff.detail}; not gate evidence`);
    banners.unshift(`SELF-DIFF (${selfDiff.kind}): ${selfDiff.detail}. The run compares a site with itself: NOT gate evidence, NOT SIGNABLE, whatever its result.`);
  }
  return { selfDiff, reasons, banners };
}
