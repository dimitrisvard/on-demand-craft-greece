export interface Lead {
  id: string;
  source: 'reddit' | 'hackernews' | 'twitter' | 'forum';
  source_url: string;
  source_id: string | null;
  subreddit: string | null;
  title: string;
  body: string | null;
  author: string | null;
  author_url: string | null;
  upvotes: number;
  comments_count: number;
  auto_score: 'high' | 'medium' | 'low' | 'noise' | 'unscored';
  manual_score: 'high' | 'medium' | 'low' | null;
  matched_keywords: string[];
  matched_categories: string[];
  status: 'new' | 'reviewed' | 'contacted' | 'saved' | 'dismissed' | 'converted';
  suggested_response: string | null;
  response_sent_at: string | null;
  response_platform: string | null;
  notes: string | null;
  post_created_at: string | null;
  discovered_at: string;
  updated_at: string;
  industry_tags: string[];
}

export interface LeadFilters {
  source: string;
  score: string;
  status: string;
  industry: string;
  search: string;
  days_back: number;
}

export interface LeadStats {
  total_all_time: number;
  period_days: number;
  period_total: number;
  today: number;
  by_source: Record<string, number>;
  by_score: Record<string, number>;
  by_status: Record<string, number>;
  daily_volume: Record<string, number>;
  conversion_rate: number;
}

export interface MonitoredSubreddit {
  id: number;
  subreddit: string;
  source: string;
  tier: number;
  scan_interval_minutes: number;
  industry_tags: string[];
  is_active: boolean;
  last_scanned_at: string | null;
  last_post_id: string | null;
}

export interface LeadKeyword {
  id: number;
  keyword: string;
  category: string;
  weight: number;
  is_active: boolean;
  match_count: number;
}
