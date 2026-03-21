import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { Globe, Search, UserPlus, Loader2, Trash2, Upload, CheckCircle2 } from 'lucide-react';

interface ScrapeResult {
  url: string;
  status: 'success' | 'error' | 'no_emails' | 'pending';
  emails: string[];
  companyName: string | null;
  error?: string;
  added?: boolean;
}

const EmailScraperView = () => {
  const [mode, setMode] = useState<'single' | 'bulk'>('single');
  const [singleUrl, setSingleUrl] = useState('');
  const [bulkUrls, setBulkUrls] = useState('');
  const [results, setResults] = useState<ScrapeResult[]>([]);
  const queryClient = useQueryClient();

  const bulkUrlList = bulkUrls
    .split('\n')
    .map(u => u.trim())
    .filter(u => u.length > 0);

  // Scrape mutation
  const scrapeMutation = useMutation({
    mutationFn: async (urls: string[]) => {
      // Normalize URLs - add https:// if missing
      const normalizedUrls = urls.map(url => {
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          return 'https://' + url;
        }
        return url;
      });

      const response = await fetch('/api/scrape-website', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: normalizedUrls }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Scrape request failed');
      }

      return response.json();
    },
    onSuccess: (data) => {
      setResults(data.results);
      const found = data.results.filter(
        (r: ScrapeResult) => r.status === 'success' && r.emails.length > 0
      );
      if (found.length > 0) {
        toast.success(`Found emails on ${found.length} of ${data.results.length} website(s)`);
      } else {
        toast.info('No emails found on the scanned website(s)');
      }
    },
    onError: (error: Error) => {
      toast.error('Scraping failed: ' + error.message);
    },
  });

  // Add to contacts mutation
  const addContactMutation = useMutation({
    mutationFn: async (result: ScrapeResult) => {
      let hostname = '';
      try {
        hostname = new URL(result.url).hostname.replace(/^www\./, '');
      } catch {
        hostname = 'unknown';
      }

      for (const email of result.emails) {
        // Check if subscriber already exists
        const { data: existing } = await supabase
          .from('marketing_subscribers')
          .select('id')
          .eq('email', email)
          .maybeSingle();

        if (existing) {
          toast.info(`${email} already exists in subscribers`);
          continue;
        }

        const { error } = await supabase
          .from('marketing_subscribers')
          .insert({
            email,
            name: result.companyName || null,
            tags: ['scraped', hostname],
            status: 'active',
          });

        if (error) throw error;
      }
    },
    onSuccess: (_, result) => {
      queryClient.invalidateQueries({ queryKey: ['subscribers'] });
      // Mark as added in local state
      setResults(prev =>
        prev.map(r => (r.url === result.url ? { ...r, added: true } : r))
      );
      toast.success('Contact(s) added to subscribers');
    },
    onError: (error: Error) => {
      toast.error('Failed to add contact: ' + error.message);
    },
  });

  const handleSingleScan = () => {
    if (!singleUrl.trim()) return;
    scrapeMutation.mutate([singleUrl.trim()]);
  };

  const handleBulkScan = () => {
    if (bulkUrlList.length === 0) return;
    if (bulkUrlList.length > 25) {
      toast.error('Maximum 25 URLs at a time');
      return;
    }
    scrapeMutation.mutate(bulkUrlList);
  };

  const handleAddAll = async () => {
    const successResults = results.filter(
      r => r.status === 'success' && r.emails.length > 0 && !r.added
    );
    for (const result of successResults) {
      await addContactMutation.mutateAsync(result);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && mode === 'single') {
      e.preventDefault();
      handleSingleScan();
    }
  };

  const successCount = results.filter(r => r.status === 'success').length;
  const totalEmails = results.reduce((sum, r) => sum + r.emails.length, 0);
  const addableResults = results.filter(
    r => r.status === 'success' && r.emails.length > 0 && !r.added
  );

  return (
    <div className="space-y-4">
      {/* Input Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Website Email Scraper
          </CardTitle>
          <CardDescription>
            Enter website URLs to find company email addresses and names. Tip: try /contact or /about pages for best results.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Mode Toggle */}
          <div className="flex gap-2">
            <Button
              variant={mode === 'single' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('single')}
            >
              <Search className="mr-2 h-4 w-4" />
              Single URL
            </Button>
            <Button
              variant={mode === 'bulk' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('bulk')}
            >
              <Upload className="mr-2 h-4 w-4" />
              Bulk Import
            </Button>
          </div>

          {mode === 'single' ? (
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  placeholder="https://example.com/contact"
                  value={singleUrl}
                  onChange={e => setSingleUrl(e.target.value)}
                  onKeyDown={handleKeyDown}
                />
              </div>
              <Button
                onClick={handleSingleScan}
                disabled={!singleUrl.trim() || scrapeMutation.isPending}
              >
                {scrapeMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Search className="mr-2 h-4 w-4" />
                )}
                Scan Website
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <Label htmlFor="bulk-urls">
                  Paste URLs (one per line)
                  {bulkUrlList.length > 0 && (
                    <Badge variant="secondary" className="ml-2">
                      {bulkUrlList.length} URL{bulkUrlList.length !== 1 ? 's' : ''}
                    </Badge>
                  )}
                </Label>
                <Textarea
                  id="bulk-urls"
                  placeholder={"https://company1.com/contact\nhttps://company2.com/about\nhttps://company3.com"}
                  value={bulkUrls}
                  onChange={e => setBulkUrls(e.target.value)}
                  rows={6}
                  className="mt-1.5 font-mono text-sm"
                />
              </div>
              <Button
                onClick={handleBulkScan}
                disabled={bulkUrlList.length === 0 || scrapeMutation.isPending}
              >
                {scrapeMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Search className="mr-2 h-4 w-4" />
                )}
                Scan All ({bulkUrlList.length})
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Results Section */}
      {results.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Scan Results</CardTitle>
                <CardDescription>
                  Found {totalEmails} email{totalEmails !== 1 ? 's' : ''} across {successCount} website{successCount !== 1 ? 's' : ''}
                </CardDescription>
              </div>
              <div className="flex gap-2">
                {addableResults.length > 0 && (
                  <Button
                    onClick={handleAddAll}
                    disabled={addContactMutation.isPending}
                    size="sm"
                  >
                    {addContactMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <UserPlus className="mr-2 h-4 w-4" />
                    )}
                    Add All to Contacts ({addableResults.length})
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setResults([])}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Clear
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[250px]">Website</TableHead>
                  <TableHead>Company Name</TableHead>
                  <TableHead>Emails Found</TableHead>
                  <TableHead className="w-[100px]">Status</TableHead>
                  <TableHead className="w-[150px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((result, index) => (
                  <TableRow key={index}>
                    <TableCell className="font-mono text-xs truncate max-w-[250px]" title={result.url}>
                      {result.url}
                    </TableCell>
                    <TableCell>
                      {result.companyName || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      {result.emails.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {result.emails.map((email, i) => (
                            <Badge key={i} variant="secondary" className="text-xs">
                              {email}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">None</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {result.status === 'success' && (
                        <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                          Found
                        </Badge>
                      )}
                      {result.status === 'no_emails' && (
                        <Badge variant="secondary">No emails</Badge>
                      )}
                      {result.status === 'error' && (
                        <Badge variant="destructive" title={result.error}>
                          Error
                        </Badge>
                      )}
                      {result.status === 'pending' && (
                        <Badge variant="outline">
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                          Scanning
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {result.status === 'success' && result.emails.length > 0 && (
                        result.added ? (
                          <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                            <CheckCircle2 className="mr-1 h-3 w-3" />
                            Added
                          </Badge>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => addContactMutation.mutate(result)}
                            disabled={addContactMutation.isPending}
                          >
                            <UserPlus className="mr-1 h-3 w-3" />
                            Add
                          </Button>
                        )
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default EmailScraperView;
