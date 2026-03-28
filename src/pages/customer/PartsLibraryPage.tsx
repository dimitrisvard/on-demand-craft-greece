import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Database, Search, Filter, RotateCcw, FileText, Plus, ChevronLeft, ChevronRight } from 'lucide-react';
import { format, subDays, subYears } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { RFQ, RfqItem } from '@/types/customer';

type RfqStatus = RFQ['status'];

interface FlattenedPart {
  part: RfqItem;
  rfqId: string;
  rfqNumber: string | undefined;
  rfqStatus: RfqStatus;
  rfqCreatedAt: string;
  rfqUpdatedAt: string | undefined;
}

const STATUS_CONFIG: Record<RfqStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; className: string }> = {
  draft: { label: 'Draft', variant: 'secondary', className: 'bg-gray-100 text-gray-700 hover:bg-gray-100' },
  sent: { label: 'Quoted', variant: 'default', className: 'bg-blue-100 text-blue-700 hover:bg-blue-100' },
  received: { label: 'Under Review', variant: 'default', className: 'bg-orange-100 text-orange-700 hover:bg-orange-100' },
  approved: { label: 'Approved', variant: 'default', className: 'bg-green-100 text-green-700 hover:bg-green-100' },
  rejected: { label: 'Rejected', variant: 'destructive', className: 'bg-red-100 text-red-700 hover:bg-red-100' },
};

const PROCESS_TYPES = [
  'CNC Milling',
  'Turning',
  'Laser Cutting',
  'Sheet Metal',
  '3D Printing',
  'Injection Molding',
] as const;

const DATE_RANGES = [
  { label: 'All Time', value: 'all' },
  { label: 'Last 7 days', value: '7' },
  { label: 'Last 30 days', value: '30' },
  { label: 'Last 90 days', value: '90' },
  { label: 'Last year', value: '365' },
] as const;

const SORT_OPTIONS = [
  { label: 'Updated', value: 'updated' },
  { label: 'Created', value: 'created' },
  { label: 'Name', value: 'name' },
] as const;

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

export default function PartsLibraryPage() {
  const [rfqs, setRfqs] = useState<RFQ[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [processFilter, setProcessFilter] = useState('all');
  const [dateRange, setDateRange] = useState('all');
  const [sortBy, setSortBy] = useState('updated');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(10);
  const { toast } = useToast();

  useEffect(() => {
    fetchRfqs();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, processFilter, dateRange, sortBy, pageSize]);

  const fetchRfqs = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('rfqs')
        .select('id, rfq_number, status, parts_details, created_at, updated_at')
        .order('updated_at', { ascending: false });

      if (error) throw error;
      setRfqs((data as unknown as RFQ[]) || []);
    } catch (err: any) {
      toast({ title: 'Error loading parts', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // Flatten all parts from all RFQs
  const allParts: FlattenedPart[] = useMemo(() => {
    const parts: FlattenedPart[] = [];
    for (const rfq of rfqs) {
      if (!rfq.parts_details || rfq.parts_details.length === 0) continue;
      for (const part of rfq.parts_details) {
        parts.push({
          part,
          rfqId: rfq.id,
          rfqNumber: rfq.rfq_number,
          rfqStatus: rfq.status,
          rfqCreatedAt: rfq.created_at,
          rfqUpdatedAt: rfq.updated_at,
        });
      }
    }
    return parts;
  }, [rfqs]);

  // Extract process from description or product_name
  const getProcess = (part: RfqItem): string | null => {
    const text = `${part.product_name || ''} ${part.description || ''}`.toLowerCase();
    for (const process of PROCESS_TYPES) {
      if (text.includes(process.toLowerCase())) return process;
    }
    return null;
  };

  // Extract material from description
  const getMaterial = (part: RfqItem): string | null => {
    const desc = part.description || '';
    if (!desc) return null;
    // Look for common material keywords
    const materialPatterns = [
      /aluminum/i, /steel/i, /stainless/i, /titanium/i, /brass/i,
      /copper/i, /plastic/i, /nylon/i, /abs/i, /pla/i, /peek/i,
      /delrin/i, /acetal/i, /polycarbonate/i, /inconel/i,
    ];
    for (const pattern of materialPatterns) {
      const match = desc.match(pattern);
      if (match) return match[0].charAt(0).toUpperCase() + match[0].slice(1);
    }
    return null;
  };

  // Filtered and sorted parts
  const filteredParts = useMemo(() => {
    let result = [...allParts];

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((fp) => {
        const partName = (fp.part.product_name || '').toLowerCase();
        const rfqNum = (fp.rfqNumber || '').toLowerCase();
        const description = (fp.part.description || '').toLowerCase();
        return partName.includes(q) || rfqNum.includes(q) || description.includes(q);
      });
    }

    // Process filter
    if (processFilter !== 'all') {
      result = result.filter((fp) => {
        const process = getProcess(fp.part);
        return process === processFilter;
      });
    }

    // Date range filter
    if (dateRange !== 'all') {
      const days = parseInt(dateRange, 10);
      const cutoff = days === 365 ? subYears(new Date(), 1) : subDays(new Date(), days);
      result = result.filter((fp) => {
        const date = new Date(fp.rfqUpdatedAt || fp.rfqCreatedAt);
        return date >= cutoff;
      });
    }

    // Sorting
    result.sort((a, b) => {
      switch (sortBy) {
        case 'updated': {
          const dateA = new Date(a.rfqUpdatedAt || a.rfqCreatedAt).getTime();
          const dateB = new Date(b.rfqUpdatedAt || b.rfqCreatedAt).getTime();
          return dateB - dateA;
        }
        case 'created': {
          const dateA = new Date(a.rfqCreatedAt).getTime();
          const dateB = new Date(b.rfqCreatedAt).getTime();
          return dateB - dateA;
        }
        case 'name':
          return (a.part.product_name || '').localeCompare(b.part.product_name || '');
        default:
          return 0;
      }
    });

    return result;
  }, [allParts, searchQuery, processFilter, dateRange, sortBy]);

  // Pagination
  const totalItems = filteredParts.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedParts = filteredParts.slice((safePage - 1) * pageSize, safePage * pageSize);

  const resetFilters = () => {
    setSearchQuery('');
    setProcessFilter('all');
    setDateRange('all');
    setSortBy('updated');
  };

  const hasActiveFilters = searchQuery || processFilter !== 'all' || dateRange !== 'all' || sortBy !== 'updated';

  const renderStatusBadge = (status: RfqStatus) => {
    const config = STATUS_CONFIG[status];
    return (
      <Badge variant={config.variant} className={config.className}>
        {config.label}
      </Badge>
    );
  };

  const renderPartCard = (fp: FlattenedPart, index: number) => {
    const process = getProcess(fp.part);
    const material = getMaterial(fp.part);
    const displayDate = fp.rfqUpdatedAt || fp.rfqCreatedAt;

    return (
      <Card key={`${fp.rfqId}-${fp.part.id}-${index}`} className="mb-3 transition-shadow hover:shadow-md">
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            {/* Left section */}
            <div className="flex-1 min-w-0 space-y-1.5">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-base font-semibold text-foreground truncate">
                  {fp.part.product_name || 'Unnamed Part'}
                </span>
                {process && (
                  <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                    {process}
                  </Badge>
                )}
                {renderStatusBadge(fp.rfqStatus)}
              </div>

              <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                {fp.rfqNumber && (
                  <Link
                    to={`/customer/quotes/${fp.rfqId}`}
                    className="hover:underline text-primary"
                  >
                    RFQ: {fp.rfqNumber}
                  </Link>
                )}
                {material && (
                  <>
                    <span className="hidden sm:inline">·</span>
                    <span>Material: {material}</span>
                  </>
                )}
                <span className="hidden sm:inline">·</span>
                <span>Qty: {fp.part.quantity}</span>
                <span className="hidden sm:inline">·</span>
                <span>Updated {format(new Date(displayDate), 'MMM dd, yyyy')}</span>
              </div>
            </div>

            {/* Right section */}
            <div className="flex items-center gap-3 flex-shrink-0">
              <Button variant="outline" size="sm" asChild>
                <Link to={`/quote?part=${encodeURIComponent(fp.part.product_name || '')}&rfq=${fp.rfqId}`}>
                  <Plus className="h-4 w-4 mr-1" />
                  Quote this part
                </Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderPagination = () => {
    if (totalItems <= PAGE_SIZE_OPTIONS[0]) return null;

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
          <span className="ml-2">({totalItems} total)</span>
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

  const renderEmptyState = () => (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="rounded-full bg-muted p-6 mb-6">
        <Database className="h-12 w-12 text-muted-foreground" />
      </div>
      <h3 className="text-xl font-semibold mb-2">No parts yet</h3>
      <p className="text-muted-foreground mb-6 max-w-md">
        Upload your first design to get started.
      </p>
      <Button asChild className="bg-accent hover:bg-accent/90 text-accent-foreground">
        <Link to="/quote">
          <Plus className="mr-2 h-4 w-4" />
          Upload Design
        </Link>
      </Button>
    </div>
  );

  const renderNoResults = () => (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="rounded-full bg-muted p-6 mb-6">
        <Search className="h-12 w-12 text-muted-foreground" />
      </div>
      <h3 className="text-xl font-semibold mb-2">No parts found</h3>
      <p className="text-muted-foreground mb-6 max-w-md">
        Try adjusting your search or filters.
      </p>
      <Button variant="outline" onClick={resetFilters}>
        <RotateCcw className="mr-2 h-4 w-4" />
        Reset Filters
      </Button>
    </div>
  );

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Parts Library</h1>
        <p className="text-muted-foreground mt-1">All your uploaded parts across all projects</p>
      </div>

      {/* Search & Filters */}
      <div className="space-y-4 mb-6">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by project, part name, or PO number..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Filter className="h-4 w-4" />
            <span>Filters:</span>
          </div>

          <Select value={processFilter} onValueChange={setProcessFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Process type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Processes</SelectItem>
              {PROCESS_TYPES.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Date range" />
            </SelectTrigger>
            <SelectContent>
              {DATE_RANGES.map((d) => (
                <SelectItem key={d.value} value={d.value}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  Sort: {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={resetFilters} className="text-muted-foreground">
              <RotateCcw className="h-4 w-4 mr-1" />
              Reset Filters
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : allParts.length === 0 ? (
        renderEmptyState()
      ) : filteredParts.length === 0 ? (
        renderNoResults()
      ) : (
        <>
          {paginatedParts.map((fp, i) => renderPartCard(fp, i))}
          {renderPagination()}
        </>
      )}
    </div>
  );
}
