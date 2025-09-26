import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Users, 
  FileText, 
  Package, 
  Factory, 
  ShoppingBag, 
  TrendingUp, 
  ChevronUp, 
  ChevronDown 
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ChartContainer, ChartTooltip, ChartLegend, ChartLegendContent } from '@/components/ui/chart';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart, Legend } from 'recharts';
import { useAuth } from "@/contexts/AuthContext";

const DashboardOverview = () => {
  const [timeRange, setTimeRange] = useState<string>("30d");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [stats, setStats] = useState<any>({
    customers: { total: 0, new: 0, trend: '', positive: null },
    quotes: { total: 0, new: 0, trend: '', positive: null },
    orders: { total: 0, new: 0, trend: '', positive: null },
    productionOrders: { total: 0, inProduction: 0, finished: 0, trend: '', positive: null },
    revenue: { total: 0, trend: '', positive: null },
    costs: { total: 0, material: 0, labor: 0, vat: 0, trend: '', positive: null },
    partners: { total: 0, active: 0, trend: '', positive: null },
    products: { total: 0, lowStock: 0, trend: '', positive: null }
  });
  const [salesData, setSalesData] = useState<any[]>([]);
  const navigate = useNavigate();
  const { user } = useAuth();

  // Check if user is a production partner
  const isProductionPartner = user?.role === 'partner_seller';

  // Helper to get date range
  const getStartDate = (range: string) => {
    const now = new Date();
    switch (range) {
      case '7d': return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
      case '30d': return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
      case '90d': return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 89);
      case '1y': return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate() + 1);
      default: return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
    }
  };

  useEffect(() => {
    async function fetchStats() {
      setIsLoading(true);
      const startDate = getStartDate(timeRange);
      
      if (isProductionPartner) {
        // For partners, only fetch their assigned orders
        // First, find the partner's production_partners record
        const { data: partnerData, error: partnerError } = await supabase
          .from('production_partners')
          .select('id')
          .eq('email', user?.email)
          .single();
        
        if (partnerError) {
          console.error('Error fetching partner data:', partnerError);
          throw partnerError;
        }
        
        if (!partnerData) {
          console.log('No partner data found for email:', user?.email);
          setStats({
            orders: { total: 0, new: 0, trend: '', positive: null }
          });
          setSalesData([]);
          setIsLoading(false);
          return;
        }
        
        console.log('Partner data found:', partnerData);
        const ordersRes = await supabase
          .from('orders')
          .select('id,total_amount,total_with_vat,created_at,production_status')
          .eq('partner_id', partnerData.id);
        
        const orders = (ordersRes.data || []).filter(o => new Date(o.created_at) >= startDate);
        const ordersThisMonth = orders.filter(o => new Date(o.created_at).getMonth() === new Date().getMonth() && new Date(o.created_at).getFullYear() === new Date().getFullYear());
        
        // Calculate production orders
        const productionOrders = orders.filter(o => o.production_status && o.production_status !== 'pending');
        const inProductionOrders = orders.filter(o => o.production_status === 'in_production');
        const finishedOrders = orders.filter(o => o.production_status === 'ready' || o.production_status === 'completed');
        
        // Calculate costs
        const totalMaterialCosts = orders.reduce((sum, o) => sum + (o.material_costs || 0), 0);
        const totalLaborCosts = orders.reduce((sum, o) => sum + (o.working_hours_costs || 0), 0);
        const totalVat = orders.reduce((sum, o) => sum + (o.vat_amount || 0), 0);
        const totalCosts = orders.reduce((sum, o) => sum + (o.total_with_vat || 0), 0);
        
        setStats({
          orders: { total: orders.length, new: ordersThisMonth.length, trend: '', positive: null },
          productionOrders: { total: productionOrders.length, inProduction: inProductionOrders.length, finished: finishedOrders.length, trend: '', positive: null },
          costs: { total: totalCosts, material: totalMaterialCosts, labor: totalLaborCosts, vat: totalVat, trend: '', positive: null }
        });

        // Prepare sales data for chart (only partner's orders)
        let chartData: any[] = [];
        if (timeRange === '1y') {
          const months: {[k: string]: {revenue: number, costs: number}} = {};
          orders.forEach(o => {
            const d = new Date(o.created_at);
            const key = `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}`;
            if (!months[key]) {
              months[key] = { revenue: 0, costs: 0 };
            }
            months[key].revenue += (o.total_with_vat || 0); // Partner's revenue
            months[key].costs += (o.total_with_vat || 0); // Same as revenue for partners
          });
          chartData = Object.entries(months).map(([month, values]) => ({ 
            label: month, 
            revenue: values.revenue,
            costs: values.costs
          }));
        } else if (timeRange === '90d') {
          const weeks: {[k: string]: {revenue: number, costs: number}} = {};
          orders.forEach(o => {
            const d = new Date(o.created_at);
            const week = `${d.getFullYear()}-W${Math.ceil((d.getDate() + 6 - d.getDay()) / 7)}`;
            if (!weeks[week]) {
              weeks[week] = { revenue: 0, costs: 0 };
            }
            weeks[week].revenue += (o.total_with_vat || 0); // Partner's revenue
            weeks[week].costs += (o.total_with_vat || 0); // Same as revenue for partners
          });
          chartData = Object.entries(weeks).map(([week, values]) => ({ 
            label: week, 
            revenue: values.revenue,
            costs: values.costs
          }));
        } else {
          const days: {[k: string]: {revenue: number, costs: number}} = {};
          orders.forEach(o => {
            const d = new Date(o.created_at);
            const key = d.toISOString().slice(0,10);
            if (!days[key]) {
              days[key] = { revenue: 0, costs: 0 };
            }
            days[key].revenue += (o.total_with_vat || 0); // Partner's revenue
            days[key].costs += (o.total_with_vat || 0); // Same as revenue for partners
          });
          chartData = Object.entries(days).map(([day, values]) => ({ 
            label: day, 
            revenue: values.revenue,
            costs: values.costs
          }));
        }
        setSalesData(chartData.sort((a, b) => a.label.localeCompare(b.label)));
      } else {
        // For admin users, fetch all data
        const [customersRes, rfqsRes, ordersRes, partnersRes, productsRes] = await Promise.all([
          supabase.from('customers').select('id,created_at'),
          supabase.from('rfqs').select('id,created_at'),
          supabase.from('orders').select('id,total_amount,total_with_vat,created_at,production_status'),
          supabase.from('production_partners').select('id,active'),
          supabase.from('products').select('id,stock_quantity')
        ]);
        
        // Customers
        const customers = (customersRes.data || []).filter(c => new Date(c.created_at) >= startDate);
        const customersThisMonth = customers.filter(c => new Date(c.created_at).getMonth() === new Date().getMonth() && new Date(c.created_at).getFullYear() === new Date().getFullYear());
        // Quotes
        const rfqs = (rfqsRes.data || []).filter(q => new Date(q.created_at) >= startDate);
        const rfqsThisMonth = rfqs.filter(q => new Date(q.created_at).getMonth() === new Date().getMonth() && new Date(q.created_at).getFullYear() === new Date().getFullYear());
        // Orders
        const orders = (ordersRes.data || []).filter(o => new Date(o.created_at) >= startDate);
        const ordersThisMonth = orders.filter(o => new Date(o.created_at).getMonth() === new Date().getMonth() && new Date(o.created_at).getFullYear() === new Date().getFullYear());
        
        // Calculate production orders
        const productionOrders = orders.filter(o => o.production_status && o.production_status !== 'pending');
        const inProductionOrders = orders.filter(o => o.production_status === 'in_production');
        const finishedOrders = orders.filter(o => o.production_status === 'ready' || o.production_status === 'completed');
        
        // Revenue (what customers pay)
        const revenueThisMonth = ordersThisMonth.reduce((sum, o) => sum + (o.total_amount || 0), 0);
        
        // Calculate costs
        const totalMaterialCosts = orders.reduce((sum, o) => sum + (o.material_costs || 0), 0);
        const totalLaborCosts = orders.reduce((sum, o) => sum + (o.working_hours_costs || 0), 0);
        const totalVat = orders.reduce((sum, o) => sum + (o.vat_amount || 0), 0);
        const totalCosts = orders.reduce((sum, o) => sum + (o.total_with_vat || 0), 0);
        
        // Partners
        const partners = partnersRes.data || [];
        const activePartners = partners.filter(p => p.active).length;
        // Products
        const products = productsRes.data || [];
        const lowStock = products.filter(p => p.stock_quantity !== undefined && p.stock_quantity <= 5).length;
        
        setStats({
          customers: { total: customers.length, new: customersThisMonth.length, trend: '', positive: null },
          quotes: { total: rfqs.length, new: rfqsThisMonth.length, trend: '', positive: null },
          orders: { total: orders.length, new: ordersThisMonth.length, trend: '', positive: null },
          productionOrders: { total: productionOrders.length, inProduction: inProductionOrders.length, finished: finishedOrders.length, trend: '', positive: null },
          revenue: { total: revenueThisMonth, trend: '', positive: null },
          costs: { total: totalCosts, material: totalMaterialCosts, labor: totalLaborCosts, vat: totalVat, trend: '', positive: null },
          partners: { total: partners.length, active: activePartners, trend: '', positive: null },
          products: { total: products.length, lowStock, trend: '', positive: null }
        });

        // Prepare sales data for chart
        let chartData: any[] = [];
        if (timeRange === '1y') {
          const months: {[k: string]: {revenue: number, costs: number}} = {};
          orders.forEach(o => {
            const d = new Date(o.created_at);
            const key = `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}`;
            if (!months[key]) {
              months[key] = { revenue: 0, costs: 0 };
            }
            months[key].revenue += (o.total_amount || 0);
            months[key].costs += (o.total_with_vat || 0);
          });
          chartData = Object.entries(months).map(([month, values]) => ({ 
            label: month, 
            revenue: values.revenue,
            costs: values.costs
          }));
        } else if (timeRange === '90d') {
          const weeks: {[k: string]: {revenue: number, costs: number}} = {};
          orders.forEach(o => {
            const d = new Date(o.created_at);
            const week = `${d.getFullYear()}-W${Math.ceil((d.getDate() + 6 - d.getDay()) / 7)}`;
            if (!weeks[week]) {
              weeks[week] = { revenue: 0, costs: 0 };
            }
            weeks[week].revenue += (o.total_amount || 0);
            weeks[week].costs += (o.total_with_vat || 0);
          });
          chartData = Object.entries(weeks).map(([week, values]) => ({ 
            label: week, 
            revenue: values.revenue,
            costs: values.costs
          }));
        } else {
          const days: {[k: string]: {revenue: number, costs: number}} = {};
          orders.forEach(o => {
            const d = new Date(o.created_at);
            const key = d.toISOString().slice(0,10);
            if (!days[key]) {
              days[key] = { revenue: 0, costs: 0 };
            }
            days[key].revenue += (o.total_amount || 0);
            days[key].costs += (o.total_with_vat || 0);
          });
          chartData = Object.entries(days).map(([day, values]) => ({ 
            label: day, 
            revenue: values.revenue,
            costs: values.costs
          }));
        }
        setSalesData(chartData.sort((a, b) => a.label.localeCompare(b.label)));
      }
      
      setIsLoading(false);
    }
    fetchStats();
  }, [timeRange, isProductionPartner, user?.email]);

  // Helper to format currency
  const formatCurrency = (amount: number) => {
    return amount.toLocaleString('en-US', { style: 'currency', currency: 'EUR' });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-2 sm:space-y-0">
        <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
        <div className="flex items-center space-x-2">
          <Tabs defaultValue="30d" value={timeRange} onValueChange={setTimeRange}>
            <TabsList>
              <TabsTrigger value="7d">7d</TabsTrigger>
              <TabsTrigger value="30d">30d</TabsTrigger>
              <TabsTrigger value="90d">90d</TabsTrigger>
              <TabsTrigger value="1y">1y</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Show all cards for admin users */}
        {!isProductionPartner && (
          <>
            {/* Customers Card */}
            <StatCard 
              title="Customers"
              icon={<Users className="h-4 w-4" />}
              totalValue={isLoading ? null : stats.customers.total.toString()}
              subtitle={`${stats.customers.new} new this month`}
              trend={stats.customers.trend}
              trendPositive={stats.customers.positive}
              isLoading={isLoading}
              onClick={() => navigate('/customers')}
            />
            
            {/* RFQs Card */}
            <StatCard 
              title="Quote Requests"
              icon={<FileText className="h-4 w-4" />}
              totalValue={isLoading ? null : stats.quotes.total.toString()}
              subtitle={`${stats.quotes.new} new this month`}
              trend={stats.quotes.trend}
              trendPositive={stats.quotes.positive}
              isLoading={isLoading}
              onClick={() => navigate('/rfq-management')}
            />
            
            {/* Revenue Card */}
            <StatCard 
              title="Revenue"
              icon={<TrendingUp className="h-4 w-4" />}
              totalValue={isLoading ? null : formatCurrency(stats.revenue.total)}
              subtitle="Total this month"
              trend={stats.revenue.trend}
              trendPositive={stats.revenue.positive}
              isLoading={isLoading}
              onClick={() => navigate('/orders')}
            />
            
            {/* Production Partners Card */}
            <StatCard 
              title="Production Partners"
              icon={<Factory className="h-4 w-4" />}
              totalValue={isLoading ? null : stats.partners.total.toString()}
              subtitle={`${stats.partners.active} currently active`}
              trend={stats.partners.trend}
              trendPositive={stats.partners.positive}
              isLoading={isLoading}
              onClick={() => navigate('/partners')}
            />
            
            {/* Products Card */}
            <StatCard 
              title="Products"
              icon={<ShoppingBag className="h-4 w-4" />}
              totalValue={isLoading ? null : stats.products.total.toString()}
              subtitle={`${stats.products.lowStock} low stock items`}
              trend={stats.products.trend}
              trendPositive={stats.products.positive}
              isLoading={isLoading}
              onClick={() => navigate('/products')}
            />
          </>
        )}
        
        {/* Orders Card - Show for all users */}
        <StatCard 
          title="Orders"
          icon={<Package className="h-4 w-4" />}
          totalValue={isLoading ? null : stats.orders.total.toString()}
          subtitle={`${stats.orders.new} new this month`}
          trend={stats.orders.trend}
          trendPositive={stats.orders.positive}
          isLoading={isLoading}
          onClick={() => navigate('/orders')}
        />
        
        {/* Production Orders - In Production Card */}
        <StatCard 
          title="Production Orders - In Production"
          icon={<Factory className="h-4 w-4" />}
          totalValue={isLoading ? null : stats.productionOrders.inProduction.toString()}
          subtitle={`${stats.productionOrders.total} total production orders`}
          trend={stats.productionOrders.trend}
          trendPositive={stats.productionOrders.positive}
          isLoading={isLoading}
          onClick={() => navigate('/orders')}
        />
        
        {/* Production Orders - Finished Card */}
        <StatCard 
          title="Production Orders - Finished"
          icon={<Package className="h-4 w-4" />}
          totalValue={isLoading ? null : stats.productionOrders.finished.toString()}
          subtitle={`${stats.productionOrders.total} total production orders`}
          trend={stats.productionOrders.trend}
          trendPositive={stats.productionOrders.positive}
          isLoading={isLoading}
          onClick={() => navigate('/orders')}
        />
        
        {/* Cost Statistics Cards */}
        <StatCard 
          title="Total Costs"
          icon={<Factory className="h-4 w-4" />}
          totalValue={isLoading ? null : `€${stats.costs.total.toFixed(2)}`}
          subtitle={`€${stats.costs.material.toFixed(2)} materials + €${stats.costs.labor.toFixed(2)} labor`}
          trend={stats.costs.trend}
          trendPositive={stats.costs.positive}
          isLoading={isLoading}
          onClick={() => navigate('/orders')}
        />
        
      </div>
      
      {/* Charts and additional analytics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Latest system activities and events</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="flex items-center space-x-4">
                    <Skeleton className="h-12 w-12 rounded-full" />
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-[250px]" />
                      <Skeleton className="h-4 w-[200px]" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-muted-foreground">
                Activity feed will be implemented here.
              </div>
            )}
          </CardContent>
        </Card>
        
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>Revenue vs Costs Overview</CardTitle>
            <CardDescription>Revenue and costs breakdown over time</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px] flex items-center justify-center">
            {isLoading ? (
              <div className="w-full space-y-2">
                <Skeleton className="h-[250px] w-full" />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={salesData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.7}/>
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.05}/>
                    </linearGradient>
                    <linearGradient id="colorCosts" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.7}/>
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0.05}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 12, fill: '#6b7280' }} axisLine={false} tickLine={false} width={60} />
                  <Tooltip contentStyle={{ background: '#fff', borderRadius: 8, boxShadow: '0 2px 8px #0001', border: 'none', fontSize: 14 }} formatter={(v, name) => [`€${Number(v).toLocaleString()}`, name === 'revenue' ? 'Revenue' : 'Costs']}/>
                  <Legend verticalAlign="top" height={36} iconType="circle"/>
                  <Area type="monotone" dataKey="revenue" stroke="#10b981" fillOpacity={1} fill="url(#colorRevenue)" strokeWidth={3} dot={{ r: 4, fill: '#10b981', stroke: '#fff', strokeWidth: 2 }} activeDot={{ r: 6 }} name="Revenue" />
                  <Area type="monotone" dataKey="costs" stroke="#ef4444" fillOpacity={1} fill="url(#colorCosts)" strokeWidth={3} dot={{ r: 4, fill: '#ef4444', stroke: '#fff', strokeWidth: 2 }} activeDot={{ r: 6 }} name="Costs" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
      
      {/* Additional dashboard sections - Only show for admin users */}
      {!isProductionPartner && (
        <div className="grid grid-cols-1 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
              <CardDescription>Frequently used tools and shortcuts</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                <QuickActionButton 
                  icon={<Users />} 
                  label="New Customer" 
                  onClick={() => console.log('New customer')} 
                />
                <QuickActionButton 
                  icon={<FileText />} 
                  label="Create Quote" 
                  onClick={() => console.log('Create quote')} 
                />
                <QuickActionButton 
                  icon={<Package />} 
                  label="New Order" 
                  onClick={() => console.log('New order')} 
                />
                <QuickActionButton 
                  icon={<ShoppingBag />} 
                  label="Add Product" 
                  onClick={() => console.log('Add product')} 
                />
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

interface StatCardProps {
  title: string;
  icon: React.ReactNode;
  totalValue: string | null;
  subtitle: string;
  trend: string;
  trendPositive: boolean | null;
  isLoading: boolean;
  onClick: () => void;
}

const StatCard = ({
  title,
  icon,
  totalValue,
  subtitle,
  trend,
  trendPositive,
  isLoading,
  onClick
}: StatCardProps) => {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">
          {title}
        </CardTitle>
        <div className="h-4 w-4 text-muted-foreground">
          {icon}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-4 w-28" />
          </div>
        ) : (
          <>
            <div className="text-2xl font-bold">{totalValue}</div>
            <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
            {trend !== 'neutral' && (
              <div className={`flex items-center text-xs mt-2 ${
                trendPositive 
                  ? 'text-green-500' 
                  : trendPositive === false 
                    ? 'text-red-500' 
                    : 'text-muted-foreground'
              }`}>
                {trendPositive 
                  ? <ChevronUp className="h-3 w-3 mr-1" />
                  : trendPositive === false 
                    ? <ChevronDown className="h-3 w-3 mr-1" />
                    : null
                }
                <span>{trend}</span>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

interface QuickActionButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}

const QuickActionButton = ({ icon, label, onClick }: QuickActionButtonProps) => {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center justify-center p-4 border rounded-lg hover:bg-muted transition-colors"
    >
      <div className="h-8 w-8 text-primary mb-2">{icon}</div>
      <span className="text-sm">{label}</span>
    </button>
  );
};

export default DashboardOverview;
