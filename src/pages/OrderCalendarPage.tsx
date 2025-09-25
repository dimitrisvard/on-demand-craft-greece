import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { OrderCalendar } from "@/components/OrderCalendar";
import { ChevronLeft } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { Order, OrderStatus } from "@/types/customer";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { useAuth } from '@/contexts/AuthContext';

export default function OrderCalendarPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [isOrderDialogOpen, setIsOrderDialogOpen] = useState(false);
  const { user } = useAuth();
  
  useEffect(() => {
    fetchOrders();
  }, []);

  async function fetchOrders() {
    setIsLoading(true);
    
    try {
      let query = supabase
        .from('orders')
        .select('*, customers(company_name)')
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
        customer_name: item.customers?.company_name,
        rfq_id: item.rfq_id,
        status: item.status as OrderStatus,
        total_amount: item.total_amount || 0,
        currency: item.currency || 'USD',
        created_at: item.created_at,
        start_date: item.start_date || item.created_at,
        delivery_date: item.delivery_date || new Date(new Date(item.created_at).getTime() + 14 * 24 * 60 * 60 * 1000).toISOString()
      }));

      setOrders(transformedData);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to load orders",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }

  const handleOrderClick = (order: Order) => {
    setSelectedOrder(order);
    setIsOrderDialogOpen(true);
  };

  const handleViewDetails = (orderId: string) => {
    setIsOrderDialogOpen(false);
    navigate(`/orders/${orderId}`);
  };

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  };

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

  return (
    <div className="p-6 pt-20 space-y-6">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => navigate('/dashboard')}
            className="gap-1"
          >
            <ChevronLeft className="h-4 w-4" /> Back to Dashboard
          </Button>
          <h1 className="text-2xl font-bold">Production Calendar</h1>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-10">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto"></div>
          <p className="mt-2">Loading orders...</p>
        </div>
      ) : (
        <OrderCalendar 
          orders={orders}
          onOrderClick={handleOrderClick}
        />
      )}
      
      <Dialog open={isOrderDialogOpen} onOpenChange={setIsOrderDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          {selectedOrder && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedOrder.title}</DialogTitle>
                <DialogDescription>
                  Order details and timeline information
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-4 py-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Status</span>
                  {getStatusBadge(selectedOrder.status)}
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Customer</p>
                    {user?.role === 'partner_seller' ? '' : selectedOrder?.customer_name}
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Total Amount</p>
                    {user?.role === 'partner_seller' ? '' : formatCurrency(selectedOrder?.total_amount, selectedOrder?.currency)}
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Start Date</p>
                    <p className="font-medium">{format(new Date(selectedOrder.start_date), "MMMM d, yyyy")}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Delivery Date</p>
                    <p className="font-medium">{format(new Date(selectedOrder.delivery_date), "MMMM d, yyyy")}</p>
                  </div>
                </div>
              </div>
              
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsOrderDialogOpen(false)}>Close</Button>
                <Button onClick={() => handleViewDetails(selectedOrder.id)}>View Full Details</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
