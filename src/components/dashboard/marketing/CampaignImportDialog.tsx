import React, { useState, useRef } from 'react';
import Papa from 'papaparse';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { Upload, FileSpreadsheet, Loader2, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface CsvRow {
  recipient_email: string;
  recipient_name?: string;
  subject: string;
  body: string;
}

interface Props {
  onImported?: () => void;
}

const CampaignImportDialog = ({ onImported }: Props) => {
  const [open, setOpen] = useState(false);
  const [campaignName, setCampaignName] = useState('');
  const [rows, setRows] = useState<CsvRow[]>([]);
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
        const parsed: CsvRow[] = [];

        result.data.forEach((row, idx) => {
          const email = row['recipient_email'] || row['email'] || row['Email'] || '';
          const name = row['recipient_name'] || row['name'] || row['Name'] || '';
          const subject = row['subject'] || row['Subject'] || '';
          const body = row['body'] || row['Body'] || row['content'] || row['Content'] || '';

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

          parsed.push({ recipient_email: email, recipient_name: name, subject, body });
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
    if (!campaignName.trim()) {
      toast.error('Please enter a campaign name');
      return;
    }
    if (rows.length === 0) {
      toast.error('No valid rows to import');
      return;
    }

    setIsImporting(true);
    try {
      // 1. Create campaign
      const { data: campaign, error: campaignError } = await supabase
        .from('marketing_campaigns')
        .insert({
          name: campaignName.trim(),
          subject_a: rows[0].subject,
          body: 'csv_import',
          status: 'draft',
          target_tags: [],
        })
        .select()
        .single();

      if (campaignError) throw campaignError;

      // 2. Upsert subscribers and collect IDs
      const subscriberMap = new Map<string, string>();

      for (const row of rows) {
        const { data: existing } = await supabase
          .from('marketing_subscribers')
          .select('id')
          .eq('email', row.recipient_email)
          .maybeSingle();

        if (existing) {
          subscriberMap.set(row.recipient_email, existing.id);
        } else {
          const { data: newSub, error: subError } = await supabase
            .from('marketing_subscribers')
            .insert({
              email: row.recipient_email,
              name: row.recipient_name || null,
              status: 'active',
              tags: [],
            })
            .select('id')
            .single();

          if (subError) {
            console.error(`Failed to upsert ${row.recipient_email}:`, subError);
            continue;
          }
          subscriberMap.set(row.recipient_email, newSub.id);
        }
      }

      // 3. Create campaign recipients with custom content
      const recipients = rows
        .map((row) => {
          const subscriberId = subscriberMap.get(row.recipient_email);
          if (!subscriberId) return null;
          return {
            campaign_id: campaign.id,
            subscriber_id: subscriberId,
            custom_subject: row.subject,
            custom_body: row.body,
            sequence_number: 1,
            delay_days: 0,
            status: 'pending',
          };
        })
        .filter(Boolean);

      if (recipients.length > 0) {
        const { error: recipientsError } = await supabase
          .from('marketing_campaign_recipients')
          .insert(recipients);

        if (recipientsError) throw recipientsError;
      }

      toast.success(`Campaign "${campaignName}" created with ${recipients.length} recipients`);
      setOpen(false);
      setCampaignName('');
      setRows([]);
      setErrors([]);
      onImported?.();
    } catch (error: any) {
      console.error('Import error:', error);
      toast.error(`Import failed: ${error.message}`);
    } finally {
      setIsImporting(false);
    }
  };

  const handleClose = () => {
    setOpen(false);
    setCampaignName('');
    setRows([]);
    setErrors([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); else setOpen(true); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Upload className="w-4 h-4 mr-2" /> Import Campaign
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5" /> Import Campaign from CSV
          </DialogTitle>
          <DialogDescription>
            Import a campaign with personalized content per recipient.
            CSV columns: <code>recipient_email, recipient_name, subject, body</code>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 flex-1 overflow-hidden">
          <div className="space-y-2">
            <Label>Campaign Name</Label>
            <Input
              value={campaignName}
              onChange={(e) => setCampaignName(e.target.value)}
              placeholder="e.g. Personalized Outreach - March 2026"
            />
          </div>

          <div className="space-y-2">
            <Label>CSV File</Label>
            <div
              className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Click to upload CSV</p>
              <p className="text-xs text-muted-foreground mt-1">
                Required columns: recipient_email, subject, body
              </p>
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
                  {errors.length > 5 && <li>...and {errors.length - 5} more errors</li>}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {rows.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Preview ({rows.length} recipients)</Label>
                <span className="text-xs text-muted-foreground">Showing first 5</span>
              </div>
              <ScrollArea className="h-[200px] border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Subject</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.slice(0, 5).map((row, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs">{row.recipient_email}</TableCell>
                        <TableCell className="text-xs">{row.recipient_name || '-'}</TableCell>
                        <TableCell className="text-xs max-w-[200px] truncate">{row.subject}</TableCell>
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
            disabled={rows.length === 0 || !campaignName.trim() || isImporting}
          >
            {isImporting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Import {rows.length > 0 ? `(${rows.length} recipients)` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CampaignImportDialog;
