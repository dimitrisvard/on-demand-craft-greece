// Runs a call of the copied parsers (src/cad/inline/*) with the console's non-error output switched off.
//
// Rules
//   - Log lines of this Worker carry ids, codes and sizes only, behind the [microns-ops] prefix (cad-jobs.ts header);
//     the parser copies stay identical to their originals (CQ-3) and keep their own console.log calls, so the
//     callers run them through quietly() instead of editing the copies.
//   - The parsers are synchronous (parseSTEP is declared async but contains no await), so their whole body runs
//     inside fn() while the no-op is in place and no other code of the isolate logs in between; the original
//     functions are restored in finally, also when the parser throws.

const LEVELS = ['log', 'info', 'debug', 'warn'] as const;

export function quietly<T>(fn: () => T): T {
  const saved = LEVELS.map((level) => [level, console[level]] as const);
  const silent = (): void => {};
  for (const level of LEVELS) console[level] = silent;
  try {
    return fn();
  } finally {
    for (const [level, original] of saved) console[level] = original;
  }
}
