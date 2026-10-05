// Failure card: a Workflow run that failed waits for a human (agent_runs.status 'waiting_human',
// parked_reason 'failed'). Verbs: 'retry' (restart the instance from the failed step) and 'dismiss' (close the run
// 'failed'); 'retry' is offered only when the run belongs to a Workflow instance and the failed step is known.

import { cardOpenUrl, type CardV1 } from './index';

export interface FailureCardInput {
  run_id: string;
  /** agent_runs.agent, e.g. 'rfq_intake'. */
  agent: string;
  /** Name of the step that threw, or null when unknown. */
  failed_step: string | null;
  /** Short error code or name (never a stack, an address or a token). */
  error: string;
  /** True when the run belongs to a Workflow instance that can be restarted. */
  restartable: boolean;
  /** SITE_ORIGIN of microns-ops (dashboard link base). */
  site_origin: string;
}

/** allowed_verbs of a failure card. */
export function failureVerbs(restartable: boolean, failedStep: string | null): string[] {
  return restartable && failedStep ? ['retry', 'dismiss'] : ['dismiss'];
}

export function failureCard(i: FailureCardInput): CardV1 {
  return {
    v: 1,
    kind: 'failure',
    run_id: i.run_id,
    title: `Agent run failed \u00b7 ${i.agent}`,
    lines: [
      { label: 'Agent', value: i.agent },
      { label: 'Step', value: i.failed_step ?? 'unknown' },
      { label: 'Error', value: i.error },
    ],
    flags: [],
    allowed_verbs: failureVerbs(i.restartable, i.failed_step),
    open_url: cardOpenUrl(i.site_origin, i.run_id),
  };
}
