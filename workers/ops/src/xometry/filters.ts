// Preset matching, secondary-operation exclusion and spec extraction, ported from
// xometry-bot/xometry_bot/filters.py.
//
// Rules
//   - An offer matches a preset when any part tag id is in its include set and none is in its exclude set.
//   - Exclusion looks at tags of the context production_method_features and at the part finish text: a borderline
//     op (grinding, heat treatment, case hardening, marking) is kept unless one of value.borderline_exclude occurs in
//     the lower-cased tag name; any SECONDARY_OP_RE match excludes. Parts are checked in order, tags before finish.
//   - File kinds use the last '.'-suffix of the last path segment, lower-cased (PurePosixPath.suffix: a name that
//     starts or ends with the dot has none).
//   - Flag lists keep their first occurrence order (dict.fromkeys).

import {
  ACTIVE_PRESETS,
  BORDERLINE_RE,
  INSTANT_QUOTE_EXTS,
  MANUAL_ONLY_EXTS,
  PREFERRED_QUOTE_EXTS,
  PRESETS,
  pyMatches,
  ROUGHNESS_RE,
  SECONDARY_OP_RE,
  THREAD_RISK_RE,
  TOLERANCE_RE,
} from './config';
import type { JobOffer, Preset, SecondaryOpHit, Spec } from './types';

export const METHODS_CTX = 'production_methods';
export const FEATURES_CTX = 'production_method_features';
export const MATERIALS_CTX = 'materials';
export const RISKS_CTX = 'production_risks';

/** First occurrences only, in order (dict.fromkeys). */
export function dedupe<T>(items: Iterable<T>): T[] {
  return [...new Set(items)];
}

export function matchesPreset(offer: JobOffer, preset: Preset): boolean {
  const ids = new Set<number>();
  for (const part of offer.parts) for (const tag of part.tags) ids.add(tag.id);
  let included = false;
  for (const id of ids) {
    if (preset.exclude.has(id)) return false;
    if (preset.include.has(id)) included = true;
  }
  return included;
}

export function matchesAnyActivePreset(offer: JobOffer, active: readonly string[] = ACTIVE_PRESETS): boolean {
  return active.some((name) => {
    const preset = (PRESETS as Record<string, Preset | undefined>)[name];
    if (!preset) throw new Error(`unknown preset: ${name}`);
    return matchesPreset(offer, preset);
  });
}

/** The first finishing or coating op that excludes the offer, or null to keep it. */
export function findSecondaryOp(offer: JobOffer, opts: { borderlineExclude?: Iterable<string> } = {}): SecondaryOpHit | null {
  const borderline = [...(opts.borderlineExclude ?? [])];
  for (const part of offer.parts) {
    for (const tag of part.tags) {
      if (tag.context !== FEATURES_CTX) continue;
      if (pyMatches(BORDERLINE_RE, tag.name)) {
        const lower = tag.name.toLowerCase();
        if (borderline.some((k) => lower.includes(k))) return { op_name: tag.name, source: 'tag' };
        continue;
      }
      if (pyMatches(SECONDARY_OP_RE, tag.name)) return { op_name: tag.name, source: 'tag' };
    }
    if (part.finish && pyMatches(SECONDARY_OP_RE, part.finish)) return { op_name: part.finish, source: 'finish' };
  }
  return null;
}

/** Tolerance, Ra, finish and inspection, plus the advisory flags, of a surviving offer. */
export function extractSpec(offer: JobOffer): Spec {
  const spec: Spec = { tolerance: null, roughness: null, finish: null, inspection_needed: false, flags: [] };
  const flags: string[] = [];
  for (const part of offer.parts) {
    if (part.measurement_protocol_needed) spec.inspection_needed = true;
    if (part.samples_needed) flags.push('samples_needed');
    if (part.finish && spec.finish === null) {
      spec.finish = part.finish;
      // A survivor should carry no finish: a non-empty one that did not trip the exclusion is unmapped.
      flags.push(`finish_unmapped:${part.finish}`);
    }
    for (const tag of part.tags) {
      if (tag.context === FEATURES_CTX) {
        if (pyMatches(ROUGHNESS_RE, tag.name)) spec.roughness = spec.roughness || tag.name;
        else if (pyMatches(TOLERANCE_RE, tag.name)) spec.tolerance = spec.tolerance || tag.name;
        else if (pyMatches(BORDERLINE_RE, tag.name)) flags.push(`borderline:${tag.name}`);
      }
      if (tag.context === RISKS_CTX) flags.push(`risk:${tag.name}`);
      if (pyMatches(THREAD_RISK_RE, tag.name)) flags.push('threads_flagged_partner');
    }
  }
  if (offer.parts.length > 1) flags.push('multi_part');
  spec.flags = dedupe(flags);
  return spec;
}

/** PurePosixPath(path).suffix. */
export function posixSuffix(path: string): string {
  const parts = path.split('/').filter((s) => s !== '' && s !== '.');
  const name = parts.length > 0 ? parts[parts.length - 1] : '';
  const i = name.lastIndexOf('.');
  return i > 0 && i < name.length - 1 ? name.slice(i) : '';
}

/** 'instant' | 'dxf_only' | 'manual' | 'none'. */
export function fileKind(filenames: readonly string[]): 'instant' | 'dxf_only' | 'manual' | 'none' {
  const exts = new Set(filenames.map((n) => posixSuffix(n.toLowerCase())));
  const instant = [...exts].filter((e) => INSTANT_QUOTE_EXTS.has(e));
  if (instant.some((e) => e !== '.dxf')) return 'instant';
  if (instant.includes('.dxf')) return 'dxf_only';
  if ([...exts].some((e) => MANUAL_ONLY_EXTS.has(e))) return 'manual';
  return 'none';
}

/** The file for an instant quote: STEP/STP first, else any instant 3D format. */
export function pickQuoteFile(paths: readonly string[]): string | null {
  for (const preferred of PREFERRED_QUOTE_EXTS) {
    for (const p of paths) if (p.toLowerCase().endsWith(preferred)) return p;
  }
  for (const p of paths) {
    const suffix = posixSuffix(p.toLowerCase());
    if (INSTANT_QUOTE_EXTS.has(suffix) && suffix !== '.dxf') return p;
  }
  return null;
}
