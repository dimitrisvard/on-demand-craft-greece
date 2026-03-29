import React, { useState, useEffect, useMemo } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { RFQ, RfqItem } from "@/types/customer";
import { Database } from '@/integrations/supabase/types';
import {
  FilePlus,
  Search,
  MoreHorizontal,
  Eye,
  Trash2,
  Send,
  FileCheck,
  UserPlus,
  FileText,
  Package,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Plus,
  Download,
  Copy,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CustomerSearchAssign } from "@/components/customers/CustomerSearchAssign";
import PersistentDashboardLayout from "@/components/dashboard/PersistentDashboardLayout";
import { format } from "date-fns";

type RfqStatus = "draft" | "sent" | "received" | "approved" | "rejected";
type RfqRow = Database['public']['Tables']['rfqs']['Row'];

type Customer = {
  id: string;
  company_name: string;
};

// Status config matching customer-side
const RFQ_STATUS_CONFIG: Record<RfqStatus, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-gray-100 text-gray-700 hover:bg-gray-100' },
  sent: { label: 'Quoted', className: 'bg-blue-100 text-blue-700 hover:bg-blue-100' },
  received: { label: 'Under Review', className: 'bg-orange-100 text-orange-700 hover:bg-orange-100' },
  approved: { label: 'Approved', className: 'bg-green-100 text-green-700 hover:bg-green-100' },
  rejected: { label: 'Rejected', className: 'bg-red-100 text-red-700 hover:bg-red-100' },
};

const ORDER_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  new: { label: 'New', className: 'bg-blue-100 text-blue-700 hover:bg-blue-100' },
  in_progress: { label: 'In Progress', className: 'bg-yellow-100 text-yellow-800 hover:bg-yellow-100' },
  completed: { label: 'Completed', className: 'bg-green-100 text-green-700 hover:bg-green-100' },
  cancelled: { label: 'Cancelled', className: 'bg-red-100 text-red-700 hover:bg-red-100' },
};

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

function formatCurrency(amount: number, currency: string = 'EUR'): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(amount);
}

export default function RfqManagement() {
  const [rfqs, setRfqs] = useState<RFQ[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [rfqItems, setRfqItems] = useState<RfqItem[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedRfq, setSelectedRfq] = useState<RFQ | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [isRfqDialogOpen, setIsRfqDialogOpen] = useState(false);
  const [isItemDialogOpen, setIsItemDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isCustomerAssignDialogOpen, setIsCustomerAssignDialogOpen] = useState(false);
  const [isOrderCustomerAssignDialogOpen, setIsOrderCustomerAssignDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState<RfqStatus | "all">("all");
  const [mainTab, setMainTab] = useState<"rfqs" | "orders">("rfqs");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(10);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const [newRfq, setNewRfq] = useState<Partial<RFQ>>({
    title: "",
    customer_id: "",
    status: "draft" as RfqStatus,
    currency: "EUR",
    due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    version: 1
  });

  const [newItem, setNewItem] = useState<Partial<RfqItem>>({
    product_name: "",
    description: "",
    quantity: 1,
    unit_price: 0,
    total_price: 0
  });

  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    fetchRfqs();
    fetchCustomers();
    fetchOrders();
  }, []);

  useEffect(() => { setCurrentPage(1); }, [mainTab, pageSize, searchQuery, dateFrom, dateTo, statusFilter]);

  useEffect(() => {
    if (newItem.unit_price !== undefined && newItem.quantity !== undefined) {
      setNewItem(prev => ({ ...prev, total_price: (prev.unit_price || 0) * (prev.quantity || 0) }));
    }
  }, [newItem.unit_price, newItem.quantity]);

  // ── Data fetching ──────────────────────────────────────────
  async function fetchRfqs() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('rfqs')
        .select('*, customers(company_name, email, phone, vat_tax_id)')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const transformedData: RFQ[] = (data || []).map(item => ({
        id: item.id,
        title: item.title,
        customer_id: item.customer_id,
        customer_name: item.customers?.company_name || 'Unassigned',
        rfq_number: (item as any).rfq_number,
        status: item.status as RfqStatus,
        total_amount: item.total_amount || 0,
        currency: item.currency || 'EUR',
        created_at: item.created_at,
        due_date: item.due_date || new Date().toISOString(),
        version: item.version || 1,
        parts_details: (item as unknown as { parts_details: RfqItem[] }).parts_details || [],
        customer: item.customers as any,
      }));

      setRfqs(transformedData);
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to load RFQs", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function fetchCustomers() {
    try {
      const { data, error } = await supabase.from('customers').select('id, company_name').order('company_name', { ascending: true });
      if (error) throw error;
      setCustomers(data as Customer[]);
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to load customers", variant: "destructive" });
    }
  }

  async function fetchOrders() {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*, customers(company_name, email, phone, vat_tax_id)')
        .order('created_at', { ascending: false });

      if (error) throw error;
      const transformed = (data || []).map(item => ({
        ...item,
        customer_name: item.customers?.company_name || 'Unassigned',
        customer_email: item.customers?.email,
        customer_phone: item.customers?.phone,
        customer_vat: item.customers?.vat_tax_id,
      }));
      setOrders(transformed);
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to load orders", variant: "destructive" });
    }
  }

  // ── Filtered & paginated data ──────────────────────────────
  const filteredRfqs = useMemo(() => {
    let result = [...rfqs];

    if (statusFilter !== "all") {
      result = result.filter(r => r.status === statusFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(r =>
        (r.rfq_number || '').toLowerCase().includes(q) ||
        (r.title || '').toLowerCase().includes(q) ||
        (r.customer_name || '').toLowerCase().includes(q)
      );
    }
    if (dateFrom) {
      const from = new Date(dateFrom);
      result = result.filter(r => new Date(r.created_at) >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      result = result.filter(r => new Date(r.created_at) <= to);
    }
    return result;
  }, [rfqs, statusFilter, searchQuery, dateFrom, dateTo]);

  const filteredOrders = useMemo(() => {
    let result = [...orders];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(o =>
        generateOrderId(o).toLowerCase().includes(q) ||
        (o.title || '').toLowerCase().includes(q) ||
        (o.customer_name || '').toLowerCase().includes(q)
      );
    }
    if (dateFrom) {
      const from = new Date(dateFrom);
      result = result.filter(o => new Date(o.created_at) >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      result = result.filter(o => new Date(o.created_at) <= to);
    }
    return result;
  }, [orders, searchQuery, dateFrom, dateTo]);

  const currentItems = mainTab === 'rfqs' ? filteredRfqs : filteredOrders;
  const totalItems = currentItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedItems = currentItems.slice((safePage - 1) * pageSize, safePage * pageSize);

  // ── Order ID generation ────────────────────────────────────
  const generateOrderId = (order: any) => {
    const orderDate = new Date(order.created_at);
    const day = String(orderDate.getDate()).padStart(2, '0');
    const month = String(orderDate.getMonth() + 1).padStart(2, '0');
    const year = orderDate.getFullYear();
    const dateStr = `${day}${month}${year}`;

    const sameDateOrders = orders
      .filter(o => {
        const d = new Date(o.created_at);
        return d.getDate() === orderDate.getDate() && d.getMonth() === orderDate.getMonth() && d.getFullYear() === orderDate.getFullYear();
      })
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    const seqIndex = sameDateOrders.findIndex(o => o.id === order.id);
    return `PO-${dateStr}-${seqIndex >= 0 ? seqIndex + 1 : 1}`;
  };

  // ── RFQ Actions ────────────────────────────────────────────
  const handleAddRfq = async () => {
    try {
      if (!newRfq.title || !newRfq.customer_id) {
        toast({ title: "Error", description: "Title and customer are required", variant: "destructive" });
        return;
      }
      const { data, error } = await supabase
        .from('rfqs')
        .insert([{ title: newRfq.title, customer_id: newRfq.customer_id, status: newRfq.status, currency: newRfq.currency, due_date: newRfq.due_date, version: newRfq.version, total_amount: 0 }])
        .select();

      if (error) throw error;
      toast({ title: "Success", description: "RFQ created successfully" });

      if (data && data.length > 0) {
        navigate(`/rfq/${data[0].id}`);
      } else {
        fetchRfqs();
        setIsRfqDialogOpen(false);
      }
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to create RFQ", variant: "destructive" });
    }
  };

  const handleUpdateRfqStatus = async (rfqId: string, newStatus: RfqStatus) => {
    try {
      const { error } = await supabase.from('rfqs').update({ status: newStatus }).eq('id', rfqId);
      if (error) throw error;
      toast({ title: "Success", description: `RFQ ${newStatus === 'approved' ? 'approved and converted to order' : newStatus}` });
      if (newStatus === 'approved') await createOrderFromRfq(rfqId);
      fetchRfqs();
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to update RFQ status", variant: "destructive" });
    }
  };

  const createOrderFromRfq = async (rfqId: string) => {
    try {
      const { data: rfqData, error: rfqError } = await supabase.from('rfqs').select('*').eq('id', rfqId).single();
      if (rfqError) throw rfqError;

      const { data: orderData, error: orderError } = await supabase
        .from('orders')
        .insert([{
          customer_id: rfqData.customer_id,
          rfq_id: rfqId,
          status: 'new',
          total_amount: rfqData.total_amount,
          currency: rfqData.currency,
          title: `Order - ${rfqData.title}`,
          start_date: new Date().toISOString(),
          delivery_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
        }])
        .select();
      if (orderError) throw orderError;

      if (orderData && rfqData.parts_details) {
        const orderItems = rfqData.parts_details.map((item: any) => ({
          order_id: orderData[0].id,
          product_name: item.product_name,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          total_price: item.total_price
        }));
        await supabase.from('order_items').insert(orderItems);
      }
      toast({ title: "Success", description: "Order created successfully" });
      fetchOrders();
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to create order", variant: "destructive" });
    }
  };

  const handleDeleteRfq = async (id: string) => {
    try {
      const { error } = await supabase.from('rfqs').delete().eq('id', id);
      if (error) throw error;
      setRfqs(prev => prev.filter(r => r.id !== id));
      toast({ title: "Success", description: "RFQ deleted" });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to delete RFQ", variant: "destructive" });
    } finally {
      setDeleteConfirmId(null);
    }
  };

  const handleCustomerAssign = async (customer: any) => {
    if (!selectedRfq) return;
    try {
      const { error } = await supabase.from('rfqs').update({ customer_id: customer?.id || null }).eq('id', selectedRfq.id);
      if (error) throw error;
      toast({ title: "Success", description: customer ? `Customer ${customer.company_name} assigned` : "Customer removed" });
      setIsCustomerAssignDialogOpen(false);
      setSelectedRfq(null);
      fetchRfqs();
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to assign customer", variant: "destructive" });
    }
  };

  const handleOrderCustomerAssign = async (customer: any) => {
    if (!selectedOrder) return;
    try {
      const { error } = await supabase.from('orders').update({ customer_id: customer?.id || null }).eq('id', selectedOrder.id);
      if (error) throw error;
      toast({ title: "Success", description: customer ? `Customer ${customer.company_name} assigned` : "Customer removed" });
      setIsOrderCustomerAssignDialogOpen(false);
      setSelectedOrder(null);
      fetchOrders();
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to assign customer", variant: "destructive" });
    }
  };

  const handleRfqInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setNewRfq({ ...newRfq, [e.target.name]: e.target.value });
  };

  // ── Helpers ────────────────────────────────────────────────
  const getPartsQtySummary = (rfq: RFQ): string | null => {
    if (!rfq.parts_details || rfq.parts_details.length === 0) return null;
    const partsCount = rfq.parts_details.length;
    const totalQty = rfq.parts_details.reduce((sum, item) => sum + (item.quantity || 0), 0);
    return `${partsCount} / ${totalQty}`;
  };

  const getProcess = (rfq: RFQ): string | null => {
    if (!rfq.parts_details || rfq.parts_details.length === 0) return null;
    return rfq.parts_details[0].product_name || null;
  };

  // ── RFQ Card (matching customer-side pattern) ──────────────
  const renderRfqCard = (rfq: RFQ) => {
    const partsQty = getPartsQtySummary(rfq);
    const process = getProcess(rfq);
    const statusConfig = RFQ_STATUS_CONFIG[rfq.status];
    const isDeleting = deleteConfirmId === rfq.id;

    return (
      <Card key={rfq.id} className="mb-3 transition-shadow hover:shadow-md">
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            {/* Left: ID, customer, date, status */}
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-3 flex-wrap">
                <Link
                  to={`/rfq/${rfq.id}`}
                  className="text-base font-semibold text-primary hover:underline truncate"
                >
                  {rfq.rfq_number || rfq.title || `RFQ ${rfq.id.slice(0, 8)}`}
                </Link>
                <Badge className={`${statusConfig.className} border-0 text-xs`}>
                  {statusConfig.label}
                </Badge>
              </div>
              <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                <span className="font-medium text-foreground">{rfq.customer_name}</span>
                <span className="hidden sm:inline">·</span>
                <span>{format(new Date(rfq.created_at), 'MMM dd, yyyy')}</span>
                {process && (
                  <>
                    <span className="hidden sm:inline">·</span>
                    <span>{process}</span>
                  </>
                )}
                {rfq.due_date && (
                  <>
                    <span className="hidden sm:inline">·</span>
                    <span>Due: {format(new Date(rfq.due_date), 'MMM dd, yyyy')}</span>
                  </>
                )}
              </div>
            </div>

            {/* Right: parts/qty, total, actions */}
            <div className="flex items-center gap-4 sm:gap-6 flex-shrink-0">
              {partsQty && (
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Parts / Qty</p>
                  <p className="text-sm font-medium">{partsQty}</p>
                </div>
              )}
              <div className="text-right">
                <p className="text-lg font-semibold">
                  {formatCurrency(rfq.total_amount, rfq.currency)}
                </p>
              </div>

              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" asChild>
                  <Link to={`/rfq/${rfq.id}`}>
                    <Eye className="h-4 w-4 mr-1" />
                    <span className="hidden sm:inline">View</span>
                  </Link>
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {rfq.status === 'draft' && (
                      <DropdownMenuItem onClick={() => handleUpdateRfqStatus(rfq.id, 'sent')}>
                        <Send className="mr-2 h-4 w-4" /> Mark as Sent
                      </DropdownMenuItem>
                    )}
                    {rfq.status === 'sent' && (
                      <DropdownMenuItem onClick={() => handleUpdateRfqStatus(rfq.id, 'received')}>
                        <FileCheck className="mr-2 h-4 w-4" /> Mark as Received
                      </DropdownMenuItem>
                    )}
                    {rfq.status === 'received' && (
                      <>
                        <DropdownMenuItem onClick={() => handleUpdateRfqStatus(rfq.id, 'approved')}>
                          <FileCheck className="mr-2 h-4 w-4" /> Approve & Create Order
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleUpdateRfqStatus(rfq.id, 'rejected')}>
                          <Trash2 className="mr-2 h-4 w-4" /> Reject
                        </DropdownMenuItem>
                      </>
                    )}
                    {rfq.status !== 'approved' && (
                      <DropdownMenuItem onClick={() => createOrderFromRfq(rfq.id)}>
                        <Package className="mr-2 h-4 w-4" /> Convert to Order
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={() => { setSelectedRfq(rfq); setIsCustomerAssignDialogOpen(true); }}>
                      <UserPlus className="mr-2 h-4 w-4" /> Assign Customer
                    </DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive" onClick={() => setDeleteConfirmId(rfq.id)}>
                      <Trash2 className="mr-2 h-4 w-4" /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                {isDeleting && (
                  <div className="flex items-center gap-1 ml-1">
                    <Button variant="destructive" size="sm" onClick={() => handleDeleteRfq(rfq.id)}>Confirm</Button>
                    <Button variant="ghost" size="sm" onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  // ── Order Card (matching customer-side pattern) ────────────
  const renderOrderCard = (order: any) => {
    const orderId = generateOrderId(order);
    const statusConfig = ORDER_STATUS_CONFIG[order.status] || { label: order.status, className: 'bg-gray-100 text-gray-700' };
    const isDeleting = deleteConfirmId === order.id;

    return (
      <Card key={order.id} className="mb-3 transition-shadow hover:shadow-md">
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            {/* Left: order ID, title, customer, dates */}
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-3 flex-wrap">
                <Link
                  to={`/orders/${order.id}`}
                  className="text-base font-semibold text-primary hover:underline truncate font-mono"
                >
                  {orderId}
                </Link>
                <Badge className={`${statusConfig.className} border-0 text-xs`}>
                  {statusConfig.label}
                </Badge>
                {order.production_status && order.production_status !== order.status && (
                  <Badge variant="outline" className="text-xs">
                    {order.production_status.replace('_', ' ')}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                <span className="font-medium text-foreground">{order.customer_name}</span>
                <span className="hidden sm:inline">·</span>
                <span>{order.title}</span>
                {order.start_date && (
                  <>
                    <span className="hidden sm:inline">·</span>
                    <span>Start: {format(new Date(order.start_date), 'MMM dd, yyyy')}</span>
                  </>
                )}
                {order.delivery_date && (
                  <>
                    <span className="hidden sm:inline">·</span>
                    <span>Due: {format(new Date(order.delivery_date), 'MMM dd, yyyy')}</span>
                  </>
                )}
              </div>
              {/* Customer info row */}
              {(order.customer_email || order.customer_phone || order.customer_vat) && (
                <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                  {order.customer_email && <span>{order.customer_email}</span>}
                  {order.customer_phone && <span>{order.customer_phone}</span>}
                  {order.customer_vat && <span>VAT: {order.customer_vat}</span>}
                </div>
              )}
            </div>

            {/* Right: total, actions */}
            <div className="flex items-center gap-4 sm:gap-6 flex-shrink-0">
              <div className="text-right">
                <p className="text-lg font-semibold">
                  {order.total_amount ? formatCurrency(order.total_amount, order.currency || 'EUR') : '—'}
                </p>
                {order.total_with_vat > 0 && (
                  <p className="text-xs text-muted-foreground">
                    incl. VAT: {formatCurrency(order.total_with_vat, 'EUR')}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" asChild>
                  <Link to={`/orders/${order.id}`}>
                    <Eye className="h-4 w-4 mr-1" />
                    <span className="hidden sm:inline">View</span>
                  </Link>
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => navigate(`/orders/${order.id}`)}>
                      <Eye className="mr-2 h-4 w-4" /> View Details
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { setSelectedOrder(order); setIsOrderCustomerAssignDialogOpen(true); }}>
                      <UserPlus className="mr-2 h-4 w-4" /> Assign Customer
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  // ── Pagination (matching customer-side pattern) ────────────
  const renderPagination = () => {
    if (totalItems <= PAGE_SIZE_OPTIONS[0]) return null;

    const pages: (number | 'ellipsis')[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (safePage > 3) pages.push('ellipsis');
      for (let i = Math.max(2, safePage - 1); i <= Math.min(totalPages - 1, safePage + 1); i++) pages.push(i);
      if (safePage < totalPages - 2) pages.push('ellipsis');
      pages.push(totalPages);
    }

    return (
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-6 pt-4 border-t">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Show</span>
          <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="border rounded px-2 py-1 text-sm bg-background">
            {PAGE_SIZE_OPTIONS.map((size) => (<option key={size} value={size}>{size}</option>))}
          </select>
          <span>per page ({totalItems} total)</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={safePage <= 1}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          {pages.map((page, idx) =>
            page === 'ellipsis' ? (
              <span key={`e-${idx}`} className="px-2 text-muted-foreground">...</span>
            ) : (
              <Button key={page} variant={page === safePage ? 'default' : 'outline'} size="sm" className="min-w-[36px]" onClick={() => setCurrentPage(page)}>
                {page}
              </Button>
            )
          )}
          <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  };

  // ── Empty state ────────────────────────────────────────────
  const renderEmptyState = (type: 'rfqs' | 'orders') => (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="rounded-full bg-muted p-6 mb-6">
        {type === 'rfqs' ? <FileText className="h-12 w-12 text-muted-foreground" /> : <Package className="h-12 w-12 text-muted-foreground" />}
      </div>
      <h3 className="text-xl font-semibold mb-2">No {type === 'rfqs' ? 'RFQs' : 'orders'} found</h3>
      <p className="text-muted-foreground mb-6 max-w-md">
        {type === 'rfqs'
          ? 'Create a new RFQ to get started with quoting.'
          : 'Orders are created when RFQs are approved.'}
      </p>
      {type === 'rfqs' && (
        <Button onClick={() => { setIsRfqDialogOpen(true); }}>
          <Plus className="mr-2 h-4 w-4" /> New RFQ
        </Button>
      )}
    </div>
  );

  // ── Loading state ──────────────────────────────────────────
  const renderLoading = () => (
    <div className="flex items-center justify-center py-20">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    </div>
  );

  // ── Tab content ────────────────────────────────────────────
  const renderContent = () => {
    if (loading) return renderLoading();

    if (paginatedItems.length === 0) return renderEmptyState(mainTab);

    return (
      <>
        {mainTab === 'rfqs'
          ? paginatedItems.map((rfq: any) => renderRfqCard(rfq))
          : paginatedItems.map((order: any) => renderOrderCard(order))
        }
        {renderPagination()}
      </>
    );
  };

  const rfqCount = rfqs.length;
  const orderCount = orders.length;

  return (
    <PersistentDashboardLayout>
      <div className="container mx-auto max-w-5xl space-y-6">
        {/* Page Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold tracking-tight">RFQ & Orders</h1>
          <Button onClick={() => setIsRfqDialogOpen(true)}>
            <FilePlus className="mr-2 h-4 w-4" /> New RFQ
          </Button>
        </div>

        {/* Search and Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by RFQ number, order ID, title, or customer..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground whitespace-nowrap">From</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="border rounded-md px-2 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring" />
            <label className="text-sm text-muted-foreground whitespace-nowrap">To</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="border rounded-md px-2 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={mainTab} onValueChange={(v) => setMainTab(v as "rfqs" | "orders")}>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <TabsList>
              <TabsTrigger value="rfqs">
                RFQs
                {rfqCount > 0 && (
                  <span className="ml-1.5 text-xs bg-muted-foreground/20 rounded-full px-2 py-0.5">{rfqCount}</span>
                )}
              </TabsTrigger>
              <TabsTrigger value="orders">
                Orders
                {orderCount > 0 && (
                  <span className="ml-1.5 text-xs bg-muted-foreground/20 rounded-full px-2 py-0.5">{orderCount}</span>
                )}
              </TabsTrigger>
            </TabsList>

            {/* Status filter for RFQs */}
            {mainTab === 'rfqs' && (
              <div className="flex gap-1 flex-wrap">
                {(['all', 'draft', 'sent', 'received', 'approved', 'rejected'] as const).map(s => (
                  <Button
                    key={s}
                    variant={statusFilter === s ? 'default' : 'outline'}
                    size="sm"
                    className="text-xs"
                    onClick={() => setStatusFilter(s)}
                  >
                    {s === 'all' ? 'All' : RFQ_STATUS_CONFIG[s].label}
                  </Button>
                ))}
              </div>
            )}

            {/* Calendar link for orders */}
            {mainTab === 'orders' && (
              <Button variant="outline" size="sm" onClick={() => navigate('/calendar')}>
                <Calendar className="h-4 w-4 mr-1" /> Calendar
              </Button>
            )}
          </div>

          <div className="mt-6">
            <TabsContent value="rfqs" className="mt-0">{renderContent()}</TabsContent>
            <TabsContent value="orders" className="mt-0">{renderContent()}</TabsContent>
          </div>
        </Tabs>
      </div>

      {/* ── Dialogs ────────────────────────────────────────── */}

      {/* New RFQ Dialog */}
      <Dialog open={isRfqDialogOpen} onOpenChange={setIsRfqDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Create New RFQ</DialogTitle>
            <DialogDescription>Enter the details for the new request for quotation.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <label htmlFor="title" className="text-sm font-medium">RFQ Title *</label>
              <Input id="title" name="title" value={newRfq.title} onChange={handleRfqInputChange} placeholder="e.g., Q1 2025 Parts Order" required />
            </div>
            <div className="space-y-2">
              <label htmlFor="customer_id" className="text-sm font-medium">Customer *</label>
              <select id="customer_id" name="customer_id" value={newRfq.customer_id} onChange={handleRfqInputChange} className="w-full p-2 border rounded-md" required>
                <option value="">Select a customer...</option>
                {customers.map((c) => (<option key={c.id} value={c.id}>{c.company_name}</option>))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label htmlFor="currency" className="text-sm font-medium">Currency</label>
                <select id="currency" name="currency" value={newRfq.currency} onChange={handleRfqInputChange} className="w-full p-2 border rounded-md">
                  <option value="EUR">EUR</option>
                  <option value="USD">USD</option>
                  <option value="GBP">GBP</option>
                </select>
              </div>
              <div className="space-y-2">
                <label htmlFor="due_date" className="text-sm font-medium">Due Date</label>
                <Input id="due_date" name="due_date" type="date" value={newRfq.due_date} onChange={handleRfqInputChange} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRfqDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleAddRfq}>Create RFQ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Customer Assignment Dialogs */}
      <CustomerSearchAssign
        currentCustomerId={selectedRfq?.customer_id}
        onCustomerSelect={handleCustomerAssign}
        isOpen={isCustomerAssignDialogOpen}
        onClose={() => setIsCustomerAssignDialogOpen(false)}
        title="Assign Customer to RFQ"
        description="Search and assign a customer to this RFQ"
      />
      <CustomerSearchAssign
        currentCustomerId={selectedOrder?.customer_id}
        onCustomerSelect={handleOrderCustomerAssign}
        isOpen={isOrderCustomerAssignDialogOpen}
        onClose={() => setIsOrderCustomerAssignDialogOpen(false)}
        title="Assign Customer to Order"
        description="Search and assign a customer to this order"
      />
    </PersistentDashboardLayout>
  );
}
