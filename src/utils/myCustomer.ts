import { supabase } from '@/integrations/supabase/client';

// Resolve the customers-table row(s) belonging to the logged-in portal user,
// matched the same way the RLS policies do: customers.user_id first, with a
// case-insensitive e-mail fallback for rows created before user_id existed.
export async function getMyCustomerIds(): Promise<string[]> {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return [];

  const filters = [`user_id.eq.${user.id}`];
  if (user.email) {
    filters.push(`email.ilike.${user.email.replace(/[,()]/g, '')}`);
  }

  const { data, error } = await supabase
    .from('customers')
    .select('id')
    .or(filters.join(','));

  if (error) {
    console.error('Failed to resolve own customer record:', error);
    return [];
  }
  return (data || []).map((c: { id: string }) => c.id);
}
