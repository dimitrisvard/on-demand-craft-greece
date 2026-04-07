import React, { useState, useEffect, useMemo, lazy, Suspense } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { RFQ, RfqItem } from "@/types/customer";
import { Database } from '@/integrations/supabase/types';
import { getSignedUrl } from '@/utils/awsS3Storage';
import { calculateWeight, formatWeight } from '@/utils/materialDensity';
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
  ChevronDown,
  ChevronUp,
  Plus,
  Download,
  Copy,
  Layers,
  Weight,
  Box,
  ArrowLeft,
  Sparkles,
  X,
} from "lucide-react";

const PartThumbnail3D = lazy(() => import('@/components/shared/PartThumbnail3D'));
import type { PartThumbnail3DMetrics } from '@/components/shared/PartThumbnail3D';
const is3DFile = (name: string) => /\.(stl|obj|glb|gltf|step|stp)$/i.test(name);
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
  email?: string;
  first_name?: string;
  last_name?: string;
  contact_name?: string;
  vat_tax_id?: string;
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
  pending: { label: 'Pending', className: 'bg-amber-100 text-amber-700 hover:bg-amber-100' },
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
  const [customerSearch, setCustomerSearch] = useState("");
  const [isCustomerDropdownOpen, setIsCustomerDropdownOpen] = useState(false);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [partIndexes, setPartIndexes] = useState<Record<string, number>>({});
  // Thumbnail state: key (rfqId or partId) -> { url, name } for 3D files
  const [rfqThumbnails, setRfqThumbnails] = useState<Record<string, { url: string; name: string }>>({});
  // Per-part thumbnail: partId -> { url, name }
  const [partThumbnails, setPartThumbnails] = useState<Record<string, { url: string; name: string }>>({});
  // Volume state: key -> volume in mm³ (computed when thumbnail 3D model loads)
  const [rfqVolumes, setRfqVolumes] = useState<Record<string, number>>({});

  const toggleExpand = (id: string) => {
    setExpandedCards(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const navigatePart = (id: string, direction: 'prev' | 'next', totalParts: number) => {
    setPartIndexes(prev => {
      const current = prev[id] || 0;
      const next = direction === 'next'
        ? (current + 1) % totalParts
        : (current - 1 + totalParts) % totalParts;
      return { ...prev, [id]: next };
    });
  };

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
        customer_name: item.customers?.company_name || (item as any).company_name || 'Unassigned',
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
      const { data, error } = await supabase
        .from('customers')
        .select('id, company_name, email, first_name, last_name, contact_name, vat_tax_id')
        .order('company_name', { ascending: true });
      if (error) throw error;
      // Use company_name, fall back to contact_name/email so self-registered customers are visible
      const mapped: Customer[] = (data || []).map((c: any) => ({
        id: c.id,
        company_name: c.company_name || c.contact_name || `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email || 'Unknown',
        email: c.email || '',
        first_name: c.first_name || '',
        last_name: c.last_name || '',
        contact_name: c.contact_name || '',
        vat_tax_id: c.vat_tax_id || '',
      }));
      setCustomers(mapped);
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to load customers", variant: "destructive" });
    }
  }

  async function fetchOrders() {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*, customers(company_name, email, phone, vat_tax_id), rfqs(customer_id, rfq_number, parts_details, customers(company_name, email, phone, vat_tax_id))')
        .order('created_at', { ascending: false });

      if (error) throw error;
      const transformed = (data || []).map((item: any) => {
        // Use order's customer, fall back to RFQ's customer
        const directCustomer = item.customers;
        const rfqCustomer = item.rfqs?.customers;
        const cust = directCustomer || rfqCustomer;
        return {
          ...item,
          customer_name: cust?.company_name || item.rfqs?.company_name || 'Unassigned',
          customer_email: cust?.email,
          customer_phone: cust?.phone,
          customer_vat: cust?.vat_tax_id,
          parts_details: item.rfqs?.parts_details || [],
          from_rfq_number: item.from_rfq_number || item.rfqs?.rfq_number || '',
        };
      });
      setOrders(transformed);
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to load orders", variant: "destructive" });
    }
  }

  // ── Fetch 3D file thumbnails for all RFQs (per-rfq + per-part) ──
  async function fetchThumbnails(rfqIds: string[]) {
    if (rfqIds.length === 0) return;
    try {
      const { data: files } = await supabase
        .from('rfq_files')
        .select('id, rfq_id, part_id, file_name, file_path')
        .in('rfq_id', rfqIds);
      if (!files || files.length === 0) return;

      // First 3D file per rfq_id (fallback thumbnail)
      const firstPerRfq: Record<string, { file_path: string; file_name: string }> = {};
      // First 3D file per part_id
      const firstPerPart: Record<string, { file_path: string; file_name: string }> = {};
      for (const f of files as any[]) {
        if (!is3DFile(f.file_name)) continue;
        if (!firstPerRfq[f.rfq_id]) {
          firstPerRfq[f.rfq_id] = { file_path: f.file_path, file_name: f.file_name };
        }
        if (f.part_id && !firstPerPart[f.part_id]) {
          firstPerPart[f.part_id] = { file_path: f.file_path, file_name: f.file_name };
        }
      }

      // Generate signed URLs for both maps
      const allEntries = [
        ...Object.entries(firstPerRfq).map(([k, v]) => ({ key: k, ...v, type: 'rfq' as const })),
        ...Object.entries(firstPerPart).map(([k, v]) => ({ key: k, ...v, type: 'part' as const })),
      ];
      const results = await Promise.all(
        allEntries.map(async (entry) => {
          const url = await getSignedUrl(entry.file_path);
          return url ? { key: entry.key, url, name: entry.file_name, type: entry.type } : null;
        })
      );
      const rfqMap: Record<string, { url: string; name: string }> = {};
      const partMap: Record<string, { url: string; name: string }> = {};
      for (const r of results) {
        if (!r) continue;
        if (r.type === 'rfq') rfqMap[r.key] = { url: r.url, name: r.name };
        else partMap[r.key] = { url: r.url, name: r.name };
      }
      setRfqThumbnails(prev => ({ ...prev, ...rfqMap }));
      setPartThumbnails(prev => ({ ...prev, ...partMap }));
    } catch (e) {
      // Silent fail — thumbnails are not critical
    }
  }

  // Load thumbnails when RFQs or orders change
  useEffect(() => {
    const rfqIds = rfqs.map(r => r.id);
    const orderRfqIds = orders.filter(o => o.rfq_id).map(o => o.rfq_id);
    const allIds = [...new Set([...rfqIds, ...orderRfqIds])];
    if (allIds.length > 0) fetchThumbnails(allIds);
  }, [rfqs, orders]);

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

  const generatePoNumber = async (): Promise<string> => {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const dateStr = `${day}${month}${year}`;

    // Count existing orders for today
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
    const { data: todayOrders } = await supabase
      .from('orders')
      .select('id')
      .gte('created_at', startOfDay)
      .lt('created_at', endOfDay);

    const seq = (todayOrders?.length || 0) + 1;
    return `PO-${dateStr}-${seq}`;
  };

  const createOrderFromRfq = async (rfqId: string) => {
    try {
      const { data: rfqData, error: rfqError } = await supabase.from('rfqs').select('*, customers(company_name)').eq('id', rfqId).single();
      if (rfqError) throw rfqError;

      const poNumber = await generatePoNumber();
      const rfqNumber = (rfqData as any).rfq_number || '';

      const { data: orderData, error: orderError } = await supabase
        .from('orders')
        .insert([{
          customer_id: rfqData.customer_id,
          rfq_id: rfqId,
          status: 'new',
          total_amount: rfqData.total_amount,
          currency: rfqData.currency,
          title: poNumber,
          po_number: poNumber,
          from_rfq_number: rfqNumber,
          start_date: new Date().toISOString(),
          delivery_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
        }])
        .select();
      if (orderError) throw orderError;

      if (orderData && rfqData.parts_details) {
        const orderItems = rfqData.parts_details.map((item: any) => ({
          order_id: orderData[0].id,
          product_name: item.product_name || item.name,
          description: item.description || '',
          quantity: item.quantity,
          unit_price: item.unit_price,
          total_price: item.total_price
        }));
        await supabase.from('order_items').insert(orderItems);
      }
      toast({ title: "Success", description: `Order ${poNumber} created successfully` });
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

  const generateRfqNumber = async (): Promise<string> => {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const dateStr = `${day}${month}${year}`;
    const prefix = `RFQ-${dateStr}-`;

    // Count existing RFQs with same prefix
    const { data: todayRfqs } = await supabase
      .from('rfqs')
      .select('title')
      .like('title', `${prefix}%`);

    const seq = (todayRfqs?.length || 0) + 1;
    return `${prefix}${seq}`;
  };

  const handleOpenCreateRfq = async () => {
    const rfqNumber = await generateRfqNumber();
    setNewRfq(prev => ({ ...prev, title: rfqNumber, customer_id: '' }));
    setCustomerSearch('');
    setIsCustomerDropdownOpen(false);
    setIsRfqDialogOpen(true);
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

  // Track which RFQs have been viewed (persisted in localStorage)
  const [viewedRfqIds, setViewedRfqIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('viewedRfqIds');
      return new Set(stored ? JSON.parse(stored) : []);
    } catch { return new Set(); }
  });

  // Check if an RFQ is "new" — received status or created within 48h, AND not yet viewed
  const isNewRfq = (rfq: RFQ): boolean => {
    if (viewedRfqIds.has(rfq.id)) return false;
    if (rfq.status === 'received') return true;
    const created = new Date(rfq.created_at);
    const hoursAgo = (Date.now() - created.getTime()) / (1000 * 60 * 60);
    return hoursAgo < 48 && rfq.status === 'draft';
  };

  // ── RFQ Card ──────────────
  const renderRfqCard = (rfq: RFQ) => {
    const partsQty = getPartsQtySummary(rfq);
    const statusConfig = RFQ_STATUS_CONFIG[rfq.status];
    const isDeleting = deleteConfirmId === rfq.id;
    const isNew = isNewRfq(rfq);

    // Collect tags from parts
    const processes = new Set<string>();
    let hasBending = false;
    let hasLaserMarking = false;
    (rfq.parts_details || []).forEach((part: any) => {
      const ov = part.original_values || {};
      const process = ov.processLabel || ov.process || part.process || '';
      if (process) processes.add(process);
      if (ov.needsBending === true || ov.needsBending === 'true' || part.needsBending) hasBending = true;
      const treatment = (ov.surfaceTreatmentLabel || ov.surfaceTreatment || part.surfaceTreatment || '').toLowerCase();
      if (treatment.includes('laser') || treatment.includes('marking') || treatment.includes('engrav')) hasLaserMarking = true;
    });

    const rfqThumb = rfqThumbnails[rfq.id];
    // Get material from first part for weight calculation
    const firstPart = (rfq.parts_details || [])[0] as any;
    const firstOv = firstPart?.original_values || {};
    const rfqMaterial = firstOv.materialSubtypeLabel || firstOv.materialLabel || firstOv.material || firstPart?.material || '';
    const rfqVolume = rfqVolumes[rfq.id];
    const rfqWeight = rfqVolume && rfqMaterial ? calculateWeight(rfqVolume, rfqMaterial) : null;

    return (
      <div key={rfq.id} className={`bg-white border rounded-lg transition-all hover:shadow-md ${isNew ? 'border-l-4 border-l-blue-500 ring-1 ring-blue-100' : 'border-slate-200'} mb-3`}>
        <div className="p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            {/* Thumbnail */}
            <div className="flex-shrink-0 hidden sm:block">
              {rfqThumb ? (
                <Suspense fallback={<div className="h-[144px] w-[144px] rounded bg-slate-50 border flex items-center justify-center"><div className="animate-spin rounded-full h-4 w-4 border-2 border-slate-300 border-t-slate-600" /></div>}>
                  <PartThumbnail3D
                    fileUrl={rfqThumb.url}
                    fileName={rfqThumb.name}
                    size={144}
                    onMetrics={(m) => {
                      setRfqVolumes(prev => {
                        if (prev[rfq.id]) return prev;
                        return { ...prev, [rfq.id]: m.volume };
                      });
                    }}
                  />
                  {rfqWeight != null && rfqWeight > 0 && (
                    <p className="text-[10px] text-muted-foreground text-center mt-0.5 flex items-center justify-center gap-0.5">
                      <Weight className="h-3 w-3" />{formatWeight(rfqWeight)}
                    </p>
                  )}
                </Suspense>
              ) : (
                <div className="h-[144px] w-[144px] rounded bg-slate-50 border flex flex-col items-center justify-center">
                  <Box className="h-5 w-5 text-slate-300" />
                </div>
              )}
            </div>

            {/* Left: ID, customer, date, status */}
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Link
                  to={`/rfq/${rfq.id}`}
                  className="text-sm font-semibold text-slate-900 hover:text-blue-700 hover:underline truncate"
                >
                  {rfq.rfq_number || rfq.title || `RFQ ${rfq.id.slice(0, 8)}`}
                </Link>
                {isNew && (
                  <span className="inline-flex items-center gap-1 bg-blue-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">
                    <Sparkles className="h-3 w-3" />New
                  </span>
                )}
                <Badge className={`${statusConfig.className} border-0 text-[11px] font-medium`}>
                  {statusConfig.label}
                </Badge>
              </div>
              {/* Tags row */}
              {(processes.size > 0 || hasBending || hasLaserMarking) && (
                <div className="flex flex-wrap gap-1">
                  {Array.from(processes).map(p => (
                    <Badge key={p} variant="outline" className="text-[10px] px-1.5 py-0 bg-slate-50">{p}</Badge>
                  ))}
                  {hasBending && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-orange-50 text-orange-700 border-orange-200">Bending</Badge>
                  )}
                  {hasLaserMarking && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-purple-50 text-purple-700 border-purple-200">Laser Marking</Badge>
                  )}
                </div>
              )}
              <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                <span className="font-medium text-foreground">{rfq.customer_name}</span>
                <span className="hidden sm:inline">·</span>
                <span>{format(new Date(rfq.created_at), 'MMM dd, yyyy')}</span>
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
                {/* Expand/collapse button */}
                {rfq.parts_details && rfq.parts_details.length > 0 && (
                  <Button variant="outline" size="sm" className="gap-1 text-xs font-medium" onClick={() => toggleExpand(rfq.id)} title="Show parts overview">
                    {expandedCards.has(rfq.id) ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    <span className="hidden sm:inline">Parts</span>
                  </Button>
                )}
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

          {/* Expandable parts overview */}
          {expandedCards.has(rfq.id) && rfq.parts_details && rfq.parts_details.length > 0 && (() => {
            const pd = rfq.parts_details;
            const currentIdx = partIndexes[rfq.id] || 0;
            const part = pd[currentIdx] as any;
            const ov = part?.original_values || {};
            const material = ov.materialSubtypeLabel || ov.materialLabel || ov.material || part?.material || '';
            const process = ov.processLabel || ov.process || part?.process || '';
            const thickness = ov.thickness || part?.thickness || '';
            const surfaceTreatment = ov.surfaceTreatmentLabel || ov.surfaceTreatment || '';
            const tolerance = ov.toleranceLabel || ov.tolerance || '';
            const surfaceRoughness = ov.surfaceRoughnessLabel || ov.surfaceRoughness || '';
            const needsBending = ov.needsBending === true || ov.needsBending === 'true';
            const volume = part?.volume || ov.volume || rfqVolumes[part?.id] || rfqVolumes[rfq.id];
            const estWeight = volume && material ? calculateWeight(volume, material) : null;
            // Per-part thumbnail (falls back to rfq-level)
            const partThumb = (part?.id && partThumbnails[part.id]) || rfqThumbnails[rfq.id];
            return (
              <div className="border-t mt-3 pt-3">
                <div className="flex items-center gap-3">
                  {/* Navigation arrows */}
                  <Button variant="outline" size="sm" className="h-8 w-8 p-0" disabled={pd.length <= 1} onClick={() => navigatePart(rfq.id, 'prev', pd.length)}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  {/* Per-part thumbnail */}
                  <div className="flex-shrink-0 hidden sm:block">
                    {partThumb ? (
                      <Suspense fallback={<div className="h-[128px] w-[128px] rounded bg-slate-50 border flex items-center justify-center"><div className="animate-spin rounded-full h-3 w-3 border-2 border-slate-300 border-t-slate-600" /></div>}>
                        <PartThumbnail3D
                          fileUrl={partThumb.url}
                          fileName={partThumb.name}
                          size={128}
                          onMetrics={(m) => {
                            if (part?.id) setRfqVolumes(prev => prev[part.id] ? prev : { ...prev, [part.id]: m.volume });
                          }}
                        />
                      </Suspense>
                    ) : (
                      <div className="h-[128px] w-[128px] rounded bg-slate-50 border flex flex-col items-center justify-center">
                        <Box className="h-4 w-4 text-slate-300" />
                      </div>
                    )}
                  </div>
                  {/* Part info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{part?.product_name || part?.name || `Part ${currentIdx + 1}`}</span>
                      <span className="text-xs text-muted-foreground">({currentIdx + 1}/{pd.length})</span>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground mt-1">
                      {material && <span><Layers className="h-3 w-3 inline mr-0.5" />{material}</span>}
                      {process && <span>{process}</span>}
                      {thickness && <span>t: {thickness}mm</span>}
                      {part?.quantity > 1 && <span>Qty: {part.quantity}</span>}
                      {part?.dimensions && <span>{part.dimensions.x?.toFixed(1)}x{part.dimensions.y?.toFixed(1)}x{part.dimensions.z?.toFixed(1)}mm</span>}
                      {estWeight != null && estWeight > 0 && <span><Weight className="h-3 w-3 inline mr-0.5" />{formatWeight(estWeight)}</span>}
                    </div>
                    {/* Additional specs row */}
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground mt-0.5">
                      {surfaceTreatment && surfaceTreatment !== 'none' && <span>Finish: {surfaceTreatment}</span>}
                      {tolerance && <span>Tol: {tolerance}</span>}
                      {surfaceRoughness && <span>Ra: {surfaceRoughness}</span>}
                      {needsBending && <span className="text-orange-600 font-medium">Bending</span>}
                    </div>
                  </div>
                  <Button variant="outline" size="sm" className="h-8 w-8 p-0" disabled={pd.length <= 1} onClick={() => navigatePart(rfq.id, 'next', pd.length)}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    );
  };

  // ── Order Card (matching customer-side pattern) ────────────
  const renderOrderCard = (order: any) => {
    const orderId = order.po_number || generateOrderId(order);
    const statusConfig = ORDER_STATUS_CONFIG[order.status] || { label: order.status, className: 'bg-gray-100 text-gray-700' };
    const isDeleting = deleteConfirmId === order.id;

    // Get first part's thumbnail info
    const partsDetails = order.parts_details || [];
    const partsSummary = partsDetails.length > 0
      ? `${partsDetails.length} part${partsDetails.length > 1 ? 's' : ''}`
      : null;

    // Collect tags from parts
    const tags: { label: string; className: string }[] = [];
    const processes = new Set<string>();
    let hasBending = false;
    let hasLaserMarking = false;
    partsDetails.forEach((part: any) => {
      const ov = part.original_values || {};
      const process = ov.processLabel || ov.process || part.process || '';
      if (process) processes.add(process);
      if (ov.needsBending === true || ov.needsBending === 'true' || part.needsBending) hasBending = true;
      const treatment = (ov.surfaceTreatmentLabel || ov.surfaceTreatment || part.surfaceTreatment || '').toLowerCase();
      if (treatment.includes('laser') || treatment.includes('marking') || treatment.includes('engrav')) hasLaserMarking = true;
    });

    const orderThumb = order.rfq_id ? rfqThumbnails[order.rfq_id] : null;
    const orderFirstPart = partsDetails[0] as any;
    const orderFirstOv = orderFirstPart?.original_values || {};
    const orderMaterial = orderFirstOv.materialSubtypeLabel || orderFirstOv.materialLabel || orderFirstOv.material || orderFirstPart?.material || '';
    const orderRfqId = order.rfq_id || order.id;
    const orderVolume = rfqVolumes[orderRfqId];
    const orderWeight = orderVolume && orderMaterial ? calculateWeight(orderVolume, orderMaterial) : null;

    return (
      <div key={order.id} className="bg-white border border-slate-200 rounded-lg mb-3 transition-all hover:shadow-md">
        <div className="p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            {/* Thumbnail */}
            <div className="flex-shrink-0 hidden sm:block">
              {orderThumb ? (
                <Suspense fallback={<div className="h-[144px] w-[144px] rounded bg-slate-50 border flex items-center justify-center"><div className="animate-spin rounded-full h-4 w-4 border-2 border-slate-300 border-t-slate-600" /></div>}>
                  <PartThumbnail3D
                    fileUrl={orderThumb.url}
                    fileName={orderThumb.name}
                    size={144}
                    onMetrics={(m) => {
                      setRfqVolumes(prev => {
                        if (prev[orderRfqId]) return prev;
                        return { ...prev, [orderRfqId]: m.volume };
                      });
                    }}
                  />
                  {orderWeight != null && orderWeight > 0 && (
                    <p className="text-[10px] text-muted-foreground text-center mt-0.5 flex items-center justify-center gap-0.5">
                      <Weight className="h-3 w-3" />{formatWeight(orderWeight)}
                    </p>
                  )}
                </Suspense>
              ) : (
                <div className="h-[144px] w-[144px] rounded bg-slate-50 border flex flex-col items-center justify-center">
                  <Box className="h-5 w-5 text-slate-300" />
                </div>
              )}
            </div>

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
                {order.from_rfq_number && (
                  <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
                    From RFQ: {order.from_rfq_number}
                  </Badge>
                )}
              </div>
              {/* Tags row */}
              {(processes.size > 0 || hasBending || hasLaserMarking) && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {Array.from(processes).map(p => (
                    <Badge key={p} variant="outline" className="text-[10px] px-1.5 py-0 bg-slate-50">{p}</Badge>
                  ))}
                  {hasBending && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-orange-50 text-orange-700 border-orange-200">Bending</Badge>
                  )}
                  {hasLaserMarking && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-purple-50 text-purple-700 border-purple-200">Laser Marking</Badge>
                  )}
                </div>
              )}
              <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                <span className="font-medium text-foreground">{order.customer_name}</span>
                <span className="hidden sm:inline">·</span>
                <span>{format(new Date(order.created_at), 'MMM dd, yyyy')}</span>
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
              {partsSummary && (
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Parts</p>
                  <p className="text-sm font-medium">{partsSummary}</p>
                </div>
              )}
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
                {/* Expand/collapse button */}
                {partsDetails.length > 0 && (
                  <Button variant="outline" size="sm" className="gap-1 text-xs font-medium" onClick={() => toggleExpand(order.id)} title="Show parts overview">
                    {expandedCards.has(order.id) ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    <span className="hidden sm:inline">Parts</span>
                  </Button>
                )}
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

          {/* Expandable parts overview */}
          {expandedCards.has(order.id) && partsDetails.length > 0 && (() => {
            const pd = partsDetails;
            const currentIdx = partIndexes[order.id] || 0;
            const part = pd[currentIdx] as any;
            const ov = part?.original_values || {};
            const material = ov.materialSubtypeLabel || ov.materialLabel || ov.material || part?.material || '';
            const process = ov.processLabel || ov.process || part?.process || '';
            const thickness = ov.thickness || part?.thickness || '';
            const surfaceTreatment = ov.surfaceTreatmentLabel || ov.surfaceTreatment || '';
            const tolerance = ov.toleranceLabel || ov.tolerance || '';
            const surfaceRoughness = ov.surfaceRoughnessLabel || ov.surfaceRoughness || '';
            const needsBending = ov.needsBending === true || ov.needsBending === 'true';
            const volume = part?.volume || ov.volume || rfqVolumes[part?.id] || rfqVolumes[orderRfqId];
            const estWeight = volume && material ? calculateWeight(volume, material) : null;
            const partThumb = (part?.id && partThumbnails[part.id]) || (order.rfq_id ? rfqThumbnails[order.rfq_id] : null);
            return (
              <div className="border-t mt-3 pt-3">
                <div className="flex items-center gap-3">
                  <Button variant="outline" size="sm" className="h-8 w-8 p-0" disabled={pd.length <= 1} onClick={() => navigatePart(order.id, 'prev', pd.length)}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  {/* Per-part thumbnail */}
                  <div className="flex-shrink-0 hidden sm:block">
                    {partThumb ? (
                      <Suspense fallback={<div className="h-[128px] w-[128px] rounded bg-slate-50 border flex items-center justify-center"><div className="animate-spin rounded-full h-3 w-3 border-2 border-slate-300 border-t-slate-600" /></div>}>
                        <PartThumbnail3D
                          fileUrl={partThumb.url}
                          fileName={partThumb.name}
                          size={128}
                          onMetrics={(m) => {
                            if (part?.id) setRfqVolumes(prev => prev[part.id] ? prev : { ...prev, [part.id]: m.volume });
                          }}
                        />
                      </Suspense>
                    ) : (
                      <div className="h-[128px] w-[128px] rounded bg-slate-50 border flex flex-col items-center justify-center">
                        <Box className="h-4 w-4 text-slate-300" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{part?.product_name || part?.name || `Part ${currentIdx + 1}`}</span>
                      <span className="text-xs text-muted-foreground">({currentIdx + 1}/{pd.length})</span>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground mt-1">
                      {material && <span><Layers className="h-3 w-3 inline mr-0.5" />{material}</span>}
                      {process && <span>{process}</span>}
                      {thickness && <span>t: {thickness}mm</span>}
                      {part?.quantity > 1 && <span>Qty: {part.quantity}</span>}
                      {part?.dimensions && <span>{part.dimensions.x?.toFixed(1)}x{part.dimensions.y?.toFixed(1)}x{part.dimensions.z?.toFixed(1)}mm</span>}
                      {estWeight != null && estWeight > 0 && <span><Weight className="h-3 w-3 inline mr-0.5" />{formatWeight(estWeight)}</span>}
                    </div>
                    {/* Additional specs row */}
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground mt-0.5">
                      {surfaceTreatment && surfaceTreatment !== 'none' && <span>Finish: {surfaceTreatment}</span>}
                      {tolerance && <span>Tol: {tolerance}</span>}
                      {surfaceRoughness && <span>Ra: {surfaceRoughness}</span>}
                      {needsBending && <span className="text-orange-600 font-medium">Bending</span>}
                    </div>
                  </div>
                  <Button variant="outline" size="sm" className="h-8 w-8 p-0" disabled={pd.length <= 1} onClick={() => navigatePart(order.id, 'next', pd.length)}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })()}
        </div>
      </div>
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
    <div className="bg-white border border-slate-200 rounded-lg flex flex-col items-center justify-center py-16 text-center">
      <div className="rounded-full bg-slate-100 p-5 mb-5">
        {type === 'rfqs' ? <FileText className="h-10 w-10 text-slate-400" /> : <Package className="h-10 w-10 text-slate-400" />}
      </div>
      <h3 className="text-lg font-semibold text-slate-900 mb-1">No {type === 'rfqs' ? 'RFQs' : 'orders'} found</h3>
      <p className="text-sm text-slate-500 mb-5 max-w-md">
        {type === 'rfqs'
          ? 'Create a new RFQ to get started with quoting.'
          : 'Orders are created when RFQs are approved.'}
      </p>
      {type === 'rfqs' && (
        <Button onClick={handleOpenCreateRfq} size="sm" className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> New RFQ
        </Button>
      )}
    </div>
  );

  // ── Loading state ──────────────────────────────────────────
  const renderLoading = () => (
    <div className="bg-white border border-slate-200 rounded-lg flex items-center justify-center py-20">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
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
      <div className="min-h-screen bg-slate-50">
        {/* Top bar — materials section style */}
        <div className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <Link to="/dashboard" className="text-sm text-slate-500 hover:text-slate-700">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div>
              <h1 className="text-lg font-semibold text-slate-900">RFQ & Orders</h1>
              <p className="text-xs text-slate-500">Manage requests for quotation and production orders</p>
            </div>
          </div>
          <Button onClick={handleOpenCreateRfq} size="sm" className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> New RFQ
          </Button>
        </div>

        {/* Content */}
        <div className="px-6 py-5 max-w-6xl mx-auto space-y-4">
          {/* Filters bar */}
          <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search by RFQ number, order ID, title, or customer..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-500 whitespace-nowrap">From</label>
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="border border-slate-200 rounded-md px-2 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                <label className="text-xs text-slate-500 whitespace-nowrap">To</label>
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="border border-slate-200 rounded-md px-2 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
              </div>
            </div>
          </div>

          {/* Tabs */}
          <Tabs value={mainTab} onValueChange={(v) => setMainTab(v as "rfqs" | "orders")}>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <TabsList className="bg-slate-100">
                <TabsTrigger value="rfqs">
                  RFQs
                  {rfqCount > 0 && (
                    <span className="ml-1.5 text-[10px] bg-slate-300/50 rounded-full px-2 py-0.5">{rfqCount}</span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="orders">
                  Orders
                  {orderCount > 0 && (
                    <span className="ml-1.5 text-[10px] bg-slate-300/50 rounded-full px-2 py-0.5">{orderCount}</span>
                  )}
                </TabsTrigger>
              </TabsList>

              {/* Status filter pills for RFQs */}
              {mainTab === 'rfqs' && (
                <div className="flex gap-1 flex-wrap">
                  {(['all', 'draft', 'sent', 'received', 'approved', 'rejected'] as const).map(s => (
                    <button
                      key={s}
                      onClick={() => setStatusFilter(s)}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        statusFilter === s
                          ? 'bg-slate-900 text-white'
                          : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {s === 'all' ? 'All' : RFQ_STATUS_CONFIG[s].label}
                    </button>
                  ))}
                </div>
              )}

              {/* Calendar link for orders */}
              {mainTab === 'orders' && (
                <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => navigate('/calendar')}>
                  <Calendar className="h-3.5 w-3.5" /> Calendar
                </Button>
              )}
            </div>

            <div className="mt-4">
              <TabsContent value="rfqs" className="mt-0">{renderContent()}</TabsContent>
              <TabsContent value="orders" className="mt-0">{renderContent()}</TabsContent>
            </div>
          </Tabs>
        </div>
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
              <div className="relative">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    placeholder="Search by name, company, email, or VAT..."
                    className="pl-10"
                    value={customerSearch}
                    onChange={(e) => {
                      setCustomerSearch(e.target.value);
                      setIsCustomerDropdownOpen(true);
                      if (!e.target.value) {
                        setNewRfq(prev => ({ ...prev, customer_id: '' }));
                      }
                    }}
                    onFocus={() => setIsCustomerDropdownOpen(true)}
                  />
                </div>
                {newRfq.customer_id && (
                  <div className="mt-1.5 flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-md px-3 py-1.5">
                    <span className="text-sm font-medium text-blue-900">{customers.find(c => c.id === newRfq.customer_id)?.company_name}</span>
                    <button type="button" onClick={() => { setNewRfq(prev => ({ ...prev, customer_id: '' })); setCustomerSearch(''); }} className="ml-auto text-blue-400 hover:text-blue-600"><X className="h-3.5 w-3.5" /></button>
                  </div>
                )}
                {isCustomerDropdownOpen && !newRfq.customer_id && (
                  <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-[240px] overflow-y-auto">
                    {(() => {
                      const q = customerSearch.toLowerCase();
                      const filtered = q
                        ? customers.filter(c =>
                            c.company_name.toLowerCase().includes(q) ||
                            (c.email || '').toLowerCase().includes(q) ||
                            (c.contact_name || '').toLowerCase().includes(q) ||
                            (c.first_name || '').toLowerCase().includes(q) ||
                            (c.last_name || '').toLowerCase().includes(q) ||
                            (c.vat_tax_id || '').toLowerCase().includes(q)
                          )
                        : customers.slice(0, 15);
                      if (filtered.length === 0) {
                        return <div className="px-4 py-3 text-sm text-slate-500">No customers found</div>;
                      }
                      return filtered.map(c => (
                        <button
                          key={c.id}
                          type="button"
                          className="w-full text-left px-4 py-2.5 hover:bg-slate-50 border-b border-slate-100 last:border-b-0 transition-colors"
                          onClick={() => {
                            setNewRfq(prev => ({ ...prev, customer_id: c.id }));
                            setCustomerSearch(c.company_name);
                            setIsCustomerDropdownOpen(false);
                          }}
                        >
                          <p className="text-sm font-medium text-slate-900">{c.company_name}</p>
                          <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                            {c.email && <span>{c.email}</span>}
                            {c.vat_tax_id && <><span className="text-slate-300">|</span><span className="font-mono">{c.vat_tax_id}</span></>}
                          </div>
                        </button>
                      ));
                    })()}
                  </div>
                )}
              </div>
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
