import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Package, Search, Clock, ArrowRight, CheckCircle2, Truck, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

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
};

type SortOption = 'latest' | 'price_high' | 'price_low' | 'deadline';

const statusConfig: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  new: { label: 'New', color: 'bg-blue-100 text-blue-800', icon: <AlertCircle className="h-3.5 w-3.5" /> },
  in_progress: { label: 'In Progress', color: 'bg-amber-100 text-amber-800', icon: <Clock className="h-3.5 w-3.5" /> },
  production: { label: 'Production', color: 'bg-purple-100 text-purple-800', icon: <Package className="h-3.5 w-3.5" /> },
  shipped: { label: 'Shipped', color: 'bg-cyan-100 text-cyan-800', icon: <Truck className="h-3.5 w-3.5" /> },
  completed: { label: 'Completed', color: 'bg-green-100 text-green-800', icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
};

const PAGE_SIZE_OPTIONS = [10, 20, 50];

export default function PartnerOrdersPage() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('latest');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    if (user) fetchOrders();
  }, [user]);

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('partner_id', user!.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setOrders(data || []);
    } catch (error) {
      console.error('Error fetching orders:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatOrderId = (id: string): string => `ORD-${id.substring(0, 8).toUpperCase()}`;

  const filtered = useMemo(() => {
    let result = [...orders];

    if (statusFilter !== 'all') {
      result = result.filter((o) => o.status === statusFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (o) =>
          o.id.toLowerCase().includes(q) ||
          o.title.toLowerCase().includes(q) ||
          formatOrderId(o.id).toLowerCase().includes(q)
      );
    }

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
  }, [orders, searchQuery, sortBy, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, sortBy, statusFilter, pageSize]);

  const getStatus = (status: string) => statusConfig[status] || { label: status, color: 'bg-gray-100 text-gray-800', icon: null };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Package className="h-8 w-8 text-primary" />
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">My Orders</h1>
          </div>
          <p className="text-muted-foreground">Manage your accepted manufacturing orders</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardContent className="pt-4 pb-4">
              <p className="text-xs text-muted-foreground">Total Orders</p>
              <p className="text-2xl font-bold">{orders.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <p className="text-xs text-muted-foreground">In Progress</p>
              <p className="text-2xl font-bold text-amber-600">{orders.filter(o => o.status === 'in_progress' || o.status === 'production').length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <p className="text-xs text-muted-foreground">Completed</p>
              <p className="text-2xl font-bold text-green-600">{orders.filter(o => o.status === 'completed').length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <p className="text-xs text-muted-foreground">Total Value</p>
              <p className="text-2xl font-bold">{new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(orders.reduce((s, o) => s + (o.total_amount || 0), 0))}</p>
            </CardContent>
          </Card>
        </div>

        {/* Search & Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search orders..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-[160px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="new">New</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="production">Production</SelectItem>
              <SelectItem value="shipped">Shipped</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="latest">Latest first</SelectItem>
              <SelectItem value="price_high">Price: High to Low</SelectItem>
              <SelectItem value="price_low">Price: Low to High</SelectItem>
              <SelectItem value="deadline">Deadline: Soonest</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        )}

        {/* Empty State */}
        {!loading && filtered.length === 0 && (
          <Card>
            <CardContent className="py-16 text-center">
              <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-lg text-muted-foreground mb-4">
                {orders.length === 0
                  ? "You haven't accepted any orders yet."
                  : 'No orders match your filters.'}
              </p>
              {orders.length === 0 && (
                <Button onClick={() => navigate('/partner/jobs')} className="gap-2">
                  Browse Job Board <ArrowRight className="h-4 w-4" />
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* Order Cards */}
        {!loading && paginated.length > 0 && (
          <div className="space-y-3">
            {paginated.map((order) => {
              const status = getStatus(order.status);
              return (
                <Card
                  key={order.id}
                  className="hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => navigate(`/partner/orders/${order.id}`)}
                >
                  <CardContent className="p-4 sm:p-6">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span className="font-mono text-sm font-semibold text-muted-foreground">
                            {formatOrderId(order.id)}
                          </span>
                          <Badge className={`${status.color} border-0 gap-1`}>
                            {status.icon}
                            {status.label}
                          </Badge>
                        </div>
                        <h3 className="font-semibold text-gray-900 truncate">{order.title}</h3>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground mt-1">
                          {order.created_at && (
                            <span>Created: {format(new Date(order.created_at), 'dd MMM yyyy')}</span>
                          )}
                          {order.delivery_date && (
                            <span className="flex items-center gap-1">
                              <Clock className="h-3.5 w-3.5" />
                              Due: {format(new Date(order.delivery_date), 'dd MMM yyyy')}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="text-xl font-bold text-gray-900">
                            {new Intl.NumberFormat('de-DE', {
                              style: 'currency',
                              currency: order.currency || 'EUR',
                            }).format(order.total_amount || 0)}
                          </p>
                        </div>
                        <ArrowRight className="h-5 w-5 text-muted-foreground hidden sm:block" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {!loading && filtered.length > pageSize && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-8">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Show</span>
              <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                <SelectTrigger className="w-[70px] h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <SelectItem key={size} value={String(size)}>{size}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span>per page ({filtered.length} total)</span>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}>
                Previous
              </Button>
              <span className="px-3 text-sm text-muted-foreground">
                {currentPage} / {totalPages}
              </span>
              <Button variant="outline" size="sm" disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
