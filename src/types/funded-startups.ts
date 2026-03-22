export interface FundedStartup {
  id: string;
  source_name: string;
  source_url: string;
  article_title: string;
  article_excerpt: string | null;
  article_published_at: string | null;
  company_name: string | null;
  company_website: string | null;
  country_code: string | null;
  city: string | null;
  funding_amount_millions: number | null;
  funding_currency: string;
  funding_stage: string | null;
  investors: string[] | null;
  industry_tags: string[];
  is_hardware: boolean;
  hardware_confidence: number;
  matched_keywords: string[];
  scraped_emails: string[];
  email_scrape_status: string;
  outreach_status: 'new' | 'researched' | 'contacted' | 'responded' | 'not_relevant';
  notes: string | null;
  contacted_at: string | null;
  discovered_at: string;
  updated_at: string;
}

export interface FundedStartupFilters {
  industry: string;
  country: string;
  stage: string;
  outreach_status: string;
  min_confidence: number;
  min_amount: string;
  is_hardware: boolean | null;
  days_back: number;
  search: string;
  source: string;
}

export interface FundedStartupStats {
  total_all_time: number;
  period_days: number;
  period_total: number;
  period_hardware: number;
  by_stage: Record<string, number>;
  by_country: Record<string, number>;
  by_outreach: Record<string, number>;
  daily_volume: Record<string, number>;
}

export interface FundingFeed {
  id: number;
  name: string;
  feed_url: string;
  language: string;
  priority: number;
  is_active: boolean;
  last_fetched_at: string | null;
  last_item_count: number;
  error_count: number;
  last_error: string | null;
}
