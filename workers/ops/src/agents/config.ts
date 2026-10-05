// Per-use configuration checks of the agent layer. Every Phase 4 field of OpsEnv is optional, so an unrelated
// deploy never fails for agent configuration; each entry point narrows the env to the names it uses with need().
// A missing name fails only that step, with error code 'config_missing' and the names (never values).

import { missingNames } from '../../../shared/src/http/env-check';
import type { OpsEnv } from '../env';

export class ConfigMissingError extends Error {
  readonly code = 'config_missing' as const;
  readonly names: string[];
  constructor(names: string[]) {
    super(`config_missing: ${names.join(', ')}`);
    this.name = 'ConfigMissingError';
    this.names = names;
  }
}

/** Narrows env to the named fields or throws ConfigMissingError naming every missing one. */
export function need<K extends keyof OpsEnv>(env: OpsEnv, ...names: K[]): asserts env is OpsEnv & Required<Pick<OpsEnv, K>> {
  const missing = missingNames(env, names as string[]);
  if (missing.length > 0) throw new ConfigMissingError(missing);
}

/** True when e is a ConfigMissingError (also across module copies: checks the code). */
export function isConfigMissing(e: unknown): e is ConfigMissingError {
  return e instanceof ConfigMissingError || (typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'config_missing');
}
