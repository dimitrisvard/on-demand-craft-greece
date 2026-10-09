// Xometry scan (Phase 5, unit X5): handler of the scrapes kind 'xometry-scan' (one message per scheduled slot,
// sent by the dispatcher with the run it opened). Calls runXometryTick (src/xometry/tick.ts) and always acks: the
// next slot is the retry, as with the GitHub Action (PHASE5_SPEC §5.3, §6.4).
//
// Rules
//   - Params must hold a slot 'YYYY-MM-DDTHH:MMZ'; anything else is logged (message id only) and acked, and the
//     message's run is closed 'failed' (error invalid_params) when it is a growth.xometry run that is still
//     running, so no run of a message that can never succeed stays open.
//   - The ports are built from env unless the caller passes them (tests).
//   - When the tick throws (its run could not be closed), the message is still acked and the error goes to the
//     scrapes-p5 consumer, which closes the run 'failed' if it is still running.

import { formatLogLine } from '../../../shared/src/http/log';
import { closeRun, EMPTY_USAGE } from '../agents/runs';
import { getRun } from '../db/repos/agent-runs';
import { LOG_PREFIX } from '../env';
import { makePorts } from '../ports/index';
import { makeP5Ports } from '../ports/p5';
import type { P5ScrapeHandler } from '../queues/scrapes-p5';
import { runXometryTick, XOMETRY_AGENT } from './tick';

const SLOT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/;

export const handleXometryScan: P5ScrapeHandler = async (msg, env, _ctx, deps) => {
  try {
    const slot = (msg.body.params as { slot?: unknown } | null)?.slot;
    const runId = msg.body.run_id;
    if (typeof slot !== 'string' || !SLOT.test(slot) || typeof runId !== 'string' || runId === '') {
      console.error(formatLogLine(LOG_PREFIX, 'xometry-scan invalid params acked', { message_id: msg.id }));
      if (typeof runId === 'string' && runId !== '') {
        const db = (deps?.ports ?? makePorts(env)).db;
        const run = await getRun(db, runId);
        if (run?.agent === XOMETRY_AGENT && run.status === 'running') {
          await closeRun(db, runId, { status: 'failed', error: 'invalid_params', output: { reason: 'invalid_params' } }, { ...EMPTY_USAGE, by_step: {} });
        }
      }
      return;
    }
    const ports = deps?.ports ?? makePorts(env);
    const p5 = deps?.p5 ?? makeP5Ports(env);
    await runXometryTick(env, ports, p5, { slot, run_id: runId, attempt: msg.attempts });
  } finally {
    msg.ack();
  }
};
