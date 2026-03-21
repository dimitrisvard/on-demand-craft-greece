import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import type { LeadKeyword } from "@/types/leads";

interface KeywordManagerProps {
  keywords: LeadKeyword[];
  onAdd: (keyword: string, category: string, weight: number) => Promise<void>;
  onRemove: (id: number) => Promise<void>;
  onToggle: (id: number, isActive: boolean) => Promise<void>;
}

const CATEGORIES = [
  { value: "sourcing_intent", label: "Sourcing Intent" },
  { value: "competitor_mentions", label: "Competitor Mentions" },
  { value: "competitor_complaints", label: "Competitor Complaints" },
  { value: "material_specific", label: "Material Specific" },
  { value: "competition_teams", label: "Competition Teams" },
  { value: "geographic_europe", label: "Geographic (Europe)" },
];

const CATEGORY_COLORS: Record<string, string> = {
  sourcing_intent: "bg-blue-100 text-blue-800",
  competitor_mentions: "bg-orange-100 text-orange-800",
  competitor_complaints: "bg-red-100 text-red-800",
  material_specific: "bg-purple-100 text-purple-800",
  competition_teams: "bg-green-100 text-green-800",
  geographic_europe: "bg-teal-100 text-teal-800",
};

export default function KeywordManager({ keywords, onAdd, onRemove, onToggle }: KeywordManagerProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [newKeyword, setNewKeyword] = useState("");
  const [newCategory, setNewCategory] = useState("sourcing_intent");
  const [newWeight, setNewWeight] = useState(2);
  const [adding, setAdding] = useState(false);

  const byCategory: Record<string, LeadKeyword[]> = {};
  for (const kw of keywords) {
    if (!byCategory[kw.category]) byCategory[kw.category] = [];
    byCategory[kw.category].push(kw);
  }

  async function handleAdd() {
    if (!newKeyword.trim()) return;
    setAdding(true);
    await onAdd(newKeyword.trim(), newCategory, newWeight);
    setNewKeyword("");
    setAdding(false);
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">
            Keyword Management
            <Badge variant="outline" className="ml-2 text-xs">
              {keywords.filter((k) => k.is_active).length} active / {keywords.length} total
            </Badge>
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>

      {!collapsed && (
        <CardContent className="space-y-4">
          {/* Add keyword form */}
          <div className="flex gap-2 flex-wrap">
            <Input
              placeholder="New keyword..."
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              className="flex-1 min-w-48 h-8 text-sm"
            />
            <Select value={newCategory} onValueChange={setNewCategory}>
              <SelectTrigger className="w-44 h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((cat) => (
                  <SelectItem key={cat.value} value={cat.value}>
                    {cat.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={String(newWeight)} onValueChange={(v) => setNewWeight(parseInt(v))}>
              <SelectTrigger className="w-24 h-8 text-sm">
                <SelectValue placeholder="Weight" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Weight 1</SelectItem>
                <SelectItem value="2">Weight 2</SelectItem>
                <SelectItem value="3">Weight 3</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" onClick={handleAdd} disabled={adding || !newKeyword.trim()} className="h-8">
              <Plus className="h-3 w-3 mr-1" />
              Add
            </Button>
          </div>

          {/* Keywords by category */}
          <div className="space-y-3 max-h-80 overflow-y-auto">
            {CATEGORIES.map(({ value: cat, label }) => {
              const catKeywords = byCategory[cat] || [];
              if (catKeywords.length === 0) return null;

              return (
                <div key={cat}>
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                    {label} ({catKeywords.length})
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {catKeywords.map((kw) => (
                      <div
                        key={kw.id}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs border ${
                          kw.is_active ? CATEGORY_COLORS[cat] || "bg-gray-100" : "bg-gray-50 text-gray-400 border-gray-200"
                        }`}
                      >
                        <Switch
                          checked={kw.is_active}
                          onCheckedChange={(checked) => onToggle(kw.id, checked)}
                          className="h-3 w-6 scale-75"
                        />
                        <span>{kw.keyword}</span>
                        <span className="opacity-60">w{kw.weight}</span>
                        {kw.match_count > 0 && (
                          <span className="opacity-60">·{kw.match_count}</span>
                        )}
                        <button
                          onClick={() => onRemove(kw.id)}
                          className="ml-0.5 text-current opacity-50 hover:opacity-100"
                        >
                          <Trash2 className="h-2.5 w-2.5" />
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
