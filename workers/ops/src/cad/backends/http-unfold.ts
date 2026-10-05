// HttpUnfoldBackend: the unfold service over HTTP (the VPS in Phase 4; the Phase 5 Container changes only the
// fetcher). STEP files only; sheet-metal analysis returns the flat DXF and the part metadata headers.
//
// Rules
//   - Only two paths are called: POST {base}/api/v1/unfold and GET {base}/api/v1/health, both with X-API-Key (and,
//     when configured, the Access service-token headers of the CAD hostname).
//   - The unfold request is multipart/form-data with exactly these parts: file (the R2 object, streamed, under the
//     sanitised file name), material, thickness_override, k_factor_override, output_format, drawing_size. The file
//     always travels as an upload; no URL- or path-based input field is ever sent.
//   - output_format: analyse and flat_dxf -> dxf, drawing_pdf -> pdf, flat_svg -> svg.
//   - Inputs above 50 MB fail 'too_large' before any request.
//   - Answers: 200 -> artefact + result; 400/413/415/422 -> 'invalid_input' (not retryable); 401/403 and other 4xx
//     -> 'backend_error' (not retryable: configuration); 408/429 -> 'unavailable' (retryable); 5xx ->
//     'backend_error' (retryable), 502/503/504 also mark the backend down; network error -> 'unavailable'
//     (retryable, backend down); the job signal firing -> 'timeout' (retryable).
//   - Analysis metrics come from the X-Part-* headers plus the in-Worker DXF metrics of the returned flat.dxf
//     (skipped with a warning when that DXF is above the inline DXF cap).
//   - Error messages carry the HTTP status and a short code only, never the service's response text.

import type { CadJobMessageV1 } from '../../queues/messages';
import { safeName } from '../../agents/ids';
import { dxfMetrics } from '../dxf-metrics';
import { parseDXF } from '../inline/dxf-parser';
import { multipartBody } from '../multipart';
import { parseUnfoldHeaders, resultFromUnfold } from '../result';
import { INLINE_CAPS, MAX_INPUT_BYTES, type CadArtefact, type CadBackend, type CadInput, type CadKind, type CadOutcome, type UnfoldFetcher } from '../types';

export interface HttpUnfoldOptions {
  baseUrl: string;
  apiKey: string;
  maxConcurrency: number;
  /** Access service token of the CAD hostname (optional; sent as CF-Access-Client-Id / -Secret). */
  accessClientId?: string;
  accessClientSecret?: string;
  /** Multipart boundary (tests); random by default. */
  boundary?: string;
  clock?: () => number;
}

/** The six form fields of an unfold request, in order (the file part follows them). */
export const UNFOLD_FIELDS = ['material', 'thickness_override', 'k_factor_override', 'output_format', 'drawing_size'] as const;

type OutputFormat = 'dxf' | 'pdf' | 'svg';

export function outputFormatOf(jobType: CadJobMessageV1['job_type']): OutputFormat {
  return jobType === 'drawing_pdf' ? 'pdf' : jobType === 'flat_svg' ? 'svg' : 'dxf';
}

function finiteOrZero(n: unknown): string {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? String(n) : '0';
}

/** Form field values of a job (material defaults to 'steel', the service's own default). */
export function unfoldFields(job: CadJobMessageV1): Array<readonly [string, string]> {
  const material = typeof job.params.material === 'string' && /^[A-Za-z0-9 ._+\-/()]{1,60}$/.test(job.params.material) ? job.params.material : 'steel';
  return [
    ['material', material],
    ['thickness_override', finiteOrZero(job.params.thickness_override)],
    ['k_factor_override', finiteOrZero(job.params.k_factor_override)],
    ['output_format', outputFormatOf(job.job_type)],
    ['drawing_size', job.params.drawing_size === 'A4' ? 'A4' : 'A3'],
  ];
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

function fail(code: Extract<CadOutcome, { ok: false }>['code'], retryable: boolean, message: string, httpStatus?: number): CadOutcome {
  return httpStatus === undefined ? { ok: false, retryable, code, message } : { ok: false, retryable, code, message, httpStatus };
}

/** CadOutcome of a non-200 answer (see the rules above). */
export function outcomeOfStatus(status: number): CadOutcome {
  if (status === 400 || status === 413 || status === 415 || status === 422) return fail('invalid_input', false, `unfold ${status}`, status);
  if (status === 408 || status === 429) return fail('unavailable', true, `unfold ${status}`, status);
  if (status >= 500) return fail('backend_error', true, `unfold ${status}`, status);
  return fail('backend_error', false, `unfold ${status}`, status);
}

/** True when a failed outcome means the service itself is unreachable or down. */
export function isBackendDown(o: CadOutcome): boolean {
  if (o.ok) return false;
  if (o.code === 'unavailable' && o.httpStatus === undefined) return true;
  return o.httpStatus === 502 || o.httpStatus === 503 || o.httpStatus === 504;
}

export class HttpUnfoldBackend implements CadBackend {
  readonly mode = 'sync' as const;
  readonly maxConcurrency: number;
  private readonly base: string;
  private readonly clock: () => number;

  constructor(
    readonly name: 'vps' | 'container',
    private readonly fetcher: UnfoldFetcher,
    private readonly opts: HttpUnfoldOptions,
  ) {
    if (!opts.baseUrl || !opts.apiKey) throw new Error('HttpUnfoldBackend needs baseUrl and apiKey');
    this.base = opts.baseUrl.replace(/\/+$/, '');
    this.maxConcurrency = opts.maxConcurrency;
    this.clock = opts.clock ?? (() => Date.now());
  }

  supports(jobType: CadJobMessageV1['job_type'], kind: CadKind, process: string): boolean {
    if (kind !== 'step') return false;
    if (jobType === 'analyse') return process === 'sheet_metal' || process === 'mixed';
    return true;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = { 'X-API-Key': this.opts.apiKey, ...extra };
    if (this.opts.accessClientId && this.opts.accessClientSecret) {
      headers['CF-Access-Client-Id'] = this.opts.accessClientId;
      headers['CF-Access-Client-Secret'] = this.opts.accessClientSecret;
    }
    return headers;
  }

  async health(signal: AbortSignal): Promise<boolean> {
    try {
      const res = await this.fetcher(new Request(`${this.base}/api/v1/health`, { method: 'GET', headers: this.headers(), signal }));
      if (res.status !== 200) {
        await res.body?.cancel();
        return false;
      }
      const data = (await res.json().catch(() => null)) as { status?: unknown } | null;
      return data?.status === 'healthy';
    } catch {
      return false;
    }
  }

  async run(job: CadJobMessageV1, input: CadInput, signal: AbortSignal): Promise<CadOutcome> {
    if (input.sizeBytes > MAX_INPUT_BYTES) return fail('too_large', false, 'input above 50 MB');
    if (!this.supports(job.job_type, input.kind, job.params.process)) return fail('unsupported', false, `${job.job_type} of ${input.kind} is not supported here`);
    const started = this.clock();
    const format = outputFormatOf(job.job_type);
    let response: Response;
    if (signal.aborted) return fail('timeout', true, 'job deadline passed before the request');
    try {
      const content = await input.open();
      const multipart = multipartBody(
        unfoldFields(job),
        { name: 'file', fileName: safeName(input.fileName), contentType: 'application/octet-stream', size: input.sizeBytes, body: content },
        this.opts.boundary,
      );
      const init: RequestInit & { duplex?: 'half' } = {
        method: 'POST',
        headers: this.headers({ 'Content-Type': multipart.contentType }),
        body: multipart.body,
        signal,
        duplex: 'half',
      };
      response = await this.fetcher(new Request(`${this.base}/api/v1/unfold`, init as RequestInit));
    } catch (error) {
      if (signal.aborted || isAbort(error)) return fail('timeout', true, 'unfold request timed out');
      return fail('unavailable', true, 'unfold service unreachable');
    }
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      return outcomeOfStatus(response.status);
    }
    let body: ArrayBuffer;
    try {
      body = await response.arrayBuffer();
    } catch (error) {
      if (signal.aborted || isAbort(error)) return fail('timeout', true, 'unfold answer timed out');
      return fail('unavailable', true, 'unfold answer interrupted');
    }
    const headers = parseUnfoldHeaders(response.headers);
    const artefact: CadArtefact =
      format === 'pdf'
        ? { name: 'drawing.pdf', contentType: 'application/pdf', body }
        : format === 'svg'
          ? { name: 'flat.svg', contentType: 'image/svg+xml', body }
          : { name: 'flat.dxf', contentType: 'application/dxf', body };
    const warnings: string[] = [];
    let metrics = null;
    if (format === 'dxf') {
      if (body.byteLength > INLINE_CAPS.dxf) warnings.push('dxf_metrics_skipped_too_large');
      else {
        try {
          metrics = dxfMetrics(parseDXF(body));
        } catch {
          warnings.push('dxf_metrics_unreadable');
        }
      }
    }
    const result = resultFromUnfold(headers, metrics, { warnings, duration_ms: this.clock() - started, versions: { backend: this.name, service: 'sheet-metal-service' } });
    return { ok: true, result, artefacts: [artefact] };
  }
}
