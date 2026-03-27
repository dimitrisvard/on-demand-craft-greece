import React, { useState, useEffect, useCallback } from "react";
import PersistentDashboardLayout from "@/components/dashboard/PersistentDashboardLayout";
import LeadCard from "@/components/leads/LeadCard";
import LeadFiltersPanel from "@/components/leads/LeadFilters";
import LeadStatsBar from "@/components/leads/LeadStatsBar";
import KeywordManager from "@/components/leads/KeywordManager";
import SubredditManager from "@/components/leads/SubredditManager";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  RefreshCw,
  Download,
  Settings2,
  BarChart3,
  Radio,
  AlertCircle,
  Loader2,
  Trash2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Lead, LeadFilters, LeadStats, MonitoredSubreddit, LeadKeyword } from "@/types/leads";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  LineChart,
  Line,
  CartesianGrid,
} from "recharts";
import { format, parseISO } from "date-fns";

const PAGE_SIZE = 30;

const SCORE_COLORS: Record<string, string> = {
  high: "#ef4444",
  medium: "#f59e0b",
  low: "#22c55e",
  unscored: "#94a3b8",
  noise: "#cbd5e1",
};

export default function LeadMonitorPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [collecting, setCollecting] = useState(false);
  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState<LeadFilters>({
    source: "all",
    score: "all",
    status: "all",
    industry: "",
    search: "",
    days_back: 7,
  });

  const [stats, setStats] = useState<LeadStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [keywords, setKeywords] = useState<LeadKeyword[]>([]);
  const [subreddits, setSubreddits] = useState<MonitoredSubreddit[]>([]);
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [selectedSubreddit, setSelectedSubreddit] = useState<string>("");
  const [scanningSubreddit, setScanningSubreddit] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  // ===== Fetch leads =====
  const fetchLeads = useCallback(async (resetPage = false) => {
    setLoading(true);
    const currentPage = resetPage ? 0 : page;
    if (resetPage) setPage(0);

    let query = supabase
      .from("leads")
      .select("*", { count: "exact" })
      .order("discovered_at", { ascending: false })
      .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1);

    if (filters.source !== "all") query = query.eq("source", filters.source);
    if (filters.score !== "all") query = query.eq("auto_score", filters.score);
    if (filters.status !== "all") query = query.eq("status", filters.status);
    if (filters.industry) query = query.contains("industry_tags", [filters.industry]);
    if (filters.search) query = query.or(`title.ilike.%${filters.search}%,body.ilike.%${filters.search}%`);
    if (filters.days_back > 0) {
      const since = new Date(Date.now() - filters.days_back * 86400 * 1000).toISOString();
      query = query.gte("discovered_at", since);
    }

    const { data, error, count } = await query;
    if (!error && data) {
      setLeads(data as Lead[]);
      setTotal(count || 0);
    }
    setLoading(false);
  }, [filters, page]);

  // ===== Fetch stats =====
  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const resp = await fetch(
        `${supabaseUrl}/functions/v1/leads-api/stats?days_back=7`,
        { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
      );
      if (resp.ok) {
        const data = await resp.json();
        setStats(data);
      }
    } catch (e) {
      // If edge function not deployed, compute stats from local queries
      const since = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
      const { data } = await supabase.from("leads").select("source, auto_score, status, discovered_at").gte("discovered_at", since);
      if (data) {
        const today = new Date().toISOString().slice(0, 10);
        const bySource: Record<string, number> = {};
        const byScore: Record<string, number> = {};
        const byStatus: Record<string, number> = {};
        const daily: Record<string, number> = {};

        for (const l of data) {
          bySource[l.source] = (bySource[l.source] || 0) + 1;
          byScore[l.auto_score] = (byScore[l.auto_score] || 0) + 1;
          byStatus[l.status] = (byStatus[l.status] || 0) + 1;
          const day = l.discovered_at?.slice(0, 10);
          if (day) daily[day] = (daily[day] || 0) + 1;
        }

        const { count } = await supabase.from("leads").select("id", { count: "exact", head: true });

        setStats({
          total_all_time: count || 0,
          period_days: 7,
          period_total: data.length,
          today: daily[today] || 0,
          by_source: bySource,
          by_score: byScore,
          by_status: byStatus,
          daily_volume: daily,
          conversion_rate: byStatus["converted"] ? Math.round((byStatus["converted"] / data.length) * 100) : 0,
        });
      }
    }
    setStatsLoading(false);
  }, [supabaseUrl, supabaseKey]);

  // ===== Fetch keywords =====
  const fetchKeywords = useCallback(async () => {
    const { data } = await supabase.from("lead_keywords").select("*").order("category").order("weight", { ascending: false });
    if (data) setKeywords(data as LeadKeyword[]);
  }, []);

  // ===== Fetch subreddits =====
  const fetchSubreddits = useCallback(async () => {
    const { data } = await supabase.from("monitored_subreddits").select("*").order("tier").order("subreddit");
    if (data) setSubreddits(data as MonitoredSubreddit[]);
  }, []);

  useEffect(() => {
    fetchLeads(true);
  }, [filters]);

  useEffect(() => {
    fetchLeads();
  }, [page]);

  useEffect(() => {
    fetchStats();
    fetchKeywords();
    fetchSubreddits();
  }, []);

  // ===== Update lead =====
  async function updateLead(id: string, updates: Partial<Lead>) {
    try {
      const resp = await fetch(
        `${supabaseUrl}/functions/v1/leads-api/leads/${id}`,
        {
          method: "PATCH",
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(updates),
        }
      );

      if (resp.ok) {
        const data = await resp.json();
        setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...updates } : l)));
      } else {
        console.error("Failed to update lead:", await resp.text());
      }
    } catch (e) {
      console.error("Lead update error:", e);
    }
  }

  // ===== Trigger collection =====
  async function triggerCollection() {
    setCollecting(true);
    setScanResult(null);
    try {
      const resp = await fetch(
        `${supabaseUrl}/functions/v1/leads-api/collect?source=all`,
        {
          method: "GET",
          headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
        }
      );
      if (resp.ok) {
        await fetchLeads(true);
        await fetchStats();
      }
    } catch (e) {
      console.error("Collection trigger failed:", e);
    }
    setCollecting(false);
  }

  async function triggerSubredditScan() {
    if (!selectedSubreddit) return;
    setScanningSubreddit(true);
    setScanResult(null);
    try {
      const resp = await fetch(
        `${supabaseUrl}/functions/v1/reddit-collector?subreddit=${encodeURIComponent(selectedSubreddit)}`,
        { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
      );
      const data = await resp.json();
      if (resp.ok) {
        const count = data.totalNewLeads ?? 0;
        setScanResult(`r/${selectedSubreddit}: ${count} new lead${count !== 1 ? "s" : ""} found`);
        await fetchLeads(true);
        await fetchStats();
      } else {
        setScanResult(`Error: ${data.error || "Scan failed"}`);
      }
    } catch (e) {
      setScanResult("Scan failed — check console");
      console.error("Subreddit scan failed:", e);
    }
    setScanningSubreddit(false);
  }

  // ===== Keyword management =====
  async function addKeyword(keyword: string, category: string, weight: number) {
    const { error } = await supabase.from("lead_keywords").insert({ keyword, category, weight, is_active: true });
    if (error) throw new Error(error.message);
    await fetchKeywords();
  }

  async function removeKeyword(id: number) {
    await supabase.from("lead_keywords").delete().eq("id", id);
    await fetchKeywords();
  }

  async function toggleKeyword(id: number, isActive: boolean) {
    await supabase.from("lead_keywords").update({ is_active: isActive }).eq("id", id);
    await fetchKeywords();
  }

  // ===== Subreddit management =====
  async function addSubreddit(subredditName: string, tier: number) {
    const intervalMap: Record<number, number> = { 1: 15, 2: 30, 3: 30, 4: 60, 5: 120 };
    const { error } = await supabase.from("monitored_subreddits").insert({
      subreddit: subredditName,
      tier,
      scan_interval_minutes: intervalMap[tier] || 30,
      is_active: true,
    });
    if (error) throw new Error(error.message);
    await fetchSubreddits();
  }

  async function removeSubreddit(id: number) {
    await supabase.from("monitored_subreddits").delete().eq("id", id);
    await fetchSubreddits();
  }

  async function toggleSubreddit(id: number, isActive: boolean) {
    await supabase.from("monitored_subreddits").update({ is_active: isActive }).eq("id", id);
    await fetchSubreddits();
  }

  // ===== Clear leads =====
  async function clearLeads() {
    setClearing(true);
    const { error } = await supabase.from("leads").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (!error) {
      setLeads([]);
      setTotal(0);
      await fetchStats();
    }
    setClearing(false);
    setConfirmClear(false);
  }

  // ===== Chart data =====
  const dailyVolumeData = Object.entries(stats?.daily_volume || {})
    .sort()
    .map(([date, count]) => ({
      date: format(parseISO(date), "MMM d"),
      leads: count,
    }));

  const scoreChartData = Object.entries(stats?.by_score || {}).map(([score, count]) => ({
    name: score.charAt(0).toUpperCase() + score.slice(1),
    value: count,
    color: SCORE_COLORS[score] || "#94a3b8",
  }));

  const sourceChartData = Object.entries(stats?.by_source || {}).map(([source, count]) => ({
    name: source === "hackernews" ? "HN" : source.charAt(0).toUpperCase() + source.slice(1),
    leads: count,
  }));

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <PersistentDashboardLayout>
      <div className="space-y-6 max-w-7xl mx-auto">
        {/* Page Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Radio className="h-6 w-6 text-brand-primary" />
              Lead Monitor
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Scanning Reddit, Hacker News, and forums for manufacturing leads
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { fetchLeads(true); fetchStats(); }}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            {confirmClear ? (
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground">Delete all leads?</span>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={clearLeads}
                  disabled={clearing}
                  className="h-8"
                >
                  {clearing ? <Loader2 className="h-3 w-3 animate-spin" /> : "Yes, clear"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setConfirmClear(false)} className="h-8">
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmClear(true)}
                disabled={total === 0}
                className="text-red-600 hover:text-red-700 hover:border-red-300"
              >
                <Trash2 className="h-4 w-4 mr-1.5" />
                Clear Leads
              </Button>
            )}
            <Button
              size="sm"
              onClick={triggerCollection}
              disabled={collecting || scanningSubreddit}
              className="bg-brand-primary hover:bg-brand-primary/90"
            >
              {collecting ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-1.5" />
              )}
              {collecting ? "Collecting..." : "Collect All"}
            </Button>
            {/* Targeted subreddit scan */}
            <div className="flex items-center gap-1.5">
              <Select value={selectedSubreddit} onValueChange={setSelectedSubreddit}>
                <SelectTrigger className="h-8 w-44 text-xs">
                  <SelectValue placeholder="Pick subreddit…" />
                </SelectTrigger>
                <SelectContent>
                  {subreddits
                    .filter((s) => s.is_active)
                    .sort((a, b) => a.tier - b.tier || a.subreddit.localeCompare(b.subreddit))
                    .map((s) => (
                      <SelectItem key={s.subreddit} value={s.subreddit} className="text-xs">
                        r/{s.subreddit} <span className="text-muted-foreground ml-1">T{s.tier}</span>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                onClick={triggerSubredditScan}
                disabled={!selectedSubreddit || scanningSubreddit || collecting}
                className="h-8 text-xs px-2.5"
              >
                {scanningSubreddit ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                <span className="ml-1">Scan</span>
              </Button>
            </div>
          </div>
          {scanResult && (
            <p className="text-xs mt-1 text-right text-muted-foreground">{scanResult}</p>
          )}
        </div>

        {/* Stats Bar */}
        <LeadStatsBar stats={stats} loading={statsLoading} />

        {/* Main Tabs */}
        <Tabs defaultValue="feed">
          <TabsList className="mb-4">
            <TabsTrigger value="feed" className="flex items-center gap-1.5">
              <AlertCircle className="h-4 w-4" />
              Lead Feed
              {total > 0 && (
                <Badge className="ml-1 text-xs" variant="secondary">
                  {total}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="analytics" className="flex items-center gap-1.5">
              <BarChart3 className="h-4 w-4" />
              Analytics
            </TabsTrigger>
            <TabsTrigger value="settings" className="flex items-center gap-1.5">
              <Settings2 className="h-4 w-4" />
              Settings
            </TabsTrigger>
          </TabsList>

          {/* ===== LEAD FEED ===== */}
          <TabsContent value="feed" className="space-y-4">
            <LeadFiltersPanel filters={filters} onChange={setFilters} />

            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : leads.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                  <Radio className="h-12 w-12 text-muted-foreground mb-4 opacity-30" />
                  <h3 className="font-medium text-lg mb-1">No leads found</h3>
                  <p className="text-sm text-muted-foreground max-w-sm">
                    {filters.source !== "all" || filters.score !== "all" || filters.search
                      ? "Try adjusting your filters or broadening your search."
                      : "Click 'Collect Now' to start scanning for leads, or wait for the scheduled collection to run."}
                  </p>
                  <Button className="mt-4" onClick={triggerCollection} disabled={collecting}>
                    {collecting ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4 mr-2" />
                    )}
                    Collect Now
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>
                    Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total} leads
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page === 0}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      ← Prev
                    </Button>
                    <span>
                      Page {page + 1} / {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages - 1}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Next →
                    </Button>
                  </div>
                </div>

                <div className="space-y-3">
                  {leads.map((lead) => (
                    <LeadCard key={lead.id} lead={lead} onUpdate={updateLead} />
                  ))}
                </div>

                {/* Bottom pagination */}
                <div className="flex items-center justify-center gap-2">
                  <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                    ← Previous
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Page {page + 1} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages - 1}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next →
                  </Button>
                </div>
              </>
            )}
          </TabsContent>

          {/* ===== ANALYTICS ===== */}
          <TabsContent value="analytics" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Lead Volume Chart */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Lead Volume — Last 7 Days</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={dailyVolumeData}>
                      <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Line
                        type="monotone"
                        dataKey="leads"
                        stroke="#1F4690"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Score Distribution */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Score Distribution</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie
                        data={scoreChartData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={70}
                        label={({ name, value }) => `${name}: ${value}`}
                        labelLine={false}
                      >
                        {scoreChartData.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Leads by Source */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Leads by Source</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={sourceChartData}>
                      <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="leads" fill="#1F4690" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Status Breakdown */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Status Breakdown — Last 7 Days</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 mt-2">
                    {Object.entries(stats?.by_status || {}).map(([status, count]) => {
                      const pct = stats?.period_total
                        ? Math.round((count / stats.period_total) * 100)
                        : 0;
                      return (
                        <div key={status} className="flex items-center gap-2">
                          <span className="text-sm w-24 capitalize text-muted-foreground">{status}</span>
                          <div className="flex-1 bg-gray-100 rounded-full h-2">
                            <div
                              className="bg-brand-primary h-2 rounded-full"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-sm font-medium w-8 text-right">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Top keywords */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Top Keywords by Match Count</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {keywords
                    .filter((k) => k.match_count > 0)
                    .sort((a, b) => b.match_count - a.match_count)
                    .slice(0, 20)
                    .map((kw) => (
                      <div
                        key={kw.id}
                        className="flex items-center justify-between px-2 py-1 bg-gray-50 rounded border text-xs"
                      >
                        <span className="truncate">{kw.keyword}</span>
                        <Badge variant="outline" className="ml-1 text-xs shrink-0">
                          {kw.match_count}
                        </Badge>
                      </div>
                    ))}
                  {keywords.filter((k) => k.match_count > 0).length === 0 && (
                    <p className="text-sm text-muted-foreground col-span-4">
                      No keyword match data yet. Run the collectors to populate this.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ===== SETTINGS ===== */}
          <TabsContent value="settings" className="space-y-4">
            <KeywordManager
              keywords={keywords}
              onAdd={addKeyword}
              onRemove={removeKeyword}
              onToggle={toggleKeyword}
            />
            <SubredditManager
              subreddits={subreddits}
              onAdd={addSubreddit}
              onRemove={removeSubreddit}
              onToggle={toggleSubreddit}
            />

            {/* Setup guide */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Setup & Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <div>
                  <h4 className="font-medium text-foreground mb-1">Required Environment Variables</h4>
                  <div className="bg-gray-50 rounded p-3 font-mono text-xs space-y-1">
                    <div>REDDIT_CLIENT_ID=<span className="text-muted-foreground">your reddit app client id</span></div>
                    <div>REDDIT_CLIENT_SECRET=<span className="text-muted-foreground">your reddit app secret</span></div>
                    <div>REDDIT_USER_AGENT=MicronsHubLeadMonitor/1.0</div>
                    <div>TELEGRAM_BOT_TOKEN=<span className="text-muted-foreground">from @BotFather</span></div>
                    <div>TELEGRAM_CHAT_ID=<span className="text-muted-foreground">your channel/group chat id</span></div>
                    <div>MCP_AUTH_TOKEN=<span className="text-muted-foreground">random secure token</span></div>
                  </div>
                </div>
                <div>
                  <h4 className="font-medium text-foreground mb-1">Reddit App Setup</h4>
                  <ol className="list-decimal list-inside space-y-0.5 text-xs">
                    <li>Go to reddit.com/prefs/apps</li>
                    <li>Create a new "script" app</li>
                    <li>Set redirect URI to <code>http://localhost:8080</code></li>
                    <li>Copy client_id and secret to env vars</li>
                  </ol>
                </div>
                <div>
                  <h4 className="font-medium text-foreground mb-1">Telegram Bot Setup</h4>
                  <ol className="list-decimal list-inside space-y-0.5 text-xs">
                    <li>Message @BotFather on Telegram</li>
                    <li>Send /newbot and follow instructions</li>
                    <li>Copy the bot token to TELEGRAM_BOT_TOKEN</li>
                    <li>Create a channel/group and add the bot</li>
                    <li>Get chat_id via @userinfobot or API</li>
                  </ol>
                </div>
                <div>
                  <h4 className="font-medium text-foreground mb-1">Scheduled Collection (Supabase Cron)</h4>
                  <p className="text-xs mb-1">Add these to Supabase Dashboard → Database → Extensions → pg_cron:</p>
                  <div className="bg-gray-50 rounded p-3 font-mono text-xs space-y-1">
                    <div className="text-muted-foreground">-- Tier 1 (every 15 min)</div>
                    <div>{"SELECT cron.schedule('reddit-tier1', '*/15 * * * *', $$SELECT net.http_post(url:='<SUPABASE_URL>/functions/v1/reddit-collector?tier=1', headers:='{\"Authorization\":\"Bearer <SERVICE_KEY>\"}'::jsonb) $$);"}</div>
                  </div>
                </div>
                <div>
                  <h4 className="font-medium text-foreground mb-1">MCP Server</h4>
                  <p className="text-xs">
                    The MCP server is located at <code>mcp-server/</code> in the project root.
                    Run it with <code>node mcp-server/build/index.js</code> or use the npm script.
                    Configure Claude Desktop by adding it to <code>claude_desktop_config.json</code>.
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </PersistentDashboardLayout>
  );
}
