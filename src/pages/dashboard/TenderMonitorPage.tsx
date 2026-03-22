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
  MapPin,
  Clock,
  DollarSign,
  Tag,
  CheckCircle,
  Circle,
  Building,
} from "lucide-react";
import type { Tender, TenderFilters, TenderStats, TenderConnector } from "@/types/tenders";

// ─── Constants ────────────────────────────────────────────────

const COUNTRY_FLAGS: Record<string, string> = {
  NL: "🇳🇱", IE: "🇮🇪", FR: "🇫🇷", DE: "🇩🇪", IT: "🇮🇹",
  ES: "🇪🇸", PL: "🇵🇱", BE: "🇧🇪", SE: "🇸🇪", AT: "🇦🇹",
  DK: "🇩🇰", FI: "🇫🇮", PT: "🇵🇹", RO: "🇷🇴", EE: "🇪🇪",
  NO: "🇳🇴", CZ: "🇨🇿", HU: "🇭🇺", HR: "🇭🇷", SK: "🇸🇰",
  SI: "🇸🇮", BG: "🇧🇬", LT: "🇱🇹", LV: "🇱🇻", CY: "🇨🇾",
  LU: "🇱🇺", MT: "🇲🇹",
};

const CPV_CATEGORIES = [
  { value: "all", label: "All CPV codes" },
  { value: "42", label: "42 — Industrial Machinery" },
  { value: "44", label: "44 — Metal Products" },
  { value: "38", label: "38 — Precision Equipment" },
  { value: "34", label: "34 — Transport Components" },
  { value: "35", label: "35 — Defense Equipment" },
  { value: "14", label: "14 — Base Metals" },
  { value: "50", label: "50 — Repair & Maintenance" },
  { value: "19", label: "19 — Plastics & Rubber" },
  { value: "33", label: "33 — Medical Equipment" },
];

const COUNTRIES = [
  { code: "all", name: "All Countries" },
  { code: "DE", name: "Germany" }, { code: "FR", name: "France" },
  { code: "IT", name: "Italy" }, { code: "ES", name: "Spain" },
  { code: "NL", name: "Netherlands" }, { code: "PL", name: "Poland" },
  { code: "BE", name: "Belgium" }, { code: "SE", name: "Sweden" },
  { code: "AT", name: "Austria" }, { code: "DK", name: "Denmark" },
  { code: "FI", name: "Finland" }, { code: "PT", name: "Portugal" },
  { code: "IE", name: "Ireland" }, { code: "CZ", name: "Czechia" },
  { code: "RO", name: "Romania" }, { code: "HU", name: "Hungary" },
  { code: "HR", name: "Croatia" }, { code: "SK", name: "Slovakia" },
  { code: "SI", name: "Slovenia" }, { code: "BG", name: "Bulgaria" },
  { code: "LT", name: "Lithuania" }, { code: "LV", name: "Latvia" },
  { code: "EE", name: "Estonia" }, { code: "CY", name: "Cyprus" },
  { code: "LU", name: "Luxembourg" }, { code: "MT", name: "Malta" },
  { code: "NO", name: "Norway" },
];

const PAGE_SIZE = 30;

// European map coordinates for each country (for SVG map dots)
const COUNTRY_POSITIONS: Record<string, [number, number]> = {
  // [x%, y%] in a simple Europe SVG viewport
  IE: [12, 28], GB: [18, 25], FR: [22, 40], ES: [16, 52], PT: [10, 52],
  DE: [36, 32], NL: [30, 27], BE: [30, 33], LU: [33, 36],
  AT: [42, 38], CH: [34, 40], IT: [40, 50], MT: [42, 62],
  DK: [37, 21], SE: [42, 14], FI: [52, 12], NO: [36, 12],
  PL: [50, 30], CZ: [44, 33], SK: [48, 35], HU: [50, 39],
  HR: [45, 44], SI: [42, 42], RO: [58, 40], BG: [57, 47],
  GR: [52, 56], CY: [62, 60], LT: [56, 23], LV: [58, 20],
  EE: [58, 16],
};

// ─── Main Page Component ──────────────────────────────────────

export default function TenderMonitorPage() {
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [stats, setStats] = useState<TenderStats | null>(null);
  const [connectors, setConnectors] = useState<TenderConnector[]>([]);
  const [selectedMapCountry, setSelectedMapCountry] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState<TenderFilters>({
    country: "all",
    cpvPrefix: "all",
    valueRange: "all",
    deadline: "all",
    status: "all",
    score: "all",
    search: "",
    relevantOnly: false,
  });

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  // ─── API helpers ────────────────────────────────────────────

  const apiGet = useCallback(async (path: string, params: Record<string, string> = {}) => {
    const qs = new URLSearchParams(params).toString();
    const resp = await fetch(`/api${path}${qs ? "?" + qs : ""}`);
    if (!resp.ok) throw new Error(`API error: ${resp.status}`);
    return resp.json();
  }, []);

  const apiPost = useCallback(async (path: string, body: any) => {
    const resp = await fetch(`/api${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`API error: ${resp.status}`);
    return resp.json();
  }, []);

  // ─── Fetch data ─────────────────────────────────────────────

  const buildQueryParams = useCallback(() => {
    const params: Record<string, string> = {
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
    };

    if (filters.country !== "all") params.country = filters.country;
    if (filters.cpvPrefix !== "all") params.cpv_prefix = filters.cpvPrefix;
    if (filters.status !== "all") params.status = filters.status;
    if (filters.relevantOnly) params.relevant_only = "true";
    if (filters.search) params.search = filters.search;

    if (filters.score !== "all") {
      const scoreMap: Record<string, [string, string]> = {
        "80+": ["80", "100"],
        "50-79": ["50", "79"],
        "20-49": ["20", "49"],
        "<20": ["0", "19"],
      };
      if (scoreMap[filters.score]) {
        params.min_score = scoreMap[filters.score][0];
      }
    }

    if (filters.valueRange !== "all") {
      const valueMap: Record<string, [string?, string?]> = {
        "<10k": [undefined, "10000"],
        "10-50k": ["10000", "50000"],
        "50-200k": ["50000", "200000"],
        ">200k": ["200000", undefined],
      };
      const [min, max] = valueMap[filters.valueRange] || [];
      if (min) params.min_value = min;
      if (max) params.max_value = max;
    }

    if (filters.deadline !== "all") {
      const dayMap: Record<string, string> = {
        "7days": "7", "30days": "30", "active": "365",
      };
      if (dayMap[filters.deadline]) params.deadline_within_days = dayMap[filters.deadline];
    }

    if (selectedMapCountry) params.country = selectedMapCountry;

    return params;
  }, [filters, page, selectedMapCountry]);

  const fetchTenders = useCallback(async (resetPage = false) => {
    setLoading(true);
    setError(null);
    if (resetPage) setPage(0);

    try {
      const params = buildQueryParams();
      if (resetPage) params.offset = "0";

      const data = await apiGet("/tenders", params);
      setTenders(data.tenders || []);
      setTotal(data.total || 0);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [buildQueryParams, apiGet]);

  const fetchStats = useCallback(async () => {
    try {
      const data = await apiGet("/tenders", { stats_only: "true" });
      setStats(data);
    } catch { /* silent */ }
  }, [apiGet]);

  const fetchConnectors = useCallback(async () => {
    try {
      const data = await apiGet("/connector-status");
      setConnectors(data.connectors || []);
    } catch { /* silent */ }
  }, [apiGet]);

  useEffect(() => {
    fetchTenders(true);
    fetchStats();
    fetchConnectors();
  }, []);

  useEffect(() => {
    fetchTenders(true);
  }, [filters, selectedMapCountry]);

  useEffect(() => {
    if (page > 0) fetchTenders();
  }, [page]);

  // ─── Actions ────────────────────────────────────────────────

  const triggerScan = async (countryCode: string) => {
    setScanning(countryCode);
    try {
      const result = await apiPost("/tender-scan", { country_code: countryCode });
      alert(`Scan complete: ${result.tenders_new} new, ${result.tenders_relevant} relevant tenders.`);
      fetchTenders(true);
      fetchStats();
      fetchConnectors();
    } catch (err: any) {
      alert(`Scan failed: ${err.message}`);
    } finally {
      setScanning(null);
    }
  };

  const updateTenderStatus = async (id: string, status: string) => {
    try {
      await fetch("/api/tenders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      setTenders(prev => prev.map(t => t.id === id ? { ...t, status: status as any } : t));
    } catch { /* silent */ }
  };

  const exportCsv = () => {
    const params = buildQueryParams();
    delete (params as any).limit;
    delete (params as any).offset;
    const qs = new URLSearchParams(params).toString();
    window.open(`/api/tenders-export${qs ? "?" + qs : ""}`, "_blank");
  };

  const handleFilterChange = (key: keyof TenderFilters, value: string | boolean) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  // ─── Score badge ─────────────────────────────────────────────

  const getScoreBadge = (score: number) => {
    if (score >= 70) return <Badge className="bg-green-500 text-white text-xs">{score}</Badge>;
    if (score >= 40) return <Badge className="bg-yellow-500 text-white text-xs">{score}</Badge>;
    return <Badge variant="secondary" className="text-xs">{score}</Badge>;
  };

  const getHealthColor = (health: string) => {
    switch (health) {
      case "healthy": return "text-green-500";
      case "warning": return "text-yellow-500";
      case "error": case "stale": return "text-red-500";
      default: return "text-gray-400";
    }
  };

  const getHealthIcon = (health: string) => {
    switch (health) {
      case "healthy": return "✅";
      case "warning": return "⚠️";
      case "error": return "❌";
      case "stale": return "🕐";
      case "never_scanned": return "⏳";
      default: return "⭕";
    }
  };

  // ─── Render ──────────────────────────────────────────────────

  return (
    <PersistentDashboardLayout>
      <div className="space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Globe className="h-6 w-6 text-primary" />
              Tender Monitor
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              National procurement portals across 26 EU/EEA countries
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => { fetchTenders(true); fetchStats(); fetchConnectors(); }}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="h-4 w-4 mr-1" />
              Export CSV
            </Button>
          </div>
        </div>

        {/* Stats Bar */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { label: "Total", value: stats.total, color: "text-foreground" },
              { label: "Relevant", value: stats.relevant, color: "text-green-600" },
              { label: "This Week", value: stats.thisWeek, color: "text-blue-600" },
              { label: "Active", value: stats.active, color: "text-orange-600" },
              { label: "New Today", value: stats.newToday, color: "text-purple-600" },
            ].map(({ label, value, color }) => (
              <Card key={label} className="text-center">
                <CardContent className="pt-4 pb-4">
                  <div className={`text-2xl font-bold ${color}`}>{value.toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground">{label}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Europe Map */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              European Tender Map
              {selectedMapCountry && (
                <Button variant="ghost" size="sm" className="h-5 text-xs ml-auto"
                  onClick={() => setSelectedMapCountry(null)}>
                  Clear filter ✕
                </Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative bg-muted/30 rounded-lg overflow-hidden" style={{ paddingTop: "50%" }}>
              <svg
                className="absolute inset-0 w-full h-full"
                viewBox="0 0 100 70"
                preserveAspectRatio="xMidYMid meet"
              >
                {/* Background */}
                <rect width="100" height="70" fill="hsl(var(--muted))" rx="4" />

                {/* Country dots */}
                {Object.entries(COUNTRY_POSITIONS).map(([code, [x, y]]) => {
                  const count = stats?.byCountry[code] || 0;
                  const isSelected = selectedMapCountry === code;
                  const r = count > 10 ? 2.5 : count > 5 ? 2 : count > 0 ? 1.5 : 1;
                  const fill = count > 0
                    ? (count > 10 ? "#22c55e" : "#f59e0b")
                    : "#94a3b8";

                  return (
                    <g
                      key={code}
                      onClick={() => setSelectedMapCountry(isSelected ? null : code)}
                      className="cursor-pointer"
                    >
                      <circle
                        cx={x} cy={y} r={r + 1}
                        fill={isSelected ? "white" : "transparent"}
                        opacity={0.5}
                      />
                      <circle
                        cx={x} cy={y} r={r}
                        fill={fill}
                        stroke={isSelected ? "white" : "transparent"}
                        strokeWidth={0.4}
                        opacity={code === selectedMapCountry ? 1 : 0.8}
                      />
                      {count > 0 && (
                        <title>{COUNTRY_FLAGS[code] || code} {code}: {count} relevant tenders</title>
                      )}
                      <text
                        x={x} y={y + 3.5}
                        textAnchor="middle"
                        fontSize="1.8"
                        fill="hsl(var(--foreground))"
                        opacity={0.7}
                      >
                        {code}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
            <p className="text-xs text-muted-foreground mt-2 text-center">
              🟢 &gt;10 relevant | 🟡 1-10 relevant | ⚫ none — Click a country to filter
            </p>
          </CardContent>
        </Card>

        {/* Filters */}
        <Card>
          <CardContent className="pt-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-3">
              <Select value={filters.country} onValueChange={v => handleFilterChange("country", v)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Country" />
                </SelectTrigger>
                <SelectContent>
                  {COUNTRIES.map(c => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.code !== "all" ? COUNTRY_FLAGS[c.code] : ""} {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={filters.cpvPrefix} onValueChange={v => handleFilterChange("cpvPrefix", v)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="CPV" />
                </SelectTrigger>
                <SelectContent>
                  {CPV_CATEGORIES.map(c => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={filters.valueRange} onValueChange={v => handleFilterChange("valueRange", v)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Value" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any value</SelectItem>
                  <SelectItem value="<10k">&lt;€10K</SelectItem>
                  <SelectItem value="10-50k">€10K–50K</SelectItem>
                  <SelectItem value="50-200k">€50K–200K (sweet spot)</SelectItem>
                  <SelectItem value=">200k">&gt;€200K</SelectItem>
                </SelectContent>
              </Select>

              <Select value={filters.deadline} onValueChange={v => handleFilterChange("deadline", v)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Deadline" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any deadline</SelectItem>
                  <SelectItem value="7days">Next 7 days</SelectItem>
                  <SelectItem value="30days">Next 30 days</SelectItem>
                  <SelectItem value="active">Active only</SelectItem>
                </SelectContent>
              </Select>

              <Select value={filters.status} onValueChange={v => handleFilterChange("status", v)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="new">New</SelectItem>
                  <SelectItem value="reviewed">Reviewed</SelectItem>
                  <SelectItem value="interested">Interested</SelectItem>
                  <SelectItem value="bidding">Bidding</SelectItem>
                  <SelectItem value="won">Won</SelectItem>
                  <SelectItem value="lost">Lost</SelectItem>
                  <SelectItem value="not_relevant">Not Relevant</SelectItem>
                </SelectContent>
              </Select>

              <Select value={filters.score} onValueChange={v => handleFilterChange("score", v)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Score" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any score</SelectItem>
                  <SelectItem value="80+">High (80+)</SelectItem>
                  <SelectItem value="50-79">Medium (50-79)</SelectItem>
                  <SelectItem value="20-49">Low (20-49)</SelectItem>
                  <SelectItem value="<20">Unscored (&lt;20)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search titles, buyers, descriptions..."
                  value={filters.search}
                  onChange={e => handleFilterChange("search", e.target.value)}
                  className="pl-8 h-8 text-xs"
                />
              </div>
              <Button
                variant={filters.relevantOnly ? "default" : "outline"}
                size="sm"
                className="h-8 text-xs"
                onClick={() => handleFilterChange("relevantOnly", !filters.relevantOnly)}
              >
                {filters.relevantOnly ? <CheckCircle className="h-3 w-3 mr-1" /> : <Circle className="h-3 w-3 mr-1" />}
                Relevant only
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Tender Table */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {loading ? "Loading..." : `${total.toLocaleString()} tenders`}
              {selectedMapCountry && ` in ${COUNTRY_FLAGS[selectedMapCountry]} ${selectedMapCountry}`}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline" size="sm" className="h-7 text-xs"
                disabled={page === 0}
                onClick={() => setPage(p => Math.max(0, p - 1))}
              >
                ← Prev
              </Button>
              <span className="text-xs text-muted-foreground">Page {page + 1}</span>
              <Button
                variant="outline" size="sm" className="h-7 text-xs"
                disabled={tenders.length < PAGE_SIZE}
                onClick={() => setPage(p => p + 1)}
              >
                Next →
              </Button>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-500 text-sm p-3 bg-red-50 rounded-md">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : tenders.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Globe className="h-12 w-12 mx-auto mb-4 opacity-30" />
                <p>No tenders found.</p>
                <p className="text-sm mt-1">Try adjusting your filters or trigger a scan below.</p>
              </CardContent>
            </Card>
          ) : (
            tenders.map(tender => (
              <TenderRow
                key={tender.id}
                tender={tender}
                expanded={expandedId === tender.id}
                onToggle={() => setExpandedId(expandedId === tender.id ? null : tender.id)}
                onStatusChange={updateTenderStatus}
                getScoreBadge={getScoreBadge}
              />
            ))
          )}
        </div>

        {/* Connector Status */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Globe className="h-4 w-4" />
              Country Connector Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {connectors.map(c => {
                const health = (c as any).health || "unknown";
                const lastScan = c.last_scan_at
                  ? `${Math.round((Date.now() - new Date(c.last_scan_at).getTime()) / 3600000)}h ago`
                  : "Never";

                return (
                  <div key={c.country_code} className="flex items-center justify-between p-2 rounded-md bg-muted/50 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-base">{COUNTRY_FLAGS[c.country_code] || "🌐"}</span>
                      <div className="min-w-0">
                        <div className="font-medium truncate">{c.portal_name}</div>
                        <div className="text-muted-foreground">{lastScan} · {c.last_scan_count || 0} found</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className={getHealthColor(health)}>{getHealthIcon(health)}</span>
                      <Button
                        variant="ghost" size="sm"
                        className="h-6 text-xs px-2"
                        disabled={scanning === c.country_code}
                        onClick={() => triggerScan(c.country_code)}
                      >
                        {scanning === c.country_code
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : "Scan"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

      </div>
    </PersistentDashboardLayout>
  );
}

// ─── Tender Row Component ─────────────────────────────────────

interface TenderRowProps {
  tender: Tender;
  expanded: boolean;
  onToggle: () => void;
  onStatusChange: (id: string, status: string) => void;
  getScoreBadge: (score: number) => React.ReactNode;
}

function TenderRow({ tender, expanded, onToggle, onStatusChange, getScoreBadge }: TenderRowProps) {
  const flag = COUNTRY_FLAGS[tender.country_code] || "🌐";
  const deadline = tender.submission_deadline
    ? new Date(tender.submission_deadline).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    : null;
  const isExpired = tender.submission_deadline && new Date(tender.submission_deadline) < new Date();
  const value = tender.estimated_value_eur
    ? `€${Math.round(tender.estimated_value_eur).toLocaleString()}`
    : null;

  const statusColors: Record<string, string> = {
    new: "bg-blue-100 text-blue-700",
    reviewed: "bg-gray-100 text-gray-700",
    interested: "bg-green-100 text-green-700",
    bidding: "bg-purple-100 text-purple-700",
    won: "bg-emerald-100 text-emerald-700",
    lost: "bg-red-100 text-red-700",
    not_relevant: "bg-gray-50 text-gray-400",
    expired: "bg-orange-100 text-orange-700",
  };

  return (
    <Card className={`transition-all ${tender.relevance_score >= 70 ? "border-green-200" : ""}`}>
      <CardContent className="p-3">
        {/* Row summary */}
        <div
          className="flex items-start gap-3 cursor-pointer"
          onClick={onToggle}
        >
          <div className="text-xl shrink-0 mt-0.5">{flag}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-2 flex-wrap">
              {getScoreBadge(tender.relevance_score)}
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${statusColors[tender.status] || "bg-gray-100"}`}>
                {tender.status}
              </span>
              {tender.is_relevant && (
                <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">relevant</span>
              )}
            </div>
            <p className="font-medium text-sm mt-1 line-clamp-2">{tender.title}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-muted-foreground">
              {tender.buyer_name && (
                <span className="flex items-center gap-1">
                  <Building className="h-3 w-3" />
                  {tender.buyer_name.substring(0, 50)}
                </span>
              )}
              {value && (
                <span className="flex items-center gap-1">
                  <DollarSign className="h-3 w-3" />
                  {value}
                </span>
              )}
              {deadline && (
                <span className={`flex items-center gap-1 ${isExpired ? "text-red-400" : ""}`}>
                  <Clock className="h-3 w-3" />
                  {deadline}
                  {isExpired && " (expired)"}
                </span>
              )}
              {(tender.cpv_codes || []).length > 0 && (
                <span className="flex items-center gap-1">
                  <Tag className="h-3 w-3" />
                  {tender.cpv_codes!.slice(0, 2).join(", ")}
                </span>
              )}
            </div>
          </div>
          <div className="shrink-0 text-muted-foreground">
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </div>

        {/* Expanded detail */}
        {expanded && (
          <div className="mt-3 pt-3 border-t space-y-3">
            {tender.description && (
              <p className="text-sm text-muted-foreground">{tender.description.substring(0, 500)}</p>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
              {tender.portal_name && (
                <div><span className="font-medium">Portal:</span> {tender.portal_name}</div>
              )}
              {tender.procedure_type && (
                <div><span className="font-medium">Procedure:</span> {tender.procedure_type}</div>
              )}
              {tender.nature_of_contract && (
                <div><span className="font-medium">Nature:</span> {tender.nature_of_contract}</div>
              )}
              {tender.place_of_performance && (
                <div><span className="font-medium">Place:</span> {tender.place_of_performance}</div>
              )}
              {tender.nuts_code && (
                <div><span className="font-medium">NUTS:</span> {tender.nuts_code}</div>
              )}
              {tender.publication_date && (
                <div><span className="font-medium">Published:</span> {new Date(tender.publication_date).toLocaleDateString("en-GB")}</div>
              )}
            </div>

            {(tender.matched_keywords || []).length > 0 && (
              <div className="flex flex-wrap gap-1">
                <span className="text-xs font-medium text-muted-foreground">Keywords:</span>
                {tender.matched_keywords!.slice(0, 8).map(kw => (
                  <span key={kw} className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">{kw}</span>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {tender.portal_url && (
                <Button variant="outline" size="sm" className="h-7 text-xs" asChild>
                  <a href={tender.portal_url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-3 w-3 mr-1" />
                    View on Portal
                  </a>
                </Button>
              )}
              {tender.status !== "interested" && (
                <Button variant="outline" size="sm" className="h-7 text-xs text-green-600 border-green-300"
                  onClick={() => onStatusChange(tender.id, "interested")}>
                  ⭐ Interested
                </Button>
              )}
              {tender.status !== "bidding" && (
                <Button variant="outline" size="sm" className="h-7 text-xs text-purple-600 border-purple-300"
                  onClick={() => onStatusChange(tender.id, "bidding")}>
                  📝 Bidding
                </Button>
              )}
              {tender.status !== "reviewed" && (
                <Button variant="outline" size="sm" className="h-7 text-xs"
                  onClick={() => onStatusChange(tender.id, "reviewed")}>
                  👁 Reviewed
                </Button>
              )}
              {tender.status !== "not_relevant" && (
                <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground"
                  onClick={() => onStatusChange(tender.id, "not_relevant")}>
                  Dismiss
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
