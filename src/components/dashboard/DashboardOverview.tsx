import { useState, useEffect } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Users,
  FileText,
  Package,
  Factory,
  TrendingUp,
  DollarSign,
  Plus,
  Clock,
  UserPlus,
  FileCheck,
  ShoppingCart,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
  Legend,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from "recharts";
import { useAuth } from "@/contexts/AuthContext";
import { format, formatDistanceToNow } from "date-fns";

// Activity item type
interface ActivityItem {
  id: string;
  type: "rfq" | "order" | "customer";
  title: string;
  description: string;
  timestamp: string;
}

const ORDER_STATUS_COLORS: Record<string, string> = {
  new: "#3b82f6",
  pending: "#f59e0b",
  in_progress: "#eab308",
  completed: "#10b981",
  cancelled: "#ef4444",
};

const RFQ_STATUS_COLORS: Record<string, string> = {
  draft: "#94a3b8",
  sent: "#3b82f6",
  received: "#f97316",
  approved: "#10b981",
  rejected: "#ef4444",
};

const DashboardOverview = () => {
  const [timeRange, setTimeRange] = useState<string>("30d");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [stats, setStats] = useState<any>({
    customers: { total: 0, new: 0 },
    quotes: { total: 0, new: 0 },
    orders: { total: 0, new: 0 },
    productionOrders: { total: 0, inProduction: 0, finished: 0 },
    revenue: { total: 0 },
    costs: { total: 0, material: 0, labor: 0, vat: 0 },
  });
  const [salesData, setSalesData] = useState<any[]>([]);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [orderStatusData, setOrderStatusData] = useState<any[]>([]);
  const [rfqPipelineData, setRfqPipelineData] = useState<any[]>([]);
  const navigate = useNavigate();
  const { user } = useAuth();

  const isProductionPartner = user?.role === "partner_seller";

  const getStartDate = (range: string) => {
    const now = new Date();
    switch (range) {
      case "7d": return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
      case "30d": return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
      case "90d": return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 89);
      case "1y": return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate() + 1);
      default: return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
    }
  };

  useEffect(() => {
    async function fetchStats() {
      setIsLoading(true);
      const startDate = getStartDate(timeRange);

      if (isProductionPartner) {
        const { data: partnerData } = await supabase
          .from("production_partners")
          .select("id")
          .eq("email", user?.email)
          .single();

        if (!partnerData) {
          setStats({ orders: { total: 0, new: 0 }, productionOrders: { total: 0, inProduction: 0, finished: 0 }, costs: { total: 0, material: 0, labor: 0, vat: 0 } });
          setSalesData([]);
          setIsLoading(false);
          return;
        }

        const ordersRes = await supabase
          .from("orders")
          .select("id,total_amount,total_with_vat,created_at,production_status")
          .eq("partner_id", partnerData.id);

        const orders = (ordersRes.data || []).filter((o) => new Date(o.created_at) >= startDate);
        const ordersThisMonth = orders.filter((o) => new Date(o.created_at).getMonth() === new Date().getMonth() && new Date(o.created_at).getFullYear() === new Date().getFullYear());
        const inProd = orders.filter((o) => o.production_status === "in_production");
        const finished = orders.filter((o) => o.production_status === "ready" || o.production_status === "completed");
        const totalCosts = orders.reduce((s, o) => s + (o.total_with_vat || 0), 0);

        setStats({
          orders: { total: orders.length, new: ordersThisMonth.length },
          productionOrders: { total: orders.length, inProduction: inProd.length, finished: finished.length },
          costs: { total: totalCosts, material: 0, labor: 0, vat: 0 },
        });
        buildChartData(orders, timeRange, true);
      } else {
        const [customersRes, rfqsRes, ordersRes] = await Promise.all([
          supabase.from("customers").select("id,created_at,company_name,email,first_name,last_name"),
          supabase.from("rfqs").select("id,created_at,title,status,company_name,rfq_number,customers(company_name)"),
          supabase.from("orders").select("id,total_amount,total_with_vat,created_at,production_status,status,title,customers(company_name)"),
        ]);

        const customers = (customersRes.data || []).filter((c) => new Date(c.created_at) >= startDate);
        const customersThisMonth = customers.filter((c) => new Date(c.created_at).getMonth() === new Date().getMonth() && new Date(c.created_at).getFullYear() === new Date().getFullYear());
        const rfqs = (rfqsRes.data || []).filter((q) => new Date(q.created_at) >= startDate);
        const rfqsThisMonth = rfqs.filter((q) => new Date(q.created_at).getMonth() === new Date().getMonth() && new Date(q.created_at).getFullYear() === new Date().getFullYear());
        const orders = (ordersRes.data || []).filter((o) => new Date(o.created_at) >= startDate);
        const ordersThisMonth = orders.filter((o) => new Date(o.created_at).getMonth() === new Date().getMonth() && new Date(o.created_at).getFullYear() === new Date().getFullYear());

        const inProd = orders.filter((o) => o.production_status === "in_production");
        const finished = orders.filter((o) => o.production_status === "ready" || o.production_status === "completed");
        const revenueThisMonth = ordersThisMonth.reduce((s, o) => s + (o.total_amount || 0), 0);
        const totalCosts = orders.reduce((s, o) => s + (o.total_with_vat || 0), 0);

        setStats({
          customers: { total: customers.length, new: customersThisMonth.length },
          quotes: { total: rfqs.length, new: rfqsThisMonth.length },
          orders: { total: orders.length, new: ordersThisMonth.length },
          productionOrders: { total: orders.length, inProduction: inProd.length, finished: finished.length },
          revenue: { total: revenueThisMonth },
          costs: { total: totalCosts, material: 0, labor: 0, vat: 0 },
        });

        buildChartData(orders, timeRange, false);

        // Order status distribution
        const statusCounts: Record<string, number> = {};
        orders.forEach((o) => {
          const s = o.status || "new";
          statusCounts[s] = (statusCounts[s] || 0) + 1;
        });
        setOrderStatusData(
          Object.entries(statusCounts).map(([name, value]) => ({
            name: name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
            value,
            color: ORDER_STATUS_COLORS[name] || "#94a3b8",
          }))
        );

        // RFQ pipeline
        const rfqCounts: Record<string, number> = {};
        (rfqsRes.data || []).forEach((r: any) => {
          const s = r.status || "draft";
          rfqCounts[s] = (rfqCounts[s] || 0) + 1;
        });
        setRfqPipelineData(
          ["draft", "sent", "received", "approved", "rejected"]
            .filter((s) => rfqCounts[s])
            .map((s) => ({
              name: s === "sent" ? "Quoted" : s === "received" ? "Under Review" : s.charAt(0).toUpperCase() + s.slice(1),
              count: rfqCounts[s] || 0,
              fill: RFQ_STATUS_COLORS[s],
            }))
        );

        // Recent activity feed
        const activityItems: ActivityItem[] = [];
        (rfqsRes.data || [])
          .slice(0, 8)
          .forEach((r: any) => {
            activityItems.push({
              id: `rfq-${r.id}`,
              type: "rfq",
              title: `RFQ ${r.rfq_number || r.title || r.id.slice(0, 8)}`,
              description: `${r.status === "received" ? "Received" : r.status === "approved" ? "Approved" : r.status === "draft" ? "Created as draft" : `Status: ${r.status}`} — ${(r as any).customers?.company_name || r.company_name || "Unknown"}`,
              timestamp: r.created_at,
            });
          });
        (ordersRes.data || [])
          .slice(0, 5)
          .forEach((o: any) => {
            activityItems.push({
              id: `order-${o.id}`,
              type: "order",
              title: `Order ${o.title || o.id.slice(0, 8)}`,
              description: `${o.status === "new" ? "New order created" : `Status: ${(o.status || "").replace(/_/g, " ")}`} — ${o.customers?.company_name || "Unknown"}`,
              timestamp: o.created_at,
            });
          });
        (customersRes.data || [])
          .slice(0, 5)
          .forEach((c: any) => {
            activityItems.push({
              id: `cust-${c.id}`,
              type: "customer",
              title: c.company_name || `${c.first_name || ""} ${c.last_name || ""}`.trim() || c.email || "Customer",
              description: "Registered as customer",
              timestamp: c.created_at,
            });
          });
        activityItems.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        setActivities(activityItems.slice(0, 10));
      }

      setIsLoading(false);
    }
    fetchStats();
  }, [timeRange, isProductionPartner, user?.email]);

  function buildChartData(orders: any[], range: string, isPartner: boolean) {
    let chartData: any[] = [];
    const bucket = (o: any) => {
      const d = new Date(o.created_at);
      if (range === "1y") return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}`;
      if (range === "90d") return `${d.getFullYear()}-W${Math.ceil((d.getDate() + 6 - d.getDay()) / 7)}`;
      return d.toISOString().slice(0, 10);
    };
    const buckets: Record<string, { revenue: number; costs: number }> = {};
    orders.forEach((o) => {
      const key = bucket(o);
      if (!buckets[key]) buckets[key] = { revenue: 0, costs: 0 };
      buckets[key].revenue += isPartner ? (o.total_with_vat || 0) : (o.total_amount || 0);
      buckets[key].costs += o.total_with_vat || 0;
    });
    chartData = Object.entries(buckets)
      .map(([label, v]) => ({ label, revenue: v.revenue, costs: v.costs }))
      .sort((a, b) => a.label.localeCompare(b.label));
    setSalesData(chartData);
  }

  const formatCurrency = (amount: number) =>
    amount.toLocaleString("en-US", { style: "currency", currency: "EUR" });

  const activityIcon = (type: string) => {
    switch (type) {
      case "rfq": return <FileCheck className="h-4 w-4 text-blue-600" />;
      case "order": return <ShoppingCart className="h-4 w-4 text-emerald-600" />;
      case "customer": return <UserPlus className="h-4 w-4 text-violet-600" />;
      default: return <Clock className="h-4 w-4 text-slate-400" />;
    }
  };

  const activityBg = (type: string) => {
    switch (type) {
      case "rfq": return "bg-blue-50";
      case "order": return "bg-emerald-50";
      case "customer": return "bg-violet-50";
      default: return "bg-slate-50";
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top Bar */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Dashboard</h1>
          <p className="text-xs text-slate-500">Overview of your business metrics</p>
        </div>
        <div className="flex items-center gap-3">
          <Tabs value={timeRange} onValueChange={setTimeRange}>
            <TabsList className="bg-slate-100">
              <TabsTrigger value="7d" className="text-xs">7d</TabsTrigger>
              <TabsTrigger value="30d" className="text-xs">30d</TabsTrigger>
              <TabsTrigger value="90d" className="text-xs">90d</TabsTrigger>
              <TabsTrigger value="1y" className="text-xs">1y</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <div className="px-6 py-5 max-w-7xl mx-auto space-y-5">
        {/* Quick Actions — admin only */}
        {!isProductionPartner && (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => navigate("/customers")} className="inline-flex items-center gap-1.5 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors">
              <Plus className="h-3.5 w-3.5" /> New Customer
            </button>
            <button onClick={() => navigate("/rfq-management")} className="inline-flex items-center gap-1.5 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors">
              <FileText className="h-3.5 w-3.5" /> Create Quote
            </button>
            <button onClick={() => navigate("/rfq-management?tab=orders")} className="inline-flex items-center gap-1.5 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors">
              <Package className="h-3.5 w-3.5" /> New Order
            </button>
          </div>
        )}

        {/* Stat Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {!isProductionPartner && (
            <>
              <StatCard title="Customers" value={stats.customers.total} sub={`${stats.customers.new} new`} icon={<Users className="h-5 w-5" />} color="blue" loading={isLoading} onClick={() => navigate("/customers")} />
              <StatCard title="Quote Requests" value={stats.quotes.total} sub={`${stats.quotes.new} new`} icon={<FileText className="h-5 w-5" />} color="orange" loading={isLoading} onClick={() => navigate("/rfq-management")} />
              <StatCard title="Revenue" value={formatCurrency(stats.revenue.total)} sub="This month" icon={<TrendingUp className="h-5 w-5" />} color="emerald" loading={isLoading} onClick={() => navigate("/orders")} />
            </>
          )}
          <StatCard title="Orders" value={stats.orders.total} sub={`${stats.orders.new} new`} icon={<Package className="h-5 w-5" />} color="indigo" loading={isLoading} onClick={() => navigate("/orders")} />
          <StatCard title="In Production" value={stats.productionOrders.inProduction} sub={`of ${stats.productionOrders.total} total`} icon={<Factory className="h-5 w-5" />} color="amber" loading={isLoading} onClick={() => navigate("/orders")} />
          <StatCard title="Completed" value={stats.productionOrders.finished} sub="Finished orders" icon={<Package className="h-5 w-5" />} color="emerald" loading={isLoading} onClick={() => navigate("/orders")} />
          <StatCard title="Total Costs" value={`€${stats.costs.total.toFixed(2)}`} sub="All time" icon={<DollarSign className="h-5 w-5" />} color="rose" loading={isLoading} onClick={() => navigate("/orders")} />
        </div>

        {/* Charts Row 1 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Revenue vs Costs */}
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Revenue vs Costs</h3>
                <p className="text-xs text-slate-500">Financial overview over time</p>
              </div>
            </div>
            <div className="h-[260px]">
              {isLoading ? (
                <Skeleton className="h-full w-full" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={salesData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gRevenue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.6} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="gCosts" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.6} />
                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={55} />
                    <Tooltip contentStyle={{ background: "#fff", borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,.08)", border: "1px solid #e2e8f0", fontSize: 13 }} formatter={(v: any, name: any) => [`€${Number(v).toLocaleString()}`, name === "revenue" ? "Revenue" : "Costs"]} />
                    <Legend verticalAlign="top" height={32} iconType="circle" />
                    <Area type="monotone" dataKey="revenue" stroke="#10b981" fill="url(#gRevenue)" strokeWidth={2.5} dot={false} name="Revenue" />
                    <Area type="monotone" dataKey="costs" stroke="#ef4444" fill="url(#gCosts)" strokeWidth={2.5} dot={false} name="Costs" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Order Status Distribution */}
          {!isProductionPartner && (
            <div className="bg-white border border-slate-200 rounded-lg p-5">
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-slate-900">Order Status</h3>
                <p className="text-xs text-slate-500">Distribution of current orders</p>
              </div>
              <div className="h-[260px]">
                {isLoading ? (
                  <Skeleton className="h-full w-full" />
                ) : orderStatusData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={orderStatusData} cx="50%" cy="50%" innerRadius={60} outerRadius={95} paddingAngle={3} dataKey="value" nameKey="name" label={({ name, value }) => `${name} (${value})`} labelLine={{ stroke: "#94a3b8" }}>
                        {orderStatusData.map((entry: any, idx: number) => (
                          <Cell key={idx} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-sm text-slate-400">No order data</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Charts Row 2 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* RFQ Pipeline */}
          {!isProductionPartner && (
            <div className="bg-white border border-slate-200 rounded-lg p-5">
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-slate-900">RFQ Pipeline</h3>
                <p className="text-xs text-slate-500">Quote requests by status</p>
              </div>
              <div className="h-[240px]">
                {isLoading ? (
                  <Skeleton className="h-full w-full" />
                ) : rfqPipelineData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={rfqPipelineData} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} width={90} />
                      <Tooltip contentStyle={{ background: "#fff", borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,.08)", border: "1px solid #e2e8f0", fontSize: 13 }} />
                      <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={24}>
                        {rfqPipelineData.map((entry: any, idx: number) => (
                          <Cell key={idx} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-sm text-slate-400">No RFQ data</div>
                )}
              </div>
            </div>
          )}

          {/* Recent Activity */}
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-slate-900">Recent Activity</h3>
              <p className="text-xs text-slate-500">Latest events across your platform</p>
            </div>
            <div className="space-y-1 max-h-[240px] overflow-y-auto">
              {isLoading ? (
                [...Array(5)].map((_, i) => (
                  <div key={i} className="flex items-center gap-3 p-2">
                    <Skeleton className="h-8 w-8 rounded-full" />
                    <div className="space-y-1.5 flex-1">
                      <Skeleton className="h-3.5 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                ))
              ) : activities.length > 0 ? (
                activities.map((a) => (
                  <div key={a.id} className="flex items-start gap-3 px-2 py-2.5 rounded-lg hover:bg-slate-50 transition-colors">
                    <div className={`flex-shrink-0 h-8 w-8 rounded-full ${activityBg(a.type)} flex items-center justify-center`}>
                      {activityIcon(a.type)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-800 truncate">{a.title}</p>
                      <p className="text-xs text-slate-500 truncate">{a.description}</p>
                    </div>
                    <span className="text-[10px] text-slate-400 whitespace-nowrap flex-shrink-0 pt-0.5">
                      {formatDistanceToNow(new Date(a.timestamp), { addSuffix: true })}
                    </span>
                  </div>
                ))
              ) : (
                <div className="py-8 text-center text-sm text-slate-400">No recent activity</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Stat Card ──────────────────────────
interface StatCardProps {
  title: string;
  value: string | number;
  sub: string;
  icon: React.ReactNode;
  color: string;
  loading: boolean;
  onClick: () => void;
}

const colorMap: Record<string, { bg: string; text: string; iconBg: string }> = {
  blue: { bg: "hover:border-blue-300", text: "text-blue-600", iconBg: "bg-blue-50" },
  orange: { bg: "hover:border-orange-300", text: "text-orange-600", iconBg: "bg-orange-50" },
  emerald: { bg: "hover:border-emerald-300", text: "text-emerald-600", iconBg: "bg-emerald-50" },
  indigo: { bg: "hover:border-indigo-300", text: "text-indigo-600", iconBg: "bg-indigo-50" },
  amber: { bg: "hover:border-amber-300", text: "text-amber-600", iconBg: "bg-amber-50" },
  rose: { bg: "hover:border-rose-300", text: "text-rose-600", iconBg: "bg-rose-50" },
  violet: { bg: "hover:border-violet-300", text: "text-violet-600", iconBg: "bg-violet-50" },
};

const StatCard = ({ title, value, sub, icon, color, loading, onClick }: StatCardProps) => {
  const c = colorMap[color] || colorMap.blue;
  return (
    <div
      onClick={onClick}
      className={`bg-white border border-slate-200 rounded-lg p-4 cursor-pointer transition-all hover:shadow-md ${c.bg} group`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className={`p-2 rounded-lg ${c.iconBg} ${c.text}`}>{icon}</div>
      </div>
      {loading ? (
        <Skeleton className="h-8 w-20 mb-1" />
      ) : (
        <p className="text-2xl font-bold text-slate-900">{value}</p>
      )}
      <p className="text-[11px] text-slate-500 mt-0.5">{loading ? <Skeleton className="h-3 w-16" /> : sub}</p>
      <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wider mt-2">{title}</p>
    </div>
  );
};

export default DashboardOverview;
