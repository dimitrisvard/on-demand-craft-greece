import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Trash2, ChevronDown, ChevronUp, Clock, Wifi, WifiOff } from "lucide-react";
import type { MonitoredSubreddit } from "@/types/leads";
import { formatDistanceToNow } from "date-fns";

interface SubredditManagerProps {
  subreddits: MonitoredSubreddit[];
  onAdd: (subreddit: string, tier: number) => Promise<void>;
  onRemove: (id: number) => Promise<void>;
  onToggle: (id: number, isActive: boolean) => Promise<void>;
}

const TIER_LABELS: Record<number, { label: string; color: string; interval: string }> = {
  1: { label: "Tier 1", color: "bg-red-100 text-red-800", interval: "15min" },
  2: { label: "Tier 2", color: "bg-orange-100 text-orange-800", interval: "30min" },
  3: { label: "Tier 3", color: "bg-yellow-100 text-yellow-800", interval: "30min" },
  4: { label: "Tier 4", color: "bg-green-100 text-green-800", interval: "60min" },
  5: { label: "Tier 5", color: "bg-blue-100 text-blue-800", interval: "2hr" },
};

export default function SubredditManager({ subreddits, onAdd, onRemove, onToggle }: SubredditManagerProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [newSubreddit, setNewSubreddit] = useState("");
  const [newTier, setNewTier] = useState(3);
  const [adding, setAdding] = useState(false);

  const byTier: Record<number, MonitoredSubreddit[]> = {};
  for (const sub of subreddits) {
    if (!byTier[sub.tier]) byTier[sub.tier] = [];
    byTier[sub.tier].push(sub);
  }

  async function handleAdd() {
    if (!newSubreddit.trim()) return;
    setAdding(true);
    await onAdd(newSubreddit.trim().replace(/^r\//, ""), newTier);
    setNewSubreddit("");
    setAdding(false);
  }

  const activeCount = subreddits.filter((s) => s.is_active).length;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">
            Monitored Subreddits
            <Badge variant="outline" className="ml-2 text-xs">
              {activeCount} active / {subreddits.length} total
            </Badge>
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>

      {!collapsed && (
        <CardContent className="space-y-4">
          {/* Add subreddit */}
          <div className="flex gap-2 flex-wrap">
            <Input
              placeholder="subreddit name (without r/)"
              value={newSubreddit}
              onChange={(e) => setNewSubreddit(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              className="flex-1 min-w-48 h-8 text-sm"
            />
            <Select value={String(newTier)} onValueChange={(v) => setNewTier(parseInt(v))}>
              <SelectTrigger className="w-32 h-8 text-sm">
                <SelectValue placeholder="Tier" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(TIER_LABELS).map(([tier, { label, interval }]) => (
                  <SelectItem key={tier} value={tier}>
                    {label} ({interval})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={handleAdd} disabled={adding || !newSubreddit.trim()} className="h-8">
              <Plus className="h-3 w-3 mr-1" />
              Add
            </Button>
          </div>

          {/* Subreddits by tier */}
          <div className="space-y-3 max-h-80 overflow-y-auto">
            {[1, 2, 3, 4, 5].map((tier) => {
              const tierSubs = byTier[tier] || [];
              if (tierSubs.length === 0) return null;
              const tierConfig = TIER_LABELS[tier];

              return (
                <div key={tier}>
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1">
                    <Badge className={`text-xs ${tierConfig.color}`}>
                      {tierConfig.label}
                    </Badge>
                    <span>— every {tierConfig.interval} — {tierSubs.length} subs</span>
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                    {tierSubs.map((sub) => (
                      <div
                        key={sub.id}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded border text-xs ${
                          sub.is_active
                            ? "bg-white border-gray-200"
                            : "bg-gray-50 border-gray-100 opacity-60"
                        }`}
                      >
                        <Switch
                          checked={sub.is_active}
                          onCheckedChange={(checked) => onToggle(sub.id, checked)}
                          className="h-3 w-6 scale-75"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">r/{sub.subreddit}</div>
                          {sub.last_scanned_at && (
                            <div className="text-muted-foreground flex items-center gap-0.5">
                              <Clock className="h-2.5 w-2.5" />
                              {formatDistanceToNow(new Date(sub.last_scanned_at), { addSuffix: true })}
                            </div>
                          )}
                        </div>
                        {sub.is_active ? (
                          <Wifi className="h-3 w-3 text-green-500 flex-shrink-0" />
                        ) : (
                          <WifiOff className="h-3 w-3 text-gray-400 flex-shrink-0" />
                        )}
                        <button
                          onClick={() => onRemove(sub.id)}
                          className="text-gray-400 hover:text-red-500 flex-shrink-0"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
