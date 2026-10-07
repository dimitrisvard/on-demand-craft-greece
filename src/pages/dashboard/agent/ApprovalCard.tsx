// One waiting approval (agent_runs row with a card) on the Approvals page and in the RFQ inbox drawer.
//
// Rules
//   - The card shows output.card as stored by microns-ops: business fields only, rendered as text.
//   - One button per verb of output.allowed_verbs, labelled as on Telegram. A decision sends run_id + token_sha256
//     (as read under staff RLS) with the verb; the buttons are disabled until the agent API answered the status probe.
//   - Quote approvals open the editor (prices, shipping, texts, PDF preview); verbs that need input elsewhere
//     (change_partner) are shown disabled with a hint.
//   - 409 (decided elsewhere, or the card was replaced by a reminder) and 422 reload the list; every outcome is shown
//     as a toast.
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { VERB_LABELS, type AgentRunRow } from '@/types/agent';
import { dashboardDecision, describeAgentError, type AgentApiClient } from '@/utils/agentApi';
import { QuoteApprovalEditor } from './QuoteApprovalEditor';

/** Verbs that need input on another page; shown disabled with this hint. */
const INPUT_VERBS: Readonly<Record<string, string>> = {
  change_partner: 'Change the partner on the order page',
};

const FLAG_LABELS: Readonly<Record<string, string>> = {
  dmarc_fail: 'DMARC failed',
  injection_suspected: 'Injection suspected',
  low_confidence: 'Low confidence',
  flag_off: 'Agent off',
  manual_lines: 'Manual price lines',
};

function formatTime(value: string | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

export interface ApprovalCardProps {
  run: AgentRunRow;
  /** The agent API client, or null while it is not available (buttons disabled). */
  api: AgentApiClient | null;
  /** Highlight (deep link ?run=<id>). */
  highlighted?: boolean;
  /** Reload the lists after a decision or a refusal that means the card changed. */
  onChanged: () => void;
}

export function ApprovalCard({ run, api, highlighted = false, onChanged }: ApprovalCardProps) {
  const [editorOpen, setEditorOpen] = useState(false);
  const output = run.output ?? {};
  const card = output.card;
  const kind = output.card_kind ?? card?.kind;
  const verbs = Array.isArray(output.allowed_verbs) ? output.allowed_verbs : (card?.allowed_verbs ?? []);
  const title = card?.title ?? `${run.agent} run`;

  const decide = useMutation({
    mutationFn: (verb: string) => {
      if (!api) throw new Error('Agent API unavailable');
      return api.decide(dashboardDecision(run, verb));
    },
    onSuccess: (result) => {
      toast.success(result.label);
      onChanged();
    },
    onError: (error) => {
      const message = describeAgentError(error);
      toast.error(message.title);
      if (message.refetch) onChanged();
    },
  });

  const disabled = !api || decide.isPending || !run.approval_token_sha256;

  return (
    <Card data-testid="approval-card" data-run-id={run.id} className={highlighted ? 'ring-2 ring-primary' : undefined}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{title}</CardTitle>
          <div className="flex flex-wrap gap-1">
            {kind && <Badge variant="secondary">{kind}</Badge>}
            <Badge variant="outline">{run.agent}</Badge>
          </div>
        </div>
        <CardDescription>Waiting since {formatTime(run.updated_at ?? run.started_at)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {card?.lines && card.lines.length > 0 && (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
            {card.lines.map((line, i) => (
              <div key={`${line.label}-${i}`} className="contents">
                <dt className="text-muted-foreground">{line.label}</dt>
                <dd className="break-words">{line.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {card?.flags && card.flags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {card.flags.map((f) => (
              <Badge key={f} variant="destructive">
                {FLAG_LABELS[f] ?? f}
              </Badge>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {verbs.map((verb) => {
            if (INPUT_VERBS[verb]) {
              return (
                <Button key={verb} size="sm" variant="outline" disabled title={INPUT_VERBS[verb]}>
                  {VERB_LABELS[verb] ?? verb}
                </Button>
              );
            }
            if (kind === 'quote' && verb === 'approve') {
              return (
                <Button key={verb} size="sm" disabled={disabled} onClick={() => setEditorOpen(true)} data-testid="verb-approve-review">
                  Review and approve
                </Button>
              );
            }
            return (
              <Button
                key={verb}
                size="sm"
                variant={verb === 'reject' || verb === 'not_rfq' || verb === 'dismiss' ? 'outline' : 'default'}
                disabled={disabled}
                onClick={() => decide.mutate(verb)}
                data-testid={`verb-${verb}`}
              >
                {VERB_LABELS[verb] ?? verb}
              </Button>
            );
          })}
        </div>
      </CardContent>
      {kind === 'quote' && (
        <QuoteApprovalEditor
          run={run}
          api={api}
          open={editorOpen}
          onOpenChange={setEditorOpen}
          onDecided={() => {
            setEditorOpen(false);
            onChanged();
          }}
        />
      )}
    </Card>
  );
}
