// /dashboard/approvals (Phase 4 agent layer): the cards waiting for a human decision, RFQs that can get a quote,
// the agent switches and the agent activity. Staff only (the user_roles staff roles, isAdmin()).
//
// Rules (the page ships to production before the agent layer exists)
//   - Reads go through supabase-js under staff RLS (src/lib/agentDb.ts); missing tables show "not installed" and stop
//     all reads (no retry, no polling).
//   - Actions (decisions, starts, switches, test card, PDF preview) are enabled only after GET /api/agent/status
//     answered as specified (src/utils/agentApi.ts); otherwise the data stays readable and a hint explains why.
//   - The pending list polls every 30 s, only after its first read succeeded.
//   - ?run=<id> (the "Open" button of a Telegram card) highlights that card.
import { useEffect, useRef } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ClipboardCheck, Send } from 'lucide-react';
import PersistentDashboardLayout from '@/components/dashboard/PersistentDashboardLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Toaster } from '@/components/ui/sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { agentQueries, agentRetry, isNotInstalled, pollAfterSuccess } from '@/lib/agentDb';
import type { StartBody } from '@/types/agent';
import { describeAgentError, useAgentApi } from '@/utils/agentApi';
import { useApiUnauthorized } from '@/utils/apiAuth';
import { AgentActivity } from './agent/AgentActivity';
import { AgentSwitches } from './agent/AgentSwitches';
import { ApprovalCard } from './agent/ApprovalCard';
import { ApiStateNotice, NotInstalled, SignInAgain } from './agent/NotInstalled';

const PENDING_KEY = ['agent-pending-approvals'] as const;
const RFQS_KEY = ['agent-rfqs-without-quote'] as const;
const PENDING_POLL_MS = 30_000;

function ApprovalsContent() {
  const [params] = useSearchParams();
  const runParam = params.get('run');
  const queryClient = useQueryClient();
  const apiUnauthorized = useApiUnauthorized();
  const probe = useAgentApi();
  const api = probe.data?.available ? probe.data.client : null;
  const highlightRef = useRef<HTMLDivElement | null>(null);

  const pending = useQuery({
    queryKey: PENDING_KEY,
    queryFn: () => agentQueries.listPendingApprovals(),
    retry: agentRetry,
    refetchInterval: pollAfterSuccess(PENDING_POLL_MS),
  });
  const notInstalled = isNotInstalled(pending.error);
  const rfqs = useQuery({
    queryKey: RFQS_KEY,
    queryFn: () => agentQueries.listRfqsWithoutQuote(),
    retry: agentRetry,
    enabled: pending.isSuccess,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: PENDING_KEY });
    void queryClient.invalidateQueries({ queryKey: RFQS_KEY });
  };

  const start = useMutation({
    mutationFn: (body: StartBody) => {
      if (!api) throw new Error('Agent API unavailable');
      return api.start(body);
    },
    onSuccess: (result, body) => {
      if (body.kind === 'test_card') toast.success('Test card sent; tap Dismiss on Telegram');
      else toast.success(result.created ? 'Quote started' : 'This quote is already running');
      refresh();
    },
    onError: (error) => {
      const message = describeAgentError(error);
      toast.error(message.title);
      if (message.refetch) refresh();
    },
  });

  const highlighted = runParam && pending.data?.some((r) => r.id === runParam) ? runParam : null;
  useEffect(() => {
    if (highlighted) highlightRef.current?.scrollIntoView({ block: 'center' });
  }, [highlighted]);

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <ClipboardCheck className="h-6 w-6" />
            Approvals
          </h1>
          <p className="text-sm text-muted-foreground">Agent cards waiting for a decision, agent switches and activity.</p>
        </div>
        {api?.status.principal === 'ADMIN' && (
          <Button variant="outline" size="sm" disabled={start.isPending} onClick={() => start.mutate({ v: 1, kind: 'test_card' })} data-testid="send-test-card">
            <Send className="h-4 w-4 mr-2" />
            Send test card
          </Button>
        )}
      </div>

      {apiUnauthorized ? <SignInAgain /> : <ApiStateNotice probe={probe.data} loading={probe.isLoading} />}

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="switches">Agent switches</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="space-y-4">
          {pending.isLoading && <Skeleton className="h-40 w-full" />}
          {notInstalled && <NotInstalled />}
          {pending.isError && !notInstalled && <p className="text-sm text-destructive">The pending approvals could not be loaded.</p>}
          {runParam && pending.isSuccess && !highlighted && <p className="text-sm text-muted-foreground">The linked card is not waiting any more (decided, or replaced by a reminder).</p>}
          {pending.data && pending.data.length === 0 && <p className="text-sm text-muted-foreground" data-testid="no-pending">Nothing is waiting for a decision.</p>}
          <div className="grid gap-4 lg:grid-cols-2">
            {(pending.data ?? []).map((run) => (
              <div key={run.id} ref={run.id === highlighted ? highlightRef : undefined}>
                <ApprovalCard run={run} api={api} highlighted={run.id === highlighted} onChanged={refresh} />
              </div>
            ))}
          </div>

          {pending.isSuccess && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">RFQs without a quote</CardTitle>
                <CardDescription>Draft or received RFQs that have no running quote.</CardDescription>
              </CardHeader>
              <CardContent>
                {rfqs.isLoading && <Skeleton className="h-20 w-full" />}
                {rfqs.isError && <p className="text-sm text-destructive">The RFQs could not be loaded.</p>}
                {rfqs.data && rfqs.data.length === 0 && <p className="text-sm text-muted-foreground">None.</p>}
                {rfqs.data && rfqs.data.length > 0 && (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>RFQ</TableHead>
                        <TableHead>Company</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rfqs.data.map((rfq) => (
                        <TableRow key={rfq.id}>
                          <TableCell>
                            <Link to={`/rfq/${rfq.id}`} className="underline">
                              {rfq.rfq_number ?? rfq.id.slice(0, 8)}
                            </Link>
                          </TableCell>
                          <TableCell>{rfq.company_name ?? ''}</TableCell>
                          <TableCell>{rfq.status ?? ''}</TableCell>
                          <TableCell className="text-right">
                            <Button size="sm" disabled={!api || start.isPending} onClick={() => start.mutate({ v: 1, kind: 'quote', rfq_id: rfq.id })}>
                              Start quote
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="switches">
          <AgentSwitches api={api} />
        </TabsContent>

        <TabsContent value="activity">
          <AgentActivity />
        </TabsContent>
      </Tabs>
      <Toaster />
    </div>
  );
}

export default function ApprovalsPage() {
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
      <ApprovalsContent />
    </PersistentDashboardLayout>
  );
}
