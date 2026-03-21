import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, AlertCircle, Wifi, Clock, BarChart2, Target } from "lucide-react";
import type { LeadStats } from "@/types/leads";

interface LeadStatsBarProps {
  stats: LeadStats | null;
  loading?: boolean;
}

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color?: string;
  sublabel?: string;
}

function StatCard({ label, value, icon, color = "text-brand-primary", sublabel }: StatCardProps) {
  return (
    <Card className="flex-1 min-w-32">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</span>
          <div className={`${color}`}>{icon}</div>
        </div>
        <div className="text-2xl font-bold">{value}</div>
        {sublabel && <div className="text-xs text-muted-foreground mt-0.5">{sublabel}</div>}
      </CardContent>
    </Card>
  );
}

export default function LeadStatsBar({ stats, loading }: LeadStatsBarProps) {
  if (loading || !stats) {
    return (
      <div className="flex gap-3 flex-wrap">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="flex-1 min-w-32">
            <CardContent className="p-4">
              <div className="h-4 w-20 bg-gray-200 animate-pulse rounded mb-2" />
              <div className="h-7 w-12 bg-gray-200 animate-pulse rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const highCount = stats.by_score?.["high"] || 0;
  const sourcesActive = Object.keys(stats.by_source || {}).length;
  const weekTotal = stats.period_total || 0;
  const converted = stats.by_status?.["converted"] || 0;

  // Calculate trend (compare today vs yesterday approximately)
  const dailyEntries = Object.entries(stats.daily_volume || {}).sort();
  const todayCount = stats.today || 0;
  const yesterdayCount = dailyEntries.length >= 2 ? dailyEntries[dailyEntries.length - 2]?.[1] || 0 : 0;
  const trend = yesterdayCount > 0 ? Math.round(((todayCount - yesterdayCount) / yesterdayCount) * 100) : 0;

  return (
    <div className="flex gap-3 flex-wrap">
      <StatCard
        label="Leads Today"
        value={todayCount}
        icon={<TrendingUp className="h-4 w-4" />}
        sublabel={trend !== 0 ? `${trend > 0 ? "+" : ""}${trend}% vs yesterday` : "Same as yesterday"}
      />
      <StatCard
        label="High Intent"
        value={highCount}
        icon={<AlertCircle className="h-4 w-4" />}
        color="text-red-500"
        sublabel="Needs attention"
      />
      <StatCard
        label="Sources Active"
        value={sourcesActive}
        icon={<Wifi className="h-4 w-4" />}
        color="text-green-500"
        sublabel="Scanning now"
      />
      <StatCard
        label="This Period"
        value={weekTotal}
        icon={<BarChart2 className="h-4 w-4" />}
        sublabel={`Last ${stats.period_days} days`}
      />
      <StatCard
        label="Converted"
        value={converted}
        icon={<Target className="h-4 w-4" />}
        color="text-emerald-500"
        sublabel={`${stats.conversion_rate}% rate`}
      />
      <StatCard
        label="Total (All Time)"
        value={(stats.total_all_time || 0).toLocaleString()}
        icon={<Clock className="h-4 w-4" />}
        color="text-purple-500"
        sublabel="All leads ever"
      />
    </div>
  );
}
