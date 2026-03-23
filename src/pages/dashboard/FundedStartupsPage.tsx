import React, { useState, useEffect, useCallback } from "react";
import PersistentDashboardLayout from "@/components/dashboard/PersistentDashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RefreshCw,
  Download,
  ExternalLink,
  Globe,
  AlertCircle,
  Loader2,
  Search,
  ChevronDown,
  ChevronUp,
  Rocket,
  TrendingUp,
  Building2,
  Mail,
  Radio,
  CheckCircle,
  XCircle,
  Clock,
  Target,
} from "lucide-react";
import type { FundedStartup, FundedStartupFilters, FundedStartupStats, FundingFeed } from "@/types/funded-startups";

// ─── Constants ─────────────────────────────────────────────────

const COUNTRY_FLAGS: Record<string, string> = {
  DE: "🇩🇪", FR: "🇫🇷", NL: "🇳🇱", SE: "🇸🇪", FI: "🇫🇮", DK: "🇩🇰",
  NO: "🇳🇴", ES: "🇪🇸", IT: "🇮🇹", BE: "🇧🇪", AT: "🇦🇹", CH: "🇨🇭",
  IE: "🇮🇪", PT: "🇵🇹", PL: "🇵🇱", CZ: "🇨🇿", EE: "🇪🇪", LT: "🇱🇹",
  LV: "🇱🇻", GR: "🇬🇷", UK: "🇬🇧", RO: "🇷🇴", HU: "🇭🇺", HR: "🇭🇷",
  BG: "🇧🇬", SI: "🇸🇮", SK: "🇸🇰", LU: "🇱🇺", CY: "🇨🇾", MT: "🇲🇹",
  IL: "🇮🇱", EU: "🇪🇺",
};

const STAGE_COLORS: Record<string, string> = {
  "pre-seed": "bg-purple-100 text-purple-800",
  "seed": "bg-blue-100 text-blue-800",
  "series-a": "bg-green-100 text-green-800",
  "series-b": "bg-yellow-100 text-yellow-800",
  "series-c": "bg-orange-100 text-orange-800",
  "grant": "bg-teal-100 text-teal-800",
  "bridge": "bg-gray-100 text-gray-700",
  "ipo": "bg-red-100 text-red-800",
  "unknown": "bg-gray-100 text-gray-500",
};

const OUTREACH_COLORS: Record<string, string> = {
  new: "bg-blue-100 text-blue-800",
  researched: "bg-purple-100 text-purple-800",
  contacted: "bg-yellow-100 text-yellow-800",
  responded: "bg-green-100 text-green-800",
  not_relevant: "bg-gray-100 text-gray-500",
};

const INDUSTRIES = [
  { value: "all", label: "All industries" },
  { value: "robotics", label: "Robotics" },
  { value: "medtech", label: "MedTech" },
  { value: "automotive", label: "Automotive / EV" },
  { value: "aerospace", label: "Aerospace & Space" },
  { value: "drones", label: "Drones / UAV" },
  { value: "cleantech", label: "CleanTech" },
  { value: "energy-storage", label: "Energy Storage" },
  { value: "renewable-energy", label: "Renewable Energy" },
  { value: "consumer-electronics", label: "Consumer Electronics" },
  { value: "iot", label: "IoT" },
  { value: "defense", label: "Defense" },
  { value: "agritech", label: "AgriTech" },
  { value: "biotech", label: "BioTech" },
  { value: "industrial", label: "Industrial" },
  { value: "semiconductor", label: "Semiconductor" },
  { value: "deeptech", label: "DeepTech" },
  { value: "marine", label: "Marine" },
];

const STAGES = [
  { value: "all", label: "All stages" },
  { value: "pre-seed", label: "Pre-Seed" },
  { value: "seed", label: "Seed" },
  { value: "series-a", label: "Series A" },
  { value: "series-b", label: "Series B" },
  { value: "series-c", label: "Series C+" },
  { value: "grant", label: "Grant / EIC" },
];

const COUNTRIES = [
  { code: "all", name: "All countries" },
  { code: "DE", name: "Germany" }, { code: "FR", name: "France" },
  { code: "NL", name: "Netherlands" }, { code: "SE", name: "Sweden" },
  { code: "FI", name: "Finland" }, { code: "DK", name: "Denmark" },
  { code: "NO", name: "Norway" }, { code: "ES", name: "Spain" },
  { code: "IT", name: "Italy" }, { code: "BE", name: "Belgium" },
  { code: "AT", name: "Austria" }, { code: "CH", name: "Switzerland" },
  { code: "IE", name: "Ireland" }, { code: "PT", name: "Portugal" },
  { code: "PL", name: "Poland" }, { code: "CZ", name: "Czechia" },
  { code: "UK", name: "United Kingdom" }, { code: "GR", name: "Greece" },
];

const PAGE_SIZE = 30;

// ─── Confidence badge ──────────────────────────────────────────
function ConfidenceBadge({ score }: { score: number }) {
  const color =
    score >= 70 ? "bg-green-100 text-green-800" :
    score >= 40 ? "bg-yellow-100 text-yellow-800" :
    "bg-orange-100 text-orange-700";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${color}`}>
      {score}/100
    </span>
  );
}

// ─── Startup card ──────────────────────────────────────────────
function StartupCard({
  startup,
  onUpdateStatus,
  onUpdateNotes,
}: {
  startup: FundedStartup;
  onUpdateStatus: (id: string, status: string) => void;
  onUpdateNotes: (id: string, notes: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [notes, setNotes] = useState(startup.notes || "");
  const [saving, setSaving] = useState(false);

  const flag = COUNTRY_FLAGS[startup.country_code || "EU"] || "🌍";
  const amount = startup.funding_amount_millions
    ? `${startup.funding_currency}${startup.funding_amount_millions}M`
    : "undisclosed";
  const stageClass = STAGE_COLORS[startup.funding_stage || "unknown"] || STAGE_COLORS.unknown;
  const outreachClass = OUTREACH_COLORS[startup.outreach_status] || OUTREACH_COLORS.new;
  const discoveredDate = new Date(startup.discovered_at).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });

  const handleSaveNotes = async () => {
    setSaving(true);
    await onUpdateNotes(startup.id, notes);
    setSaving(false);
  };

  return (
    <Card className="border border-border hover:border-primary/30 transition-colors">
      <CardContent className="p-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-lg">{flag}</span>
              <h3 className="font-semibold text-foreground truncate">
                {startup.company_name || <span className="text-muted-foreground italic">Unknown company</span>}
              </h3>
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${stageClass}`}>
                {startup.funding_stage || "unknown"}
              </span>
              <span className="text-sm font-semibold text-emerald-700">
                {amount}
              </span>
            </div>
            <p className="text-sm text-muted-foreground line-clamp-2">{startup.article_title}</p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <ConfidenceBadge score={startup.hardware_confidence} />
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-1 hover:bg-accent rounded"
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Industry tags + meta */}
        <div className="flex items-center gap-2 flex-wrap mt-2">
          {(startup.industry_tags || []).slice(0, 4).map(tag => (
            <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
          ))}
          <span className="text-xs text-muted-foreground ml-auto">{startup.source_name} · {discoveredDate}</span>
        </div>

        {/* Outreach status selector */}
        <div className="flex items-center gap-2 mt-3">
          <Select
            value={startup.outreach_status}
            onValueChange={(val) => onUpdateStatus(startup.id, val)}
          >
            <SelectTrigger className="h-7 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="new">🆕 New</SelectItem>
              <SelectItem value="researched">🔍 Researched</SelectItem>
              <SelectItem value="contacted">✉️ Contacted</SelectItem>
              <SelectItem value="responded">✅ Responded</SelectItem>
              <SelectItem value="not_relevant">❌ Not relevant</SelectItem>
            </SelectContent>
          </Select>

          {startup.company_website && (
            <a
              href={startup.company_website}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <Globe className="h-3 w-3" />
              Website
            </a>
          )}

          <a
            href={startup.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="h-3 w-3" />
            Article
          </a>

          {(startup.scraped_emails || []).length > 0 && (
            <span className="flex items-center gap-1 text-xs text-green-700">
              <Mail className="h-3 w-3" />
              {startup.scraped_emails.length} email{startup.scraped_emails.length > 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* Expanded details */}
        {expanded && (
          <div className="mt-4 space-y-3 border-t pt-3">
            {startup.article_excerpt && (
              <p className="text-sm text-muted-foreground">{startup.article_excerpt}</p>
            )}

            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <div><span className="text-muted-foreground">Country:</span> {COUNTRY_FLAGS[startup.country_code || "EU"]} {startup.country_code}</div>
              <div><span className="text-muted-foreground">Stage:</span> {startup.funding_stage}</div>
              {startup.company_website && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">Website:</span>{" "}
                  <a href={startup.company_website} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    {startup.company_website}
                  </a>
                </div>
              )}
              {(startup.scraped_emails || []).length > 0 && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">Emails:</span>{" "}
                  {startup.scraped_emails.join(", ")}
                </div>
              )}
            </div>

            {(startup.matched_keywords || []).length > 0 && (
              <div className="text-xs text-muted-foreground">
                <span className="font-medium">Matched: </span>
                {startup.matched_keywords.slice(0, 10).join(", ")}
              </div>
            )}

            {/* Notes */}
            <div className="space-y-1">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add notes…"
                className="w-full text-sm border rounded px-2 py-1 resize-none h-16 bg-background"
              />
              <Button size="sm" variant="outline" onClick={handleSaveNotes} disabled={saving}>
                {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                Save notes
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Stats bar ────────────────────────────────────────────────
function StatsBar({ stats }: { stats: FundedStartupStats | null }) {
  if (!stats) return null;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Card>
        <CardContent className="p-4">
          <div className="text-2xl font-bold">{stats.total_all_time}</div>
          <div className="text-xs text-muted-foreground">Total found</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <div className="text-2xl font-bold text-blue-600">{stats.period_total}</div>
          <div className="text-xs text-muted-foreground">This period</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <div className="text-2xl font-bold text-green-600">{stats.period_hardware}</div>
          <div className="text-xs text-muted-foreground">Hardware companies</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <div className="text-2xl font-bold text-yellow-600">
            {stats.by_outreach?.contacted || 0}
          </div>
          <div className="text-xs text-muted-foreground">Contacted</div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Feed health panel ────────────────────────────────────────
function FeedHealthPanel({ feeds }: { feeds: FundingFeed[] }) {
  return (
    <div className="space-y-2">
      {feeds.map(feed => {
        const hasError = feed.error_count > 0;
        const fetchedAgo = feed.last_fetched_at
          ? Math.round((Date.now() - new Date(feed.last_fetched_at).getTime()) / 60000)
          : null;
        return (
          <div key={feed.id} className="flex items-center gap-3 text-sm py-1 border-b last:border-0">
            <span className={hasError ? "text-red-500" : "text-green-500"}>
              {hasError ? <XCircle className="h-4 w-4" /> : <CheckCircle className="h-4 w-4" />}
            </span>
            <span className="font-medium w-36 truncate">{feed.name}</span>
            <span className="text-muted-foreground text-xs">
              {fetchedAgo !== null ? `${fetchedAgo}m ago` : "never"}
            </span>
            <span className="text-xs text-muted-foreground">{feed.last_item_count || 0} items</span>
            {hasError && (
              <span className="text-xs text-red-500 truncate max-w-xs" title={feed.last_error || ""}>
                {feed.last_error?.substring(0, 60)}
              </span>
            )}
            <span className={`ml-auto text-xs px-1.5 py-0.5 rounded ${feed.language === 'en' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
              {feed.language}
            </span>
            <span className={`text-xs px-1.5 py-0.5 rounded bg-gray-100`}>P{feed.priority}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────
export default function FundedStartupsPage() {
  const [startups, setStartups] = useState<FundedStartup[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [page, setPage] = useState(0);
  const [stats, setStats] = useState<FundedStartupStats | null>(null);
  const [feeds, setFeeds] = useState<FundingFeed[]>([]);
  const [showFeeds, setShowFeeds] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<string | null>(null);

  const [filters, setFilters] = useState<FundedStartupFilters>({
    industry: "all",
    country: "all",
    stage: "all",
    outreach_status: "all",
    min_confidence: 0,
    min_amount: "",
    is_hardware: null,
    days_back: 30,
    search: "",
    source: "all",
  });

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  // ── Fetch list ──
  const fetchStartups = useCallback(async (resetPage = false) => {
    setLoading(true);
    setError(null);
    const currentPage = resetPage ? 0 : page;
    if (resetPage) setPage(0);

    const params = new URLSearchParams({
      page: String(currentPage),
      days_back: String(filters.days_back),
      min_confidence: String(filters.min_confidence),
    });

    if (filters.industry && filters.industry !== "all") params.set("industry", filters.industry);
    if (filters.country && filters.country !== "all") params.set("country", filters.country);
    if (filters.stage && filters.stage !== "all") params.set("stage", filters.stage);
    if (filters.outreach_status && filters.outreach_status !== "all") params.set("outreach_status", filters.outreach_status);
    if (filters.is_hardware === true) params.set("is_hardware", "true");
    if (filters.min_amount) params.set("min_amount", filters.min_amount);
    if (filters.search) params.set("search", filters.search);
    if (filters.source && filters.source !== "all") params.set("source", filters.source);

    try {
      const res = await fetch(`/api/funded-startups?${params}`, {
        headers: { Authorization: `Bearer ${supabaseKey}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load startups");
      setStartups(json.data || []);
      setTotal(json.count || 0);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filters, page, supabaseKey]);

  // ── Fetch stats ──
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/funded-startups?action=stats&days_back=${filters.days_back}`, {
        headers: { Authorization: `Bearer ${supabaseKey}` },
      });
      const json = await res.json();
      if (res.ok) setStats(json);
    } catch { /* silent */ }
  }, [filters.days_back, supabaseKey]);

  // ── Fetch feeds ──
  const fetchFeeds = useCallback(async () => {
    try {
      const res = await fetch(`/api/funded-startups?action=feeds`, {
        headers: { Authorization: `Bearer ${supabaseKey}` },
      });
      const json = await res.json();
      if (res.ok) setFeeds(json);
    } catch { /* silent */ }
  }, [supabaseKey]);

  useEffect(() => {
    fetchStartups(true);
    fetchStats();
    fetchFeeds();
  }, [filters]);

  useEffect(() => {
    if (page > 0) fetchStartups(false);
  }, [page]);

  // ── Trigger scan ──
  const triggerScan = async (priority: number) => {
    setScanning(true);
    setScanResult(null);
    try {
      const res = await fetch(`/api/funded-startups`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseKey}` },
        body: JSON.stringify({ priority }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Scan failed");
      setScanResult(`✅ Scanned ${json.feeds_scanned} feeds · ${json.articles_found} articles · ${json.startups_new} new startups found (${json.startups_hardware} hardware)`);
      fetchStartups(true);
      fetchStats();
      fetchFeeds();
    } catch (err: any) {
      setScanResult(`❌ ${err.message}`);
    } finally {
      setScanning(false);
    }
  };

  // ── Update outreach status ──
  const updateStatus = async (id: string, status: string) => {
    await fetch(`/api/funded-startups`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseKey}` },
      body: JSON.stringify({ id, outreach_status: status }),
    });
    setStartups(prev => prev.map(s => s.id === id ? { ...s, outreach_status: status as FundedStartup["outreach_status"] } : s));
  };

  // ── Update notes ──
  const updateNotes = async (id: string, notes: string) => {
    await fetch(`/api/funded-startups`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseKey}` },
      body: JSON.stringify({ id, notes }),
    });
    setStartups(prev => prev.map(s => s.id === id ? { ...s, notes } : s));
  };

  // ── Export ──
  const handleExport = () => {
    const params = new URLSearchParams({
      action: "export",
      days_back: String(filters.days_back),
    });
    if (filters.is_hardware === true) params.set("is_hardware", "true");
    window.open(`/api/funded-startups?${params}`, "_blank");
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <PersistentDashboardLayout>
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Rocket className="h-6 w-6 text-primary" />
              Funded Startup Scanner
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              European hardware startups that just raised funding — potential manufacturing leads
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { fetchStartups(true); fetchStats(); fetchFeeds(); }}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => triggerScan(1)} disabled={scanning}>
              {scanning ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Radio className="h-4 w-4 mr-1" />}
              Scan P1
            </Button>
            <Button variant="outline" size="sm" onClick={() => triggerScan(2)} disabled={scanning}>
              {scanning ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Radio className="h-4 w-4 mr-1" />}
              Scan P1+2
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="h-4 w-4 mr-1" />
              Export CSV
            </Button>
          </div>
        </div>

        {/* Scan result banner */}
        {scanResult && (
          <div className={`px-4 py-2 rounded-md text-sm ${scanResult.startsWith("✅") ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
            {scanResult}
          </div>
        )}

        {/* Stats */}
        <StatsBar stats={stats} />

        {/* Feed health toggle */}
        <div>
          <button
            onClick={() => setShowFeeds(!showFeeds)}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            {showFeeds ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            Feed health ({feeds.length} feeds)
          </button>
          {showFeeds && (
            <Card className="mt-2">
              <CardContent className="p-4">
                <FeedHealthPanel feeds={feeds} />
              </CardContent>
            </Card>
          )}
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search company / title…"
                  value={filters.search}
                  onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
                  className="pl-8 h-9 text-sm"
                />
              </div>

              <Select value={filters.industry} onValueChange={v => setFilters(f => ({ ...f, industry: v }))}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Industry" /></SelectTrigger>
                <SelectContent>
                  {INDUSTRIES.map(i => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}
                </SelectContent>
              </Select>

              <Select value={filters.country} onValueChange={v => setFilters(f => ({ ...f, country: v }))}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Country" /></SelectTrigger>
                <SelectContent>
                  {COUNTRIES.map(c => <SelectItem key={c.code} value={c.code}>{COUNTRY_FLAGS[c.code] || ""} {c.name}</SelectItem>)}
                </SelectContent>
              </Select>

              <Select value={filters.stage} onValueChange={v => setFilters(f => ({ ...f, stage: v }))}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Stage" /></SelectTrigger>
                <SelectContent>
                  {STAGES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>

              <Select value={filters.outreach_status} onValueChange={v => setFilters(f => ({ ...f, outreach_status: v }))}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Outreach status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="new">🆕 New</SelectItem>
                  <SelectItem value="researched">🔍 Researched</SelectItem>
                  <SelectItem value="contacted">✉️ Contacted</SelectItem>
                  <SelectItem value="responded">✅ Responded</SelectItem>
                  <SelectItem value="not_relevant">❌ Not relevant</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={String(filters.min_confidence)}
                onValueChange={v => setFilters(f => ({ ...f, min_confidence: parseInt(v, 10) }))}
              >
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Min confidence" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Any confidence</SelectItem>
                  <SelectItem value="30">30+ (hardware likely)</SelectItem>
                  <SelectItem value="50">50+ (strong signal)</SelectItem>
                  <SelectItem value="70">70+ (very confident)</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={String(filters.days_back)}
                onValueChange={v => setFilters(f => ({ ...f, days_back: parseInt(v, 10) }))}
              >
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Last 7 days</SelectItem>
                  <SelectItem value="14">Last 14 days</SelectItem>
                  <SelectItem value="30">Last 30 days</SelectItem>
                  <SelectItem value="90">Last 90 days</SelectItem>
                </SelectContent>
              </Select>

              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.is_hardware === true}
                  onChange={e => setFilters(f => ({ ...f, is_hardware: e.target.checked ? true : null }))}
                  className="rounded"
                />
                Hardware only
              </label>
            </div>
          </CardContent>
        </Card>

        {/* Results count */}
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{total.toLocaleString()} startups found</span>
          {totalPages > 1 && <span>Page {page + 1} of {totalPages}</span>}
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 p-3 rounded">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}

        {/* Startup cards */}
        {!loading && startups.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <Rocket className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>No funded startups found matching your filters.</p>
            <p className="text-sm mt-1">Try running a scan or adjusting the filters.</p>
          </div>
        )}

        {!loading && startups.length > 0 && (
          <div className="space-y-3">
            {startups.map(startup => (
              <StartupCard
                key={startup.id}
                startup={startup}
                onUpdateStatus={updateStatus}
                onUpdateNotes={updateNotes}
              />
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 pt-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0 || loading}
              onClick={() => setPage(p => p - 1)}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              {page + 1} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages - 1 || loading}
              onClick={() => setPage(p => p + 1)}
            >
              Next
            </Button>
          </div>
        )}
      </div>
    </PersistentDashboardLayout>
  );
}
