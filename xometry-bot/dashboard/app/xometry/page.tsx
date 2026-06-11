import { createClient } from '@supabase/supabase-js';

import { OfferTable } from './offer-table';
import { OFFER_COLUMNS, type XometryOfferRow } from './types';

// The queue must always reflect the live table — never cache.
export const dynamic = 'force-dynamic';

async function fetchRows(): Promise<XometryOfferRow[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY; // server-only: RLS denies anon by design
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured');
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase
    .from('xometry_offers')
    .select(OFFER_COLUMNS)
    .order('publication_end', { ascending: true, nullsFirst: false });
  if (error) {
    throw new Error(`xometry_offers query failed: ${error.message}`);
  }
  return (data ?? []) as unknown as XometryOfferRow[];
}

export default async function XometryPage() {
  const rows = await fetchRows();
  return (
    <main className="mx-auto max-w-screen-2xl p-6">
      <h1 className="text-2xl font-semibold">Xometry counteroffer queue</h1>
      <p className="mt-1 text-sm text-gray-500">
        Sorted by expiry. Suggested price = max(buyer × 0.80, cost × 1.15); lead time ≥ today +
        10 business days. Nothing is sent to Xometry without the Submit click.
      </p>
      <OfferTable initialRows={rows} />
    </main>
  );
}
