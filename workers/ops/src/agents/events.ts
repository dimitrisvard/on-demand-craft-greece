// Analytics Engine data points of the agent layer (binding EVENTS, dataset microns_events).
//
// Layout (fixed order; one index, at most 20 blobs and 20 doubles per point):
//   indexes[0]  run_id
//   blobs       event, agent, step, route (or CAD backend), model, outcome, prompt_version, tenant_id,
//               workflow_instance_id
//   doubles     input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, latency_ms, attempt,
//               bytes
// The writer is a no-op without the binding and never throws. No address, subject, body or token is ever a blob.

/** 'xometry_tick': one point per Xometry scan slot (Phase 5, src/xometry/tick.ts). */
export type AgentEventName = 'llm_call' | 'embed_call' | 'step' | 'run_end' | 'cad_job' | 'mail_in' | 'send' | 'xometry_tick';

export interface AgentEventPoint {
  event: AgentEventName;
  run_id: string;
  agent: string;
  step?: string;
  /** LLM route, or the CAD backend for cad_job. */
  route?: string;
  model?: string;
  outcome?: string;
  prompt_version?: string;
  tenant_id?: string;
  workflow_instance_id?: string;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  cost_usd?: number;
  latency_ms?: number;
  attempt?: number;
  bytes?: number;
}

/** Blob order of the data point (blob1 … blob9). */
export const BLOB_FIELDS = ['event', 'agent', 'step', 'route', 'model', 'outcome', 'prompt_version', 'tenant_id', 'workflow_instance_id'] as const;

/** Double order of the data point (double1 … double8). */
export const DOUBLE_FIELDS = ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'cost_usd', 'latency_ms', 'attempt', 'bytes'] as const;

/** Longest blob kept (identifiers and short codes only; the dataset allows 16 KB per point). */
export const BLOB_MAX = 256;
/** The index is the sampling key and may hold at most 96 bytes. */
export const INDEX_MAX = 96;

function blob(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, BLOB_MAX) : '';
}

function double(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Pure: the data point in the fixed layout (missing blobs '', missing doubles 0). */
export function toDataPoint(p: AgentEventPoint): AnalyticsEngineDataPoint {
  return {
    indexes: [blob(p.run_id).slice(0, INDEX_MAX)],
    blobs: BLOB_FIELDS.map((field) => blob(p[field])),
    doubles: DOUBLE_FIELDS.map((field) => double(p[field])),
  };
}

/** Writes one point; no-op when the binding is absent; never throws. */
export function writeEvent(ds: AnalyticsEngineDataset | undefined, p: AgentEventPoint): void {
  if (!ds) return;
  try {
    ds.writeDataPoint(toDataPoint(p));
  } catch {
    // Analytics are best effort: a failed write never fails the run.
  }
}
