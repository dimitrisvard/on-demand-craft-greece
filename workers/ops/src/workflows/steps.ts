// Step profiles of the agent Workflows (retries and timeouts per kind of step).
//
// Rules for every Workflow step
//   - Step names are constants (plus a stable index, e.g. 'copy-file-3'), never time- or random-based.
//   - Every side-effecting step re-reads its flag first and parks the run on flag_off.
//   - NonRetryableError (cloudflare:workflows) for a schema failure after one re-ask, a provider 4xx other than 408
//     and 429, a refusal and invalid input.
//   - "already exists" on a Workflow create() counts as success.
//   - Step results stay below 1 MiB and carry ids and compact JSON only (no e-mail bodies or addresses).

import type { WorkflowStepConfig } from 'cloudflare:workers';

/** Supabase REST / RPC. */
export const DB: WorkflowStepConfig = { retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' }, timeout: '2 minutes' };
/** R2 put / copy (objects up to 25 MiB). */
export const BLOB: WorkflowStepConfig = { retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' }, timeout: '5 minutes' };
/** extract calls (PDF input). */
export const LLM_EXTRACT: WorkflowStepConfig = { retries: { limit: 3, delay: '30 seconds', backoff: 'exponential' }, timeout: '3 minutes' };
/** classify calls. */
export const LLM_CLASSIFY: WorkflowStepConfig = { retries: { limit: 3, delay: '15 seconds', backoff: 'exponential' }, timeout: '1 minute' };
/** Embeddings and Vectorize. */
export const EMBED: WorkflowStepConfig = { retries: { limit: 3, delay: '10 seconds', backoff: 'exponential' }, timeout: '1 minute' };
/** Resend (always with an Idempotency-Key). */
export const SEND: WorkflowStepConfig = { retries: { limit: 3, delay: '1 minute', backoff: 'exponential' }, timeout: '1 minute' };
/** Telegram cards. */
export const NOTIFY: WorkflowStepConfig = { retries: { limit: 3, delay: '30 seconds', backoff: 'exponential' }, timeout: '30 seconds' };
/** PDF rendering. */
export const PDF: WorkflowStepConfig = { retries: { limit: 2, delay: '5 seconds', backoff: 'constant' }, timeout: '2 minutes' };
/** Deterministic decisions kept as steps so their result is cached. */
export const PURE: WorkflowStepConfig = { retries: { limit: 0, delay: 0 }, timeout: '30 seconds' };

export const STEP_PROFILES = Object.freeze({ DB, BLOB, LLM_EXTRACT, LLM_CLASSIFY, EMBED, SEND, NOTIFY, PDF, PURE });

export type StepProfileName = keyof typeof STEP_PROFILES;
