// Per-request configuration check. There is no global config check: each dispatch target and each gate check
// declares the binding, var and secret names it needs and checks them after resolution, so a missing name
// answers 500 only on the requests that need it.

/** Names whose value in `env` is undefined, null or ''. */
export function missingNames(env: object, names: readonly string[]): string[] {
  throw new Error('not implemented: A');
}

/** Logs `${prefix} api config missing: <NAMES>` and answers 500 text/plain "Internal Server Error". */
export function configError(prefix: string, missing: readonly string[]): Response {
  throw new Error('not implemented: A');
}
