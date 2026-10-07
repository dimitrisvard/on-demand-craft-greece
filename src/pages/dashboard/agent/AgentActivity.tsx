// "Activity" tab of the Approvals page: the newest agent_runs rows (all agents or one), with status, cost and the
// run's summary output as compact JSON (outputs hold ids and counts, never e-mail text).
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { agentQueries, agentRetry, isNotInstalled } from '@/lib/agentDb';
import type { AgentRunRow } from '@/types/agent';
import { NotInstalled } from './NotInstalled';

/** Agents written by Phase 4 (agent_runs.agent); 'all' shows every agent. */
const AGENTS = ['all', 'rfq_intake', 'quote', 'post_order', 'quote.reply_poller', 'cad', 'mcp', 'flags', 'eval', 'growth.scrapers'] as const;
const OUTPUT_PREVIEW_CHARS = 300;

function costText(run: AgentRunRow): string {
  const cents = Number(run.cost_cents ?? 0);
  return Number.isFinite(cents) && cents > 0 ? `$${(cents / 100).toFixed(4)}` : '-';
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'failed') return 'destructive';
  if (status === 'waiting_human') return 'default';
  if (status === 'succeeded') return 'secondary';
  return 'outline';
}

function compactJson(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = JSON.stringify(value);
  return text.length > OUTPUT_PREVIEW_CHARS ? `${text.slice(0, OUTPUT_PREVIEW_CHARS)}…` : text;
}

export function AgentActivity() {
  const [agent, setAgent] = useState<(typeof AGENTS)[number]>('all');
  const runs = useQuery({
    queryKey: ['agent-activity', agent],
    queryFn: () => agentQueries.listAgentRuns(agent === 'all' ? null : agent),
    retry: agentRetry,
  });

  return (
    <div className="space-y-3">
      <Select value={agent} onValueChange={(v) => setAgent(v as (typeof AGENTS)[number])}>
        <SelectTrigger className="w-56" aria-label="Agent">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {AGENTS.map((a) => (
            <SelectItem key={a} value={a}>
              {a === 'all' ? 'All agents' : a}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {runs.isLoading && <Skeleton className="h-48 w-full" />}
      {runs.isError && (isNotInstalled(runs.error) ? <NotInstalled /> : <p className="text-sm text-destructive">The activity could not be loaded.</p>)}
      {runs.data && (
        <Table data-testid="agent-activity">
          <TableHeader>
            <TableRow>
              <TableHead>Started</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead>Trigger</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">LLM calls</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead>Error</TableHead>
              <TableHead>Output</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.data.map((run) => (
              <TableRow key={run.id}>
                <TableCell className="whitespace-nowrap text-xs">{run.started_at ? new Date(run.started_at).toLocaleString() : ''}</TableCell>
                <TableCell className="font-mono text-xs">{run.agent}</TableCell>
                <TableCell className="text-xs">{run.trigger}</TableCell>
                <TableCell>
                  <Badge variant={statusVariant(run.status)}>{run.parked_reason ? `${run.status} (${run.parked_reason})` : run.status}</Badge>
                </TableCell>
                <TableCell className="text-right">{run.llm_calls ?? 0}</TableCell>
                <TableCell className="text-right">{costText(run)}</TableCell>
                <TableCell className="max-w-[12rem] break-words text-xs">{run.error ?? ''}</TableCell>
                <TableCell className="max-w-[24rem]">
                  <code className="block break-all text-xs">{compactJson(run.output)}</code>
                </TableCell>
              </TableRow>
            ))}
            {runs.data.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                  No runs yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
