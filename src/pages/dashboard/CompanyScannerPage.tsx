import React, { useState, useCallback, useEffect } from "react";
import PersistentDashboardLayout from "@/components/dashboard/PersistentDashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Globe,
  Phone,
  Mail,
  Loader2,
  Search,
  Download,
  RefreshCw,
  Building2,
  MapPin,
  ExternalLink,
  AlertCircle,
  CheckCircle,
  Clock,
  Bookmark,
  Scan,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
interface CompanyLead {
  id: string;
  source: string;
  source_url: string;
  search_url?: string;
  search_query?: string;
  search_country?: string;
  company_name: string;
  description?: string;
  country?: string;
  city?: string;
  full_address?: string;
  website_url?: string;
  phone?: string;
  email?: string;
  scraped_emails?: string[];
  email_scrape_status: string;
  employee_count?: string;
  year_established?: string;
  industry_tags?: string[];
  products_services?: string[];
  certifications?: string[];
  outreach_status: string;
  outreach_notes?: string;
  created_at: string;
}

interface SavedSearch {
  id: number;
  name: string;
  source: string;
  search_url: string;
  keyword?: string;
  country?: string;
  max_pages: number;
  is_active: boolean;
  last_run_at?: string;
  last_run_count?: number;
  created_at: string;
}

interface ScanState {
  running: boolean;
  currentPage: number;
  totalPages: number;
  companiesFound: number;
  companiesNew: number;
  errors: string[];
  phase: "idle" | "scanning" | "enriching" | "done";
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function detectSource(url: string): "europages" | "wlw" | "unknown" {
  const lower = url.toLowerCase();
  if (lower.includes("europages.")) return "europages";
  if (lower.includes("wlw.com") || lower.includes("wlw.de") || lower.includes("wlw.at")) return "wlw";
  return "unknown";
}

function extractMeta(url: string, source: string) {
  let keyword = "";
  let country = "";
  if (source === "europages") {
    const m = url.match(/\/companies\/(?:([^/]+?)\/)?([^/]+?)(?:\.html|\/p-\d+|$)/i);
    if (m) {
      if (m[2]) keyword = decodeURIComponent(m[2]).replace(/-/g, " ");
      if (m[1] && !m[1].startsWith("p-")) country = m[1];
    }
  } else if (source === "wlw") {
    const kwM = url.match(/\/(?:en|de)\/(?:search|suche)\/([^/?#]+)/i);
    const cM = url.match(/\/country\/([^/?#]+)/i);
    if (kwM) keyword = decodeURIComponent(kwM[1]).replace(/-/g, " ");
    if (cM) country = cM[1];
  }
  return { keyword: keyword.trim(), country: country.trim() };
}

function buildPageUrl(baseUrl: string, page: number, source: string): string {
  if (page === 1) return baseUrl;
  if (source === "europages") {
    const cleaned = baseUrl.replace(/\/p-\d+\.html$/, ".html").replace(/\.html$/, "");
    return `${cleaned}/p-${page}.html`;
  }
  if (source === "wlw") {
    const cleaned = baseUrl.replace(/\/page\/\d+/, "").replace(/\/$/, "");
    return `${cleaned}/page/${page}`;
  }
  return baseUrl;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const STATUS_COLORS: Record<string, string> = {
  new: "bg-gray-100 text-gray-700",
  email_found: "bg-blue-100 text-blue-700",
  contacted: "bg-yellow-100 text-yellow-700",
  responded: "bg-orange-100 text-orange-700",
  converted: "bg-green-100 text-green-700",
  not_relevant: "bg-red-100 text-red-700",
};

const EMAIL_STATUS_COLORS: Record<string, string> = {
  pending: "bg-gray-100 text-gray-500",
  scraped: "bg-green-100 text-green-700",
  no_emails: "bg-yellow-100 text-yellow-700",
  failed: "bg-red-100 text-red-700",
};

const PAGE_SIZE = 25;

// ─────────────────────────────────────────────
// Main Page Component
// ─────────────────────────────────────────────
export default function CompanyScannerPage() {
  const [scanUrl, setScanUrl] = useState("");
  const [maxPages, setMaxPages] = useState(3);
  const [enrichProfiles, setEnrichProfiles] = useState(true);
  const [scan, setScan] = useState<ScanState>({
    running: false,
    currentPage: 0,
    totalPages: 0,
    companiesFound: 0,
    companiesNew: 0,
    errors: [],
    phase: "idle",
  });

  const [companies, setCompanies] = useState<CompanyLead[]>([]);
  const [totalCompanies, setTotalCompanies] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    source: "all",
    country: "",
    outreachStatus: "all",
    emailStatus: "all",
    search: "",
  });

  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [saveName, setSaveName] = useState("");
  const [savingSearch, setSavingSearch] = useState(false);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [enrichingIds, setEnrichingIds] = useState<Set<string>>(new Set());

  // Detect source from URL
  const detectedSource = detectSource(scanUrl);
  const { keyword, country } = scanUrl ? extractMeta(scanUrl, detectedSource) : { keyword: "", country: "" };

  // ─── Fetch companies from Supabase ───
  const fetchCompanies = useCallback(async (resetPage = false) => {
    setLoading(true);
    const currentPage = resetPage ? 0 : page;
    if (resetPage) setPage(0);

    let query = supabase
      .from("company_leads")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1);

    if (filters.source !== "all") query = query.eq("source", filters.source);
    if (filters.outreachStatus !== "all") query = query.eq("outreach_status", filters.outreachStatus);
    if (filters.emailStatus !== "all") query = query.eq("email_scrape_status", filters.emailStatus);
    if (filters.country) query = query.ilike("country", `%${filters.country}%`);
    if (filters.search) query = query.ilike("company_name", `%${filters.search}%`);

    const { data, count, error } = await query;
    if (!error) {
      setCompanies((data as CompanyLead[]) || []);
      setTotalCompanies(count || 0);
    }
    setLoading(false);
  }, [page, filters]);

  useEffect(() => {
    fetchCompanies();
  }, [fetchCompanies]);

  // ─── Fetch saved searches ───
  const fetchSavedSearches = useCallback(async () => {
    const { data } = await supabase
      .from("saved_searches")
      .select("*")
      .order("created_at", { ascending: false });
    setSavedSearches((data as SavedSearch[]) || []);
  }, []);

  useEffect(() => {
    fetchSavedSearches();
  }, [fetchSavedSearches]);

  // ─── Stats ───
  const [stats, setStats] = useState({ total: 0, withEmail: 0, pendingEnrich: 0, contacted: 0 });
  useEffect(() => {
    (async () => {
      const [total, withEmail, pendingEnrich, contacted] = await Promise.all([
        supabase.from("company_leads").select("id", { count: "exact", head: true }),
        supabase.from("company_leads").select("id", { count: "exact", head: true }).not("website_url", "is", null).eq("email_scrape_status", "scraped"),
        supabase.from("company_leads").select("id", { count: "exact", head: true }).eq("email_scrape_status", "pending").not("website_url", "is", null),
        supabase.from("company_leads").select("id", { count: "exact", head: true }).in("outreach_status", ["contacted", "responded", "converted"]),
      ]);
      setStats({
        total: total.count || 0,
        withEmail: withEmail.count || 0,
        pendingEnrich: pendingEnrich.count || 0,
        contacted: contacted.count || 0,
      });
    })();
  }, [companies]);

  // ─── Main Scan ───
  const handleScan = async () => {
    if (!scanUrl || detectedSource === "unknown") return;

    setScan({ running: true, currentPage: 0, totalPages: maxPages, companiesFound: 0, companiesNew: 0, errors: [], phase: "scanning" });
    setSelectedIds(new Set());

    let totalFound = 0;
    let totalNew = 0;
    const allErrors: string[] = [];

    for (let pg = 1; pg <= maxPages; pg++) {
      const pageUrl = buildPageUrl(scanUrl, pg, detectedSource);
      setScan(s => ({ ...s, currentPage: pg }));

      try {
        const resp = await fetch("/api/scan-directory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: pageUrl, source: detectedSource }),
        });

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
          allErrors.push(`Page ${pg}: ${err.error || "unknown error"}`);
          if (resp.status === 429 || resp.status === 403) break;
          continue;
        }

        const data = await resp.json();
        const pageCompanies = data.companies || [];

        if (pageCompanies.length === 0) break;

        totalFound += pageCompanies.length;

        // Store in Supabase (upsert by source + source_url to dedup)
        const { data: upserted, error: upsertErr } = await supabase
          .from("company_leads")
          .upsert(pageCompanies, { onConflict: "source,source_url", ignoreDuplicates: false })
          .select("id");

        if (upsertErr) {
          allErrors.push(`Page ${pg} DB: ${upsertErr.message}`);
        } else {
          totalNew += upserted?.length || 0;
        }

        setScan(s => ({ ...s, companiesFound: totalFound, companiesNew: totalNew }));

        // Check if there's a next page
        if (!data.hasNextPage) break;

        // Rate limit between pages
        const delayMs = detectedSource === "wlw" ? 4000 : 2500;
        await sleep(delayMs);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        allErrors.push(`Page ${pg}: ${message}`);
      }
    }

    // Profile enrichment phase (website URL)
    if (enrichProfiles && totalNew > 0) {
      setScan(s => ({ ...s, phase: "enriching" }));

      // Get companies without website_url from this scan
      const { data: toEnrich } = await supabase
        .from("company_leads")
        .select("id, source_url, source")
        .eq("source", detectedSource)
        .is("website_url", null)
        .order("created_at", { ascending: false })
        .limit(Math.min(totalNew, 20)); // Limit to avoid timeout

      if (toEnrich && toEnrich.length > 0) {
        for (const c of toEnrich) {
          try {
            const resp = await fetch("/api/scrape-company-profile", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: c.source_url, source: c.source }),
            });

            if (resp.ok) {
              const details = await resp.json();
              const updates: Record<string, unknown> = {};
              if (details.website_url) updates.website_url = details.website_url;
              if (details.phone) updates.phone = details.phone;
              if (details.email) updates.email = details.email;
              if (details.description) updates.description = details.description;
              if (details.employee_count) updates.employee_count = details.employee_count;
              if (details.country) updates.country = details.country;
              if (details.city) updates.city = details.city;
              if (details.full_address) updates.full_address = details.full_address;
              if (details.industry_tags?.length) updates.industry_tags = details.industry_tags;
              if (details.certifications?.length) updates.certifications = details.certifications;
              if (details.contact_persons?.length) updates.contact_persons = details.contact_persons;
              if (details.company_name && details.company_name !== "Unknown") updates.company_name = details.company_name;

              if (Object.keys(updates).length > 0) {
                await supabase.from("company_leads").update(updates).eq("id", c.id);
              }
            }
          } catch (_) { /* skip single profile errors */ }

          await sleep(detectedSource === "wlw" ? 3500 : 2000);
        }
      }
    }

    setScan(s => ({ ...s, running: false, phase: "done", errors: allErrors }));
    fetchCompanies(true);
  };

  // ─── Enrich single company emails ───
  const handleEnrichEmails = async (company: CompanyLead) => {
    if (!company.website_url) return;
    setEnrichingIds(prev => new Set(prev).add(company.id));

    try {
      const resp = await fetch("/api/scrape-website", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: [company.website_url] }),
      });

      if (resp.ok) {
        const data = await resp.json();
        const result = data.results?.[0];
        const emails = result?.emails || [];

        await supabase.from("company_leads").update({
          scraped_emails: emails,
          email_scrape_status: emails.length > 0 ? "scraped" : "no_emails",
          email_scraped_at: new Date().toISOString(),
          outreach_status: emails.length > 0 ? "email_found" : company.outreach_status,
        }).eq("id", company.id);

        fetchCompanies();
      }
    } catch (_) { /* ignore */ } finally {
      setEnrichingIds(prev => {
        const next = new Set(prev);
        next.delete(company.id);
        return next;
      });
    }
  };

  // ─── Bulk enrich selected ───
  const handleBulkEnrich = async () => {
    const toEnrich = companies.filter(c => selectedIds.has(c.id) && c.website_url);
    for (const c of toEnrich) {
      await handleEnrichEmails(c);
      await sleep(1500);
    }
  };

  // ─── Update outreach status ───
  const handleStatusChange = async (id: string, status: string) => {
    await supabase.from("company_leads").update({ outreach_status: status }).eq("id", id);
    fetchCompanies();
  };

  // ─── Save search ───
  const handleSaveSearch = async () => {
    if (!scanUrl || !saveName || detectedSource === "unknown") return;
    setSavingSearch(true);
    await supabase.from("saved_searches").insert({
      name: saveName,
      source: detectedSource,
      search_url: scanUrl,
      keyword,
      country,
      max_pages: maxPages,
    });
    setSaveName("");
    setSavingSearch(false);
    fetchSavedSearches();
  };

  // ─── CSV Export ───
  const handleExport = () => {
    const rows = companies.filter(c => selectedIds.size === 0 || selectedIds.has(c.id));
    const headers = ["Company Name", "Source", "Country", "City", "Website", "Phone", "Email", "Scraped Emails", "Employee Count", "Industry Tags", "Outreach Status", "Description"];
    const csv = [
      headers.join(","),
      ...rows.map(c => [
        `"${(c.company_name || "").replace(/"/g, '""')}"`,
        c.source,
        c.country || "",
        c.city || "",
        c.website_url || "",
        c.phone || "",
        c.email || "",
        (c.scraped_emails || []).join("|"),
        c.employee_count || "",
        (c.industry_tags || []).join("|"),
        c.outreach_status,
        `"${(c.description || "").replace(/"/g, '""').slice(0, 100)}"`,
      ].join(","))
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `company-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ─── Toggle select ───
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === companies.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(companies.map(c => c.id)));
    }
  };

  const scanProgress = scan.totalPages > 0 ? (scan.currentPage / scan.totalPages) * 100 : 0;

  return (
    <PersistentDashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Scan className="h-6 w-6 text-primary" />
              Company Scanner
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Scan Europages & wlw for potential customers. Paste a search results URL to begin.
            </p>
          </div>
        </div>

        {/* Scan Input */}
        <Card>
          <CardContent className="pt-5 space-y-4">
            <div className="flex gap-2">
              <Input
                value={scanUrl}
                onChange={e => setScanUrl(e.target.value)}
                placeholder="Paste Europages or wlw search URL... e.g. https://www.europages.co.uk/companies/germany/robotics.html"
                className="flex-1 font-mono text-sm"
                disabled={scan.running}
              />
              <Button onClick={handleScan} disabled={scan.running || !scanUrl || detectedSource === "unknown"} className="gap-2 shrink-0">
                {scan.running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scan className="h-4 w-4" />}
                {scan.running ? "Scanning..." : "Scan"}
              </Button>
            </div>

            {/* Source detection & options */}
            <div className="flex flex-wrap items-center gap-4 text-sm">
              {scanUrl && (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Detected:</span>
                  {detectedSource === "unknown" ? (
                    <Badge variant="destructive">Unknown source</Badge>
                  ) : (
                    <Badge className="bg-green-100 text-green-800">
                      {detectedSource === "europages" ? "Europages" : "wlw"}{keyword ? ` · "${keyword}"` : ""}{country ? ` · ${country}` : ""}
                    </Badge>
                  )}
                </div>
              )}

              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Max pages:</span>
                <Select value={String(maxPages)} onValueChange={v => setMaxPages(Number(v))} disabled={scan.running}>
                  <SelectTrigger className="w-20 h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 5, 10].map(n => (
                      <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={enrichProfiles}
                  onCheckedChange={v => setEnrichProfiles(!!v)}
                  disabled={scan.running}
                />
                <span className="text-muted-foreground">Enrich profiles (get website URL)</span>
              </label>
            </div>

            {/* Save search */}
            <div className="flex gap-2 items-center">
              <Input
                value={saveName}
                onChange={e => setSaveName(e.target.value)}
                placeholder="Save search as... e.g. German Machine Builders"
                className="max-w-xs h-8 text-sm"
                disabled={!scanUrl || detectedSource === "unknown"}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleSaveSearch}
                disabled={!saveName || !scanUrl || detectedSource === "unknown" || savingSearch}
                className="gap-1"
              >
                <Bookmark className="h-3.5 w-3.5" />
                Save Search
              </Button>
            </div>

            {/* Scan progress */}
            {scan.running && (
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>
                    {scan.phase === "scanning" ? `Scanning page ${scan.currentPage} of ${scan.totalPages}...` : "Enriching company profiles..."}
                  </span>
                  <span>{scan.companiesFound} found · {scan.companiesNew} new</span>
                </div>
                <Progress value={scanProgress} className="h-2" />
              </div>
            )}

            {/* Scan complete */}
            {scan.phase === "done" && !scan.running && (
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <span className="text-green-700">
                  Scan complete — {scan.companiesFound} companies found, {scan.companiesNew} new
                </span>
                {scan.errors.length > 0 && (
                  <span className="text-yellow-600 ml-2">({scan.errors.length} errors)</span>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Stats Bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Companies", value: stats.total, icon: <Building2 className="h-5 w-5 text-blue-600" />, color: "text-blue-600" },
            { label: "Emails Found", value: stats.withEmail, icon: <Mail className="h-5 w-5 text-green-600" />, color: "text-green-600" },
            { label: "Pending Enrichment", value: stats.pendingEnrich, icon: <Clock className="h-5 w-5 text-yellow-600" />, color: "text-yellow-600" },
            { label: "Contacted", value: stats.contacted, icon: <Users className="h-5 w-5 text-purple-600" />, color: "text-purple-600" },
          ].map(s => (
            <Card key={s.label}>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-3">
                  {s.icon}
                  <div>
                    <p className={`text-2xl font-bold ${s.color}`}>{s.value.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Tabs defaultValue="companies">
          <TabsList>
            <TabsTrigger value="companies">Companies ({totalCompanies})</TabsTrigger>
            <TabsTrigger value="saved">Saved Searches ({savedSearches.length})</TabsTrigger>
          </TabsList>

          {/* ─── Companies Tab ─── */}
          <TabsContent value="companies" className="space-y-4">
            {/* Filters */}
            <div className="flex flex-wrap gap-2 items-center">
              <Select value={filters.source} onValueChange={v => setFilters(f => ({ ...f, source: v }))}>
                <SelectTrigger className="w-36 h-8">
                  <SelectValue placeholder="Source" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sources</SelectItem>
                  <SelectItem value="europages">Europages</SelectItem>
                  <SelectItem value="wlw">wlw</SelectItem>
                </SelectContent>
              </Select>

              <Select value={filters.outreachStatus} onValueChange={v => setFilters(f => ({ ...f, outreachStatus: v }))}>
                <SelectTrigger className="w-36 h-8">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="new">New</SelectItem>
                  <SelectItem value="email_found">Email Found</SelectItem>
                  <SelectItem value="contacted">Contacted</SelectItem>
                  <SelectItem value="responded">Responded</SelectItem>
                  <SelectItem value="converted">Converted</SelectItem>
                  <SelectItem value="not_relevant">Not Relevant</SelectItem>
                </SelectContent>
              </Select>

              <Select value={filters.emailStatus} onValueChange={v => setFilters(f => ({ ...f, emailStatus: v }))}>
                <SelectTrigger className="w-40 h-8">
                  <SelectValue placeholder="Email Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Email Statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="scraped">Scraped</SelectItem>
                  <SelectItem value="no_emails">No Emails</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>

              <Input
                value={filters.country}
                onChange={e => setFilters(f => ({ ...f, country: e.target.value }))}
                placeholder="Country..."
                className="w-32 h-8 text-sm"
              />

              <div className="relative">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={filters.search}
                  onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
                  placeholder="Search companies..."
                  className="w-44 h-8 pl-7 text-sm"
                />
              </div>

              <Button variant="ghost" size="sm" onClick={() => fetchCompanies(true)} className="h-8">
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* Bulk actions */}
            {companies.length > 0 && (
              <div className="flex items-center gap-3 py-2 border-b text-sm">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={selectedIds.size === companies.length && companies.length > 0}
                    onCheckedChange={toggleSelectAll}
                  />
                  <span className="text-muted-foreground">
                    {selectedIds.size > 0 ? `${selectedIds.size} selected` : "Select all"}
                  </span>
                </label>

                {selectedIds.size > 0 && (
                  <>
                    <Button variant="outline" size="sm" onClick={handleBulkEnrich} className="h-7 gap-1">
                      <Mail className="h-3.5 w-3.5" />
                      Enrich Emails
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleExport} className="h-7 gap-1">
                      <Download className="h-3.5 w-3.5" />
                      Export CSV
                    </Button>
                  </>
                )}

                {selectedIds.size === 0 && (
                  <Button variant="outline" size="sm" onClick={handleExport} className="h-7 gap-1">
                    <Download className="h-3.5 w-3.5" />
                    Export All CSV
                  </Button>
                )}
              </div>
            )}

            {/* Company list */}
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : companies.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Building2 className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p className="font-medium">No companies yet</p>
                <p className="text-sm mt-1">Paste a search URL above and click Scan to start</p>
              </div>
            ) : (
              <div className="space-y-2">
                {companies.map(company => (
                  <CompanyCard
                    key={company.id}
                    company={company}
                    selected={selectedIds.has(company.id)}
                    onSelect={() => toggleSelect(company.id)}
                    onStatusChange={handleStatusChange}
                    onEnrichEmails={handleEnrichEmails}
                    enriching={enrichingIds.has(company.id)}
                  />
                ))}
              </div>
            )}

            {/* Pagination */}
            {totalCompanies > PAGE_SIZE && (
              <div className="flex items-center justify-between pt-2">
                <p className="text-sm text-muted-foreground">
                  Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCompanies)} of {totalCompanies}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>
                    Previous
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={(page + 1) * PAGE_SIZE >= totalCompanies}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>

          {/* ─── Saved Searches Tab ─── */}
          <TabsContent value="saved" className="space-y-3">
            {savedSearches.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Bookmark className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p className="font-medium">No saved searches</p>
                <p className="text-sm mt-1">Save a search URL to run it again later</p>
              </div>
            ) : (
              savedSearches.map(ss => (
                <Card key={ss.id} className="hover:shadow-sm transition-shadow">
                  <CardContent className="py-3 px-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div>
                          <p className="font-medium text-sm">{ss.name}</p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                            <Badge className="text-xs py-0 h-4" variant="outline">{ss.source}</Badge>
                            {ss.keyword && <span>"{ss.keyword}"</span>}
                            {ss.country && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{ss.country}</span>}
                            <span>max {ss.max_pages} pages</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        {ss.last_run_at ? (
                          <span>Last: {new Date(ss.last_run_at).toLocaleDateString()}{ss.last_run_count ? ` (${ss.last_run_count})` : ""}</span>
                        ) : (
                          <span className="text-yellow-600">Never run</span>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1"
                          onClick={() => { setScanUrl(ss.search_url); setMaxPages(ss.max_pages); }}
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          Load & Scan
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      </div>
    </PersistentDashboardLayout>
  );
}

// ─────────────────────────────────────────────
// Company Card Component
// ─────────────────────────────────────────────
interface CompanyCardProps {
  company: CompanyLead;
  selected: boolean;
  onSelect: () => void;
  onStatusChange: (id: string, status: string) => void;
  onEnrichEmails: (company: CompanyLead) => void;
  enriching: boolean;
}

function CompanyCard({ company, selected, onSelect, onStatusChange, onEnrichEmails, enriching }: CompanyCardProps) {
  const allEmails = [
    ...(company.scraped_emails || []),
    ...(company.email ? [company.email] : []),
  ].filter((e, i, arr) => arr.indexOf(e) === i);

  return (
    <Card className={`transition-all hover:shadow-sm ${selected ? "border-primary ring-1 ring-primary/20" : ""}`}>
      <CardContent className="py-3 px-4">
        <div className="flex items-start gap-3">
          <Checkbox checked={selected} onCheckedChange={onSelect} className="mt-0.5 shrink-0" />

          <div className="flex-1 min-w-0 space-y-1.5">
            {/* Header row */}
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm">{company.company_name}</span>
                <Badge variant="outline" className="text-xs py-0 h-4">{company.source}</Badge>
                {company.country && (
                  <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                    <MapPin className="h-3 w-3" />
                    {[company.city, company.country].filter(Boolean).join(", ")}
                  </span>
                )}
                {company.employee_count && (
                  <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                    <Users className="h-3 w-3" />
                    {company.employee_count}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Badge className={`text-xs py-0 h-5 ${EMAIL_STATUS_COLORS[company.email_scrape_status] || ""}`}>
                  {company.email_scrape_status}
                </Badge>
                <Select value={company.outreach_status} onValueChange={v => onStatusChange(company.id, v)}>
                  <SelectTrigger className={`h-6 text-xs w-32 ${STATUS_COLORS[company.outreach_status] || ""}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["new", "email_found", "contacted", "responded", "converted", "not_relevant"].map(s => (
                      <SelectItem key={s} value={s} className="text-xs">{s.replace("_", " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Description */}
            {company.description && (
              <p className="text-xs text-muted-foreground line-clamp-2">{company.description}</p>
            )}

            {/* Industry tags */}
            {company.industry_tags && company.industry_tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {company.industry_tags.slice(0, 5).map(tag => (
                  <Badge key={tag} variant="secondary" className="text-xs py-0 h-4">{tag}</Badge>
                ))}
              </div>
            )}

            {/* Contact info row */}
            <div className="flex items-center gap-4 flex-wrap text-xs">
              {company.website_url ? (
                <a href={company.website_url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-blue-600 hover:underline">
                  <Globe className="h-3 w-3" />
                  {new URL(company.website_url).hostname.replace("www.", "")}
                  <ExternalLink className="h-3 w-3 opacity-60" />
                </a>
              ) : (
                <span className="text-muted-foreground flex items-center gap-1">
                  <Globe className="h-3 w-3 opacity-40" />
                  No website
                </span>
              )}

              {company.phone && (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Phone className="h-3 w-3" />
                  {company.phone}
                </span>
              )}

              {allEmails.length > 0 ? (
                <span className="flex items-center gap-1 text-green-700">
                  <Mail className="h-3 w-3" />
                  {allEmails.slice(0, 2).join(", ")}
                  {allEmails.length > 2 && <span className="text-muted-foreground">+{allEmails.length - 2}</span>}
                </span>
              ) : (
                <span className="text-muted-foreground flex items-center gap-1">
                  <Mail className="h-3 w-3 opacity-40" />
                  No emails
                </span>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 pt-0.5">
              {company.website_url && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-xs gap-1"
                  onClick={() => onEnrichEmails(company)}
                  disabled={enriching || company.email_scrape_status === "scraped"}
                >
                  {enriching ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mail className="h-3 w-3" />}
                  {company.email_scrape_status === "scraped" ? "Emails found" : "Find Emails"}
                </Button>
              )}

              <a
                href={company.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="h-3 w-3" />
                View Profile
              </a>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
