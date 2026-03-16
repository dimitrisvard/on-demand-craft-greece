import React, { useState, useRef } from 'react';
import Papa from 'papaparse';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { Upload, GitBranch, Loader2, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface FollowUpRow {
  recipient_email: string;
  subject: string;
  body: string;
  delay_days: number;
  sequence_number: number;
}

interface Props {
  campaignId: string;
  onImported?: () => void;
}

const FollowUpImportDialog = ({ campaignId, onImported }: Props) => {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<FollowUpRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrors([]);
    setRows([]);

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const parseErrors: string[] = [];
        const parsed: FollowUpRow[] = [];

        result.data.forEach((row, idx) => {
          const email = row['recipient_email'] || row['email'] || row['Email'] || '';
          const subject = row['subject'] || row['Subject'] || '';
          const body = row['body'] || row['Body'] || row['content'] || '';
          const delayDays = parseInt(row['delay_days'] || row['delay'] || '3');
          const seqNum = parseInt(row['sequence_number'] || row['sequence'] || '2');

          if (!email) {
            parseErrors.push(`Row ${idx + 2}: Missing recipient_email`);
            return;
          }
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            parseErrors.push(`Row ${idx + 2}: Invalid email "${email}"`);
            return;
          }
          if (!subject) {
            parseErrors.push(`Row ${idx + 2}: Missing subject`);
            return;
          }
          if (!body) {
            parseErrors.push(`Row ${idx + 2}: Missing body`);
            return;
          }
          if (isNaN(delayDays) || delayDays < 1) {
            parseErrors.push(`Row ${idx + 2}: delay_days must be >= 1`);
            return;
          }
          if (isNaN(seqNum) || seqNum < 2) {
            parseErrors.push(`Row ${idx + 2}: sequence_number must be >= 2 (1 is the initial email)`);
            return;
          }

          parsed.push({
            recipient_email: email,
            subject,
            body,
            delay_days: delayDays,
            sequence_number: seqNum,
          });
        });

        if (parseErrors.length > 0 && parsed.length === 0) {
          setErrors(parseErrors);
        } else {
          if (parseErrors.length > 0) setErrors(parseErrors);
          setRows(parsed);
        }
      },
      error: (err) => {
        setErrors([`Failed to parse CSV: ${err.message}`]);
      },
    });
  };

  const handleImport = async () => {
    if (rows.length === 0) {
      toast.error('No valid rows to import');
      return;
    }

    setIsImporting(true);
    try {
      // Resolve emails to subscriber IDs, validate they exist in this campaign's recipients or subscribers
      const subscriberMap = new Map<string, string>();

      const uniqueEmails = [...new Set(rows.map((r) => r.recipient_email))];

      for (const email of uniqueEmails) {
        const { data: subscriber } = await supabase
          .from('marketing_subscribers')
          .select('id')
          .eq('email', email)
          .maybeSingle();

        if (!subscriber) {
          toast.error(`Email not found in subscribers: ${email}`);
          setIsImporting(false);
          return;
        }
        subscriberMap.set(email, subscriber.id);
      }

      // Insert follow-up records
      const followUps = rows
        .map((row) => {
          const subscriberId = subscriberMap.get(row.recipient_email);
          if (!subscriberId) return null;
          return {
            campaign_id: campaignId,
            subscriber_id: subscriberId,
            custom_subject: row.subject,
            custom_body: row.body,
            sequence_number: row.sequence_number,
            delay_days: row.delay_days,
            status: 'pending',
          };
        })
        .filter(Boolean);

      const { error } = await supabase
        .from('marketing_campaign_recipients')
        .insert(followUps);

      if (error) throw error;

      toast.success(`Imported ${followUps.length} follow-up emails`);
      setOpen(false);
      setRows([]);
      setErrors([]);
      onImported?.();
    } catch (error: any) {
      console.error('Follow-up import error:', error);
      toast.error(`Import failed: ${error.message}`);
    } finally {
      setIsImporting(false);
    }
  };

  const handleClose = () => {
    setOpen(false);
    setRows([]);
    setErrors([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); else setOpen(true); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <GitBranch className="w-4 h-4 mr-2" /> Import Follow-ups
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="w-5 h-5" /> Import Follow-up Emails
          </DialogTitle>
          <DialogDescription>
            Import follow-up emails for existing campaign recipients.
            CSV columns: <code>recipient_email, subject, body, delay_days, sequence_number</code>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 flex-1 overflow-hidden">
          <div className="p-3 bg-muted rounded-lg text-xs text-muted-foreground">
            <p className="font-medium mb-1">CSV Format Example:</p>
            <code>recipient_email,subject,body,delay_days,sequence_number</code><br />
            <code>john@example.com,Following up,&lt;p&gt;Hi John...&lt;/p&gt;,3,2</code><br />
            <code>john@example.com,Last check-in,&lt;p&gt;Just checking...&lt;/p&gt;,7,3</code>
          </div>

          <div className="space-y-2">
            <Label>CSV File</Label>
            <div
              className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Click to upload CSV</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
          </div>

          {errors.length > 0 && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <ul className="list-disc pl-4 space-y-1 text-xs">
                  {errors.slice(0, 5).map((err, i) => <li key={i}>{err}</li>)}
                  {errors.length > 5 && <li>...and {errors.length - 5} more</li>}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {rows.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Preview ({rows.length} follow-ups)</Label>
                <span className="text-xs text-muted-foreground">Showing first 5</span>
              </div>
              <ScrollArea className="h-[200px] border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Subject</TableHead>
                      <TableHead>Delay</TableHead>
                      <TableHead>Seq #</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.slice(0, 5).map((row, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs">{row.recipient_email}</TableCell>
                        <TableCell className="text-xs max-w-[150px] truncate">{row.subject}</TableCell>
                        <TableCell className="text-xs">+{row.delay_days} days</TableCell>
                        <TableCell className="text-xs">#{row.sequence_number}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>
          )}
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button
            onClick={handleImport}
            disabled={rows.length === 0 || isImporting}
          >
            {isImporting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Import {rows.length > 0 ? `(${rows.length} follow-ups)` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default FollowUpImportDialog;
