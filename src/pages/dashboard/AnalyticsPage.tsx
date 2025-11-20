import React, { useState, useEffect } from "react";
import PersistentDashboardLayout from "@/components/dashboard/PersistentDashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  PieChart, 
  Pie, 
  Cell, 
  Legend
} from 'recharts';
import { format, subDays, startOfYear, endOfYear, parseISO, isWithinInterval } from "date-fns";
import { Loader2, TrendingUp, TrendingDown, DollarSign, ShoppingCart, Package, Calendar as CalendarIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";

// Types for our analytics data
interface RevenueData {
  date: string;
  revenue: number;
  costs: number;
  profit: number;
}

interface OrderStatusData {
  name: string;
  value: number;
  color: string;
}

interface ProductPerformanceData {
  name: string;
  sales: number;
  revenue: number;
}

interface CustomerGrowthData {
  date: string;
  newCustomers: number;
  activeCustomers: number;
}

const AnalyticsPage = () => {
  const [timeRange, setTimeRange] = useState("30d");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [isLoading, setIsLoading] = useState(true);
  
  // State for chart data
  const [revenueData, setRevenueData] = useState<RevenueData[]>([]);
  const [orderStatusData, setOrderStatusData] = useState<OrderStatusData[]>([]);
  const [productData, setProductData] = useState<ProductPerformanceData[]>([]);
  const [customerData, setCustomerData] = useState<CustomerGrowthData[]>([]);
  
  // Summary metrics
  const [metrics, setMetrics] = useState({
    totalRevenue: 0,
    revenueGrowth: 0,
    totalOrders: 0,
    orderGrowth: 0,
    avgOrderValue: 0,
    conversionRate: 0
  });

  useEffect(() => {
    if (timeRange !== 'custom') {
      setDateRange(undefined);
      fetchAnalyticsData();
    }
  }, [timeRange]);

  useEffect(() => {
    if (timeRange === 'custom' && dateRange?.from && dateRange?.to) {
      fetchAnalyticsData();
    }
  }, [dateRange]);

  const getDateFilter = () => {
    const now = new Date();
    
    if (timeRange === 'custom' && dateRange?.from) {
      return {
        start: dateRange.from,
        end: dateRange.to || dateRange.from
      };
    }

    switch (timeRange) {
      case '7d': return { start: subDays(now, 7), end: now };
      case '30d': return { start: subDays(now, 30), end: now };
      case '90d': return { start: subDays(now, 90), end: now };
      case 'ytd': return { start: startOfYear(now), end: now };
      case '1y': return { start: subDays(now, 365), end: now };
      default: return { start: subDays(now, 30), end: now };
    }
  };

  const fetchAnalyticsData = async () => {
    setIsLoading(true);
    const { start, end } = getDateFilter();
    const isoStartDate = start.toISOString();
    const isoEndDate = end.toISOString();

    try {
      // 1. Fetch Orders for Revenue & Status
      const { data: orders, error: ordersError } = await supabase
        .from('orders')
        .select('created_at, total_amount, total_with_vat, status, production_status, material_costs, working_hours_costs')
        .gte('created_at', isoStartDate)
        .lte('created_at', isoEndDate)
        .order('created_at', { ascending: true });

      if (ordersError) throw ordersError;

      // 2. Fetch Customers for Growth
      const { data: customers, error: customersError } = await supabase
        .from('customers')
        .select('created_at, status')
        .gte('created_at', isoStartDate)
        .lte('created_at', isoEndDate)
        .order('created_at', { ascending: true });

      if (customersError) throw customersError;

      // 3. Process Revenue Data
      const revenueMap = new Map<string, RevenueData>();
      
      orders?.forEach(order => {
        const date = format(parseISO(order.created_at), 'MMM dd');
        const existing = revenueMap.get(date) || { date, revenue: 0, costs: 0, profit: 0 };
        
        const revenue = order.total_amount || 0;
        // Estimating costs if not explicitly tracked
        const costs = (order.material_costs || 0) + (order.working_hours_costs || 0) || (revenue * 0.6); 
        
        existing.revenue += revenue;
        existing.costs += costs;
        existing.profit += (revenue - costs);
        
        revenueMap.set(date, existing);
      });

      const processedRevenueData = Array.from(revenueMap.values());

      // 4. Process Order Status Data
      const statusCounts = {
        new: 0,
        in_progress: 0,
        completed: 0,
        cancelled: 0
      };

      orders?.forEach(order => {
        const status = order.status || 'new';
        if (status in statusCounts) {
          statusCounts[status as keyof typeof statusCounts]++;
        }
      });

      const processedStatusData = [
        { name: 'New', value: statusCounts.new, color: '#3b82f6' }, // Blue
        { name: 'In Progress', value: statusCounts.in_progress, color: '#f59e0b' }, // Amber
        { name: 'Completed', value: statusCounts.completed, color: '#10b981' }, // Emerald
        { name: 'Cancelled', value: statusCounts.cancelled, color: '#ef4444' }, // Red
      ].filter(item => item.value > 0);

      // 5. Process Customer Growth
      const customerMap = new Map<string, CustomerGrowthData>();
      let cumulativeCustomers = 0; // This should ideally start from total before date range
      
      customers?.forEach(customer => {
        const date = format(parseISO(customer.created_at), 'MMM dd');
        const existing = customerMap.get(date) || { date, newCustomers: 0, activeCustomers: 0 };
        
        existing.newCustomers++;
        cumulativeCustomers++;
        existing.activeCustomers = cumulativeCustomers; // simplified
        
        customerMap.set(date, existing);
      });
      
      const processedCustomerData = Array.from(customerMap.values());

      // 6. Calculate Metrics
      const totalRevenue = orders?.reduce((sum, order) => sum + (order.total_amount || 0), 0) || 0;
      const totalOrders = orders?.length || 0;
      const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

      setRevenueData(processedRevenueData);
      setOrderStatusData(processedStatusData);
      setCustomerData(processedCustomerData);
      setMetrics({
        totalRevenue,
        revenueGrowth: 0, // Needs comparison logic
        totalOrders,
        orderGrowth: 0, // Needs comparison logic
        avgOrderValue,
        conversionRate: 0 // Needs traffic data
      });

      // 7. Real Product Data (if available) or Empty State
      // We removed the dummy data here as requested.
      // If you have a way to link orders to products (e.g. order_items table), fetch it here.
      // For now, we'll leave it empty to ensure no fake data is shown.
      setProductData([]); 

    } catch (error) {
      console.error("Error fetching analytics:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0
    }).format(value);
  };

  return (
    <PersistentDashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Analytics Dashboard</h1>
            <p className="text-muted-foreground mt-1">Deep insights into your business performance.</p>
          </div>
          
          <div className="flex flex-col sm:flex-row items-center gap-2">
            {timeRange === 'custom' && (
              <div className="grid gap-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      id="date"
                      variant={"outline"}
                      className={cn(
                        "w-[260px] justify-start text-left font-normal",
                        !dateRange && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dateRange?.from ? (
                        dateRange.to ? (
                          <>
                            {format(dateRange.from, "LLL dd, y")} -{" "}
                            {format(dateRange.to, "LLL dd, y")}
                          </>
                        ) : (
                          format(dateRange.from, "LLL dd, y")
                        )
                      ) : (
                        <span>Pick a date</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="end">
                    <Calendar
                      initialFocus
                      mode="range"
                      defaultMonth={dateRange?.from}
                      selected={dateRange}
                      onSelect={setDateRange}
                      numberOfMonths={2}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            )}

            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Select range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 3 months</SelectItem>
                <SelectItem value="ytd">This Year (YTD)</SelectItem>
                <SelectItem value="1y">Last year</SelectItem>
                <SelectItem value="custom">Custom Range</SelectItem>
              </SelectContent>
            </Select>
            
            <Button variant="outline" onClick={fetchAnalyticsData} disabled={isLoading}>
               {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Refresh'}
            </Button>
          </div>
        </div>

        {/* Key Metrics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard 
            title="Total Revenue" 
            value={formatCurrency(metrics.totalRevenue)} 
            trend={metrics.revenueGrowth} 
            icon={<DollarSign className="h-4 w-4" />}
            loading={isLoading}
          />
          <MetricCard 
            title="Total Orders" 
            value={metrics.totalOrders.toString()} 
            trend={metrics.orderGrowth} 
            icon={<ShoppingCart className="h-4 w-4" />}
            loading={isLoading}
          />
          <MetricCard 
            title="Avg. Order Value" 
            value={formatCurrency(metrics.avgOrderValue)} 
            trend={0} 
            icon={<Package className="h-4 w-4" />}
            loading={isLoading}
          />
          <MetricCard 
            title="Conversion Rate" 
            value={`${metrics.conversionRate}%`} 
            trend={0} 
            icon={<TrendingUp className="h-4 w-4" />}
            loading={isLoading}
            inverseTrend
          />
        </div>

        {/* Main Charts Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* Revenue vs Costs Area Chart */}
          <Card className="col-span-1 lg:col-span-2 shadow-sm border hover:shadow-md transition-all">
            <CardHeader>
              <CardTitle>Revenue & Costs Overview</CardTitle>
              <CardDescription>Financial performance over the selected period</CardDescription>
            </CardHeader>
            <CardContent className="h-[350px]">
              {isLoading ? (
                <div className="h-full flex items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : revenueData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={revenueData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorCosts" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                    <XAxis 
                      dataKey="date" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fill: '#6b7280', fontSize: 12 }} 
                      dy={10}
                    />
                    <YAxis 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fill: '#6b7280', fontSize: 12 }} 
                      tickFormatter={(value) => `€${value}`}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'white', 
                        borderRadius: '8px', 
                        border: '1px solid #e2e8f0',
                        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                      }}
                      formatter={(value: number) => [formatCurrency(value), '']}
                    />
                    <Legend verticalAlign="top" height={36} />
                    <Area 
                      type="monotone" 
                      dataKey="revenue" 
                      name="Revenue" 
                      stroke="#10b981" 
                      fillOpacity={1} 
                      fill="url(#colorRevenue)" 
                      strokeWidth={2}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="costs" 
                      name="Costs" 
                      stroke="#ef4444" 
                      fillOpacity={1} 
                      fill="url(#colorCosts)" 
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
                  <TrendingUp className="h-12 w-12 mb-4 opacity-20" />
                  <p>No revenue data available for this period</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Order Status Distribution */}
          <Card className="shadow-sm border hover:shadow-md transition-all">
            <CardHeader>
              <CardTitle>Order Status Distribution</CardTitle>
              <CardDescription>Breakdown of orders by current status</CardDescription>
            </CardHeader>
            <CardContent className="h-[300px]">
              {isLoading ? (
                <div className="h-full flex items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : orderStatusData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={orderStatusData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {orderStatusData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip 
                       contentStyle={{ 
                        backgroundColor: 'white', 
                        borderRadius: '8px', 
                        border: '1px solid #e2e8f0',
                        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                      }}
                    />
                    <Legend verticalAlign="bottom" height={36} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
                  <Package className="h-12 w-12 mb-4 opacity-20" />
                  <p>No order status data available</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Top Products / Categories */}
          <Card className="shadow-sm border hover:shadow-md transition-all">
            <CardHeader>
              <CardTitle>Top Revenue Sources</CardTitle>
              <CardDescription>Revenue by product category</CardDescription>
            </CardHeader>
            <CardContent className="h-[300px]">
              {isLoading ? (
                <div className="h-full flex items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : productData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    layout="vertical"
                    data={productData}
                    margin={{ top: 5, right: 30, left: 40, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb" />
                    <XAxis type="number" hide />
                    <YAxis 
                      dataKey="name" 
                      type="category" 
                      width={100} 
                      tick={{ fill: '#374151', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: 'transparent' }}
                      contentStyle={{ 
                        backgroundColor: 'white', 
                        borderRadius: '8px', 
                        border: '1px solid #e2e8f0',
                        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                      }}
                      formatter={(value: number) => [formatCurrency(value), 'Revenue']}
                    />
                    <Bar dataKey="revenue" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={20}>
                      {productData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={index % 2 === 0 ? '#3b82f6' : '#60a5fa'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
                  <ShoppingCart className="h-12 w-12 mb-4 opacity-20" />
                  <p>No product revenue data available yet.</p>
                  <p className="text-xs mt-1">Data will appear here once orders are linked to products.</p>
                </div>
              )}
            </CardContent>
          </Card>
          
        </div>
      </div>
    </PersistentDashboardLayout>
  );
};

import { Button } from "@/components/ui/button";

// Helper Component for Metric Cards
const MetricCard = ({ title, value, trend, icon, loading, inverseTrend }: any) => {
  const isPositive = trend >= 0;
  const isGood = inverseTrend ? !isPositive : isPositive; // For things like churn, negative is good
  
  return (
    <Card className="shadow-sm border hover:shadow-md transition-all">
      <CardContent className="p-6">
        <div className="flex justify-between items-start">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
            {loading ? (
              <div className="h-8 w-24 bg-gray-100 animate-pulse rounded mt-1" />
            ) : (
              <h3 className="text-2xl font-bold mt-1">{value}</h3>
            )}
          </div>
          <div className="p-2 bg-primary/5 text-primary rounded-lg">
            {icon}
          </div>
        </div>
        
        <div className="mt-4 flex items-center text-xs">
          {!loading && trend !== 0 && (
            <>
              <span className={`flex items-center font-medium ${isGood ? 'text-green-600' : 'text-red-600'}`}>
                {isPositive ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />}
                {Math.abs(trend)}%
              </span>
              <span className="text-muted-foreground ml-2">vs last period</span>
            </>
          )}
          {!loading && trend === 0 && (
             <span className="text-muted-foreground">No trend data available</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default AnalyticsPage;
