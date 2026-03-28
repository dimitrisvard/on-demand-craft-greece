import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Briefcase, Search, Package, Clock, CheckCircle, XCircle, ArrowRight } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/components/ui/use-toast';

type OrderRow = {
  id: string;
  title: string;
  status: string;
  total_amount: number | null;
  currency: string | null;
  created_at: string | null;
  delivery_date: string | null;
  start_date: string | null;
  rfq_id: string | null;
  partner_id: string | null;
  customer_id: string | null;
  material_costs: number | null;
  total_with_vat: number | null;
};

type RfqRow = {
  id: string;
  title: string | null;
  parts_details: unknown;
  description: string | null;
};

type PartDetail = {
  product_name?: string;
  description?: string;
  quantity?: number;
  unit_price?: number;
  total_price?: number;
  material?: string;
  process?: string;
  dimensions?: string;
};

type SortOption = 'latest' | 'price_high' | 'price_low' | 'deadline';

const PAGE_SIZE_OPTIONS = [5, 10, 20, 50];

export default function PartnerJobBoard() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [rfqs, setRfqs] = useState<Record<string, RfqRow>>({});
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('latest');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    fetchJobs();
  }, []);

  const fetchJobs = async () => {
    setLoading(true);
    try {
      const { data: ordersData, error: ordersError } = await supabase
        .from('orders')
        .select('*')
        .eq('status', 'new')
        .is('partner_id', null)
        .order('created_at', { ascending: false });

      if (ordersError) throw ordersError;

      setOrders(ordersData || []);

      // Fetch associated RFQs
      const rfqIds = (ordersData || [])
        .map((o) => o.rfq_id)
        .filter((id): id is string => id !== null);

      if (rfqIds.length > 0) {
        const { data: rfqsData, error: rfqsError } = await supabase
          .from('rfqs')
          .select('id, title, parts_details, description')
          .in('id', rfqIds);

        if (rfqsError) throw rfqsError;

        const rfqMap: Record<string, RfqRow> = {};
        (rfqsData || []).forEach((rfq) => {
          rfqMap[rfq.id] = rfq;
        });
        setRfqs(rfqMap);
      }
    } catch (error) {
      console.error('Error fetching jobs:', error);
      toast({
        title: 'Error',
        description: 'Failed to load available jobs.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const getPartsDetails = (order: OrderRow): PartDetail[] => {
    if (!order.rfq_id || !rfqs[order.rfq_id]) return [];
    const rfq = rfqs[order.rfq_id];
    if (!rfq.parts_details) return [];
    if (Array.isArray(rfq.parts_details)) return rfq.parts_details as PartDetail[];
    return [];
  };

  const getManufacturingProcess = (order: OrderRow): string => {
    const parts = getPartsDetails(order);
    if (parts.length > 0 && parts[0].process) return parts[0].process;
    const title = order.title.toLowerCase();
    if (title.includes('cnc')) return 'CNC Machining';
    if (title.includes('3d') || title.includes('print')) return '3D Printing';
    if (title.includes('injection')) return 'Injection Molding';
    if (title.includes('sheet') || title.includes('metal')) return 'Sheet Metal';
    return 'Manufacturing';
  };

  const getMaterialInfo = (order: OrderRow): string => {
    const parts = getPartsDetails(order);
    if (parts.length > 0 && parts[0].material) return parts[0].material;
    return 'See details';
  };

  const getTotalQuantity = (order: OrderRow): number => {
    const parts = getPartsDetails(order);
    if (parts.length === 0) return 1;
    return parts.reduce((sum, p) => sum + (p.quantity || 0), 0);
  };

  const getProcessBadgeColor = (process: string): string => {
    switch (process) {
      case 'CNC Machining': return 'bg-blue-100 text-blue-800';
      case '3D Printing': return 'bg-purple-100 text-purple-800';
      case 'Injection Molding': return 'bg-orange-100 text-orange-800';
      case 'Sheet Metal': return 'bg-slate-100 text-slate-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const formatJobId = (id: string): string => {
    return `J-${id.substring(0, 8).toUpperCase()}`;
  };

  // Filter and sort
  const filteredAndSorted = useMemo(() => {
    let result = [...orders];

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (o) =>
          o.id.toLowerCase().includes(query) ||
          o.title.toLowerCase().includes(query) ||
          formatJobId(o.id).toLowerCase().includes(query)
      );
    }

    // Sort
    switch (sortBy) {
      case 'latest':
        result.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
        break;
      case 'price_high':
        result.sort((a, b) => (b.total_amount || 0) - (a.total_amount || 0));
        break;
      case 'price_low':
        result.sort((a, b) => (a.total_amount || 0) - (b.total_amount || 0));
        break;
      case 'deadline':
        result.sort((a, b) => {
          if (!a.delivery_date) return 1;
          if (!b.delivery_date) return -1;
          return new Date(a.delivery_date).getTime() - new Date(b.delivery_date).getTime();
        });
        break;
    }

    return result;
  }, [orders, searchQuery, sortBy]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredAndSorted.length / pageSize));
  const paginatedJobs = filteredAndSorted.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const totalValue = orders.reduce((sum, o) => sum + (o.total_amount || 0), 0);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, sortBy, pageSize]);

  const handleAcceptJob = async (orderId: string) => {
    toast({
      title: 'Job Accepted',
      description: `You have accepted job ${formatJobId(orderId)}. Redirecting to order details...`,
    });
    navigate(`/partner/orders/${orderId}`);
  };

  const handleDeclineJob = (orderId: string) => {
    toast({
      title: 'Job Declined',
      description: `You have declined job ${formatJobId(orderId)}.`,
    });
    setOrders((prev) => prev.filter((o) => o.id !== orderId));
  };

  const renderPaginationButtons = () => {
    const buttons: React.ReactNode[] = [];
    const maxVisible = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    const endPage = Math.min(totalPages, startPage + maxVisible - 1);
    if (endPage - startPage < maxVisible - 1) {
      startPage = Math.max(1, endPage - maxVisible + 1);
    }

    if (startPage > 1) {
      buttons.push(
        <Button key={1} variant={currentPage === 1 ? 'default' : 'outline'} size="sm" onClick={() => setCurrentPage(1)}>
          1
        </Button>
      );
      if (startPage > 2) {
        buttons.push(<span key="start-dots" className="px-2 text-muted-foreground">...</span>);
      }
    }

    for (let i = startPage; i <= endPage; i++) {
      buttons.push(
        <Button key={i} variant={currentPage === i ? 'default' : 'outline'} size="sm" onClick={() => setCurrentPage(i)}>
          {i}
        </Button>
      );
    }

    if (endPage < totalPages) {
      if (endPage < totalPages - 1) {
        buttons.push(<span key="end-dots" className="px-2 text-muted-foreground">...</span>);
      }
      buttons.push(
        <Button key={totalPages} variant={currentPage === totalPages ? 'default' : 'outline'} size="sm" onClick={() => setCurrentPage(totalPages)}>
          {totalPages}
        </Button>
      );
    }

    return buttons;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Briefcase className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold text-gray-900">Partner Job Board</h1>
          </div>
          <p className="text-muted-foreground">
            Browse and accept available manufacturing jobs
          </p>
        </div>

        {/* Header Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground mb-1">Total order value available now:</p>
              <p className="text-3xl font-bold text-primary">
                {new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(totalValue)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 flex items-center gap-4">
              <div className="h-12 w-12 rounded-full bg-green-100 flex items-center justify-center">
                <Package className="h-6 w-6 text-green-700" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Available now:</p>
                <p className="text-3xl font-bold text-gray-900">{orders.length} jobs</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Search & Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by offer number..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
            <SelectTrigger className="w-full sm:w-[220px]">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="latest">Latest first</SelectItem>
              <SelectItem value="price_high">Price: High to Low</SelectItem>
              <SelectItem value="price_low">Price: Low to High</SelectItem>
              <SelectItem value="deadline">Deadline: Soonest</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" className="gap-2">
            <Package className="h-4 w-4" />
            Filters
          </Button>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        )}

        {/* Empty State */}
        {!loading && filteredAndSorted.length === 0 && (
          <Card>
            <CardContent className="py-16 text-center">
              <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-lg text-muted-foreground">
                No jobs available right now. Check back soon for new manufacturing opportunities.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Job Cards */}
        {!loading && paginatedJobs.length > 0 && (
          <div className="space-y-4">
            {paginatedJobs.map((order) => {
              const process = getManufacturingProcess(order);
              const material = getMaterialInfo(order);
              const quantity = getTotalQuantity(order);
              const parts = getPartsDetails(order);

              return (
                <Card key={order.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-6">
                    <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                      {/* Left: Job info */}
                      <div className="flex-1 space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-semibold text-muted-foreground">
                            {formatJobId(order.id)}
                          </span>
                          <Badge className={`${getProcessBadgeColor(process)} border-0`}>
                            {process}
                          </Badge>
                        </div>

                        <h3 className="text-lg font-semibold text-gray-900">
                          {order.title}
                        </h3>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                          <div>
                            <span className="text-muted-foreground block">Material</span>
                            <span className="font-medium">{material}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground block">Dimensions</span>
                            <span className="font-medium">
                              {parts.length > 0 && parts[0].dimensions
                                ? parts[0].dimensions
                                : 'See details'}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground block">Quantity</span>
                            <span className="font-medium">{quantity} parts</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground block">Lead time</span>
                            <span className="font-medium flex items-center gap-1">
                              <Clock className="h-3.5 w-3.5" />
                              {order.delivery_date
                                ? format(new Date(order.delivery_date), 'dd MMM yyyy')
                                : 'TBD'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Right: Price & actions */}
                      <div className="flex flex-col items-end gap-3 min-w-[200px]">
                        <div className="text-right">
                          <p className="text-sm text-muted-foreground">Total price</p>
                          <p className="text-2xl font-bold text-gray-900">
                            {new Intl.NumberFormat('de-DE', {
                              style: 'currency',
                              currency: order.currency || 'EUR',
                            }).format(order.total_amount || 0)}
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => navigate(`/partner/orders/${order.id}`)}
                            className="gap-1"
                          >
                            Show Details
                            <ArrowRight className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDeclineJob(order.id)}
                            className="gap-1 text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            Decline
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => handleAcceptJob(order.id)}
                            className="gap-1 bg-green-600 hover:bg-green-700 text-white"
                          >
                            <CheckCircle className="h-3.5 w-3.5" />
                            Accept Job
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {!loading && filteredAndSorted.length > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-8">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Show</span>
              <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                <SelectTrigger className="w-[70px] h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span>per page</span>
              <span className="ml-2">
                ({filteredAndSorted.length} total)
              </span>
            </div>

            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((p) => p - 1)}
              >
                Previous
              </Button>
              {renderPaginationButtons()}
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
