// Per-request configuration check. There is no global config check: each dispatch target and each gate check
// declares the binding, var and secret names it needs and checks them after resolution, so a missing name
// answers 500 only on the requests that need it.

import { textResponse } from './json';

/** Names whose value in `env` is undefined, null or ''. */
export function missingNames(env: object, names: readonly string[]): string[] {
  const values = env as Record<string, unknown>;
  return names.filter((name) => {
    const value = values[name];
    return value === undefined || value === null || value === '';
  });
}

/** Logs `${prefix} api config missing: <NAMES>` and answers 500 text/plain "Internal Server Error". */
export function configError(prefix: string, missing: readonly string[]): Response {
  // Names only: a value is never logged.
  console.error(`${prefix} api config missing: ${missing.join(', ')}`);
  return textResponse(500, 'Internal Server Error');
}
