import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { BackToDashboardButton } from "@/components/dashboard/BackToDashboardButton"
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
import { PencilIcon, PlusCircle, Calendar, Package, Search } from "lucide-react"
import { supabase } from "@/integrations/supabase/client"
import { useToast } from "@/components/ui/use-toast"
import { useNavigate } from "react-router-dom"
import { format } from "date-fns"
import { Badge } from "@/components/ui/badge"
import { Order, OrderStatus } from "@/types/customer"
import { useAuth } from '@/contexts/AuthContext'

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
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
    fetchOrders()
    fetchCustomers()
    fetchRfqs()
  }, [])
  
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
          query = query.eq('partner_id', partnerData.id);
        }
      }
      
      const { data, error } = await query;

      if (error) throw error;

      const transformedData: Order[] = data.map(item => ({
        id: item.id,
        title: item.title,
        customer_id: item.customer_id,
        customer_name: item.customers?.company_name,
        customer_vat: item.customers?.vat_tax_id,
        rfq_id: item.rfq_id,
        status: item.status as OrderStatus,
        total_amount: item.total_amount || 0,
        currency: item.currency || 'USD',
        created_at: item.created_at,
        start_date: item.start_date || item.created_at,
        delivery_date: item.delivery_date || new Date(new Date(item.created_at).getTime() + 14 * 24 * 60 * 60 * 1000).toISOString()
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
    
    // Extract a short unique identifier from the order ID
    const shortId = order.id.substring(0, 4);
    
    return `PO-${day}${month}${year}-${shortId}`;
  };

  const handleEditClick = (order: Order) => {
    setSelectedOrder(order)
    setIsEditDialogOpen(true)
  }

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

  const handleSaveChanges = async () => {
    if (!selectedOrder) return;
    
    try {
      const { error } = await supabase
        .from('orders')
        .update({
          title: selectedOrder.title,
          status: selectedOrder.status,
          start_date: selectedOrder.start_date,
          delivery_date: selectedOrder.delivery_date,
          updated_at: new Date().toISOString()
        })
        .eq('id', selectedOrder.id)

      if (error) throw error;

      toast({
        title: "Success",
        description: "Order updated successfully",
      });
      
      fetchOrders();
      setIsEditDialogOpen(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update order",
        variant: "destructive",
      });
    }
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

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    
    if (selectedOrder) {
      setSelectedOrder({
        ...selectedOrder,
        [name]: value
      });
    }
  }

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

  const getStatusBadge = (status: OrderStatus) => {
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

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  };

  return (
    <div className="p-6 pt-20 space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <BackToDashboardButton />
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
      
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order ID</TableHead>
              <TableHead>Order Title</TableHead>
              {!isProductionPartner && <TableHead>Customer</TableHead>}
              <TableHead>Status</TableHead>
              {!isProductionPartner && <TableHead>Total Value</TableHead>}
              <TableHead>Start Date</TableHead>
              <TableHead>Delivery Date</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={isProductionPartner ? 6 : 8} className="text-center">
                  <div className="flex items-center justify-center">
                    <div className="animate-spin w-5 h-5 border-2 border-primary border-t-transparent rounded-full"></div>
                    <span className="ml-2">Loading...</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : filteredOrders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={isProductionPartner ? 6 : 8} className="text-center py-8">
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
                  <TableCell>{getStatusBadge(order.status)}</TableCell>
                  {!isProductionPartner && <TableCell>{formatCurrency(order.total_amount, order.currency)}</TableCell>}
                  <TableCell>{format(new Date(order.start_date), 'MMM d, yyyy')}</TableCell>
                  <TableCell>{format(new Date(order.delivery_date), 'MMM d, yyyy')}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => handleViewDetails(order.id)}
                      >
                        View
                      </Button>
                      {!isProductionPartner && (
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => handleEditClick(order)}
                        >
                          <PencilIcon className="h-4 w-4 mr-1" />
                          Edit
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Edit Order Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edit Order</DialogTitle>
            <DialogDescription>
              Make changes to the order details below.
            </DialogDescription>
          </DialogHeader>
          {selectedOrder && (
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <label htmlFor="title" className="text-sm font-medium">
                  Order Title
                </label>
                <input
                  id="title"
                  name="title"
                  value={selectedOrder.title}
                  onChange={handleInputChange}
                  className="w-full p-2 border rounded"
                />
              </div>
              
              <div className="grid gap-2">
                <label htmlFor="status" className="text-sm font-medium">
                  Status
                </label>
                <select
                  id="status"
                  name="status"
                  value={selectedOrder.status}
                  onChange={handleInputChange}
                  className="w-full p-2 border rounded"
                >
                  <option value="new">New</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
              
              <div className="grid gap-2">
                <label htmlFor="start_date" className="text-sm font-medium">
                  Start Date
                </label>
                <input
                  id="start_date"
                  name="start_date"
                  type="date"
                  value={selectedOrder.start_date ? new Date(selectedOrder.start_date).toISOString().split('T')[0] : ''}
                  onChange={handleInputChange}
                  className="w-full p-2 border rounded"
                />
              </div>
              
              <div className="grid gap-2">
                <label htmlFor="delivery_date" className="text-sm font-medium">
                  Delivery Date
                </label>
                <input
                  id="delivery_date"
                  name="delivery_date"
                  type="date"
                  value={selectedOrder.delivery_date ? new Date(selectedOrder.delivery_date).toISOString().split('T')[0] : ''}
                  onChange={handleInputChange}
                  className="w-full p-2 border rounded"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveChanges}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
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
    </div>
  )
}
