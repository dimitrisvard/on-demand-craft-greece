import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { getMyCustomerIds } from '@/utils/myCustomer';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Upload,
  Package,
  Headphones,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  MessageSquare,
} from 'lucide-react';

interface RfqRow {
  id: string;
  rfq_number: string;
  process_type: string | null;
  status: string;
  quantity: number | null;
  estimated_value: number | null;
  created_at: string;
  parts_details: any[] | null;
}

const getStatusColor = (status: string) => {
  switch (status.toLowerCase()) {
    case 'approved':
      return 'bg-green-100 text-green-800 border-green-200';
    case 'received':
    case 'sent':
      return 'bg-orange-100 text-orange-800 border-orange-200';
    case 'draft':
    default:
      return 'bg-blue-100 text-blue-800 border-blue-200';
  }
};

const getPartsQtyDisplay = (rfq: RfqRow): string => {
  if (rfq.parts_details && Array.isArray(rfq.parts_details) && rfq.parts_details.length > 0) {
    const numberOfParts = rfq.parts_details.length;
    const totalQuantity = rfq.parts_details.reduce((sum, part) => {
      const qty = typeof part.quantity === 'number' ? part.quantity : 0;
      return sum + qty;
    }, 0);
    return `${numberOfParts} / ${totalQuantity}`;
  }
  return rfq.quantity != null ? `1 / ${rfq.quantity}` : '—';
};

const CustomerDashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [rfqs, setRfqs] = useState<RfqRow[]>([]);
  const [loadingRfqs, setLoadingRfqs] = useState(true);
  const [showQuotePanel, setShowQuotePanel] = useState(true);

  const firstName =
    user?.user_metadata?.first_name ||
    user?.user_metadata?.firstName ||
    user?.email?.split('@')[0] ||
    'there';

  useEffect(() => {
    const fetchRfqs = async () => {
      try {
        // Only this user's quotes: RLS also enforces this server-side, but the
        // explicit filter keeps the page correct regardless of deploy order.
        const customerIds = await getMyCustomerIds();
        if (customerIds.length === 0) {
          setRfqs([]);
          return;
        }
        const { data, error } = await supabase
          .from('rfqs')
          .select('*')
          .in('customer_id', customerIds)
          .order('created_at', { ascending: false })
          .limit(5);

        if (error) throw error;
        setRfqs((data as RfqRow[]) || []);
      } catch (err) {
        console.error('Error fetching RFQs:', err);
      } finally {
        setLoadingRfqs(false);
      }
    };

    fetchRfqs();
  }, []);

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-7xl mx-auto">
      {/* Welcome Banner */}
      <div className="rounded-lg bg-gradient-to-r from-blue-600 to-blue-800 p-6 text-white shadow-md mt-2">
        <h1 className="text-2xl font-bold">
          Hi {firstName}, welcome to your Microns Hub account
        </h1>
        <p className="mt-1 text-blue-100">
          Manage your quotes, orders, and projects all in one place.
        </p>
      </div>

      {/* Quoting Options Info Panel */}
      <Card>
        <CardHeader
          className="cursor-pointer flex flex-row items-center justify-between"
          onClick={() => setShowQuotePanel(!showQuotePanel)}
        >
          <div>
            <CardTitle>Get a Quote or Order</CardTitle>
            {showQuotePanel && (
              <CardDescription className="mt-1">
                Upload your CAD files to get a quote or place an order. Our
                network of certified manufacturers delivers precision parts with
                fast turnaround.
              </CardDescription>
            )}
          </div>
          <Button variant="ghost" size="icon" className="shrink-0">
            {showQuotePanel ? (
              <ChevronUp className="h-5 w-5" />
            ) : (
              <ChevronDown className="h-5 w-5" />
            )}
          </Button>
        </CardHeader>
        {showQuotePanel && (
          <CardContent className="flex items-center gap-4">
            <Button onClick={() => navigate('/customer/quote')}>
              Get Quote
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate('/customer/order')}
            >
              Place an Order
            </Button>
          </CardContent>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Latest Projects Table */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Latest Projects</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingRfqs ? (
              <p className="text-sm text-muted-foreground">Loading projects...</p>
            ) : rfqs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No projects yet. Start by getting a quote!
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-2 pr-4 font-medium">Quote ID</th>
                      <th className="pb-2 pr-4 font-medium">Process</th>
                      <th className="pb-2 pr-4 font-medium">Status</th>
                      <th className="pb-2 pr-4 font-medium text-right">Parts / Qty</th>
                      <th className="pb-2 font-medium text-right">Value (EUR)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rfqs.map((rfq) => (
                      <tr key={rfq.id} className="border-b last:border-0">
                        <td className="py-3 pr-4 font-medium">
                          {rfq.rfq_number}
                        </td>
                        <td className="py-3 pr-4">
                          {rfq.process_type || '—'}
                        </td>
                        <td className="py-3 pr-4">
                          <Badge
                            variant="outline"
                            className={getStatusColor(rfq.status)}
                          >
                            {rfq.status}
                          </Badge>
                        </td>
                        <td className="py-3 pr-4 text-right">
                          {getPartsQtyDisplay(rfq)}
                        </td>
                        <td className="py-3 text-right">
                          {rfq.estimated_value != null
                            ? `€${rfq.estimated_value.toLocaleString('de-DE', {
                                minimumFractionDigits: 2,
                              })}`
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-4">
              <Link
                to="/customer/projects"
                className="inline-flex items-center text-sm font-medium text-blue-600 hover:text-blue-800"
              >
                Go to My Projects
                <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Latest Messages Panel */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Latest Messages
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              No messages yet. Your conversations with our team will appear here.
            </p>
            <div className="mt-4">
              <Link
                to="/messages"
                className="inline-flex items-center text-sm font-medium text-blue-600 hover:text-blue-800"
              >
                Go to All Messages
                <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card
          className="cursor-pointer transition-shadow hover:shadow-md"
          onClick={() => navigate('/customer/quote')}
        >
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
            <Upload className="h-8 w-8 text-blue-600" />
            <span className="font-medium">Start New Quote</span>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer transition-shadow hover:shadow-md"
          onClick={() => navigate('/customer/projects?tab=orders')}
        >
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
            <Package className="h-8 w-8 text-blue-600" />
            <span className="font-medium">View Orders</span>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer transition-shadow hover:shadow-md"
          onClick={() => navigate('/contact')}
        >
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
            <Headphones className="h-8 w-8 text-blue-600" />
            <span className="font-medium">Contact Support</span>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default CustomerDashboard;
