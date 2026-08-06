import { supabase } from '@/integrations/supabase/client';

// Both edge functions below verify the caller is a staff user, so we must send
// the logged-in admin's session token — the anon key alone is rejected.
async function authHeaders(): Promise<Record<string, string> | null> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data?.session?.access_token;
  if (!accessToken) return null;
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
    'apikey': supabase.supabaseKey,
  };
}

/**
 * Creates an auth user for an existing partner who doesn't have one
 */
export async function createAuthUserForPartner(partnerId: string, password: string): Promise<boolean> {
  try {
    const headers = await authHeaders();
    if (!headers) {
      console.error('Not signed in — cannot create partner auth user');
      return false;
    }
    const response = await fetch('/functions/v1/create-partner-auth-user', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        partnerId,
        password
      })
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('Error creating auth user:', result.error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error in createAuthUserForPartner:', error);
    return false;
  }
}

/**
 * Updates password for an existing partner's auth user
 */
export async function updatePartnerPassword(partnerId: string, newPassword: string): Promise<boolean> {
  try {
    const headers = await authHeaders();
    if (!headers) {
      console.error('Not signed in — cannot update partner password');
      return false;
    }
    const response = await fetch('/functions/v1/update-partner-password', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        partnerId,
        newPassword
      })
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('Error updating password:', result.error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error in updatePartnerPassword:', error);
    return false;
  }
}
