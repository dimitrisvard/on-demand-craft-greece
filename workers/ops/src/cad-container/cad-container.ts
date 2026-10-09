// CadContainer (Phase 5, unit D5): the unfold service in a Cloudflare Container, a Durable Object class exported by
// microns-ops (binding CAD_CONTAINER, container application "microns-cad", migration tag v2). One instance per slot
// name ('cad-0' … 'cad-<CAD_SLOTS - 1>', src/cad-container/slots.ts); CadRouter hands the slots out.
//
// Rules
//   - '@cloudflare/containers' is a dependency of workers/ops only; src/index.ts re-exports ContainerProxy from the
//     same specifier, so the bundle holds exactly one copy of the package (its outbound registries are
//     module-level maps that ContainerProxy reads by class name).
//   - The outbound handler is registered through the inherited static setter, by an assignment after the class
//     body; a `static outboundByHost = {…}` class field would define an own property and never register it.
//   - No internet: enableInternet false; the only outbound path is INPUT_HOST through fetchCompatInput.
//   - The service listens on 8000 (sheet-metal-service/Dockerfile); readiness is probed on the open path
//     localhost/health, because every other path of the service requires the shared key.
//   - envVars: API_KEY = CAD_SHARED_SECRET (omitted when not configured: the service then answers 503 "API key not
//     configured" for every keyed route, because REQUIRE_API_KEY is '1'), REQUIRE_API_KEY '1', PROCESSING_TIMEOUT =
//     CAD_PROCESSING_TIMEOUT_S or '120' (seconds; the service stops a request after it and answers 504).
//   - An instance sleeps 10 minutes after its last request (no keep-warm).
//   - Log lines use the prefix [microns-cad] and carry exit codes, reasons and error names only.

import { Container, type StopParams } from '@cloudflare/containers';
import { formatLogLine } from '../../../shared/src/http/log';
import type { OpsEnv } from '../env';
import { fetchCompatInput, INPUT_HOST } from './input-proxy';

/** Environment of the container class and of its outbound handler (the microns-ops env). */
export type CadEnv = OpsEnv;

/** Log prefix of the container class and its outbound handler. */
export const CAD_LOG_PREFIX = '[microns-cad]';

/** Port of the unfold service inside the image. */
export const CAD_SERVICE_PORT = 8000;

/** Default PROCESSING_TIMEOUT of the service, in seconds. */
export const DEFAULT_PROCESSING_TIMEOUT_S = '120';

const TIMEOUT_VALUE = /^(?:[1-9][0-9]{0,3}|0\.[0-9]{1,3}|[1-9][0-9]{0,3}\.[0-9]{1,3})$/;

/** The environment variables the container starts with (names and rules: see the header). */
export function cadEnvVars(env: Pick<CadEnv, 'CAD_SHARED_SECRET' | 'CAD_PROCESSING_TIMEOUT_S'>): Record<string, string> {
  const vars: Record<string, string> = {};
  if (typeof env.CAD_SHARED_SECRET === 'string' && env.CAD_SHARED_SECRET !== '') vars.API_KEY = env.CAD_SHARED_SECRET;
  vars.REQUIRE_API_KEY = '1';
  const timeout = typeof env.CAD_PROCESSING_TIMEOUT_S === 'string' ? env.CAD_PROCESSING_TIMEOUT_S.trim() : '';
  vars.PROCESSING_TIMEOUT = TIMEOUT_VALUE.test(timeout) ? timeout : DEFAULT_PROCESSING_TIMEOUT_S;
  return vars;
}

export class CadContainer extends Container<CadEnv> {
  defaultPort = CAD_SERVICE_PORT;
  sleepAfter = '10m';
  enableInternet = false;
  pingEndpoint = 'localhost/health';

  constructor(ctx: DurableObjectState<{}>, env: CadEnv) {
    super(ctx, env);
    this.envVars = cadEnvVars(env);
  }

  override onStop(params: StopParams): void {
    console.log(formatLogLine(CAD_LOG_PREFIX, 'container stopped', { exit: params.exitCode, reason: params.reason }));
  }

  override onError(error: unknown): unknown {
    console.error(formatLogLine(CAD_LOG_PREFIX, 'container error', { error: error instanceof Error ? error.name : typeof error }));
    throw error;
  }
}

// Registration through the inherited static setter (after the class body, see the rules above).
CadContainer.outboundByHost = { [INPUT_HOST]: fetchCompatInput };
