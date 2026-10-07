// Quote approval on the dashboard: the draft of a quote_workflows row (prices per line, shipping, the cover text)
// with optional edits, a preview of the stored PDF, and "Approve and send" / "Reject".
//
// Rules
//   - The editor reads the quote under staff RLS and never writes it: an approval is one decision
//     {verb: 'approve', edits} through /api/agent/decision, carrying only the values that changed. microns-ops checks
//     the edits again, re-prices from its own data and re-renders the PDF.
//   - Edits follow the limits decide() applies (validateQuoteEdits); refused values disable the approval.
//   - Totals here are for display only (quantity x unit price per line, plus shipping).
//   - Every text from the quote is rendered as text; the PDF is shown from an object URL that is revoked on close.
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { agentQueries, agentRetry, isNotInstalled } from '@/lib/agentDb';
import type { AgentRunRow, QuoteEdits, QuotePricingLine, QuoteWorkflowRow } from '@/types/agent';
import { dashboardDecision, describeAgentError, validateQuoteEdits, type AgentApiClient, type PreviewTarget } from '@/utils/agentApi';

/** A price as typed: a number with at most two decimals, '.' or ',' as separator; null when empty or not a number. */
function parsePrice(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (t === '' || !/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Number(t);
}

function money(value: number | null | undefined, currency: string): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${currency} ${value.toFixed(2)}` : 'open';
}

/** The edits a form state means: only values that differ from the stored draft. */
function editsFrom(
  lines: readonly QuotePricingLine[],
  prices: Readonly<Record<number, string>>,
  notes: Readonly<Record<number, string>>,
  shipping: { stored: number | null | undefined; text: string },
  drafts: { stored: { subject?: string; body_text?: string } | null | undefined; subject: string; body: string },
): { edits: QuoteEdits; invalid: string | null } {
  const overrides: NonNullable<QuoteEdits['overrides']> = [];
  for (const line of lines) {
    const text = prices[line.line_no] ?? '';
    const note = (notes[line.line_no] ?? '').trim();
    const stored = typeof line.unit_price === 'number' ? line.unit_price : null;
    if (text.trim() === '' && note === '') continue;
    const price = text.trim() === '' ? stored : parsePrice(text);
    if (price === null) return { edits: {}, invalid: `Line ${line.line_no}: enter a price like 12.50` };
    if (price !== stored || note !== '') overrides.push(note === '' ? { line_no: line.line_no, unit_price: price } : { line_no: line.line_no, unit_price: price, note });
  }
  const edits: QuoteEdits = {};
  if (overrides.length > 0) edits.overrides = overrides;
  if (shipping.text.trim() !== '') {
    const value = parsePrice(shipping.text);
    if (value === null) return { edits: {}, invalid: 'Shipping: enter an amount like 25.00' };
    if (value !== (shipping.stored ?? null)) edits.shipping = value;
  }
  const d: { subject?: string; body_text?: string } = {};
  if (drafts.stored && drafts.subject !== (drafts.stored.subject ?? '')) d.subject = drafts.subject;
  if (drafts.stored && drafts.body !== (drafts.stored.body_text ?? '')) d.body_text = drafts.body;
  if (d.subject !== undefined || d.body_text !== undefined) edits.drafts = d;
  return { edits, invalid: null };
}

export interface QuoteApprovalEditorProps {
  run: AgentRunRow;
  api: AgentApiClient | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDecided: () => void;
}

export function QuoteApprovalEditor({ run, api, open, onOpenChange, onDecided }: QuoteApprovalEditorProps) {
  const output = run.output ?? {};
  const quoteId = typeof output.quote_workflow_id === 'string' ? output.quote_workflow_id : run.subject_type === 'quote_workflow' ? (run.subject_id ?? null) : null;
  const quote = useQuery({
    queryKey: ['agent-quote', quoteId],
    queryFn: () => agentQueries.getQuoteWorkflow(quoteId as string),
    enabled: open && quoteId !== null,
    retry: agentRetry,
  });
  const row: QuoteWorkflowRow | null = quote.data ?? null;
  const lines = useMemo(() => row?.pricing?.lines ?? [], [row]);
  const currency = row?.pricing?.currency ?? row?.currency ?? 'EUR';

  const [prices, setPrices] = useState<Record<number, string>>({});
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [shipping, setShipping] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState<PreviewTarget | null>(null);

  useEffect(() => {
    if (!row) return;
    setPrices({});
    setNotes({});
    setShipping('');
    setSubject(row.drafts?.subject ?? '');
    setBody(row.drafts?.body_text ?? '');
  }, [row]);

  useEffect(() => () => preview?.revoke(), [preview]);

  const { edits, invalid } = editsFrom(lines, prices, notes, { stored: row?.pricing?.shipping, text: shipping }, { stored: row?.drafts, subject, body });
  const lineCount = lines.length || (typeof output.line_count === 'number' ? output.line_count : 0);
  const problem = invalid ?? validateQuoteEdits(edits, lineCount);

  const priceOf = (line: QuotePricingLine): number | null => {
    const typed = prices[line.line_no];
    if (typed !== undefined && typed.trim() !== '') return parsePrice(typed);
    return typeof line.unit_price === 'number' ? line.unit_price : null;
  };
  const shippingValue = shipping.trim() !== '' ? parsePrice(shipping) : (row?.pricing?.shipping ?? null);
  const unpriced = lines.filter((l) => priceOf(l) === null).length;
  const net = unpriced === 0 && lines.length > 0 ? lines.reduce((sum, l) => sum + (priceOf(l) ?? 0) * (l.qty ?? 0), 0) + (shippingValue ?? 0) : null;

  const decide = useMutation({
    mutationFn: (verb: 'approve' | 'reject') => {
      if (!api) throw new Error('Agent API unavailable');
      return api.decide(verb === 'approve' ? dashboardDecision(run, 'approve', { edits }) : dashboardDecision(run, 'reject'));
    },
    onSuccess: (result) => {
      toast.success(result.label);
      onDecided();
    },
    onError: (error) => {
      const message = describeAgentError(error);
      toast.error(message.title);
      if (message.refetch) onDecided();
    },
  });

  const openPreview = async () => {
    if (!api || !row?.quote_pdf_r2_key) return;
    try {
      setPreview(await api.previewFile(row.quote_pdf_r2_key));
    } catch (error) {
      toast.error(describeAgentError(error).title);
    }
  };

  const busy = decide.isPending;
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="quote-editor">
          <DialogHeader>
            <DialogTitle>{output.card?.title ?? 'Quote approval'}</DialogTitle>
            <DialogDescription>
              Check the prices, change what needs changing, then approve. Only changed values are sent; the PDF is rebuilt from them.
            </DialogDescription>
          </DialogHeader>
          {quote.isLoading && <Skeleton className="h-40 w-full" />}
          {quote.isError && <p className="text-sm text-destructive">{isNotInstalled(quote.error) ? 'The agent layer is not installed yet (database).' : 'The quote could not be loaded.'}</p>}
          {!quote.isLoading && !quote.isError && quoteId === null && <p className="text-sm text-muted-foreground">This card has no quote attached.</p>}
          {row && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="secondary">Version {row.quote_version}</Badge>
                <Badge variant="outline">{row.status}</Badge>
                {unpriced > 0 && <Badge variant="destructive">{unpriced} line(s) without a price</Badge>}
                {row.quote_pdf_r2_key && (
                  <Button size="sm" variant="outline" onClick={openPreview} disabled={!api}>
                    Preview PDF
                  </Button>
                )}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Part</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead>Suggested</TableHead>
                    <TableHead>Unit price</TableHead>
                    <TableHead>Note</TableHead>
                    <TableHead className="text-right">Line total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line) => {
                    const price = priceOf(line);
                    return (
                      <TableRow key={line.line_no}>
                        <TableCell>{line.line_no}</TableCell>
                        <TableCell className="max-w-[16rem]">
                          <div className="font-medium break-words">{line.product_name || '-'}</div>
                          <div className="text-xs text-muted-foreground break-words">{[line.material?.text, line.process].filter(Boolean).join(' · ')}</div>
                          {line.manual && line.manual_reasons && line.manual_reasons.length > 0 && <div className="text-xs text-destructive">{line.manual_reasons.join(', ')}</div>}
                        </TableCell>
                        <TableCell className="text-right">{line.qty ?? '-'}</TableCell>
                        <TableCell>{money(line.suggested_unit_price, currency)}</TableCell>
                        <TableCell>
                          <Input
                            aria-label={`Unit price of line ${line.line_no}`}
                            className="w-28"
                            inputMode="decimal"
                            placeholder={typeof line.unit_price === 'number' ? line.unit_price.toFixed(2) : 'price'}
                            value={prices[line.line_no] ?? ''}
                            onChange={(e) => setPrices((p) => ({ ...p, [line.line_no]: e.target.value }))}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            aria-label={`Note of line ${line.line_no}`}
                            className="w-40"
                            maxLength={500}
                            value={notes[line.line_no] ?? ''}
                            onChange={(e) => setNotes((n) => ({ ...n, [line.line_no]: e.target.value }))}
                          />
                        </TableCell>
                        <TableCell className="text-right">{money(price !== null && typeof line.qty === 'number' ? price * line.qty : null, currency)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="agent-quote-shipping">Shipping</Label>
                  <Input
                    id="agent-quote-shipping"
                    inputMode="decimal"
                    placeholder={typeof row.pricing?.shipping === 'number' ? row.pricing.shipping.toFixed(2) : 'amount'}
                    value={shipping}
                    onChange={(e) => setShipping(e.target.value)}
                  />
                </div>
                <div className="space-y-1 text-sm">
                  <div>Net total (display only): {money(net, currency)}</div>
                  <div className="text-muted-foreground">VAT and the final total are set on the quote.</div>
                </div>
              </div>
              {row.drafts && (
                <div className="space-y-2">
                  <div className="space-y-1">
                    <Label htmlFor="agent-quote-subject">E-mail subject</Label>
                    <Input id="agent-quote-subject" maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="agent-quote-body">E-mail text</Label>
                    <Textarea id="agent-quote-body" rows={8} maxLength={10_000} value={body} onChange={(e) => setBody(e.target.value)} />
                  </div>
                </div>
              )}
              {problem && (
                <p className="text-sm text-destructive" data-testid="quote-edit-problem">
                  {problem}
                </p>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" disabled={!api || busy || !run.approval_token_sha256} onClick={() => decide.mutate('reject')}>
              Reject
            </Button>
            <Button disabled={!api || busy || !row || problem !== null || !run.approval_token_sha256} onClick={() => decide.mutate('approve')} data-testid="quote-approve">
              Approve and send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={preview !== null}
        onOpenChange={(o) => {
          if (!o) setPreview(null);
        }}
      >
        <DialogContent className="max-w-5xl h-[90vh]">
          <DialogHeader>
            <DialogTitle>Quote PDF</DialogTitle>
          </DialogHeader>
          {preview && <iframe title="Quote PDF" src={preview.href} className="w-full h-full min-h-[70vh] border-0" />}
        </DialogContent>
      </Dialog>
    </>
  );
}
