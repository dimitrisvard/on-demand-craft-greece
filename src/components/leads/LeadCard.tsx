import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  ExternalLink,
  MessageSquare,
  ThumbsUp,
  Clock,
  ChevronDown,
  ChevronUp,
  Bookmark,
  CheckCircle,
  XCircle,
  Eye,
  Send,
  StickyNote,
} from "lucide-react";
import type { Lead } from "@/types/leads";
import { formatDistanceToNow } from "date-fns";

interface LeadCardProps {
  lead: Lead;
  onUpdate: (id: string, updates: Partial<Lead>) => Promise<void>;
}

const SOURCE_LABELS: Record<string, string> = {
  reddit: "Reddit",
  hackernews: "HN",
  twitter: "Twitter",
  forum: "Forum",
};

const SOURCE_COLORS: Record<string, string> = {
  reddit: "bg-orange-100 text-orange-800 border-orange-200",
  hackernews: "bg-yellow-100 text-yellow-800 border-yellow-200",
  twitter: "bg-sky-100 text-sky-800 border-sky-200",
  forum: "bg-purple-100 text-purple-800 border-purple-200",
};

const SCORE_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  high: { label: "High", color: "bg-red-100 text-red-700 border-red-200", dot: "bg-red-500" },
  medium: { label: "Medium", color: "bg-yellow-100 text-yellow-700 border-yellow-200", dot: "bg-yellow-500" },
  low: { label: "Low", color: "bg-green-100 text-green-700 border-green-200", dot: "bg-green-500" },
  unscored: { label: "Unscored", color: "bg-gray-100 text-gray-600 border-gray-200", dot: "bg-gray-400" },
  noise: { label: "Noise", color: "bg-gray-100 text-gray-500 border-gray-200", dot: "bg-gray-300" },
};

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  new: { label: "New", color: "bg-blue-100 text-blue-700" },
  reviewed: { label: "Reviewed", color: "bg-purple-100 text-purple-700" },
  contacted: { label: "Contacted", color: "bg-green-100 text-green-700" },
  saved: { label: "Saved", color: "bg-yellow-100 text-yellow-700" },
  dismissed: { label: "Dismissed", color: "bg-gray-100 text-gray-500" },
  converted: { label: "Converted", color: "bg-emerald-100 text-emerald-700" },
};

function highlightKeywords(text: string, keywords: string[]): React.ReactNode {
  if (!keywords || keywords.length === 0) return text;
  const regex = new RegExp(`(${keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part) ? (
      <mark key={i} className="bg-yellow-200 text-yellow-900 rounded px-0.5">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

export default function LeadCard({ lead, onUpdate }: LeadCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showResponse, setShowResponse] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [responseText, setResponseText] = useState(lead.suggested_response || "");
  const [notesText, setNotesText] = useState(lead.notes || "");
  const [saving, setSaving] = useState(false);

  const effectiveScore = lead.manual_score || lead.auto_score;
  const scoreConfig = SCORE_CONFIG[effectiveScore] || SCORE_CONFIG.unscored;
  const statusConfig = STATUS_CONFIG[lead.status] || STATUS_CONFIG.new;
  const sourceConfig = SOURCE_COLORS[lead.source] || "bg-gray-100 text-gray-700";

  const timeAgo = lead.post_created_at
    ? formatDistanceToNow(new Date(lead.post_created_at), { addSuffix: true })
    : formatDistanceToNow(new Date(lead.discovered_at), { addSuffix: true });

  const excerpt = lead.body ? lead.body.slice(0, 200) : null;

  async function handleStatusChange(status: Lead["status"]) {
    setSaving(true);
    await onUpdate(lead.id, { status });
    setSaving(false);
  }

  async function handleScoreChange(score: "high" | "medium" | "low") {
    setSaving(true);
    await onUpdate(lead.id, { manual_score: score });
    setSaving(false);
  }

  async function saveResponse() {
    setSaving(true);
    await onUpdate(lead.id, { suggested_response: responseText });
    setSaving(false);
  }

  async function saveNotes() {
    setSaving(true);
    await onUpdate(lead.id, { notes: notesText });
    setSaving(false);
  }

  const resolvedUrl = lead.source_url
    || (lead.source === "reddit" && lead.source_id ? `https://reddit.com/comments/${lead.source_id}` : null)
    || (lead.source === "hackernews" && lead.source_id ? `https://news.ycombinator.com/item?id=${lead.source_id}` : null);

  const isDismissed = lead.status === "dismissed";

  return (
    <Card className={`transition-all duration-200 ${isDismissed ? "opacity-50" : "hover:shadow-md"} border`}>
      <CardContent className="p-4">
        {/* Header row */}
        <div className="flex items-start gap-3">
          {/* Score dot */}
          <div className="mt-1.5 flex-shrink-0">
            <div className={`w-2.5 h-2.5 rounded-full ${scoreConfig.dot}`} />
          </div>

          <div className="flex-1 min-w-0">
            {/* Badges row */}
            <div className="flex flex-wrap items-center gap-1.5 mb-2">
              <Badge variant="outline" className={`text-xs font-medium ${sourceConfig}`}>
                {SOURCE_LABELS[lead.source] || lead.source}
              </Badge>
              {lead.subreddit && (
                <Badge variant="outline" className="text-xs text-muted-foreground">
                  {lead.subreddit}
                </Badge>
              )}
              <Badge variant="outline" className={`text-xs font-medium ${scoreConfig.color}`}>
                {scoreConfig.label} Intent
              </Badge>
              {lead.manual_score && (
                <Badge variant="outline" className="text-xs bg-blue-50 text-blue-600 border-blue-200">
                  Manual Override
                </Badge>
              )}
              <Badge variant="outline" className={`text-xs ${statusConfig.color}`}>
                {statusConfig.label}
              </Badge>
            </div>

            {/* Title */}
            <h3 className="font-semibold text-sm leading-snug mb-1.5">
              {resolvedUrl ? (
                <a
                  href={resolvedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-brand-primary transition-colors"
                >
                  {highlightKeywords(lead.title, lead.matched_keywords || [])}
                </a>
              ) : (
                <span>{highlightKeywords(lead.title, lead.matched_keywords || [])}</span>
              )}
            </h3>

            {/* Excerpt */}
            {excerpt && (
              <p className="text-xs text-muted-foreground mb-2 leading-relaxed">
                {expanded
                  ? highlightKeywords(lead.body || "", lead.matched_keywords || [])
                  : highlightKeywords(excerpt + (lead.body && lead.body.length > 200 ? "..." : ""), lead.matched_keywords || [])}
              </p>
            )}

            {/* Metadata row */}
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground mb-2">
              {lead.author && (
                <span>
                  👤{" "}
                  {lead.author_url ? (
                    <a href={lead.author_url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                      {lead.author}
                    </a>
                  ) : (
                    lead.author
                  )}
                </span>
              )}
              <span className="flex items-center gap-1">
                <ThumbsUp className="h-3 w-3" />
                {lead.upvotes}
              </span>
              <span className="flex items-center gap-1">
                <MessageSquare className="h-3 w-3" />
                {lead.comments_count}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {timeAgo}
              </span>
            </div>

            {/* Keywords chips */}
            {lead.matched_keywords && lead.matched_keywords.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {lead.matched_keywords.slice(0, 6).map((kw) => (
                  <span
                    key={kw}
                    className="px-1.5 py-0.5 bg-yellow-50 text-yellow-800 text-xs rounded border border-yellow-200"
                  >
                    {kw}
                  </span>
                ))}
                {lead.matched_keywords.length > 6 && (
                  <span className="text-xs text-muted-foreground">+{lead.matched_keywords.length - 6} more</span>
                )}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              {/* Score buttons */}
              <div className="flex items-center gap-1 border rounded-md overflow-hidden">
                {(["high", "medium", "low"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => handleScoreChange(s)}
                    disabled={saving}
                    className={`px-2 py-0.5 text-xs transition-colors ${
                      effectiveScore === s
                        ? "bg-brand-primary text-white"
                        : "hover:bg-gray-100 text-muted-foreground"
                    }`}
                  >
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>

              {/* Status buttons */}
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-xs px-2"
                onClick={() => handleStatusChange(lead.status === "reviewed" ? "new" : "reviewed")}
                disabled={saving}
              >
                <Eye className="h-3 w-3 mr-1" />
                Review
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-xs px-2 text-green-700 border-green-300 hover:bg-green-50"
                onClick={() => handleStatusChange("contacted")}
                disabled={saving}
              >
                <CheckCircle className="h-3 w-3 mr-1" />
                Contacted
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-xs px-2 text-yellow-700 border-yellow-300 hover:bg-yellow-50"
                onClick={() => handleStatusChange("saved")}
                disabled={saving}
              >
                <Bookmark className="h-3 w-3 mr-1" />
                Save
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-xs px-2 text-gray-500 hover:bg-gray-100"
                onClick={() => handleStatusChange("dismissed")}
                disabled={saving}
              >
                <XCircle className="h-3 w-3 mr-1" />
                Dismiss
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-xs px-2 text-blue-700 border-blue-300 hover:bg-blue-50"
                onClick={() => setShowResponse(!showResponse)}
              >
                <Send className="h-3 w-3 mr-1" />
                Response
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-xs px-2"
                onClick={() => setShowNotes(!showNotes)}
              >
                <StickyNote className="h-3 w-3 mr-1" />
                Notes
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-xs px-2"
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </Button>
              {resolvedUrl ? (
                <a
                  href={resolvedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  <ExternalLink className="h-3 w-3" />
                  Open
                </a>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs text-muted-foreground cursor-not-allowed opacity-50">
                  <ExternalLink className="h-3 w-3" />
                  Open
                </span>
              )}
            </div>

            {/* Response textarea */}
            {showResponse && (
              <div className="mt-3 space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Suggested Response</label>
                <Textarea
                  value={responseText}
                  onChange={(e) => setResponseText(e.target.value)}
                  placeholder="Draft a helpful response for this post..."
                  rows={4}
                  className="text-sm resize-none"
                />
                <Button size="sm" onClick={saveResponse} disabled={saving} className="h-7 text-xs">
                  Save Response
                </Button>
              </div>
            )}

            {/* Notes textarea */}
            {showNotes && (
              <div className="mt-3 space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Notes</label>
                <Textarea
                  value={notesText}
                  onChange={(e) => setNotesText(e.target.value)}
                  placeholder="Add internal notes..."
                  rows={3}
                  className="text-sm resize-none"
                />
                <Button size="sm" onClick={saveNotes} disabled={saving} className="h-7 text-xs">
                  Save Notes
                </Button>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
