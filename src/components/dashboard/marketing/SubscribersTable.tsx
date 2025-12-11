import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Upload, Download, Trash2, Search, Loader2 } from 'lucide-react';
import Papa, { ParseResult } from 'papaparse';
import AddSubscriberDialog from './AddSubscriberDialog';

// Define the type to match Supabase's generated type for marketing_subscribers
interface Subscriber {
  id: string;
  email: string;
  name: string | null;
  tags: any | null; // Using any for JSON type flexibility
  status: string | null;
  created_at: string;
  updated_at: string;
}

const SubscribersTable = () => {
  const [search, setSearch] = useState('');
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [listName, setListName] = useState('');
  const queryClient = useQueryClient();

  // Fetch subscribers
  const { data: subscribers, isLoading } = useQuery({
    queryKey: ['subscribers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('marketing_subscribers')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as Subscriber[];
    },
  });

  // Import mutation
  const importMutation = useMutation({
    mutationFn: async (rows: any[]) => {
      // Format data for insertion
      const formattedData = rows.map((row) => {
        // Handle tags properly - they should be an array of strings for JSONB
        let rowTags: string[] = [];
        
        // Handle CSV tags which might be comma separated string or array
        const rawTags = row.tags || row.Tags || row.TAGS;
        
        if (Array.isArray(rawTags)) {
            rowTags = rawTags;
        } else if (typeof rawTags === 'string') {
            rowTags = rawTags.split(',').map((t: string) => t.trim()).filter(Boolean);
        }

        // Add list name to tags if provided
        if (listName && !rowTags.includes(listName)) {
            rowTags.push(listName);
        }
        
        return {
            email: row.email || row.Email || row['E-mail'] || row['e-mail'],
            name: row.name || row.Name || row['Full Name'],
            tags: rowTags, // Pass as array, Supabase handles conversion to JSONB
            status: 'active',
        };
      }).filter(row => row.email); // Ensure email exists

      const { error } = await supabase
        .from('marketing_subscribers')
        .upsert(formattedData, { onConflict: 'email', ignoreDuplicates: false });

      if (error) throw error;
      return formattedData.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['subscribers'] });
      setIsImportOpen(false);
      toast.success(`Successfully imported ${count} subscribers`);
      setImporting(false);
      setListName(''); // Clear list name after successful import
    },
    onError: (error) => {
      console.error('Import error:', error);
      toast.error('Failed to import subscribers');
      setImporting(false);
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('marketing_subscribers')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscribers'] });
      toast.success('Subscriber removed');
    },
  });

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImporting(true);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim(), // Trim headers to avoid mismatch
      complete: (results: ParseResult<any>) => {
        if (results.errors.length > 0) {
            console.warn("CSV Parse Warnings:", results.errors);
            // Filter out duplicate header errors if they are not critical
            // Using loose comparison for error codes as types might vary
            const criticalErrors = results.errors.filter((e: any) => e.code !== 'TooManyFields' && e.code !== 'NotEnoughFields');
            if(criticalErrors.length > 0) {
                 toast.warning(`CSV parsed with ${criticalErrors.length} warnings. check console.`);
            }
        }
        importMutation.mutate(results.data);
      },
      error: (error) => {
        console.error('CSV Parse Error:', error);
        toast.error('Failed to parse CSV file');
        setImporting(false);
      },
    });
  };

  const filteredSubscribers = subscribers?.filter(sub => 
    sub.email.toLowerCase().includes(search.toLowerCase()) || 
    (sub.name && sub.name.toLowerCase().includes(search.toLowerCase()))
  ) || [];

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search subscribers..."
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <AddSubscriberDialog />
          <Dialog open={isImportOpen} onOpenChange={setIsImportOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Upload className="mr-2 h-4 w-4" /> Import CSV
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Import Subscribers</DialogTitle>
                <DialogDescription>
                  Upload a CSV file with columns: email, name (optional), tags (optional).
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="listName" className="text-right">
                    List Name
                  </Label>
                  <Input
                    id="listName"
                    placeholder="e.g. Newsletter Jan 2025"
                    value={listName}
                    onChange={(e) => setListName(e.target.value)}
                    className="col-span-3"
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="csv" className="text-right">
                    CSV File
                  </Label>
                  <Input
                    id="csv"
                    type="file"
                    accept=".csv"
                    onChange={handleFileUpload}
                    className="col-span-3"
                    disabled={importing}
                  />
                </div>
              </div>
              <DialogFooter>
                 {importing && <span className="text-sm text-muted-foreground flex items-center"><Loader2 className="mr-2 h-3 w-3 animate-spin"/> Importing...</span>}
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Tags</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredSubscribers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  No subscribers found.
                </TableCell>
              </TableRow>
            ) : (
              filteredSubscribers.map((subscriber) => (
                <TableRow key={subscriber.id}>
                  <TableCell className="font-medium">{subscriber.name || '-'}</TableCell>
                  <TableCell>{subscriber.email}</TableCell>
                  <TableCell>
                    <Badge variant={subscriber.status === 'active' ? 'default' : 'secondary'}>
                      {subscriber.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {/* Handle JSONB tags which might be string or array */}
                      {Array.isArray(subscriber.tags) && subscriber.tags.map((tag: string, i: number) => (
                        <Badge key={i} variant="outline" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button 
                        variant="ghost" 
                        size="icon" 
                        onClick={() => {
                            if(confirm('Are you sure you want to delete this subscriber?')) {
                                deleteMutation.mutate(subscriber.id);
                            }
                        }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <div className="text-sm text-muted-foreground text-center">
        Showing {filteredSubscribers.length} of {subscribers?.length || 0} subscribers
      </div>
    </div>
  );
};

export default SubscribersTable;
