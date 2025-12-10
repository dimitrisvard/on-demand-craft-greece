import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell } from 'recharts';
import { ArrowUpRight, ArrowDownRight, Users, Mail, MousePointer2, AlertCircle } from 'lucide-react';

const data = [
  { name: 'Mon', opens: 4000, clicks: 2400 },
  { name: 'Tue', opens: 3000, clicks: 1398 },
  { name: 'Wed', opens: 2000, clicks: 9800 },
  { name: 'Thu', opens: 2780, clicks: 3908 },
  { name: 'Fri', opens: 1890, clicks: 4800 },
  { name: 'Sat', opens: 2390, clicks: 3800 },
  { name: 'Sun', opens: 3490, clicks: 4300 },
];

const engagementData = [
    { name: 'Opened', value: 45, color: '#0ea5e9' }, // Sky 500
    { name: 'Clicked', value: 25, color: '#8b5cf6' }, // Violet 500
    { name: 'Bounced', value: 5, color: '#ef4444' }, // Red 500
    { name: 'Unopened', value: 25, color: '#94a3b8' }, // Slate 400
];

const AnalyticsDashboard = () => {
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
        {/* KPI Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Sent</CardTitle>
                    <Mail className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">12,345</div>
                    <p className="text-xs text-muted-foreground">+20.1% from last month</p>
                </CardContent>
            </Card>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Open Rate</CardTitle>
                    <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">45.2%</div>
                    <p className="text-xs text-muted-foreground flex items-center text-emerald-500">
                        <ArrowUpRight className="mr-1 h-3 w-3" /> +4.5%
                    </p>
                </CardContent>
            </Card>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Click Rate (CTR)</CardTitle>
                    <MousePointer2 className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">12.8%</div>
                     <p className="text-xs text-muted-foreground flex items-center text-red-500">
                        <ArrowDownRight className="mr-1 h-3 w-3" /> -1.2%
                    </p>
                </CardContent>
            </Card>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Bounce Rate</CardTitle>
                    <AlertCircle className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">2.4%</div>
                    <p className="text-xs text-muted-foreground">Within healthy range</p>
                </CardContent>
            </Card>
        </div>

        {/* Charts Row */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
            {/* Main Chart */}
            <Card className="col-span-4">
                <CardHeader>
                    <CardTitle>Campaign Performance</CardTitle>
                    <CardDescription>Opens vs. Clicks over time</CardDescription>
                </CardHeader>
                <CardContent className="pl-2">
                    <ResponsiveContainer width="100%" height={300}>
                        <AreaChart data={data}>
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
                                data={engagementData}
                                cx="50%"
                                cy="50%"
                                innerRadius={60}
                                outerRadius={80}
                                paddingAngle={5}
                                dataKey="value"
                            >
                                {engagementData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={entry.color} />
                                ))}
                            </Pie>
                            <Tooltip 
                                 contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#f8fafc' }} 
                                 itemStyle={{ color: '#f8fafc' }}
                            />
                         </PieChart>
                    </ResponsiveContainer>
                    <div className="flex justify-center gap-4 text-xs">
                        {engagementData.map((entry, index) => (
                            <div key={index} className="flex items-center gap-1">
                                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
                                <span>{entry.name} ({entry.value}%)</span>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>
        </div>

        {/* Heatmap Section (Mock) */}
        <Card>
            <CardHeader>
                <CardTitle>Click Heatmap</CardTitle>
                <CardDescription>Visual representation of user clicks on the last campaign.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="relative w-full h-[400px] border rounded-lg bg-gray-50 dark:bg-slate-900 overflow-hidden flex items-center justify-center">
                    <div className="text-center p-8 opacity-50">
                        <div className="text-4xl font-bold mb-4">EMAIL PREVIEW</div>
                        <p>User content would appear here...</p>
                    </div>
                    
                    {/* Mock Heatmap Points */}
                    <div className="absolute top-1/4 left-1/4 w-12 h-12 bg-red-500/50 rounded-full blur-md animate-pulse" />
                    <div className="absolute top-1/3 right-1/3 w-16 h-16 bg-red-600/60 rounded-full blur-xl animate-pulse delay-75" />
                    <div className="absolute bottom-1/4 left-1/2 w-8 h-8 bg-orange-500/50 rounded-full blur-sm" />
                    
                    <div className="absolute top-4 right-4 bg-background/80 backdrop-blur p-2 rounded text-xs border">
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 bg-red-500 rounded-full" /> High Engagement
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                            <div className="w-3 h-3 bg-blue-500 rounded-full" /> Low Engagement
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    </div>
  );
};

export default AnalyticsDashboard;

