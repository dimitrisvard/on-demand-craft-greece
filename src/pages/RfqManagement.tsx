import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { RFQ, RfqItem } from "@/types/customer";
import { Database } from '@/integrations/supabase/types';
import { Briefcase, FileText, Calendar, Package } from "lucide-react";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
import { 
  ChevronLeft, 
  ChevronDown, 
  ChevronUp,
  FilePlus, 
  Search, 
  MoreHorizontal, 
  Edit, 
  FileText, 
  Trash, 
  Plus,
  Download,
  Send,
  FileCheck,
  UserPlus
} from "lucide-react";
import { CustomerSearchAssign } from "@/components/customers/CustomerSearchAssign";
import PersistentDashboardLayout from "@/components/dashboard/PersistentDashboardLayout";

type RfqStatus = "draft" | "sent" | "received" | "approved" | "rejected";

type Customer = {
  id: string;
  company_name: string;
};

type RfqRow = Database['public']['Tables']['rfqs']['Row'];

export default function RfqManagement() {
  const [rfqs, setRfqs] = useState<RFQ[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [rfqItems, setRfqItems] = useState<RfqItem[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedRfq, setSelectedRfq] = useState<RFQ | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [expandedRfqId, setExpandedRfqId] = useState<string | null>(null);
  const [isRfqDialogOpen, setIsRfqDialogOpen] = useState(false);
  const [isItemDialogOpen, setIsItemDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isConvertToOrderDialogOpen, setIsConvertToOrderDialogOpen] = useState(false);
  const [isCustomerAssignDialogOpen, setIsCustomerAssignDialogOpen] = useState(false);
  const [isOrderCustomerAssignDialogOpen, setIsOrderCustomerAssignDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<RfqStatus | "all">("all");
  const [mainTab, setMainTab] = useState<"rfqs" | "orders">("rfqs");
  
  const [newRfq, setNewRfq] = useState<Partial<RFQ>>({
    title: "",
    customer_id: "",
    status: "draft" as RfqStatus,
    currency: "USD",
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

  useEffect(() => {
    fetchRfqs();
  }, [activeTab, searchQuery]);

  useEffect(() => {
    if (expandedRfqId) {
      fetchRfqItems(expandedRfqId);
    }
  }, [expandedRfqId]);

  useEffect(() => {
    if (newItem.unit_price !== undefined && newItem.quantity !== undefined) {
      setNewItem({
        ...newItem,
        total_price: newItem.unit_price * newItem.quantity
      });
    }
  }, [newItem.unit_price, newItem.quantity]);

  async function fetchRfqs() {
    try {
      setLoading(true);
      
      let query = supabase
        .from('rfqs')
        .select('*, customers(company_name)');
      
      if (activeTab !== "all") {
        query = query.eq('status', activeTab);
      }
      
      if (searchQuery) {
        query = query.or(`title.ilike.%${searchQuery}%,customers.company_name.ilike.%${searchQuery}%`);
      }
      
      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) throw error;
      
      const transformedData: RFQ[] = data.map(item => ({
        id: item.id,
        title: item.title,
        customer_id: item.customer_id,
        customer_name: item.customers?.company_name || 'Unknown',
        status: item.status as RfqStatus,
        total_amount: item.total_amount || 0,
        currency: item.currency || 'USD',
        created_at: item.created_at,
        due_date: item.due_date || new Date().toISOString(),
        version: item.version || 1,
        parts_details: (item as unknown as { parts_details: RfqItem[] }).parts_details || []
      }));
      
      setRfqs(transformedData);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to load RFQs",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function fetchRfqItems(rfqId: string) {
    try {
      const { data, error } = await supabase
        .from('rfqs')
        .select('parts_details')
        .eq('id', rfqId)
        .single();

      if (error) throw error;
      
      const partsDetails = ((data as unknown as { parts_details: RfqItem[] })?.parts_details || []) as RfqItem[];
      setRfqItems(partsDetails);
    } catch (error: any) {
      toast({
        title: "Error", 
        description: error.message || "Failed to load RFQ items",
        variant: "destructive",
      });
    }
  }

  async function fetchCustomers() {
    try {
      const { data, error } = await supabase
        .from('customers')
        .select('id, company_name')
        .order('company_name', { ascending: true });

      if (error) throw error;
      setCustomers(data as Customer[]);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to load customers",
        variant: "destructive",
      });
    }
  }

  async function fetchOrders() {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*, customers(company_name, vat_tax_id)')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const transformedOrders = (data || []).map(item => ({
        ...item,
        customer_name: item.customers?.company_name || 'Unassigned',
        customer_vat: item.customers?.vat_tax_id,
      }));
      setOrders(transformedOrders);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to load orders",
        variant: "destructive",
      });
    }
  }

  const generateOrderId = (order: any) => {
    const orderDate = new Date(order.created_at);
    const day = String(orderDate.getDate()).padStart(2, '0');
    const month = String(orderDate.getMonth() + 1).padStart(2, '0');
    const year = orderDate.getFullYear();
    const dateStr = `${day}${month}${year}`;

    // Find all orders on the same date and determine sequence number
    const sameDateOrders = orders
      .filter(o => {
        const d = new Date(o.created_at);
        return d.getDate() === orderDate.getDate() &&
               d.getMonth() === orderDate.getMonth() &&
               d.getFullYear() === orderDate.getFullYear();
      })
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    const seqIndex = sameDateOrders.findIndex(o => o.id === order.id);
    const seqNum = seqIndex >= 0 ? seqIndex + 1 : 1;

    return `PO-${dateStr}-${seqNum}`;
  };

  const getOrderStatusBadge = (status: string) => {
    switch (status) {
      case 'new':
        return <Badge>New</Badge>;
      case 'in_progress':
        return <Badge variant="default">In Progress</Badge>;
      case 'completed':
        return <Badge variant="secondary">Completed</Badge>;
      case 'cancelled':
        return <Badge variant="destructive">Cancelled</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const handleAddRfq = async () => {
    try {
      if (!newRfq.title || !newRfq.customer_id) {
        toast({
          title: "Error",
          description: "Title and customer are required",
          variant: "destructive",
        });
        return;
      }

      const { data, error } = await supabase
        .from('rfqs')
        .insert([
          {
            title: newRfq.title,
            customer_id: newRfq.customer_id,
            status: newRfq.status,
            currency: newRfq.currency,
            due_date: newRfq.due_date,
            version: newRfq.version,
            total_amount: 0
          }
        ])
        .select();

      if (error) throw error;

      toast({
        title: "Success",
        description: "RFQ created successfully",
      });

      if (data && data.length > 0) {
        navigate(`/rfq/${data[0].id}`);
      } else {
        fetchRfqs();
        setIsRfqDialogOpen(false);
        resetNewRfqForm();
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to create RFQ",
        variant: "destructive",
      });
    }
  };

  const handleAddItem = async () => {
    try {
      if (!selectedRfq || !newItem.product_name) {
        toast({
          title: "Error",
          description: "Product name is required",
          variant: "destructive",
        });
        return;
      }

      // Get current RFQ data
      const { data: rfqData, error: rfqError } = await supabase
        .from('rfqs')
        .select('parts_details')
        .eq('id', selectedRfq.id)
        .single();
      
      if (rfqError) throw rfqError;

      const now = new Date().toISOString();
      
      // Create new item with ID
      const newItemWithId: RfqItem = {
        id: crypto.randomUUID(),
        rfq_id: selectedRfq.id,
        product_name: newItem.product_name || '',
        description: newItem.description || '',
        quantity: newItem.quantity || 0,
        unit_price: newItem.unit_price || 0,
        total_price: newItem.total_price || 0,
        created_at: now,
        updated_at: now
      };
      
      // Update parts_details array
      const currentParts = ((rfqData as unknown as { parts_details: RfqItem[] })?.parts_details || []) as RfqItem[];
      const updatedParts = [...currentParts, newItemWithId];
      
      // Update RFQ with new parts_details
      const { error: updateError } = await supabase
        .from('rfqs')
        .update({ parts_details: updatedParts } as unknown as RfqRow)
        .eq('id', selectedRfq.id);
      
      if (updateError) throw updateError;

      // Update total
      const newTotal = (currentParts.reduce((sum, item) => sum + item.total_price, 0) + newItemWithId.total_price) || 0;
      await updateRfqTotal(selectedRfq.id, newTotal);

      toast({
        title: "Success",
        description: "Item added successfully",
      });

      fetchRfqItems(selectedRfq.id);
      setIsItemDialogOpen(false);
      resetNewItemForm();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to add item",
        variant: "destructive",
      });
    }
  };

  const handleUpdateRfqStatus = async (rfqId: string, newStatus: RfqStatus) => {
    try {
      const { error } = await supabase
        .from('rfqs')
        .update({ status: newStatus })
        .eq('id', rfqId);

      if (error) throw error;

      toast({
        title: "Success",
        description: `RFQ ${newStatus === 'approved' ? 'approved and converted to order' : newStatus}`,
      });

      if (newStatus === 'approved') {
        await createOrderFromRfq(rfqId);
      }

      fetchRfqs();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update RFQ status",
        variant: "destructive",
      });
    }
  };

  const createOrderFromRfq = async (rfqId: string) => {
    try {
      const { data: rfqData, error: rfqError } = await supabase
        .from('rfqs')
        .select('*')
        .eq('id', rfqId)
        .single();

      if (rfqError) throw rfqError;

      const { data: orderData, error: orderError } = await supabase
        .from('orders')
        .insert([
          {
            customer_id: rfqData.customer_id,
            rfq_id: rfqId,
            status: 'new',
            total_amount: rfqData.total_amount,
            currency: rfqData.currency,
            title: `Order - ${rfqData.title}`,
            start_date: new Date().toISOString(),
            delivery_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
          }
        ])
        .select();

      if (orderError) throw orderError;

      const { data: itemsData, error: itemsError } = await supabase
        .from('rfqs')
        .select('parts_details')
        .eq('id', rfqId)
        .single();

      if (itemsError) throw itemsError;

      if (orderData && itemsData) {
        const orderItems = itemsData.parts_details.map(item => ({
          order_id: orderData[0].id,
          product_name: item.product_name,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          total_price: item.total_price
        }));

        const { error: orderItemsError } = await supabase
          .from('order_items')
          .insert(orderItems);

        if (orderItemsError) throw orderItemsError;

        // Note: This order creation doesn't assign a partner, so no notification needed
        // If partner assignment is added later, notification should be implemented here
      }

      toast({
        title: "Success",
        description: "Order created successfully",
      });

      setTimeout(() => {
        navigate('/calendar');
      }, 1500);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to create order",
        variant: "destructive",
      });
    }
  };

  const handleDeleteRfq = async () => {
    try {
      if (!selectedRfq) return;

      const { error } = await supabase
        .from('rfqs')
        .delete()
        .eq('id', selectedRfq.id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "RFQ deleted successfully",
      });

      fetchRfqs();
      setIsDeleteDialogOpen(false);
      setSelectedRfq(null);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to delete RFQ",
        variant: "destructive",
      });
    }
  };

  const handleCustomerAssign = async (customer: any) => {
    if (!selectedRfq) return;
    
    try {
      const { error } = await supabase
        .from('rfqs')
        .update({ customer_id: customer?.id || null })
        .eq('id', selectedRfq.id);
        
      if (error) throw error;
      
      toast({
        title: "Success",
        description: customer ? `Customer ${customer.company_name} assigned successfully` : "Customer assignment removed",
      });
      
      setIsCustomerAssignDialogOpen(false);
      setSelectedRfq(null);
      fetchRfqs();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to assign customer",
        variant: "destructive",
      });
    }
  };

  const handleOrderCustomerAssign = async (customer: any) => {
    if (!selectedOrder) return;
    
    try {
      const { error } = await supabase
        .from('orders')
        .update({ customer_id: customer?.id || null })
        .eq('id', selectedOrder.id);
        
      if (error) throw error;
      
      toast({
        title: "Success",
        description: customer ? `Customer ${customer.company_name} assigned successfully` : "Customer assignment removed",
      });
      
      setIsOrderCustomerAssignDialogOpen(false);
      setSelectedOrder(null);
      fetchOrders();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to assign customer",
        variant: "destructive",
      });
    }
  };

  const updateRfqTotal = async (rfqId: string, total: number) => {
    try {
      const { error } = await supabase
        .from('rfqs')
        .update({ total_amount: total })
        .eq('id', rfqId);

      if (error) throw error;
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update RFQ total",
        variant: "destructive",
      });
    }
  };

  const resetNewRfqForm = () => {
    setNewRfq({
      title: "",
      customer_id: "",
      status: "draft",
      currency: "USD",
      due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      version: 1
    });
  };

  const resetNewItemForm = () => {
    setNewItem({
      product_name: "",
      description: "",
      quantity: 1,
      unit_price: 0,
      total_price: 0
    });
  };

  const handleRfqClick = (rfq: RFQ) => {
    setSelectedRfq(rfq);
    if (expandedRfqId === rfq.id) {
      setExpandedRfqId(null);
      setRfqItems([]);
    } else {
      setExpandedRfqId(rfq.id);
    }
  };

  const handleNewRfqClick = () => {
    setSelectedRfq(null);
    resetNewRfqForm();
    setIsRfqDialogOpen(true);
  };

  const handleNewItemClick = () => {
    resetNewItemForm();
    setIsItemDialogOpen(true);
  };

  const handleRfqInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setNewRfq({
      ...newRfq,
      [name]: value
    });
  };

  const handleItemInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    const numValue = name === 'quantity' || name === 'unit_price' ? parseFloat(value) || 0 : value;
    
    setNewItem({
      ...newItem,
      [name]: numValue
    });
  };

  const statusMap = {
    draft: {
      label: "Draft",
      variant: "outline" as const,
    },
    sent: {
      label: "Sent",
      variant: "secondary" as const,
    },
    received: {
      label: "Received",
      variant: "default" as const,
    },
    approved: {
      label: "Approved",
      variant: "default" as const,
    },
    rejected: {
      label: "Rejected",
      variant: "destructive" as const,
    },
  };

  const getStatusBadge = (status: RfqStatus) => {
    const statusInfo = statusMap[status];
    if (!statusInfo) {
      return <Badge variant="outline">Unknown</Badge>;
    }
    return <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>;
  };

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  };

  const handleDownloadPdf = (rfq: RFQ) => {
    toast({
      title: "PDF Generation",
      description: "PDF download functionality would be implemented here with a PDF generation library",
    });
  };

  const handleViewDetails = (rfqId: string) => {
    navigate(`/rfq/${rfqId}`);
  };

  const getRfqStatusActions = (rfq: RFQ) => {
    const actions = [];

    if (rfq.status === 'draft') {
      actions.push(
        <DropdownMenuItem key="send" onClick={() => handleUpdateRfqStatus(rfq.id, 'sent')}>
          <Send className="mr-2 h-4 w-4" />
          Mark as Sent
        </DropdownMenuItem>
      );
    }

    if (rfq.status === 'sent') {
      actions.push(
        <DropdownMenuItem key="receive" onClick={() => handleUpdateRfqStatus(rfq.id, 'received')}>
          <FileCheck className="mr-2 h-4 w-4" />
          Mark as Received
        </DropdownMenuItem>
      );
    }

    if (rfq.status === 'received') {
      actions.push(
        <DropdownMenuItem key="approve" onClick={() => handleUpdateRfqStatus(rfq.id, 'approved')}>
          <FileCheck className="mr-2 h-4 w-4" />
          Approve & Create Order
        </DropdownMenuItem>,
        <DropdownMenuItem key="reject" onClick={() => handleUpdateRfqStatus(rfq.id, 'rejected')}>
          <Trash className="mr-2 h-4 w-4" />
          Reject
        </DropdownMenuItem>
      );
    }

    if (rfq.status !== 'approved') {
      actions.push(
        <DropdownMenuItem key="convert" onClick={() => createOrderFromRfq(rfq.id)}>
          <FileText className="mr-2 h-4 w-4" />
          Convert to Order
        </DropdownMenuItem>
      );
    }

    return actions;
  };

  return (
    <PersistentDashboardLayout>
      <div className="space-y-6">
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold">RFQ & Orders Management</h1>
          </div>
        <Button 
          onClick={handleNewRfqClick}
          className="flex items-center gap-1"
        >
          <FilePlus className="h-4 w-4" /> New RFQ
        </Button>
      </div>

      {/* Main Tabs for RFQs vs Orders */}
      <Tabs value={mainTab} onValueChange={(value) => setMainTab(value as "rfqs" | "orders")} className="w-full">
        <TabsList className="grid w-full grid-cols-2 mb-6">
          <TabsTrigger value="rfqs" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            RFQs
          </TabsTrigger>
          <TabsTrigger value="orders" className="flex items-center gap-2">
            <Briefcase className="h-4 w-4" />
            Orders
          </TabsTrigger>
        </TabsList>

        <TabsContent value="rfqs" className="space-y-6">
          <div className="flex items-center gap-4 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by title or customer..."
                className="pl-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Tabs defaultValue="all" className="w-fit" onValueChange={(value) => setActiveTab(value as RfqStatus | "all")}>
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="draft">Draft</TabsTrigger>
                <TabsTrigger value="sent">Sent</TabsTrigger>
                <TabsTrigger value="received">Received</TabsTrigger>
                <TabsTrigger value="approved">Approved</TabsTrigger>
                <TabsTrigger value="rejected">Rejected</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Request for Quotations</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead style={{ width: '30px' }}></TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Total Amount</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>Version</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center">Loading...</TableCell>
                </TableRow>
              ) : rfqs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center">No RFQs found</TableCell>
                </TableRow>
              ) : (
                rfqs.map((rfq) => (
                  <React.Fragment key={rfq.id}>
                    <TableRow 
                      className={selectedRfq?.id === rfq.id ? "bg-muted" : ""}
                      onClick={() => handleRfqClick(rfq)}
                    >
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={(e) => {
                          e.stopPropagation();
                          handleRfqClick(rfq);
                        }}>
                          {expandedRfqId === rfq.id ? 
                            <ChevronUp className="h-4 w-4" /> : 
                            <ChevronDown className="h-4 w-4" />
                          }
                        </Button>
                      </TableCell>
                      <TableCell className="font-medium">{rfq.title}</TableCell>
                      <TableCell>{rfq.customer_name}</TableCell>
                      <TableCell>{getStatusBadge(rfq.status)}</TableCell>
                      <TableCell>{formatCurrency(rfq.total_amount, rfq.currency)}</TableCell>
                      <TableCell>{new Date(rfq.due_date).toLocaleDateString()}</TableCell>
                      <TableCell>v{rfq.version}</TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" onClick={(e) => e.stopPropagation()}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={(e) => {
                              e.stopPropagation();
                              handleViewDetails(rfq.id);
                            }}>
                              <FileText className="mr-2 h-4 w-4" />
                              View Details
                            </DropdownMenuItem>
                            
                            {getRfqStatusActions(rfq)}
                            
                            <DropdownMenuItem onClick={(e) => {
                              e.stopPropagation();
                              setSelectedRfq(rfq);
                              setIsCustomerAssignDialogOpen(true);
                            }}>
                              <UserPlus className="mr-2 h-4 w-4" />
                              Assign Customer
                            </DropdownMenuItem>
                            
                            <DropdownMenuItem onClick={(e) => {
                              e.stopPropagation();
                              handleDownloadPdf(rfq);
                            }}>
                              <Download className="mr-2 h-4 w-4" />
                              Download PDF
                            </DropdownMenuItem>
                            
                            <DropdownMenuItem 
                              className="text-destructive focus:text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedRfq(rfq);
                                setIsDeleteDialogOpen(true);
                              }}
                            >
                              <Trash className="mr-2 h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                    {expandedRfqId === rfq.id && (
                      <TableRow>
                        <TableCell colSpan={8} className="p-0 border-0">
                          <div className="bg-muted/50 p-4">
                            <div className="flex justify-between mb-4">
                              <h3 className="font-medium">RFQ Items</h3>
                              {rfq.status === 'draft' && (
                                <Button 
                                  size="sm" 
                                  variant="outline" 
                                  onClick={() => {
                                    setSelectedRfq(rfq);
                                    handleNewItemClick();
                                  }}
                                >
                                  Add Item
                                </Button>
                              )}
                            </div>
                            
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Product</TableHead>
                                  <TableHead>Description</TableHead>
                                  <TableHead className="text-right">Quantity</TableHead>
                                  <TableHead className="text-right">Unit Price</TableHead>
                                  <TableHead className="text-right">Total Price</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {rfqItems.length === 0 ? (
                                  <TableRow>
                                    <TableCell colSpan={5} className="text-center">No items in this RFQ</TableCell>
                                  </TableRow>
                                ) : (
                                  rfqItems.map((item) => (
                                    <TableRow key={item.id}>
                                      <TableCell>{item.product_name}</TableCell>
                                      <TableCell>{item.description}</TableCell>
                                      <TableCell className="text-right">{item.quantity}</TableCell>
                                      <TableCell className="text-right">{formatCurrency(item.unit_price, rfq.currency)}</TableCell>
                                      <TableCell className="text-right">{formatCurrency(item.total_price, rfq.currency)}</TableCell>
                                    </TableRow>
                                  ))
                                )}
                                <TableRow>
                                  <TableCell colSpan={4} className="text-right font-medium">Total:</TableCell>
                                  <TableCell className="text-right font-bold">{formatCurrency(rfq.total_amount, rfq.currency)}</TableCell>
                                </TableRow>
                              </TableBody>
                            </Table>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="orders" className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by order ID, customer or title..."
                className="pl-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {orders.length} {orders.length === 1 ? 'order' : 'orders'}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate('/calendar')}
              >
                <Calendar className="h-4 w-4 mr-1" />
                Calendar
              </Button>
            </div>
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order ID</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Total Amount</TableHead>
                    <TableHead>Start Date</TableHead>
                    <TableHead>Delivery Date</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center">Loading...</TableCell>
                    </TableRow>
                  ) : orders.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8">
                        <div className="flex flex-col items-center justify-center">
                          <Package className="h-12 w-12 text-gray-300 mb-2" />
                          <p className="text-muted-foreground">No orders found</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    orders
                      .filter(order => {
                        if (!searchQuery.trim()) return true;
                        const q = searchQuery.toLowerCase();
                        return generateOrderId(order).toLowerCase().includes(q) ||
                               order.title?.toLowerCase().includes(q) ||
                               order.customer_name?.toLowerCase().includes(q);
                      })
                      .map((order) => (
                      <TableRow key={order.id}>
                        <TableCell className="font-mono text-sm">{generateOrderId(order)}</TableCell>
                        <TableCell className="font-medium">{order.title}</TableCell>
                        <TableCell>{order.customer_name || 'Unassigned'}</TableCell>
                        <TableCell>{getOrderStatusBadge(order.status)}</TableCell>
                        <TableCell>{order.total_amount ? formatCurrency(order.total_amount, order.currency || 'EUR') : '-'}</TableCell>
                        <TableCell>{order.start_date ? new Date(order.start_date).toLocaleDateString() : '-'}</TableCell>
                        <TableCell>{order.delivery_date ? new Date(order.delivery_date).toLocaleDateString() : '-'}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => navigate(`/orders/${order.id}`)}
                            >
                              View
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(`/orders/${order.id}`);
                                }}>
                                  <Edit className="mr-2 h-4 w-4" />
                                  Edit/View Details
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedOrder(order);
                                  setIsOrderCustomerAssignDialogOpen(true);
                                }}>
                                  <UserPlus className="mr-2 h-4 w-4" />
                                  Assign Customer
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={isRfqDialogOpen} onOpenChange={setIsRfqDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Create New RFQ</DialogTitle>
            <DialogDescription>
              Enter the details for the new request for quotation.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <label htmlFor="title" className="text-sm font-medium">
                RFQ Title *
              </label>
              <Input
                id="title"
                name="title"
                value={newRfq.title}
                onChange={handleRfqInputChange}
                placeholder="e.g., Q1 2023 Parts Order"
                required
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="customer_id" className="text-sm font-medium">
                Customer *
              </label>
              <select
                id="customer_id"
                name="customer_id"
                value={newRfq.customer_id}
                onChange={handleRfqInputChange}
                className="w-full p-2 border rounded-md"
                required
              >
                <option value="">Select a customer...</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.company_name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label htmlFor="currency" className="text-sm font-medium">
                  Currency
                </label>
                <select
                  id="currency"
                  name="currency"
                  value={newRfq.currency}
                  onChange={handleRfqInputChange}
                  className="w-full p-2 border rounded-md"
                >
                  <option value="USD">USD - US Dollar</option>
                  <option value="EUR">EUR - Euro</option>
                  <option value="GBP">GBP - British Pound</option>
                  <option value="JPY">JPY - Japanese Yen</option>
                  <option value="CNY">CNY - Chinese Yuan</option>
                </select>
              </div>
              <div className="space-y-2">
                <label htmlFor="due_date" className="text-sm font-medium">
                  Due Date
                </label>
                <Input
                  id="due_date"
                  name="due_date"
                  type="date"
                  value={newRfq.due_date}
                  onChange={handleRfqInputChange}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRfqDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddRfq}>
              Create RFQ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isItemDialogOpen} onOpenChange={setIsItemDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Add RFQ Item</DialogTitle>
            <DialogDescription>
              Add a product or service item to the RFQ.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <label htmlFor="product_name" className="text-sm font-medium">
                Product/Service Name *
              </label>
              <Input
                id="product_name"
                name="product_name"
                value={newItem.product_name}
                onChange={handleItemInputChange}
                required
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="description" className="text-sm font-medium">
                Description
              </label>
              <Textarea
                id="description"
                name="description"
                value={newItem.description}
                onChange={handleItemInputChange}
                rows={3}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <label htmlFor="quantity" className="text-sm font-medium">
                  Quantity
                </label>
                <Input
                  id="quantity"
                  name="quantity"
                  type="number"
                  min="1"
                  value={newItem.quantity}
                  onChange={handleItemInputChange}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="unit_price" className="text-sm font-medium">
                  Unit Price
                </label>
                <Input
                  id="unit_price"
                  name="unit_price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={newItem.unit_price}
                  onChange={handleItemInputChange}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="total_price" className="text-sm font-medium">
                  Total Price
                </label>
                <Input
                  id="total_price"
                  name="total_price"
                  type="number"
                  step="0.01"
                  value={newItem.total_price}
                  readOnly
                  disabled
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsItemDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddItem}>
              Add Item
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Confirm Deletion</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this RFQ? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteRfq} disabled={loading}>
              {loading ? 
                <div className="flex items-center">
                  <div className="animate-spin rounded-full h-4 w-4 mr-2 border-b-2 border-white"></div>
                  Deleting...
                </div> : 
                "Delete"
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Customer Assignment Dialog for RFQs */}
      <CustomerSearchAssign
        currentCustomerId={selectedRfq?.customer_id}
        onCustomerSelect={handleCustomerAssign}
        isOpen={isCustomerAssignDialogOpen}
        onClose={() => setIsCustomerAssignDialogOpen(false)}
        title="Assign Customer to RFQ"
        description="Search and assign a customer to this RFQ"
      />

      {/* Customer Assignment Dialog for Orders */}
      <CustomerSearchAssign
        currentCustomerId={selectedOrder?.customer_id}
        onCustomerSelect={handleOrderCustomerAssign}
        isOpen={isOrderCustomerAssignDialogOpen}
        onClose={() => setIsOrderCustomerAssignDialogOpen(false)}
        title="Assign Customer to Order"
        description="Search and assign a customer to this order"
      />
      </div>
    </PersistentDashboardLayout>
  );
}
