import { supabase } from '@/integrations/supabase/client';

/**
 * Creates an auth user for an existing partner who doesn't have one
 */
export async function createAuthUserForPartner(partnerId: string, password: string): Promise<boolean> {
  try {
    const response = await fetch('/functions/v1/create-partner-auth-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabase.supabaseKey}`,
        'apikey': supabase.supabaseKey
      },
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
    const response = await fetch('/functions/v1/update-partner-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabase.supabaseKey}`,
        'apikey': supabase.supabaseKey
      },
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
