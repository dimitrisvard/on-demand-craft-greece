import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { Plus, Eye, Copy, Trash2, FileText, ChevronLeft, ChevronRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { RFQ } from '@/types/customer';

type RfqStatus = RFQ['status'];

const STATUS_CONFIG: Record<RfqStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; className: string }> = {
  draft: { label: 'Draft', variant: 'secondary', className: 'bg-gray-100 text-gray-700 hover:bg-gray-100' },
  sent: { label: 'Quoted', variant: 'default', className: 'bg-blue-100 text-blue-700 hover:bg-blue-100' },
  received: { label: 'Under Review', variant: 'default', className: 'bg-orange-100 text-orange-700 hover:bg-orange-100' },
  approved: { label: 'Approved', variant: 'default', className: 'bg-green-100 text-green-700 hover:bg-green-100' },
  rejected: { label: 'Rejected', variant: 'destructive', className: 'bg-red-100 text-red-700 hover:bg-red-100' },
};

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

export default function MyProjectsPage() {
  const [rfqs, setRfqs] = useState<RFQ[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('quotes');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(10);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    fetchRfqs();
  }, []);

  // Reset to page 1 when tab or page size changes
  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, pageSize]);

  const fetchRfqs = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('rfqs')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setRfqs((data as unknown as RFQ[]) || []);
    } catch (err: any) {
      toast({ title: 'Error loading projects', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleDuplicate = async (rfq: RFQ) => {
    try {
      const { id, created_at, updated_at, rfq_number, ...rest } = rfq;
      const { error } = await supabase.from('rfqs').insert({
        ...rest,
        title: `${rfq.title} (Copy)`,
        status: 'draft',
      });
      if (error) throw error;
      toast({ title: 'Quote duplicated', description: 'A copy has been created as a draft.' });
      fetchRfqs();
    } catch (err: any) {
      toast({ title: 'Error duplicating quote', description: err.message, variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase.from('rfqs').delete().eq('id', id);
      if (error) throw error;
      setRfqs((prev) => prev.filter((r) => r.id !== id));
      toast({ title: 'Quote deleted' });
    } catch (err: any) {
      toast({ title: 'Error deleting quote', description: err.message, variant: 'destructive' });
    } finally {
      setDeleteConfirmId(null);
    }
  };

  // Filter RFQs by tab
  const filteredRfqs = rfqs.filter((rfq) => {
    switch (activeTab) {
      case 'quotes':
        return ['draft', 'sent', 'received'].includes(rfq.status);
      case 'ordered':
        return rfq.status === 'approved';
      case 'completed':
        return rfq.status === 'rejected'; // placeholder until a completed status exists
      default:
        return true;
    }
  });

  // Pagination
  const totalItems = filteredRfqs.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedRfqs = filteredRfqs.slice((safePage - 1) * pageSize, safePage * pageSize);

  const getManufacturingProcess = (rfq: RFQ): string | null => {
    if (!rfq.parts_details || rfq.parts_details.length === 0) return null;
    const first = rfq.parts_details[0];
    return first.product_name || null;
  };

  const renderStatusBadge = (status: RfqStatus) => {
    const config = STATUS_CONFIG[status];
    return (
      <Badge variant={config.variant} className={config.className}>
        {config.label}
      </Badge>
    );
  };

  const renderEmptyState = () => (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="rounded-full bg-muted p-6 mb-6">
        <FileText className="h-12 w-12 text-muted-foreground" />
      </div>
      <h3 className="text-xl font-semibold mb-2">No quotes yet</h3>
      <p className="text-muted-foreground mb-6 max-w-md">
        Get started by requesting a quote for your manufacturing project. Upload your CAD files and receive competitive pricing.
      </p>
      <Button asChild className="bg-accent hover:bg-accent/90 text-accent-foreground">
        <Link to="/quote">
          <Plus className="mr-2 h-4 w-4" />
          Start New Quote
        </Link>
      </Button>
    </div>
  );

  const renderQuoteCard = (rfq: RFQ) => {
    const process = getManufacturingProcess(rfq);
    const isDeleteConfirm = deleteConfirmId === rfq.id;

    return (
      <Card key={rfq.id} className="mb-3 transition-shadow hover:shadow-md">
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            {/* Left section: ID, date, status */}
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-3 flex-wrap">
                <Link
                  to={`/customer/quotes/${rfq.id}`}
                  className="text-base font-semibold text-primary hover:underline truncate"
                >
                  {rfq.rfq_number || rfq.title || `Quote ${rfq.id.slice(0, 8)}`}
                </Link>
                {renderStatusBadge(rfq.status)}
              </div>

              <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                <span>
                  Updated {rfq.updated_at ? format(new Date(rfq.updated_at), 'MMM dd, yyyy') : format(new Date(rfq.created_at), 'MMM dd, yyyy')}
                </span>
                {process && (
                  <>
                    <span className="hidden sm:inline">·</span>
                    <span>{process}</span>
                  </>
                )}
              </div>
            </div>

            {/* Right section: total + actions */}
            <div className="flex items-center gap-4 sm:gap-6 flex-shrink-0">
              <div className="text-right">
                <p className="text-lg font-semibold">
                  {new Intl.NumberFormat('de-DE', { style: 'currency', currency: rfq.currency || 'EUR' }).format(rfq.total_amount || 0)}
                </p>
              </div>

              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" asChild>
                  <Link to={`/customer/quotes/${rfq.id}`}>
                    <Eye className="h-4 w-4 mr-1" />
                    <span className="hidden sm:inline">View Details</span>
                  </Link>
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDuplicate(rfq)}
                  title="Duplicate"
                >
                  <Copy className="h-4 w-4" />
                </Button>

                {isDeleteConfirm ? (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleDelete(rfq.id)}
                    >
                      Confirm
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteConfirmId(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleteConfirmId(rfq.id)}
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderPagination = () => {
    if (totalItems <= PAGE_SIZE_OPTIONS[0]) return null;

    // Generate page numbers to display
    const pages: (number | 'ellipsis')[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (safePage > 3) pages.push('ellipsis');
      for (let i = Math.max(2, safePage - 1); i <= Math.min(totalPages - 1, safePage + 1); i++) {
        pages.push(i);
      }
      if (safePage < totalPages - 2) pages.push('ellipsis');
      pages.push(totalPages);
    }

    return (
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-6 pt-4 border-t">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Show</span>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="border rounded px-2 py-1 text-sm bg-background"
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
          <span>per page</span>
          <span className="ml-2">
            ({totalItems} total)
          </span>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={safePage <= 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          {pages.map((page, idx) =>
            page === 'ellipsis' ? (
              <span key={`ellipsis-${idx}`} className="px-2 text-muted-foreground">
                ...
              </span>
            ) : (
              <Button
                key={page}
                variant={page === safePage ? 'default' : 'outline'}
                size="sm"
                className="min-w-[36px]"
                onClick={() => setCurrentPage(page)}
              >
                {page}
              </Button>
            )
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage >= totalPages}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  };

  const renderTabContent = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      );
    }

    if (paginatedRfqs.length === 0) {
      return renderEmptyState();
    }

    return (
      <>
        {paginatedRfqs.map(renderQuoteCard)}
        {renderPagination()}
      </>
    );
  };

  const quotesCount = rfqs.filter((r) => ['draft', 'sent', 'received'].includes(r.status)).length;
  const orderedCount = rfqs.filter((r) => r.status === 'approved').length;
  const completedCount = rfqs.filter((r) => r.status === 'rejected').length;

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      {/* Page Header */}
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold tracking-tight">My Projects</h1>
        <Button asChild className="bg-accent hover:bg-accent/90 text-accent-foreground">
          <Link to="/quote">
            <Plus className="mr-2 h-4 w-4" />
            New Quote
          </Link>
        </Button>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="quotes">
            Quotes
            {quotesCount > 0 && (
              <span className="ml-1.5 text-xs bg-muted-foreground/20 rounded-full px-2 py-0.5">
                {quotesCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="ordered">
            Ordered
            {orderedCount > 0 && (
              <span className="ml-1.5 text-xs bg-muted-foreground/20 rounded-full px-2 py-0.5">
                {orderedCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="completed">
            Completed
            {completedCount > 0 && (
              <span className="ml-1.5 text-xs bg-muted-foreground/20 rounded-full px-2 py-0.5">
                {completedCount}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="quotes">{renderTabContent()}</TabsContent>
        <TabsContent value="ordered">{renderTabContent()}</TabsContent>
        <TabsContent value="completed">{renderTabContent()}</TabsContent>
      </Tabs>
    </div>
  );
}
