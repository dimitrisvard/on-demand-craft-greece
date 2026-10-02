// Volatile window (SEO_PARITY.md §2.4): the content pipeline runs 07:00–09:00
// UTC and the sitemap is regenerated at 09:00 UTC; /sitemap.xml <lastmod>
// changes at 00:00 UTC. Runs start between 10:05 and 06:55 UTC and are invalid
// when they cross 09:00 or 00:00 UTC, or run into the window (cross 06:55).
//
// Override: PARITY_IGNORE_WINDOW=1 lets a run start or finish anyway. It is
// printed loudly and the run is never signable.

import { CROSSING_MINUTES, WINDOW_END_MIN, WINDOW_OVERRIDE_ENV, WINDOW_START_MIN } from './constants.mjs';

const minutesUtc = (d) => d.getUTCHours() * 60 + d.getUTCMinutes();

export function insideStartWindow(d) {
  const m = minutesUtc(d);
  return m >= WINDOW_START_MIN && m < WINDOW_END_MIN;
}

/** Boundaries (00:00 / 06:55 / 09:00 UTC instants) crossed by the interval (start, end]. */
export function crossedBoundaries(start, end) {
  const out = [];
  const day = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  for (let t = day.getTime(); t <= end.getTime(); t += 86400000) {
    for (const m of CROSSING_MINUTES) {
      const at = t + m * 60000;
      if (at > start.getTime() && at <= end.getTime()) out.push(new Date(at).toISOString());
    }
  }
  return out;
}

export function overrideActive(env = process.env) {
  return env[WINDOW_OVERRIDE_ENV] === '1';
}

export const OVERRIDE_BANNER = [
  '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
  `!!! ${WINDOW_OVERRIDE_ENV}=1: the volatile-window rule (SEO_PARITY.md §2.4) is OFF.`,
  '!!! This run is NOT SIGNABLE, whatever its result.',
  '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
].join('\n');

/** Check at start. Returns { refuse: string|null, override: boolean }. */
export function checkStart(now = new Date(), env = process.env) {
  const override = overrideActive(env);
  if (insideStartWindow(now) && !override) {
    return { refuse: `refusing to start at ${now.toISOString()}: inside the 06:55–10:05 UTC content-pipeline window (SEO_PARITY.md §2.4)`, override };
  }
  return { refuse: null, override };
}

/** Check at the end. Returns { crossed: string[], invalid: boolean }. */
export function checkEnd(start, end, env = process.env) {
  const crossed = crossedBoundaries(start, end);
  return { crossed, invalid: crossed.length > 0 && !overrideActive(env) };
}
