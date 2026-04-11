import React, { useState, useMemo, useCallback } from 'react';
import PersistentDashboardLayout from '@/components/dashboard/PersistentDashboardLayout';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import {
  RefreshCw,
  Search,
  Globe,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  Plus,
  Trash2,
  Loader2,
  ArrowUpDown,
} from 'lucide-react';
import { SUPPORTED_LANGUAGES } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { Navigate } from 'react-router-dom';

// ----- helpers --------------------------------------------------------------

function todayIso(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  // GSC data lags ~2 days, callers should default startDate to 28 days + 3 lag
  return d.toISOString().split('T')[0];
}

async function apiFetch<T = any>(path: string, init?: RequestInit): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('Not signed in');
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `${res.status}`);
  }
  return res.json();
}

function formatNumber(n: number | undefined): string {
  if (n === undefined || n === null) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return Math.round(n).toString();
}

function pct(n: number | undefined, digits = 1): string {
  if (n === undefined || n === null) return '—';
  return (n * 100).toFixed(digits) + '%';
}

function delta(current: number, previous: number): number {
  if (!previous) return 0;
  return (current - previous) / previous;
}

// ----- date range ----------------------------------------------------------

type RangePreset = '7d' | '28d' | '90d';

function rangeDates(preset: RangePreset): { startDate: string; endDate: string } {
  // GSC data has ~2 day lag — shift end date back 3 days.
  const endOffset = 3;
  const lookback = preset === '7d' ? 7 : preset === '28d' ? 28 : 90;
  return {
    startDate: todayIso(endOffset + lookback),
    endDate: todayIso(endOffset),
  };
}

function prevRangeDates(preset: RangePreset): { startDate: string; endDate: string } {
  const endOffset = 3;
  const lookback = preset === '7d' ? 7 : preset === '28d' ? 28 : 90;
  return {
    startDate: todayIso(endOffset + lookback * 2),
    endDate: todayIso(endOffset + lookback),
  };
}

// ----- types ---------------------------------------------------------------

interface GscRow {
  keys?: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface MonitoredUrl {
  id: number;
  url: string;
  label: string | null;
  language: string | null;
  service_type: string | null;
  priority: number;
}

interface InspectionCacheRow {
  url: string;
  indexing_state: string | null;
  coverage_state: string | null;
  last_crawl_time: string | null;
  canonical_google: string | null;
  inspected_at: string;
}

// ===========================================================================
// OVERVIEW TAB
// ===========================================================================

function OverviewTab({ preset }: { preset: RangePreset }) {
  const range = useMemo(() => rangeDates(preset), [preset]);
  const prev = useMemo(() => prevRangeDates(preset), [preset]);

  const current = useQuery({
    queryKey: ['gsc-overview-current', range],
    queryFn: () =>
      apiFetch<{ rows?: GscRow[] }>('/api/gsc/search-analytics', {
        method: 'POST',
        body: JSON.stringify({
          startDate: range.startDate,
          endDate: range.endDate,
          dimensions: ['date'],
          rowLimit: 500,
        }),
      }),
  });

  const totals = useQuery({
    queryKey: ['gsc-overview-totals', range],
    queryFn: () =>
      apiFetch<{ rows?: GscRow[] }>('/api/gsc/search-analytics', {
        method: 'POST',
        body: JSON.stringify({
          startDate: range.startDate,
          endDate: range.endDate,
          dimensions: [],
          rowLimit: 1,
        }),
      }),
  });

  const prevTotals = useQuery({
    queryKey: ['gsc-overview-prev-totals', prev],
    queryFn: () =>
      apiFetch<{ rows?: GscRow[] }>('/api/gsc/search-analytics', {
        method: 'POST',
        body: JSON.stringify({
          startDate: prev.startDate,
          endDate: prev.endDate,
          dimensions: [],
          rowLimit: 1,
        }),
      }),
  });

  const cur = totals.data?.rows?.[0];
  const prv = prevTotals.data?.rows?.[0];
  const isLoading = current.isLoading || totals.isLoading || prevTotals.isLoading;
  const error = current.error || totals.error || prevTotals.error;

  const chartData = useMemo(() => {
    if (!current.data?.rows) return [];
    return current.data.rows.map((r) => ({
      date: r.keys?.[0] || '',
      clicks: r.clicks,
      impressions: r.impressions,
    }));
  }, [current.data]);

  if (error) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-red-600 flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          Failed to load GSC data: {(error as Error).message}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <StatCard label="Clicks" current={cur?.clicks} previous={prv?.clicks} loading={isLoading} />
        <StatCard
          label="Impressions"
          current={cur?.impressions}
          previous={prv?.impressions}
          loading={isLoading}
        />
        <StatCard
          label="CTR"
          current={cur?.ctr}
          previous={prv?.ctr}
          loading={isLoading}
          formatter={pct}
        />
        <StatCard
          label="Avg position"
          current={cur?.position}
          previous={prv?.position}
          loading={isLoading}
          formatter={(n) => (n === undefined ? '—' : n.toFixed(1))}
          lowerIsBetter
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Clicks & Impressions over time</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-[300px] w-full" />
          ) : chartData.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No data for this period.</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line yAxisId="left" type="monotone" dataKey="clicks" stroke="#1F4690" strokeWidth={2} />
                <Line yAxisId="right" type="monotone" dataKey="impressions" stroke="#f59e0b" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  label,
  current,
  previous,
  loading,
  formatter = formatNumber,
  lowerIsBetter = false,
}: {
  label: string;
  current?: number;
  previous?: number;
  loading: boolean;
  formatter?: (n?: number) => string;
  lowerIsBetter?: boolean;
}) {
  const d = current !== undefined && previous !== undefined ? delta(current, previous) : 0;
  const up = d > 0;
  const good = lowerIsBetter ? !up : up;
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        {loading ? (
          <Skeleton className="h-8 w-24 mt-1" />
        ) : (
          <>
            <div className="text-2xl font-semibold">{formatter(current)}</div>
            {previous !== undefined && previous !== 0 && (
              <div
                className={`text-xs flex items-center gap-1 mt-1 ${
                  good ? 'text-emerald-600' : 'text-red-600'
                }`}
              >
                {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {(d * 100).toFixed(1)}% vs prev
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ===========================================================================
// TOP QUERIES TAB
// ===========================================================================

function TopQueriesTab({ preset }: { preset: RangePreset }) {
  const range = useMemo(() => rangeDates(preset), [preset]);
  const [sortKey, setSortKey] = useState<'clicks' | 'impressions' | 'ctr' | 'position'>('clicks');
  const [filter, setFilter] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['gsc-queries', range],
    queryFn: () =>
      apiFetch<{ rows?: GscRow[] }>('/api/gsc/search-analytics', {
        method: 'POST',
        body: JSON.stringify({
          startDate: range.startDate,
          endDate: range.endDate,
          dimensions: ['query'],
          rowLimit: 500,
        }),
      }),
  });

  const rows = useMemo(() => {
    const src = data?.rows || [];
    const filtered = filter
      ? src.filter((r) => r.keys?.[0]?.toLowerCase().includes(filter.toLowerCase()))
      : src;
    const sorted = [...filtered].sort((a, b) => {
      if (sortKey === 'position') return a.position - b.position;
      return (b as any)[sortKey] - (a as any)[sortKey];
    });
    return sorted.slice(0, 100);
  }, [data, sortKey, filter]);

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm">Top queries (last {preset})</CardTitle>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-8 w-48"
          />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-[400px] w-full" />
        ) : error ? (
          <p className="text-sm text-red-600">{(error as Error).message}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No queries found.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Query</TableHead>
                <SortableHead sortKey="clicks" current={sortKey} setSort={setSortKey}>
                  Clicks
                </SortableHead>
                <SortableHead sortKey="impressions" current={sortKey} setSort={setSortKey}>
                  Impressions
                </SortableHead>
                <SortableHead sortKey="ctr" current={sortKey} setSort={setSortKey}>
                  CTR
                </SortableHead>
                <SortableHead sortKey="position" current={sortKey} setSort={setSortKey}>
                  Position
                </SortableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.keys?.[0]}>
                  <TableCell className="max-w-md truncate">{r.keys?.[0]}</TableCell>
                  <TableCell>{formatNumber(r.clicks)}</TableCell>
                  <TableCell>{formatNumber(r.impressions)}</TableCell>
                  <TableCell>{pct(r.ctr)}</TableCell>
                  <TableCell>{r.position?.toFixed(1)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function SortableHead({
  sortKey,
  current,
  setSort,
  children,
}: {
  sortKey: any;
  current: any;
  setSort: (k: any) => void;
  children: React.ReactNode;
}) {
  return (
    <TableHead>
      <button
        className={`flex items-center gap-1 ${current === sortKey ? 'font-semibold' : ''}`}
        onClick={() => setSort(sortKey)}
      >
        {children}
        <ArrowUpDown className="h-3 w-3 opacity-50" />
      </button>
    </TableHead>
  );
}

// ===========================================================================
// TOP PAGES TAB — grouped by language prefix
// ===========================================================================

function TopPagesTab({ preset }: { preset: RangePreset }) {
  const range = useMemo(() => rangeDates(preset), [preset]);
  const [languageFilter, setLanguageFilter] = useState<string>('all');

  const { data, isLoading, error } = useQuery({
    queryKey: ['gsc-pages', range],
    queryFn: () =>
      apiFetch<{ rows?: GscRow[] }>('/api/gsc/search-analytics', {
        method: 'POST',
        body: JSON.stringify({
          startDate: range.startDate,
          endDate: range.endDate,
          dimensions: ['page'],
          rowLimit: 500,
        }),
      }),
  });

  const rows = useMemo(() => {
    const src = data?.rows || [];
    if (languageFilter === 'all') return src.slice(0, 100);
    return src
      .filter((r) => {
        const url = r.keys?.[0] || '';
        try {
          const path = new URL(url).pathname;
          return path.startsWith(`/${languageFilter}/`) || path === `/${languageFilter}`;
        } catch {
          return false;
        }
      })
      .slice(0, 100);
  }, [data, languageFilter]);

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm">Top pages (last {preset})</CardTitle>
        <Select value={languageFilter} onValueChange={setLanguageFilter}>
          <SelectTrigger className="h-8 w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All languages</SelectItem>
            {Object.entries(SUPPORTED_LANGUAGES).map(([code, info]) => (
              <SelectItem key={code} value={code}>
                {info.name} ({code})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-[400px] w-full" />
        ) : error ? (
          <p className="text-sm text-red-600">{(error as Error).message}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No pages found.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Page</TableHead>
                <TableHead>Clicks</TableHead>
                <TableHead>Impressions</TableHead>
                <TableHead>CTR</TableHead>
                <TableHead>Position</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const url = r.keys?.[0] || '';
                let path = url;
                try {
                  path = new URL(url).pathname;
                } catch {
                  /* noop */
                }
                return (
                  <TableRow key={url}>
                    <TableCell className="max-w-md truncate font-mono text-xs" title={url}>
                      {path}
                    </TableCell>
                    <TableCell>{formatNumber(r.clicks)}</TableCell>
                    <TableCell>{formatNumber(r.impressions)}</TableCell>
                    <TableCell>{pct(r.ctr)}</TableCell>
                    <TableCell>{r.position?.toFixed(1)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ===========================================================================
// COUNTRIES TAB
// ===========================================================================

const TARGET_COUNTRIES = ['gbr', 'deu', 'fra', 'esp', 'ita', 'nld', 'pol', 'prt', 'swe', 'dnk', 'fin', 'nor', 'hun', 'cze'];

function CountriesTab({ preset }: { preset: RangePreset }) {
  const range = useMemo(() => rangeDates(preset), [preset]);
  const { data, isLoading, error } = useQuery({
    queryKey: ['gsc-countries', range],
    queryFn: () =>
      apiFetch<{ rows?: GscRow[] }>('/api/gsc/search-analytics', {
        method: 'POST',
        body: JSON.stringify({
          startDate: range.startDate,
          endDate: range.endDate,
          dimensions: ['country'],
          rowLimit: 300,
        }),
      }),
  });

  const rows = data?.rows || [];
  const chartData = useMemo(
    () =>
      rows
        .filter((r) => TARGET_COUNTRIES.includes(r.keys?.[0] || ''))
        .slice(0, 14)
        .map((r) => ({ country: (r.keys?.[0] || '').toUpperCase(), clicks: r.clicks })),
    [rows],
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Clicks by target country</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-[300px] w-full" />
          ) : error ? (
            <p className="text-sm text-red-600">{(error as Error).message}</p>
          ) : chartData.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No country data.</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="country" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="clicks" fill="#1F4690" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">All countries</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Country</TableHead>
                <TableHead>Clicks</TableHead>
                <TableHead>Impressions</TableHead>
                <TableHead>CTR</TableHead>
                <TableHead>Position</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.slice(0, 50).map((r) => (
                <TableRow key={r.keys?.[0]}>
                  <TableCell className="uppercase">{r.keys?.[0]}</TableCell>
                  <TableCell>{formatNumber(r.clicks)}</TableCell>
                  <TableCell>{formatNumber(r.impressions)}</TableCell>
                  <TableCell>{pct(r.ctr)}</TableCell>
                  <TableCell>{r.position?.toFixed(1)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ===========================================================================
// INDEX STATUS TAB — monitored URLs + inspection cache + request indexing
// ===========================================================================

function IndexStatusTab() {
  const qc = useQueryClient();
  const [newUrl, setNewUrl] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // The gsc_* tables are not yet in src/integrations/supabase/types.ts
  // (regenerate those types to remove the `any` cast below).
  const monitored = useQuery({
    queryKey: ['gsc-monitored'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('gsc_monitored_urls')
        .select('*')
        .order('priority', { ascending: false });
      if (error) throw new Error(error.message);
      return ((data || []) as unknown) as MonitoredUrl[];
    },
  });

  const cache = useQuery({
    queryKey: ['gsc-inspection-cache'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('gsc_inspection_cache')
        .select('url, indexing_state, coverage_state, last_crawl_time, canonical_google, inspected_at');
      if (error) throw new Error(error.message);
      const map = new Map<string, InspectionCacheRow>();
      (data || []).forEach((r: any) => map.set(r.url, r));
      return map;
    },
  });

  const quota = useQuery({
    queryKey: ['gsc-quota'],
    queryFn: () => apiFetch<{ used: number; limit: number }>('/api/gsc/submit-indexing'),
    refetchInterval: 60_000,
  });

  const addUrl = useMutation({
    mutationFn: (payload: Partial<MonitoredUrl>) =>
      apiFetch('/api/gsc/monitored-urls', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      toast.success('URL added');
      setNewUrl('');
      qc.invalidateQueries({ queryKey: ['gsc-monitored'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteUrl = useMutation({
    mutationFn: (id: number) =>
      apiFetch('/api/gsc/monitored-urls', {
        method: 'DELETE',
        body: JSON.stringify({ id }),
      }),
    onSuccess: () => {
      toast.success('URL removed');
      qc.invalidateQueries({ queryKey: ['gsc-monitored'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const inspectOne = useMutation({
    mutationFn: (url: string) =>
      apiFetch('/api/gsc/inspect-url', { method: 'POST', body: JSON.stringify({ url }) }),
    onSuccess: () => {
      toast.success('Inspected');
      qc.invalidateQueries({ queryKey: ['gsc-inspection-cache'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);

  const inspectAll = useCallback(async () => {
    const urls = monitored.data?.map((m) => m.url) || [];
    if (urls.length === 0) return;
    setBulkProgress({ done: 0, total: urls.length });
    try {
      // chunk 50
      for (let i = 0; i < urls.length; i += 50) {
        const chunk = urls.slice(i, i + 50);
        await apiFetch('/api/gsc/bulk-inspect', {
          method: 'POST',
          body: JSON.stringify({ urls: chunk }),
        });
        setBulkProgress({ done: Math.min(i + 50, urls.length), total: urls.length });
      }
      toast.success('All URLs inspected');
      qc.invalidateQueries({ queryKey: ['gsc-inspection-cache'] });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBulkProgress(null);
    }
  }, [monitored.data, qc]);

  const requestIndexing = useMutation({
    mutationFn: (urls: string[]) =>
      apiFetch('/api/gsc/submit-indexing', {
        method: 'POST',
        body: JSON.stringify({ urls, type: 'URL_UPDATED' }),
      }),
    onSuccess: (res: any) => {
      const ok = res.results?.filter((r: any) => r.status === 'success').length || 0;
      const skipped = res.results?.filter((r: any) => r.status === 'skipped_quota').length || 0;
      toast.success(`Submitted: ${ok} · Skipped (quota): ${skipped}`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['gsc-quota'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleSelect = (url: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Indexing quota today</div>
            <div className="text-2xl font-semibold">
              {quota.data ? `${quota.data.used} / ${quota.data.limit}` : '—'}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Monitored URLs</div>
            <div className="text-2xl font-semibold">{monitored.data?.length || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Indexed (cached)</div>
            <div className="text-2xl font-semibold">
              {cache.data
                ? [...cache.data.values()].filter((r) => r.indexing_state === 'PASS').length
                : 0}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">Monitored URLs</CardTitle>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={inspectAll} disabled={!!bulkProgress}>
              {bulkProgress ? (
                <>
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  {bulkProgress.done}/{bulkProgress.total}
                </>
              ) : (
                <>
                  <Search className="h-3 w-3 mr-1" />
                  Inspect all
                </>
              )}
            </Button>
            <Button
              size="sm"
              disabled={selected.size === 0 || requestIndexing.isPending}
              onClick={() => requestIndexing.mutate([...selected])}
            >
              {requestIndexing.isPending ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3 mr-1" />
              )}
              Request indexing ({selected.size})
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 mb-3">
            <Input
              placeholder="https://www.micronshub.eu/en/services/cnc-machining"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              className="h-8"
            />
            <Button
              size="sm"
              onClick={() =>
                newUrl && addUrl.mutate({ url: newUrl, priority: 5 })
              }
              disabled={!newUrl || addUrl.isPending}
            >
              <Plus className="h-3 w-3 mr-1" />
              Add
            </Button>
          </div>
          {monitored.isLoading ? (
            <Skeleton className="h-[300px] w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>Lang</TableHead>
                  <TableHead>Index state</TableHead>
                  <TableHead>Last crawl</TableHead>
                  <TableHead className="w-[140px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(monitored.data || []).map((m) => {
                  const c = cache.data?.get(m.url);
                  return (
                    <TableRow key={m.id}>
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={selected.has(m.url)}
                          onChange={() => toggleSelect(m.url)}
                        />
                      </TableCell>
                      <TableCell className="max-w-sm truncate font-mono text-xs" title={m.url}>
                        {m.url.replace('https://www.micronshub.eu', '')}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="uppercase">
                          {m.language || '—'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {c?.indexing_state ? (
                          <Badge
                            variant={c.indexing_state === 'PASS' ? 'default' : 'destructive'}
                          >
                            {c.indexing_state}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {c?.last_crawl_time
                          ? new Date(c.last_crawl_time).toLocaleDateString()
                          : '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => inspectOne.mutate(m.url)}
                            disabled={inspectOne.isPending}
                          >
                            <Search className="h-3 w-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => deleteUrl.mutate(m.id)}
                          >
                            <Trash2 className="h-3 w-3 text-red-500" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ===========================================================================
// SITEMAPS TAB
// ===========================================================================

function SitemapsTab() {
  const qc = useQueryClient();
  const [feedpath, setFeedpath] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['gsc-sitemaps'],
    queryFn: () => apiFetch<{ sitemaps: any[] }>('/api/gsc/sitemaps'),
  });

  const submit = useMutation({
    mutationFn: (fp: string) =>
      apiFetch('/api/gsc/sitemaps', { method: 'POST', body: JSON.stringify({ feedpath: fp }) }),
    onSuccess: () => {
      toast.success('Sitemap submitted');
      setFeedpath('');
      qc.invalidateQueries({ queryKey: ['gsc-sitemaps'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: (fp: string) =>
      apiFetch('/api/gsc/sitemaps', { method: 'DELETE', body: JSON.stringify({ feedpath: fp }) }),
    onSuccess: () => {
      toast.success('Sitemap removed');
      qc.invalidateQueries({ queryKey: ['gsc-sitemaps'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Sitemaps</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2 mb-3">
          <Input
            placeholder="https://www.micronshub.eu/sitemap.xml"
            value={feedpath}
            onChange={(e) => setFeedpath(e.target.value)}
            className="h-8"
          />
          <Button size="sm" onClick={() => feedpath && submit.mutate(feedpath)} disabled={!feedpath || submit.isPending}>
            <Plus className="h-3 w-3 mr-1" />
            Submit
          </Button>
        </div>
        {isLoading ? (
          <Skeleton className="h-[200px] w-full" />
        ) : error ? (
          <p className="text-sm text-red-600">{(error as Error).message}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Path</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Last submitted</TableHead>
                <TableHead>Errors</TableHead>
                <TableHead>Warnings</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.sitemaps || []).map((s: any) => (
                <TableRow key={s.path}>
                  <TableCell className="max-w-md truncate font-mono text-xs">{s.path}</TableCell>
                  <TableCell>{s.type || 'sitemap'}</TableCell>
                  <TableCell className="text-xs">
                    {s.lastSubmitted ? new Date(s.lastSubmitted).toLocaleDateString() : '—'}
                  </TableCell>
                  <TableCell>{s.errors || 0}</TableCell>
                  <TableCell>{s.warnings || 0}</TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => remove.mutate(s.path)}
                    >
                      <Trash2 className="h-3 w-3 text-red-500" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ===========================================================================
// MAIN PAGE
// ===========================================================================

export default function SeoConsolePage() {
  const { user, loading, isAdmin } = useAuth();
  const [preset, setPreset] = useState<RangePreset>('28d');

  if (loading) {
    return (
      <PersistentDashboardLayout>
        <div className="p-6">
          <Skeleton className="h-8 w-64 mb-4" />
          <Skeleton className="h-[400px] w-full" />
        </div>
      </PersistentDashboardLayout>
    );
  }
  if (!user || !isAdmin()) {
    return <Navigate to="/login" replace />;
  }

  return (
    <PersistentDashboardLayout>
      <div className="p-4 md:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <Globe className="h-6 w-6" />
              SEO Console
            </h1>
            <p className="text-sm text-muted-foreground">
              Google Search Console dashboard for micronshub.eu
            </p>
          </div>
          <Select value={preset} onValueChange={(v) => setPreset(v as RangePreset)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="28d">Last 28 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="queries">Top queries</TabsTrigger>
            <TabsTrigger value="pages">Top pages</TabsTrigger>
            <TabsTrigger value="countries">Countries</TabsTrigger>
            <TabsTrigger value="index">Index status</TabsTrigger>
            <TabsTrigger value="sitemaps">Sitemaps</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="mt-4">
            <OverviewTab preset={preset} />
          </TabsContent>
          <TabsContent value="queries" className="mt-4">
            <TopQueriesTab preset={preset} />
          </TabsContent>
          <TabsContent value="pages" className="mt-4">
            <TopPagesTab preset={preset} />
          </TabsContent>
          <TabsContent value="countries" className="mt-4">
            <CountriesTab preset={preset} />
          </TabsContent>
          <TabsContent value="index" className="mt-4">
            <IndexStatusTab />
          </TabsContent>
          <TabsContent value="sitemaps" className="mt-4">
            <SitemapsTab />
          </TabsContent>
        </Tabs>
      </div>
    </PersistentDashboardLayout>
  );
}
