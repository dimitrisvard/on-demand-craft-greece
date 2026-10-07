// "Agent switches" tab of the Approvals page: the feature_flags rows, their KV sync state, and (ADMIN only) edits of
// the agent flags.
//
// Rules
//   - Rows are read under staff RLS; edits go through POST /api/agent/flag with the rev the row was read at, so an
//     edit made meanwhile elsewhere answers 409 and the list reloads.
//   - Only agent.* and mcp.remote rows are editable, and only for an admin whose status probe allowed 'flag';
//     seo.* and api.* rows are infrastructure flags, shown read-only.
//   - 'mode' is offered only where the row's value has a mode; 'auto' is never offered for agent.quote and
//     agent.post_order (prices and partner sends always need an approval).
//   - Sync badge: "seed pending" while the one-time import from KV has not run, "in KV" when the stored rev was
//     mirrored, "pending" otherwise (the every-minute sync converges).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { agentQueries, agentRetry, isNotInstalled } from '@/lib/agentDb';
import { FLAG_EDIT_KEY_RE, type FeatureFlagRow, type FlagEditBody, type FlagMode } from '@/types/agent';
import { describeAgentError, type AgentApiClient } from '@/utils/agentApi';
import { NotInstalled } from './NotInstalled';

export const FLAGS_QUERY_KEY = ['agent-flags'] as const;

const NO_AUTO = new Set(['agent.quote', 'agent.post_order']);
const MODES: readonly FlagMode[] = ['shadow', 'assist', 'auto'];

function syncBadge(row: FeatureFlagRow) {
  if (row.kv_seed_pending) return <Badge variant="outline">seed pending</Badge>;
  if (row.kv_synced_rev === row.rev) return <Badge variant="secondary">in KV</Badge>;
  return <Badge variant="outline">pending</Badge>;
}

function modeOf(row: FeatureFlagRow): FlagMode | null {
  const mode = row.value?.mode;
  return mode === 'shadow' || mode === 'assist' || mode === 'auto' ? mode : null;
}

export function AgentSwitches({ api }: { api: AgentApiClient | null }) {
  const queryClient = useQueryClient();
  const flags = useQuery({ queryKey: FLAGS_QUERY_KEY, queryFn: () => agentQueries.listFlags(), retry: agentRetry });

  const edit = useMutation({
    mutationFn: (body: FlagEditBody) => {
      if (!api) throw new Error('Agent API unavailable');
      return api.editFlag(body);
    },
    onSuccess: (result) => {
      toast.success(result.kv === 'written' ? `${result.key} saved` : `${result.key} saved; KV sync pending`);
      void queryClient.invalidateQueries({ queryKey: FLAGS_QUERY_KEY });
    },
    onError: (error) => {
      const message = describeAgentError(error);
      toast.error(message.title);
      if (message.refetch) void queryClient.invalidateQueries({ queryKey: FLAGS_QUERY_KEY });
    },
  });

  if (flags.isLoading) return <Skeleton className="h-48 w-full" />;
  if (flags.isError) {
    return isNotInstalled(flags.error) ? <NotInstalled /> : <p className="text-sm text-destructive">The switches could not be loaded.</p>;
  }

  const send = (row: FeatureFlagRow, change: Partial<Pick<FlagEditBody, 'enabled' | 'mode' | 'writes'>>) => {
    const body: FlagEditBody = { v: 1, key: row.key, expected_rev: Number(row.rev), enabled: change.enabled ?? row.enabled };
    if (change.mode !== undefined) body.mode = change.mode;
    if (change.writes !== undefined) body.writes = change.writes;
    edit.mutate(body);
  };

  return (
    <div className="space-y-2">
      {!api?.canEditFlags && <p className="text-sm text-muted-foreground">Read-only: only an admin can change agent switches, and only while the agent API is available.</p>}
      <Table data-testid="agent-switches">
        <TableHeader>
          <TableRow>
            <TableHead>Flag</TableHead>
            <TableHead>On</TableHead>
            <TableHead>Mode</TableHead>
            <TableHead>Writes</TableHead>
            <TableHead>Sync</TableHead>
            <TableHead>Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(flags.data ?? []).map((row) => {
            const editable = Boolean(api?.canEditFlags) && FLAG_EDIT_KEY_RE.test(row.key) && !edit.isPending;
            const infrastructure = !FLAG_EDIT_KEY_RE.test(row.key);
            const mode = modeOf(row);
            return (
              <TableRow key={row.key} data-flag={row.key}>
                <TableCell>
                  <div className="font-mono text-sm">{row.key}</div>
                  {row.description && <div className="text-xs text-muted-foreground">{row.description}</div>}
                  {infrastructure && <div className="text-xs text-muted-foreground">Infrastructure flag, changed by the owner</div>}
                </TableCell>
                <TableCell>
                  <Switch aria-label={`${row.key} enabled`} checked={row.enabled} disabled={!editable} onCheckedChange={(checked) => send(row, { enabled: checked })} />
                </TableCell>
                <TableCell>
                  {mode ? (
                    <Select value={mode} disabled={!editable} onValueChange={(v) => send(row, { mode: v as FlagMode })}>
                      <SelectTrigger className="w-28" aria-label={`${row.key} mode`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MODES.map((m) => (
                          <SelectItem key={m} value={m} disabled={m === 'auto' && NO_AUTO.has(row.key)}>
                            {m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell>
                  {row.key === 'mcp.remote' ? (
                    <Switch aria-label="mcp.remote writes" checked={row.value?.writes === true} disabled={!editable} onCheckedChange={(checked) => send(row, { writes: checked })} />
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell>{syncBadge(row)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{row.updated_at ? new Date(row.updated_at).toLocaleString() : ''}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
