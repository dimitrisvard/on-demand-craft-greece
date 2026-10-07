// /dashboard/rfq-inbox (Phase 4 agent layer): the e-mails received by the RFQ and reply mailboxes, what the intake
// agent made of them, and the decisions waiting on them. Staff only (the user_roles staff roles, isAdmin()).
//
// Rules (the page ships to production before the agent layer exists)
//   - Reads go through supabase-js under staff RLS (src/lib/agentDb.ts); missing tables show "not installed" and stop
//     all reads (no retry, no polling). The list polls every 60 s, only after its first read succeeded.
//   - Sender addresses are masked in the list; subjects, the excerpt and every parsed value render as text, never as
//     HTML. The excerpt is read only when one message is opened.
//   - Actions (decision, "Run intake again", downloads) are enabled only after GET /api/agent/status answered as
//     specified (src/utils/agentApi.ts).
//   - ?email=<id> (the "Open" button of an intake card) opens that message.
import { useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, MailOpen } from 'lucide-react';
import PersistentDashboardLayout from '@/components/dashboard/PersistentDashboardLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Toaster } from '@/components/ui/sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuth } from '@/contexts/AuthContext';
import { agentQueries, agentRetry, INBOX_PAGE_SIZE, isNotInstalled, maskEmail, pollAfterSuccess, type InboxFilter } from '@/lib/agentDb';
import { INBOUND_KINDS, INBOUND_MAILBOXES, INBOUND_STATUSES, RERUNNABLE_INBOUND, type InboundEmailRow } from '@/types/agent';
import { describeAgentError, useAgentApi, type AgentApiClient } from '@/utils/agentApi';
import { useApiUnauthorized } from '@/utils/apiAuth';
import { ApprovalCard } from './agent/ApprovalCard';
import { ApiStateNotice, NotInstalled, SignInAgain } from './agent/NotInstalled';

const INBOX_POLL_MS = 60_000;
const LOW_CONFIDENCE = 0.7;
const VALUE_PREVIEW_CHARS = 400;

function numberOf(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

function textOf(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const json = JSON.stringify(value);
  return json.length > VALUE_PREVIEW_CHARS ? `${json.slice(0, VALUE_PREVIEW_CHARS)}…` : json;
}

function ConfidenceBadge({ value }: { value: unknown }) {
  const n = numberOf(value);
  if (n === null) return null;
  return <Badge variant={n < LOW_CONFIDENCE ? 'destructive' : 'secondary'}>{`${Math.round(n * 100)}%`}</Badge>;
}

function RowBadges({ row }: { row: InboundEmailRow }) {
  const dmarc = row.auth_results?.dmarc;
  const injection = row.parsed && (row.parsed as Record<string, unknown>).injection_suspected === true;
  return (
    <div className="flex flex-wrap gap-1">
      <Badge variant="outline">{row.status}</Badge>
      {row.kind && <Badge variant="secondary">{row.kind}</Badge>}
      <ConfidenceBadge value={row.parse_confidence} />
      {row.classification?.process && <Badge variant="outline">{row.classification.process}</Badge>}
      {dmarc && <Badge variant={dmarc === 'pass' ? 'secondary' : 'destructive'}>{`DMARC ${dmarc}`}</Badge>}
      {injection && <Badge variant="destructive">Injection suspected</Badge>}
    </div>
  );
}

function InboundDetail({ id, listed, api, onChanged }: { id: string; listed: InboundEmailRow | null; api: AgentApiClient | null; onChanged: () => void }) {
  const queryClient = useQueryClient();
  const single = useQuery({ queryKey: ['agent-inbound', id], queryFn: () => agentQueries.getInbound(id), retry: agentRetry, enabled: listed === null });
  const row = listed ?? single.data ?? null;
  const excerpt = useQuery({ queryKey: ['agent-inbound-excerpt', id], queryFn: () => agentQueries.inboundExcerpt(id), retry: agentRetry });
  const pending = useQuery({ queryKey: ['agent-inbound-pending', id], queryFn: () => agentQueries.pendingIntakeRun(id), retry: agentRetry });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['agent-inbound-pending', id] });
    onChanged();
  };

  const rerun = useMutation({
    mutationFn: () => {
      if (!api) throw new Error('Agent API unavailable');
      return api.start({ v: 1, kind: 'rfq_intake', inbound_email_id: id });
    },
    onSuccess: (result) => {
      toast.success(result.created ? 'Intake started' : 'Intake started again');
      refresh();
    },
    onError: (error) => {
      const message = describeAgentError(error);
      toast.error(message.title);
      if (message.refetch) refresh();
    },
  });

  const download = async (key: string, filename: string) => {
    if (!api) return;
    try {
      await api.downloadFile(key, filename);
    } catch (error) {
      toast.error(describeAgentError(error).title);
    }
  };

  if (!row) {
    if (single.isLoading) return <Skeleton className="h-40 w-full" />;
    return <p className="text-sm text-muted-foreground">This message could not be found.</p>;
  }
  const parsed = (row.parsed ?? {}) as Record<string, unknown>;
  const confidences = (typeof parsed.field_confidence === 'object' && parsed.field_confidence !== null ? parsed.field_confidence : {}) as Record<string, unknown>;
  const canRerun = row.mailbox === 'rfq' && RERUNNABLE_INBOUND.includes(row.status) && pending.isSuccess && pending.data === null;

  return (
    <div className="space-y-4" data-testid="inbound-detail">
      <div className="space-y-1 text-sm">
        <div>
          <span className="text-muted-foreground">From: </span>
          {row.from_name ? `${row.from_name} <${row.from_email ?? ''}>` : (row.from_email ?? '')}
        </div>
        <div>
          <span className="text-muted-foreground">Received: </span>
          {new Date(row.received_at).toLocaleString()}
        </div>
        <RowBadges row={row} />
        {row.rfq_id && (
          <div>
            <Link to={`/rfq/${row.rfq_id}`} className="underline">
              Open the RFQ
            </Link>
          </div>
        )}
        {row.error && <div className="text-destructive">{row.error}</div>}
      </div>

      {pending.data && <ApprovalCard run={pending.data} api={api} onChanged={refresh} />}
      {canRerun && (
        <Button size="sm" disabled={!api || rerun.isPending} onClick={() => rerun.mutate()} data-testid="rerun-intake">
          Run intake again
        </Button>
      )}

      {Object.keys(parsed).length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-1">What the agent read</h3>
          <dl className="grid grid-cols-[max-content_1fr_max-content] gap-x-3 gap-y-1 text-sm">
            {Object.entries(parsed)
              .filter(([key]) => key !== 'field_confidence')
              .map(([key, value]) => (
                <div key={key} className="contents">
                  <dt className="text-muted-foreground">{key}</dt>
                  <dd className="break-words">{textOf(value)}</dd>
                  <dd>
                    <ConfidenceBadge value={confidences[key]} />
                  </dd>
                </div>
              ))}
          </dl>
        </div>
      )}

      <div>
        <h3 className="text-sm font-medium mb-1">Original text</h3>
        {excerpt.isLoading && <Skeleton className="h-24 w-full" />}
        {excerpt.data ? (
          <pre className="whitespace-pre-wrap break-words rounded bg-muted p-3 text-xs" data-testid="inbound-excerpt">
            {excerpt.data}
          </pre>
        ) : (
          !excerpt.isLoading && <p className="text-sm text-muted-foreground">No text stored.</p>
        )}
      </div>

      <div className="space-y-1">
        <h3 className="text-sm font-medium">Attachments</h3>
        {(row.attachments ?? []).length === 0 && <p className="text-sm text-muted-foreground">None.</p>}
        {(row.attachments ?? []).map((a) => (
          <div key={`${a.n}-${a.r2_key}`} className="flex items-center justify-between gap-2 text-sm">
            <span className="break-all">
              {a.filename}
              {a.size_bytes ? ` (${Math.ceil(a.size_bytes / 1024)} KB)` : ''}
              {a.kind ? ` · ${a.kind}` : ''}
            </span>
            <Button size="sm" variant="outline" disabled={!api} onClick={() => void download(a.r2_key, a.filename)}>
              <Download className="h-4 w-4" />
            </Button>
          </div>
        ))}
        {row.raw_r2_key && (
          <Button size="sm" variant="outline" disabled={!api} onClick={() => void download(row.raw_r2_key as string, 'original.eml')}>
            Original e-mail (.eml)
          </Button>
        )}
      </div>
    </div>
  );
}

function InboxContent() {
  const [params, setParams] = useSearchParams();
  const selected = params.get('email');
  const [filter, setFilter] = useState<InboxFilter>({ status: 'all', mailbox: 'all', kind: 'all', page: 0 });
  const queryClient = useQueryClient();
  const apiUnauthorized = useApiUnauthorized();
  const probe = useAgentApi();
  const api = probe.data?.available ? probe.data.client : null;

  const inbox = useQuery({
    queryKey: ['agent-inbox', filter],
    queryFn: () => agentQueries.listInbound(filter),
    retry: agentRetry,
    refetchInterval: pollAfterSuccess(INBOX_POLL_MS),
  });
  const notInstalled = isNotInstalled(inbox.error);
  const rows = inbox.data ?? [];
  const page = filter.page ?? 0;

  const open = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('email', id);
    else next.delete('email');
    setParams(next, { replace: true });
  };
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['agent-inbox'] });
  const setField = (field: 'status' | 'mailbox' | 'kind', value: string) => setFilter((f) => ({ ...f, [field]: value, page: 0 }));

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <MailOpen className="h-6 w-6" />
          RFQ Inbox
        </h1>
        <p className="text-sm text-muted-foreground">E-mails received by the RFQ and reply mailboxes, and what the intake agent made of them.</p>
      </div>

      {apiUnauthorized ? <SignInAgain /> : <ApiStateNotice probe={probe.data} loading={probe.isLoading} />}

      {notInstalled ? (
        <NotInstalled />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Select value={filter.status ?? 'all'} onValueChange={(v) => setField('status', v)}>
              <SelectTrigger className="w-44" aria-label="Status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {INBOUND_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filter.mailbox ?? 'all'} onValueChange={(v) => setField('mailbox', v)}>
              <SelectTrigger className="w-40" aria-label="Mailbox">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All mailboxes</SelectItem>
                {INBOUND_MAILBOXES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filter.kind ?? 'all'} onValueChange={(v) => setField('kind', v)}>
              <SelectTrigger className="w-40" aria-label="Kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All kinds</SelectItem>
                {INBOUND_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {k}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {inbox.isLoading && <Skeleton className="h-64 w-full" />}
          {inbox.isError && <p className="text-sm text-destructive">The inbox could not be loaded.</p>}
          {inbox.data && (
            <Table data-testid="rfq-inbox">
              <TableHeader>
                <TableRow>
                  <TableHead>Received</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>RFQ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} className="cursor-pointer" onClick={() => open(row.id)} data-inbound-id={row.id}>
                    <TableCell className="whitespace-nowrap text-xs">{new Date(row.received_at).toLocaleString()}</TableCell>
                    <TableCell className="text-sm">
                      <div>{row.from_name ?? ''}</div>
                      <div className="text-xs text-muted-foreground">{maskEmail(row.from_email)}</div>
                    </TableCell>
                    <TableCell className="max-w-[20rem] break-words text-sm">{row.subject ?? ''}</TableCell>
                    <TableCell>
                      <RowBadges row={row} />
                    </TableCell>
                    <TableCell>
                      {row.rfq_id && (
                        <Link to={`/rfq/${row.rfq_id}`} className="underline text-sm" onClick={(e) => e.stopPropagation()}>
                          RFQ
                        </Link>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                      No e-mails.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setFilter((f) => ({ ...f, page: Math.max(0, (f.page ?? 0) - 1) }))}>
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">Page {page + 1}</span>
            <Button size="sm" variant="outline" disabled={rows.length < INBOX_PAGE_SIZE} onClick={() => setFilter((f) => ({ ...f, page: (f.page ?? 0) + 1 }))}>
              Next
            </Button>
          </div>
        </>
      )}

      <Sheet open={selected !== null && !notInstalled} onOpenChange={(o) => !o && open(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="break-words">{rows.find((r) => r.id === selected)?.subject ?? 'E-mail'}</SheetTitle>
                <SheetDescription>Shown as received; links and markup are not followed.</SheetDescription>
              </SheetHeader>
              <div className="mt-4">
                <InboundDetail id={selected} listed={rows.find((r) => r.id === selected) ?? null} api={api} onChanged={refresh} />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
      <Toaster />
    </div>
  );
}

export default function RfqInboxPage() {
  const { user, loading, isAdmin } = useAuth();
  if (loading) {
    return (
      <PersistentDashboardLayout>
        <div className="p-6">
          <Skeleton className="h-8 w-64 mb-4" />
          <Skeleton className="h-[400px] w-full" />
        </div>
      </PersistentDashboardLayout>
    );
  }
  if (!user || !isAdmin()) return <Navigate to="/login" replace />;
  return (
    <PersistentDashboardLayout>
      <InboxContent />
    </PersistentDashboardLayout>
  );
}
