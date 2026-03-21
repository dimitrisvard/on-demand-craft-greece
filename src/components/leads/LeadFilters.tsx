import React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, X } from "lucide-react";
import type { LeadFilters } from "@/types/leads";

interface LeadFiltersProps {
  filters: LeadFilters;
  onChange: (filters: LeadFilters) => void;
}

const DAYS_OPTIONS = [
  { value: 1, label: "Today" },
  { value: 7, label: "Last 7 days" },
  { value: 30, label: "Last 30 days" },
  { value: 90, label: "Last 90 days" },
  { value: 0, label: "All time" },
];

const INDUSTRIES = [
  "aerospace", "automotive", "medical", "robotics", "electronics",
  "energy", "consumer_goods", "machine_building", "engineering",
  "education", "defense", "marine", "food_packaging", "oil_gas",
];

export default function LeadFiltersPanel({ filters, onChange }: LeadFiltersProps) {
  function update(partial: Partial<LeadFilters>) {
    onChange({ ...filters, ...partial });
  }

  function reset() {
    onChange({ source: "all", score: "all", status: "all", industry: "", search: "", days_back: 7 });
  }

  const hasActiveFilters =
    filters.source !== "all" ||
    filters.score !== "all" ||
    filters.status !== "all" ||
    filters.industry !== "" ||
    filters.search !== "" ||
    filters.days_back !== 7;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Search */}
      <div className="relative flex-1 min-w-48">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search leads..."
          value={filters.search}
          onChange={(e) => update({ search: e.target.value })}
          className="pl-9 h-9 text-sm"
        />
      </div>

      {/* Source */}
      <Select value={filters.source} onValueChange={(v) => update({ source: v })}>
        <SelectTrigger className="w-36 h-9 text-sm">
          <SelectValue placeholder="Source" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Sources</SelectItem>
          <SelectItem value="reddit">Reddit</SelectItem>
          <SelectItem value="hackernews">Hacker News</SelectItem>
          <SelectItem value="twitter">Twitter/X</SelectItem>
          <SelectItem value="forum">Forums</SelectItem>
        </SelectContent>
      </Select>

      {/* Score */}
      <Select value={filters.score} onValueChange={(v) => update({ score: v })}>
        <SelectTrigger className="w-36 h-9 text-sm">
          <SelectValue placeholder="Score" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Scores</SelectItem>
          <SelectItem value="high">🔴 High</SelectItem>
          <SelectItem value="medium">🟡 Medium</SelectItem>
          <SelectItem value="low">🟢 Low</SelectItem>
          <SelectItem value="unscored">Unscored</SelectItem>
        </SelectContent>
      </Select>

      {/* Status */}
      <Select value={filters.status} onValueChange={(v) => update({ status: v })}>
        <SelectTrigger className="w-36 h-9 text-sm">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Statuses</SelectItem>
          <SelectItem value="new">New</SelectItem>
          <SelectItem value="reviewed">Reviewed</SelectItem>
          <SelectItem value="contacted">Contacted</SelectItem>
          <SelectItem value="saved">Saved</SelectItem>
          <SelectItem value="dismissed">Dismissed</SelectItem>
          <SelectItem value="converted">Converted</SelectItem>
        </SelectContent>
      </Select>

      {/* Industry */}
      <Select value={filters.industry || "all"} onValueChange={(v) => update({ industry: v === "all" ? "" : v })}>
        <SelectTrigger className="w-40 h-9 text-sm">
          <SelectValue placeholder="Industry" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Industries</SelectItem>
          {INDUSTRIES.map((ind) => (
            <SelectItem key={ind} value={ind}>
              {ind.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Time range */}
      <Select value={String(filters.days_back)} onValueChange={(v) => update({ days_back: parseInt(v) })}>
        <SelectTrigger className="w-36 h-9 text-sm">
          <SelectValue placeholder="Time range" />
        </SelectTrigger>
        <SelectContent>
          {DAYS_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={String(opt.value)}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Reset */}
      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={reset} className="h-9 px-2 text-muted-foreground">
          <X className="h-4 w-4 mr-1" />
          Reset
        </Button>
      )}
    </div>
  );
}
