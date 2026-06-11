'use client';

import { useState } from 'react';

import { PartViewer } from './part-viewer';
import type { XometryOfferRow, XometryOfferStatus } from './types';

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

export function OfferTable({ initialRows }: { initialRows: XometryOfferRow[] }) {
  const [rows, setRows] = useState(initialRows);
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
      const payload =
        action === 'submit'
          ? {
              code: row.code,
              price: Number(edit.price),
              leadtime: edit.leadtime,
              accept_review_row: row.status === 'needs_review',
            }
          : { code: row.code };
      const res = await fetch(`/api/xometry/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as { detail?: unknown };
      if (!res.ok) {
        const detail = body.detail;
        throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail ?? res.status));
      }
      const next: XometryOfferStatus = action === 'submit' ? 'submitted' : 'skipped';
      setRows((rs) => rs.map((r) => (r.code === row.code ? { ...r, status: next } : r)));
    } catch (err) {
      setErrors((e) => ({ ...e, [row.code]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusyCode(null);
    }
  }

  return (
    <div className="mt-4 overflow-x-auto">
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
              <FragmentRow
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

function FragmentRow({
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
