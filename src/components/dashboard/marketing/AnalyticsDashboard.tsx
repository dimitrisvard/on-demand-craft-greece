import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell } from 'recharts';
import { ArrowUpRight, ArrowDownRight, Users, Mail, MousePointer2, AlertCircle, UserMinus } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, subDays, eachDayOfInterval } from 'date-fns';

const AnalyticsDashboard = () => {
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('all');

  // 1. Fetch All Campaigns for Dropdown
  const { data: campaigns } = useQuery({
    queryKey: ['campaigns-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('marketing_campaigns')
        .select('id, name, created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // 2. Fetch Metrics based on selection
  const { data: metrics } = useQuery({
    queryKey: ['analytics-metrics', selectedCampaignId],
    queryFn: async () => {
      let query = supabase.from('marketing_campaigns').select(`
        sent_count,
        marketing_analytics (
          opens,
          clicks,
          bounces
        )
      `);

      if (selectedCampaignId !== 'all') {
        query = query.eq('id', selectedCampaignId);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Aggregate data
      const totals = data.reduce(
        (acc, curr) => {
          const analytics = curr.marketing_analytics?.[0] || { opens: 0, clicks: 0, bounces: 0 };
          return {
            sent: acc.sent + (curr.sent_count || 0),
            opens: acc.opens + (analytics.opens || 0),
            clicks: acc.clicks + (analytics.clicks || 0),
            bounces: acc.bounces + (analytics.bounces || 0),
          };
        },
        { sent: 0, opens: 0, clicks: 0, bounces: 0 }
      );

      // Fetch unsubscribe count from events
      let unsubQuery = supabase
        .from('marketing_events')
        .select('id', { count: 'exact', head: true })
        .eq('event_type', 'unsubscribed');

      if (selectedCampaignId !== 'all') {
        unsubQuery = unsubQuery.eq('campaign_id', selectedCampaignId);
      }

      const { count: unsubCount } = await unsubQuery;

      return { ...totals, unsubscribes: unsubCount || 0 };
    },
  });

  // 3. Fetch Time Series Data (Mocked for 'all', Specific for single)
  // Since we don't have a time-series table for aggregated opens yet, 
  // we will construct it from marketing_events if a campaign is selected,
  // or use a mock/aggregate if 'all' (heavy query otherwise).
  const { data: chartData } = useQuery({
    queryKey: ['analytics-chart', selectedCampaignId],
    queryFn: async () => {
      const days = eachDayOfInterval({
        start: subDays(new Date(), 6),
        end: new Date(),
      });

      // Fetch real events for all campaigns or specific campaign
      let eventsQuery = supabase
        .from('marketing_events')
        .select('event_type, created_at')
        .in('event_type', ['opened', 'clicked'])
        .gte('created_at', subDays(new Date(), 7).toISOString());

      if (selectedCampaignId !== 'all') {
        eventsQuery = eventsQuery.eq('campaign_id', selectedCampaignId);
      }

      const { data: events } = await eventsQuery;

      const dayMap = new Map();
      days.forEach(day => {
          dayMap.set(format(day, 'MMM dd'), { name: format(day, 'MMM dd'), opens: 0, clicks: 0 });
      });

      events?.forEach(event => {
          const dayKey = format(new Date(event.created_at), 'MMM dd');
          if (dayMap.has(dayKey)) {
              const entry = dayMap.get(dayKey);
              if (event.event_type === 'opened') entry.opens++;
              if (event.event_type === 'clicked') entry.clicks++;
          }
      });

      return Array.from(dayMap.values());
    }
  });

  const totalSent = metrics?.sent || 0;
  const totalOpens = metrics?.opens || 0;
  const totalClicks = metrics?.clicks || 0;
  const totalBounces = metrics?.bounces || 0;
  const totalUnsubscribes = (metrics as any)?.unsubscribes || 0;

  const openRate = totalSent > 0 ? ((totalOpens / totalSent) * 100).toFixed(1) : '0.0';
  const clickRate = totalSent > 0 ? ((totalClicks / totalSent) * 100).toFixed(1) : '0.0';
  const bounceRate = totalSent > 0 ? ((totalBounces / totalSent) * 100).toFixed(1) : '0.0';
  const unsubRate = totalSent > 0 ? ((totalUnsubscribes / totalSent) * 100).toFixed(1) : '0.0';

  const engagementData = [
    { name: 'Opened', value: totalOpens, color: '#0ea5e9' },
    { name: 'Clicked', value: totalClicks, color: '#8b5cf6' },
    { name: 'Bounced', value: totalBounces, color: '#ef4444' },
    { name: 'Unopened', value: Math.max(0, totalSent - totalOpens - totalBounces), color: '#94a3b8' },
  ].filter(item => item.value > 0);

  // Fallback if no data
  const pieData = engagementData.length > 0 ? engagementData : [
      { name: 'No Data', value: 1, color: '#e2e8f0' }
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
        <div className="flex justify-between items-center">
             <h3 className="text-lg font-medium">Dashboard Overview</h3>
             <div className="w-[250px]">
                <Select value={selectedCampaignId} onValueChange={setSelectedCampaignId}>
                    <SelectTrigger>
                        <SelectValue placeholder="Select Campaign" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Campaigns</SelectItem>
                        {campaigns?.map((campaign) => (
                            <SelectItem key={campaign.id} value={campaign.id}>
                                {campaign.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
             </div>
        </div>

        {/* KPI Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Sent</CardTitle>
                    <Mail className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{totalSent.toLocaleString()}</div>
                    <p className="text-xs text-muted-foreground">Emails delivered</p>
                </CardContent>
            </Card>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Open Rate</CardTitle>
                    <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{openRate}%</div>
                    <p className="text-xs text-muted-foreground text-emerald-500">
                        {totalOpens.toLocaleString()} opens
                    </p>
                </CardContent>
            </Card>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Click Rate (CTR)</CardTitle>
                    <MousePointer2 className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{clickRate}%</div>
                     <p className="text-xs text-muted-foreground text-blue-500">
                        {totalClicks.toLocaleString()} clicks
                    </p>
                </CardContent>
            </Card>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Bounce Rate</CardTitle>
                    <AlertCircle className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{bounceRate}%</div>
                    <p className="text-xs text-muted-foreground text-red-500">
                        {totalBounces.toLocaleString()} bounces
                    </p>
                </CardContent>
            </Card>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Unsubscribe Rate</CardTitle>
                    <UserMinus className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{unsubRate}%</div>
                    <p className="text-xs text-muted-foreground text-orange-500">
                        {totalUnsubscribes.toLocaleString()} unsubscribes
                    </p>
                </CardContent>
            </Card>
        </div>

        {/* Charts Row */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
            {/* Main Chart */}
            <Card className="col-span-4">
                <CardHeader>
                    <CardTitle>Performance Trends</CardTitle>
                    <CardDescription>Opens vs. Clicks (Last 7 Days)</CardDescription>
                </CardHeader>
                <CardContent className="pl-2">
                    <ResponsiveContainer width="100%" height={300}>
                        <AreaChart data={chartData}>
                            <defs>
                                <linearGradient id="colorOpens" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.8}/>
                                    <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0}/>
                                </linearGradient>
                                <linearGradient id="colorClicks" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.8}/>
                                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                                </linearGradient>
                            </defs>
                            <XAxis dataKey="name" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                            <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}`} />
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#333" />
                            <Tooltip 
                                contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#f8fafc' }} 
                                itemStyle={{ color: '#f8fafc' }}
                            />
                            <Area type="monotone" dataKey="opens" stroke="#0ea5e9" fillOpacity={1} fill="url(#colorOpens)" />
                            <Area type="monotone" dataKey="clicks" stroke="#8b5cf6" fillOpacity={1} fill="url(#colorClicks)" />
                        </AreaChart>
                    </ResponsiveContainer>
                </CardContent>
            </Card>

            {/* Engagement Pie Chart */}
             <Card className="col-span-3">
                <CardHeader>
                    <CardTitle>Engagement Breakdown</CardTitle>
                    <CardDescription>Distribution of user actions</CardDescription>
                </CardHeader>
                <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                         <PieChart>
                            <Pie
                                data={pieData}
                                cx="50%"
                                cy="50%"
                                innerRadius={60}
                                outerRadius={80}
                                paddingAngle={5}
                                dataKey="value"
                            >
                                {pieData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={entry.color} />
                                ))}
                            </Pie>
                            <Tooltip 
                                 contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#f8fafc' }} 
                                 itemStyle={{ color: '#f8fafc' }}
                            />
                         </PieChart>
                    </ResponsiveContainer>
                    <div className="flex flex-wrap justify-center gap-4 text-xs">
                        {engagementData.length > 0 ? engagementData.map((entry, index) => (
                            <div key={index} className="flex items-center gap-1">
                                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
                                <span>{entry.name} ({entry.value})</span>
                            </div>
                        )) : (
                            <span className="text-muted-foreground">No engagement data available</span>
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>

        {/* Heatmap Section (Mock) */}
        <Card>
            <CardHeader>
                <CardTitle>Click Heatmap</CardTitle>
                <CardDescription>Visual representation of user clicks (Mockup for now).</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="relative w-full h-[300px] border rounded-lg bg-gray-50 dark:bg-slate-900 overflow-hidden flex items-center justify-center">
                    <div className="text-center p-8 opacity-50">
                        <div className="text-2xl font-bold mb-4">EMAIL PREVIEW</div>
                        <p>Select a specific campaign to view heatmap data.</p>
                    </div>
                    {/* Placeholder for future implementation */}
                </div>
            </CardContent>
        </Card>
    </div>
  );
};

export default AnalyticsDashboard;
