import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { BackToDashboardButton } from "@/components/dashboard/BackToDashboardButton"
import PersistentDashboardLayout from "@/components/dashboard/PersistentDashboardLayout"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { PlusCircle, Calendar, Package, Search, Download, UserPlus, MoreHorizontal } from "lucide-react"
import { supabase } from "@/integrations/supabase/client"
import { useToast } from "@/components/ui/use-toast"
import { useNavigate } from "react-router-dom"
import { format } from "date-fns"
import { Badge } from "@/components/ui/badge"
import { Order, OrderStatus } from "@/types/customer"
import { useAuth } from '@/contexts/AuthContext'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import { CustomerSearchAssign } from "@/components/customers/CustomerSearchAssign"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [isCustomerAssignDialogOpen, setIsCustomerAssignDialogOpen] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [customers, setCustomers] = useState<{id: string, company_name: string}[]>([])
  const [rfqs, setRfqs] = useState<{id: string, title: string}[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [filteredOrders, setFilteredOrders] = useState<Order[]>([])
  const [newOrder, setNewOrder] = useState<Partial<Order>>({
    title: "",
    customer_id: "",
    rfq_id: "",
    status: "new",
    total_amount: 0,
    currency: "USD",
    start_date: new Date().toISOString().split('T')[0],
    delivery_date: new Date(Date.now() + (14 * 24 * 60 * 60 * 1000)).toISOString().split('T')[0]
  })
  const { toast } = useToast()
  const navigate = useNavigate()
  const { user } = useAuth()

  // Check if user is a production partner
  const isProductionPartner = user?.role === 'partner_seller'

  useEffect(() => {
    if (user) {
      fetchOrders()
      fetchCustomers()
      fetchRfqs()
    }
  }, [user])
  
  useEffect(() => {
    if (searchQuery.trim() === '') {
      setFilteredOrders(orders);
      return;
    }
    
    const lowercaseQuery = searchQuery.toLowerCase();
    const filtered = orders.filter(order => 
      generateOrderId(order).toLowerCase().includes(lowercaseQuery) ||
      order.title.toLowerCase().includes(lowercaseQuery) ||
      (order.customer_name && order.customer_name.toLowerCase().includes(lowercaseQuery))
    );
    
    setFilteredOrders(filtered);
  }, [searchQuery, orders]);

  async function fetchOrders() {
    setLoading(true)
    
    try {
      let query = supabase
        .from('orders')
        .select('*, customers(company_name, vat_tax_id)')
        .order('created_at', { ascending: false });
      
      if (user?.role === 'partner_seller') {
        // For partners, we need to find their production_partners record first
        const { data: partnerData, error: partnerError } = await supabase
          .from('production_partners')
          .select('id')
          .eq('email', user.email)
          .single();
        
        if (partnerError) {
          console.error('Error fetching partner data:', partnerError);
          throw partnerError;
        }
        
        if (partnerData) {
          console.log('Partner data found:', partnerData);
          query = query.eq('partner_id', partnerData.id);
        } else {
          console.log('No partner data found for email:', user.email);
        }
      }
      
      const { data, error } = await query;

      if (error) throw error;

      const transformedData: Order[] = data.map(item => ({
        id: item.id,
        title: item.title,
        customer_id: item.customer_id,
        customer_name: item.customers?.company_name || 'Unassigned',
        customer_vat: item.customers?.vat_tax_id,
        rfq_id: item.rfq_id,
        partner_id: item.partner_id,
        status: item.status as OrderStatus,
        production_status: item.production_status,
        total_amount: item.total_amount || 0,
        currency: item.currency || 'USD',
        created_at: item.created_at,
        start_date: item.start_date || item.created_at,
        delivery_date: item.delivery_date || new Date(new Date(item.created_at).getTime() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        total_with_vat: item.total_with_vat || 0
      }));

      setOrders(transformedData);
      setFilteredOrders(transformedData);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to load orders",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function fetchCustomers() {
    try {
      const { data, error } = await supabase
        .from('customers')
        .select('id, company_name')
        .order('company_name')

      if (error) throw error;
      
      setCustomers(data || []);
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to load customers",
        variant: "destructive",
      });
    }
  }

  async function fetchRfqs() {
    try {
      const { data, error } = await supabase
        .from('rfqs')
        .select('id, title')
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      setRfqs(data || []);
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to load RFQs",
        variant: "destructive",
      });
    }
  }
  
  const generateOrderId = (order: Order) => {
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

  const handleAddClick = () => {
    setIsAddDialogOpen(true)
    setNewOrder({
      title: "",
      customer_id: "",
      rfq_id: "",
      status: "new",
      total_amount: 0,
      currency: "USD",
      start_date: new Date().toISOString().split('T')[0],
      delivery_date: new Date(Date.now() + (14 * 24 * 60 * 60 * 1000)).toISOString().split('T')[0]
    })
  }

  const handleAddOrder = async () => {
    try {
      if (!newOrder.title || !newOrder.customer_id) {
        toast({
          title: "Missing Information",
          description: "Title and customer are required",
          variant: "destructive",
        });
        return;
      }

      const startDate = newOrder.start_date ? new Date(newOrder.start_date) : new Date();
      const deliveryDate = newOrder.delivery_date ? new Date(newOrder.delivery_date) : new Date(startDate.getTime() + (14 * 24 * 60 * 60 * 1000));

      const { data, error } = await supabase
        .from('orders')
        .insert([
          {
            title: newOrder.title,
            customer_id: newOrder.customer_id,
            rfq_id: newOrder.rfq_id || null,
            status: newOrder.status || "new",
            total_amount: newOrder.total_amount || 0,
            currency: newOrder.currency || "USD",
            start_date: startDate.toISOString(),
            delivery_date: deliveryDate.toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }
        ])
        .select();

      if (error) throw error;

      toast({
        title: "Success",
        description: "Order created successfully",
      });

      if (data && data[0]) {
        navigate(`/orders/${data[0].id}`);
      } else {
        fetchOrders();
        setIsAddDialogOpen(false);
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to create order",
        variant: "destructive",
      });
    }
  }

  const handleCustomerAssign = async (customer: any) => {
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
      
      setIsCustomerAssignDialogOpen(false);
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

  const handleNewOrderInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    
    if (type === 'number') {
      setNewOrder({
        ...newOrder,
        [name]: parseFloat(value)
      });
    } else {
      setNewOrder({
        ...newOrder,
        [name]: value
      });
    }
  }

  const handleViewDetails = (orderId: string) => {
    navigate(`/orders/${orderId}`);
  }

  const handleViewCalendar = () => {
    navigate(`/calendar`);
  }

  const getStatusBadge = (status: OrderStatus, productionStatus?: string) => {
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

  const getProductionStatusBadge = (productionStatus?: string) => {
    if (!productionStatus) return null;
    
    switch (productionStatus) {
      case 'pending':
        return <Badge variant="outline" className="ml-1">Pending</Badge>;
      case 'in_production':
        return <Badge variant="default" className="ml-1 bg-blue-600">In Production</Badge>;
      case 'ready':
        return <Badge variant="default" className="ml-1 bg-green-600">Ready</Badge>;
      case 'completed':
        return <Badge variant="secondary" className="ml-1">Completed</Badge>;
      default:
        return <Badge variant="outline" className="ml-1">{productionStatus}</Badge>;
    }
  };

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  };

  // PDF Generation function for orders list
  const downloadOrderPdf = async (order: Order) => {
    try {
      // Fetch customer details for this order
      const { data: customerData, error: customerError } = await supabase
        .from('customers')
        .select('*')
        .eq('id', order.customer_id)
        .single();

      if (customerError) throw customerError;

      const customer = customerData;

      // Prepare the data structure for PDF
      const data = {
        seller: {
          company_name: 'MICRONS HUB DV Ε.Ε.',
          address_lines: [
            'Industrial Area Street B Number 4',
            'Heraklion Greece 71601',
            '+302104447830',
            'info@micronshub.eu',
            'VAT ID EL803129638'
          ],
        },
        buyer: {
          name: (customer.first_name || '') + ' ' + (customer.last_name || ''),
          company: customer.company_name || '',
          address_lines: [customer.street_address || '', (customer.city || '') + ', ' + (customer.zip_code || '')],
          country: customer.country || '',
        },
        order_id: generateOrderId(order),
        title: order.title,
        date: order.created_at,
        start_date: order.start_date,
        delivery_date: order.delivery_date,
        status: order.status,
        conditions: {
          delivery_time: '21 working days',
          shipping_terms: 'CIP',
          payment_terms: '14 days net',
          validity_days: '14 days',
        },
        footer_notes: [
          'This order is subject to our general terms and conditions.',
          'All prices are net, plus VAT where applicable.'
        ],
        terms_url: 'https://microns-hub.com/terms',
      };

      // Create a container for html2canvas rendering
      const container = document.createElement('div');
      container.style.width = '800px';
      container.style.fontFamily = 'Helvetica, Arial, sans-serif';
      container.style.fontSize = '12px';
      container.style.color = '#222';
      container.style.background = '#fff';
      container.style.padding = '32px';

      // Use an absolute path for the logo and set width for reliability
      const logoHtml = `<img src='/logo.png' style="width:180px;height:auto;display:block;" />`;

      // Build the HTML for the PDF (header, info, simplified table without prices)
      container.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          ${logoHtml}
          <div style="text-align:right;">
            <div style="font-size:20px;font-weight:bold;">${data.seller.company_name}</div>
            <div style="font-size:12px;">${data.seller.address_lines.join('<br/>')}</div>
          </div>
        </div>
        <hr style="margin:16px 0; border: 1px solid #e0e0e0;" />
        <div style="display:flex;justify-content:space-between;">
          <div>
            <b>Buyer:</b><br/>
            ${data.buyer.name}<br/>
            ${data.buyer.company}<br/>
            ${data.buyer.address_lines.join('<br/>')}<br/>
            ${data.buyer.country}
          </div>
          <div style="text-align:right;">
            <b>Order ID:</b> ${data.order_id}<br/>
            <b>Order Title:</b> ${data.title}<br/>
            <b>Order Date:</b> ${format(new Date(data.date), 'yyyy-MM-dd')}<br/>
            <b>Start Date:</b> ${data.start_date ? format(new Date(data.start_date), 'yyyy-MM-dd') : 'Not set'}<br/>
            <b>Delivery Date:</b> ${data.delivery_date ? format(new Date(data.delivery_date), 'yyyy-MM-dd') : 'Not set'}<br/>
            <b>Status:</b> ${data.status.toUpperCase()}
          </div>
        </div>
        <h2 style="text-align:center;margin:24px 0 8px 0; color:#1a237e;">PURCHASE ORDER</h2>
        <table style="width:100%;border-collapse:collapse;margin-top:24px;">
          <thead>
            <tr style="background:#f3f4f6;">
              <th style="border:1px solid #ccc;padding:6px;">Item</th>
              <th style="border:1px solid #ccc;padding:6px;">Files</th>
              <th style="border:1px solid #ccc;padding:6px;">Description</th>
              <th style="border:1px solid #ccc;padding:6px;">Quantity</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="border:1px solid #ccc;padding:6px;text-align:center;color:#666;font-style:italic;" colspan="4">
                Order details and specifications will be provided separately.
              </td>
            </tr>
          </tbody>
        </table>
        <div style="margin-top:24px;float:right;width:320px;">
          <table style="width:100%;font-size:13px;background:#f5f7fa;border-radius:8px;box-shadow:0 1px 4px #e0e0e0;">
            <tr><td style="color:#333;">Total Amount:</td><td style="text-align:right;color:#333;">—</td></tr>
            <tr><td style="color:#333;">Currency:</td><td style="text-align:right;color:#333;">—</td></tr>
            <tr style="font-weight:bold;"><td style="padding:8px 0 8px 8px;">Shipping Cost:</td><td style="text-align:right;padding:8px 8px 8px 0;">—</td></tr>
          </table>
        </div>
        <div style="clear:both;"></div>
        <div style="margin-top:32px;">
          <b style="color:#1a237e;">Conditions:</b><br/>
          <ul style="margin:0 0 0 16px;padding:0;font-size:13px;color:#333;background:#f5f7fa;border-radius:8px;padding:12px 16px;box-shadow:0 1px 4px #e0e0e0;">
            <li><b>Delivery Time:</b> ${data.conditions.delivery_time}</li>
            <li><b>Shipping Terms:</b> ${data.conditions.shipping_terms}</li>
            <li><b>Payment Terms:</b> ${data.conditions.payment_terms}</li>
            <li><b>Offer Validity:</b> ${data.conditions.validity_days}</li>
          </ul>
        </div>
        
        <div style="margin-top:32px;text-align:center;font-size:12px;color:#1a237e;background:#f8f9fa;padding:16px;border-radius:8px;border:1px solid #e0e0e0;">
          <strong>This order is subject to our general terms and conditions.</strong><br/><br/>
          All prices and shipping costs will be provided separately. Should you have any questions, please do not hesitate to call us at <strong>+302104447830</strong>
        </div>
        
        <div style="margin-top:32px;display:flex;justify-content:space-between;font-size:10px;color:#444;">
          <div style="text-align:left;">
            <div style="font-weight:bold;margin-bottom:4px;">MICRONS HUB DV Ε.Ε.</div>
            <div>Industrial Area Street B Number 4</div>
            <div>Heraklion Greece</div>
            <div>71601</div>
          </div>
          
          <div style="text-align:center;">
            <div style="font-weight:bold;margin-bottom:4px;">Trade Register</div>
            <div>Greece</div>
            <div style="margin-top:8px;font-weight:bold;">VAT ID</div>
            <div>EL803129638</div>
          </div>
          
          <div style="text-align:center;">
            <div style="font-weight:bold;margin-bottom:4px;">Managing Directors</div>
            <div>Dimitris Vardalachakis</div>
          </div>
          
          <div style="text-align:right;">
            <div style="font-weight:bold;margin-bottom:4px;">Bank Account</div>
            <div>National Bank of Greece</div>
            <div style="margin-top:4px;">SWIFT Code: ETHNGRAA</div>
            <div style="margin-top:4px;">GR4901102040000020400891170</div>
            <div style="margin-top:4px;">SWIFT/BIC: ETHNGRAA</div>
          </div>
        </div>
        
        <div style="margin-top:32px;font-size:10px;color:#444;">
          ${data.footer_notes.map(note => `<div>${note}</div>`).join('')}
          <div style="margin-top:8px;"><a href='${data.terms_url}' style='color:#1976d2;text-decoration:underline;'>General Sale and Delivery Terms and Conditions</a></div>
        </div>
      `;

      document.body.appendChild(container);
      await new Promise(resolve => setTimeout(resolve, 100)); // Wait for DOM
      const pdf = new jsPDF({ unit: 'mm', format: 'a4', putOnlyUsedFonts: true });
      const canvas = await html2canvas(container, { scale: 4, useCORS: true });
      const imgData = canvas.toDataURL('image/png');
      const imgProps = pdf.getImageProperties(imgData);
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const pdfWidth = pageWidth - 20; // 10mm margin each side
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;

      pdf.addImage(imgData, 'PNG', 10, 10, pdfWidth, pdfHeight);
      pdf.setFontSize(9);
      pdf.text(`Page 1`, pageWidth - 30, pageHeight - 10);

      pdf.save(`order_${data.order_id}.pdf`);
      document.body.removeChild(container);
      toast({
        title: 'Success',
        description: 'PDF downloaded successfully',
      });
    } catch (error: any) {
      console.error('Error generating PDF:', error);
      toast({
        title: 'Error',
        description: 'Failed to generate PDF',
        variant: 'destructive',
      });
    }
  };

  return (
    <PersistentDashboardLayout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold">Orders</h1>
          </div>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            onClick={handleViewCalendar}
            className="flex items-center gap-2"
          >
            <Calendar className="h-5 w-5" />
            <span>Calendar View</span>
          </Button>
          {!isProductionPartner && (
            <Button 
              onClick={handleAddClick}
              className="flex items-center gap-2"
            >
              <PlusCircle className="h-5 w-5" />
              <span>New Order</span>
            </Button>
          )}
        </div>
      </div>
      
      <div className="flex justify-between items-center">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search by order ID, customer or title..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
          />
        </div>
        <div className="text-sm text-muted-foreground">
          {filteredOrders.length} {filteredOrders.length === 1 ? 'order' : 'orders'} found
        </div>
      </div>
      
      <Card className="shadow-sm border hover:shadow-md transition-all duration-200 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order ID</TableHead>
              <TableHead>Order Title</TableHead>
              {!isProductionPartner && <TableHead>Customer</TableHead>}
              <TableHead>Status</TableHead>
              {!isProductionPartner && <TableHead>Total Value</TableHead>}
              <TableHead>{isProductionPartner ? 'Revenue' : 'Total Cost'}</TableHead>
              <TableHead>Start Date</TableHead>
              <TableHead>Delivery Date</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={isProductionPartner ? 7 : 9} className="text-center">
                  <div className="flex items-center justify-center">
                    <div className="animate-spin w-5 h-5 border-2 border-primary border-t-transparent rounded-full"></div>
                    <span className="ml-2">Loading...</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : filteredOrders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={isProductionPartner ? 7 : 9} className="text-center py-8">
                  <div className="flex flex-col items-center justify-center">
                    <Package className="h-12 w-12 text-gray-300 mb-2" />
                    <p className="text-muted-foreground">No orders found</p>
                    {!isProductionPartner && (
                      <Button 
                        variant="link" 
                        onClick={handleAddClick}
                        className="mt-2"
                      >
                        Create your first order
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredOrders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="font-mono">{generateOrderId(order)}</TableCell>
                  <TableCell className="font-medium">{order.title}</TableCell>
                  {!isProductionPartner && <TableCell>{order.customer_name}</TableCell>}
                  <TableCell>
                    <div className="flex items-center">
                      {getStatusBadge(order.status)}
                      {getProductionStatusBadge(order.production_status)}
                    </div>
                  </TableCell>
                  {!isProductionPartner && <TableCell>{formatCurrency(order.total_amount, order.currency)}</TableCell>}
                  <TableCell>
                    {order.total_with_vat ? 
                      `€${Number(order.total_with_vat).toFixed(2)}` : 
                      '-'}
                  </TableCell>
                  <TableCell>{format(new Date(order.start_date), 'MMM d, yyyy')}</TableCell>
                  <TableCell>{format(new Date(order.delivery_date), 'MMM d, yyyy')}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => handleViewDetails(order.id)}
                      >
                        Edit/View
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
                            setSelectedOrder(order);
                            setIsCustomerAssignDialogOpen(true);
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
      </Card>
      
      {/* Add Order Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Create New Order</DialogTitle>
            <DialogDescription>
              Enter the details for the new order.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <label htmlFor="new_title" className="text-sm font-medium">
                Order Title <span className="text-red-500">*</span>
              </label>
              <input
                id="new_title"
                name="title"
                value={newOrder.title}
                onChange={handleNewOrderInputChange}
                className="w-full p-2 border rounded"
                placeholder="e.g., Manufacturing Order - April 2025"
              />
            </div>
            
            <div className="grid gap-2">
              <label htmlFor="new_customer_id" className="text-sm font-medium">
                Customer <span className="text-red-500">*</span>
              </label>
              <select
                id="new_customer_id"
                name="customer_id"
                value={newOrder.customer_id}
                onChange={handleNewOrderInputChange}
                className="w-full p-2 border rounded"
              >
                <option value="">Select a customer...</option>
                {customers.map(customer => (
                  <option key={customer.id} value={customer.id}>
                    {customer.company_name}
                  </option>
                ))}
              </select>
            </div>
            
            <div className="grid gap-2">
              <label htmlFor="new_rfq_id" className="text-sm font-medium">
                Related Quote/RFQ
              </label>
              <select
                id="new_rfq_id"
                name="rfq_id"
                value={newOrder.rfq_id || ''}
                onChange={handleNewOrderInputChange}
                className="w-full p-2 border rounded"
              >
                <option value="">None (Direct Order)</option>
                {rfqs.map(rfq => (
                  <option key={rfq.id} value={rfq.id}>
                    {rfq.title}
                  </option>
                ))}
              </select>
            </div>
            
            <div className="grid gap-2">
              <label htmlFor="new_status" className="text-sm font-medium">
                Status
              </label>
              <select
                id="new_status"
                name="status"
                value={newOrder.status}
                onChange={handleNewOrderInputChange}
                className="w-full p-2 border rounded"
              >
                <option value="new">New</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <label htmlFor="new_start_date" className="text-sm font-medium">
                  Start Date
                </label>
                <input
                  id="new_start_date"
                  name="start_date"
                  type="date"
                  value={newOrder.start_date}
                  onChange={handleNewOrderInputChange}
                  className="w-full p-2 border rounded"
                />
              </div>
              
              <div className="grid gap-2">
                <label htmlFor="new_delivery_date" className="text-sm font-medium">
                  Delivery Date
                </label>
                <input
                  id="new_delivery_date"
                  name="delivery_date"
                  type="date"
                  value={newOrder.delivery_date}
                  onChange={handleNewOrderInputChange}
                  className="w-full p-2 border rounded"
                />
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <label htmlFor="new_total_amount" className="text-sm font-medium">
                  Order Value
                </label>
                <input
                  id="new_total_amount"
                  name="total_amount"
                  type="number"
                  value={newOrder.total_amount}
                  onChange={handleNewOrderInputChange}
                  className="w-full p-2 border rounded"
                  min="0"
                  step="0.01"
                />
              </div>
              
              <div className="grid gap-2">
                <label htmlFor="new_currency" className="text-sm font-medium">
                  Currency
                </label>
                <select
                  id="new_currency"
                  name="currency"
                  value={newOrder.currency}
                  onChange={handleNewOrderInputChange}
                  className="w-full p-2 border rounded"
                >
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                  <option value="JPY">JPY</option>
                </select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddOrder}>Create Order</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Customer Assignment Dialog */}
      <CustomerSearchAssign
        currentCustomerId={selectedOrder?.customer_id}
        onCustomerSelect={handleCustomerAssign}
        isOpen={isCustomerAssignDialogOpen}
        onClose={() => setIsCustomerAssignDialogOpen(false)}
        title="Assign Customer to Order"
        description="Search and assign a customer to this order"
      />
      </div>
    </PersistentDashboardLayout>
  )
}
