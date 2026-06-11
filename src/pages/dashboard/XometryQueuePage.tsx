import { useCallback, useEffect, useState } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { Loader2, RefreshCw } from 'lucide-react';

import PersistentDashboardLayout from '@/components/dashboard/PersistentDashboardLayout';
import { supabase } from '@/integrations/supabase/client';
import type { PartFileRef, XometryOfferRow, XometryOfferStatus } from '@/types/xometry';

// Review page for the xometry-bot counteroffer queue (see xometry-bot/README.md).
// All data flows through the xometry-review edge function: the xometry_offers
// table is RLS-locked against the anon key, and the Hetzner review API token
// never reaches the browser. Nothing is sent to Xometry without the Submit
// click below — the bot itself stops at status `ready`.

async function invokeReview<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('xometry-review', { body });
  if (error) {
    let detail = error.message;
    if (error instanceof FunctionsHttpError) {
      try {
        const payload = (await error.context.json()) as { detail?: unknown };
        if (typeof payload?.detail === 'string') detail = payload.detail;
        else if (payload?.detail != null) detail = JSON.stringify(payload.detail);
      } catch {
        // keep the generic message
      }
    }
    throw new Error(detail);
  }
  return data as T;
}

interface RowEdit {
  price: string;
  leadtime: string;
}

const STATUS_STYLES: Record<XometryOfferStatus, string> = {
  new: 'bg-gray-100 text-gray-700',
  priced: 'bg-blue-100 text-blue-700',
  ready: 'bg-green-100 text-green-800',
  needs_manual: 'bg-amber-100 text-amber-800',
  needs_review: 'bg-amber-100 text-amber-800',
  excluded_secondary_ops: 'bg-gray-100 text-gray-400',
  submitting: 'bg-purple-100 text-purple-700',
  submitted: 'bg-emerald-100 text-emerald-800',
  skipped: 'bg-gray-100 text-gray-400',
  error: 'bg-red-100 text-red-700',
};

const SUBMITTABLE: ReadonlySet<XometryOfferStatus> = new Set(['ready', 'needs_review']);
const TERMINAL: ReadonlySet<XometryOfferStatus> = new Set(['submitted', 'skipped']);

function eur(n: number | null): string {
  return n == null ? '—' : `${n.toFixed(2)} €`;
}

const XometryQueuePage = () => {
  const [rows, setRows] = useState<XometryOfferRow[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    setLoadError('');
    try {
      setRows(await invokeReview<XometryOfferRow[]>({ action: 'pending' }));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <PersistentDashboardLayout>
      <main className="mx-auto max-w-screen-2xl p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Xometry counteroffer queue</h1>
            <p className="mt-1 text-sm text-gray-500">
              Sorted by expiry. Suggested price = max(buyer × 0.80, cost × 1.15); lead time ≥
              today + 10 business days. Nothing is sent to Xometry without the Submit click.
            </p>
          </div>
          <button
            type="button"
            className="flex items-center gap-1 rounded border bg-white px-3 py-1.5 text-sm disabled:opacity-40"
            disabled={refreshing}
            onClick={() => void load()}
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
        {loadError ? (
          <div className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {loadError}
          </div>
        ) : null}
        {rows === null && !loadError ? (
          <div className="mt-12 flex justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          </div>
        ) : (
          <div className="mt-4 rounded-lg bg-white p-4 shadow-sm">
            <OfferTable rows={rows ?? []} setRows={setRows} />
          </div>
        )}
      </main>
    </PersistentDashboardLayout>
  );
};

function OfferTable({
  rows,
  setRows,
}: {
  rows: XometryOfferRow[];
  setRows: React.Dispatch<React.SetStateAction<XometryOfferRow[] | null>>;
}) {
  const [edits, setEdits] = useState<Record<string, RowEdit>>({});
  const [openCode, setOpenCode] = useState<string | null>(null);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const editFor = (row: XometryOfferRow): RowEdit =>
    edits[row.code] ?? {
      price: row.suggested_price != null ? String(row.suggested_price) : '',
      leadtime: row.suggested_leadtime ?? '',
    };

  const setEdit = (code: string, patch: Partial<RowEdit>, row: XometryOfferRow) =>
    setEdits((e) => ({ ...e, [code]: { ...editFor(row), ...e[code], ...patch } }));

  async function act(row: XometryOfferRow, action: 'submit' | 'skip') {
    const edit = editFor(row);
    if (action === 'submit') {
      const confirmed = window.confirm(
        `Send counteroffer for ${row.code}: ${edit.price} €, lead time ${edit.leadtime}?\n` +
          'This places a real counteroffer on Xometry.',
      );
      if (!confirmed) return;
    }
    setBusyCode(row.code);
    setErrors((e) => ({ ...e, [row.code]: '' }));
    try {
      // Empty inputs go up as null so the review API falls back to the row's
      // suggested values; its guard still refuses prices below the floor.
      const payload =
        action === 'submit'
          ? {
              action,
              code: row.code,
              price: edit.price === '' ? null : Number(edit.price),
              leadtime: edit.leadtime === '' ? null : edit.leadtime,
              accept_review_row: row.status === 'needs_review',
            }
          : { action, code: row.code };
      await invokeReview(payload);
      const next: XometryOfferStatus = action === 'submit' ? 'submitted' : 'skipped';
      setRows((rs) =>
        (rs ?? []).map((r) => (r.code === row.code ? { ...r, status: next } : r)),
      );
    } catch (err) {
      setErrors((e) => ({ ...e, [row.code]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusyCode(null);
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase tracking-wide text-gray-500">
            <th className="px-2 py-2">PO</th>
            <th className="px-2 py-2">Process / Material</th>
            <th className="px-2 py-2">Qty</th>
            <th className="px-2 py-2">Partner cost</th>
            <th className="px-2 py-2">Buyer price</th>
            <th className="px-2 py-2">Suggested €</th>
            <th className="px-2 py-2">Lead time</th>
            <th className="px-2 py-2">Expires</th>
            <th className="px-2 py-2">Status / flags</th>
            <th className="px-2 py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const edit = editFor(row);
            const busy = busyCode === row.code;
            const open = openCode === row.code;
            return (
              <OfferRow
                key={row.code}
                row={row}
                edit={edit}
                busy={busy}
                open={open}
                error={errors[row.code] ?? ''}
                onToggle={() => setOpenCode(open ? null : row.code)}
                onEdit={(patch) => setEdit(row.code, patch, row)}
                onAct={(action) => void act(row, action)}
              />
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={10} className="px-2 py-8 text-center text-gray-400">
                Queue is empty — the next scan runs on the 2-hour cron.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function OfferRow({
  row,
  edit,
  busy,
  open,
  error,
  onToggle,
  onEdit,
  onAct,
}: {
  row: XometryOfferRow;
  edit: RowEdit;
  busy: boolean;
  open: boolean;
  error: string;
  onToggle: () => void;
  onEdit: (patch: Partial<RowEdit>) => void;
  onAct: (action: 'submit' | 'skip') => void;
}) {
  const submittable = SUBMITTABLE.has(row.status);
  const terminal = TERMINAL.has(row.status);
  return (
    <>
      <tr className={`border-b align-top ${terminal ? 'opacity-50' : ''}`}>
        <td className="px-2 py-2 font-mono">
          <button className="underline decoration-dotted" onClick={onToggle} type="button">
            {row.code}
          </button>
          {row.is_urgent ? (
            <span className="ml-1 rounded bg-red-100 px-1 text-xs text-red-700">urgent</span>
          ) : null}
        </td>
        <td className="px-2 py-2">
          <div>{row.process_type ?? '—'}</div>
          <div className="text-xs text-gray-500">{row.material ?? ''}</div>
        </td>
        <td className="px-2 py-2">{row.quantity ?? '—'}</td>
        <td className="px-2 py-2">{eur(row.partner_cost)}</td>
        <td className="px-2 py-2">
          {eur(row.buyer_price)}
          {row.buyer_quote_id ? (
            <a
              className="ml-1 text-xs text-blue-600 underline"
              href={`https://get.xometry.eu/quotes/${row.buyer_quote_id}`}
              target="_blank"
              rel="noreferrer"
            >
              {row.buyer_quote_id}
            </a>
          ) : null}
        </td>
        <td className="px-2 py-2">
          <input
            className="w-24 rounded border px-1 py-0.5"
            type="number"
            step="0.01"
            value={edit.price}
            disabled={terminal || busy}
            onChange={(e) => onEdit({ price: e.target.value })}
          />
        </td>
        <td className="px-2 py-2">
          <input
            className="rounded border px-1 py-0.5"
            type="date"
            value={edit.leadtime}
            disabled={terminal || busy}
            onChange={(e) => onEdit({ leadtime: e.target.value })}
          />
        </td>
        <td className="px-2 py-2 text-xs">
          {row.publication_end ? new Date(row.publication_end).toLocaleString() : '—'}
        </td>
        <td className="px-2 py-2">
          <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_STYLES[row.status]}`}>
            {row.status}
          </span>
          {row.excluded_reason ? (
            <div className="mt-1 text-xs text-gray-500">excluded: {row.excluded_reason}</div>
          ) : null}
          <div className="mt-1 flex max-w-56 flex-wrap gap-1">
            {(row.flags ?? []).map((f) => (
              <span key={f} className="rounded bg-gray-100 px-1 text-xs text-gray-600">
                {f}
              </span>
            ))}
          </div>
        </td>
        <td className="px-2 py-2 whitespace-nowrap">
          <button
            type="button"
            className="rounded bg-green-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-40"
            disabled={!submittable || busy}
            onClick={() => onAct('submit')}
          >
            {busy ? '…' : row.status === 'needs_review' ? 'Submit (override)' : 'Submit'}
          </button>
          <button
            type="button"
            className="ml-1 rounded border px-2 py-1 text-xs disabled:opacity-40"
            disabled={terminal || busy}
            onClick={() => onAct('skip')}
          >
            Skip
          </button>
          {error ? <div className="mt-1 max-w-48 text-xs text-red-600">{error}</div> : null}
        </td>
      </tr>
      {open ? (
        <tr className="border-b bg-gray-50">
          <td colSpan={10} className="px-4 py-3">
            <div className="grid gap-3 md:grid-cols-2">
              <PartViewer files={row.part_files ?? []} localPaths={row.local_files ?? []} />
              <div className="text-sm">
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  <dt className="text-gray-500">Dimensions</dt>
                  <dd>{row.dimensions ?? '—'}</dd>
                  <dt className="text-gray-500">Tolerance</dt>
                  <dd>{row.tolerance ?? '—'}</dd>
                  <dt className="text-gray-500">Roughness</dt>
                  <dd>{row.roughness ?? '—'}</dd>
                  <dt className="text-gray-500">Finish</dt>
                  <dd>{row.finish || 'none'}</dd>
                  <dt className="text-gray-500">Threads</dt>
                  <dd>
                    {row.threads_present == null ? '—' : row.threads_present ? 'yes' : 'no'}
                  </dd>
                  <dt className="text-gray-500">Inspection</dt>
                  <dd>{row.inspection_needed ? 'measurement protocol required' : 'no'}</dd>
                  <dt className="text-gray-500">Xometry lead</dt>
                  <dd>{row.xo_leadtime ?? '—'}</dd>
                  <dt className="text-gray-500">Counter floor</dt>
                  <dd>{eur(row.allow_counter_from)}</dd>
                </dl>
                {row.production_remark ? (
                  <p className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-900">
                    {row.production_remark}
                  </p>
                ) : null}
                <p className="mt-2 text-xs">
                  <a
                    className="text-blue-600 underline"
                    href={`https://partner.xometry.eu/offers/${row.offer_id}?gsh=true&source=jobs`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    open on partner portal
                  </a>
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {(row.tags ?? []).map((t) => (
                    <span key={t} className="rounded bg-gray-200 px-1 text-xs text-gray-600">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

/**
 * Placeholder slot for the STEP→GLB Three.js viewer (§2 of the build spec) —
 * src/components/ThreeDViewerModal.tsx is the swap-in candidate. `files[].downloadUrl`
 * are Xometry-hosted CAD/drawing links, `localPaths` are the worker's copies.
 */
function PartViewer({ files, localPaths }: { files: PartFileRef[]; localPaths: string[] }) {
  return (
    <div className="rounded border border-dashed border-gray-300 p-3 text-sm">
      <p className="font-medium text-gray-700">
        Part files{' '}
        <span className="font-normal text-gray-400">
          (TODO: mount the Microns Hub STEP viewer here)
        </span>
      </p>
      <ul className="mt-2 list-inside list-disc text-gray-600">
        {files.map((f) => (
          <li key={f.name}>
            {f.downloadUrl ? (
              <a
                className="text-blue-600 underline"
                href={f.downloadUrl}
                target="_blank"
                rel="noreferrer"
              >
                {f.name}
              </a>
            ) : (
              f.name
            )}
          </li>
        ))}
        {files.length === 0 && <li>no files on this offer</li>}
      </ul>
      {localPaths.length > 0 && (
        <p className="mt-2 text-xs text-gray-400">worker copies: {localPaths.join(', ')}</p>
      )}
    </div>
  );
}

export default XometryQueuePage;
