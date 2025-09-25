import { supabase } from '@/integrations/supabase/client';

/**
 * Creates an auth user for an existing partner who doesn't have one
 */
export async function createAuthUserForPartner(partnerId: string, password: string): Promise<boolean> {
  try {
    // Get partner details
    const { data: partner, error: partnerError } = await supabase
      .from('production_partners')
      .select('*')
      .eq('id', partnerId)
      .single();

    if (partnerError || !partner) {
      console.error('Error fetching partner:', partnerError);
      return false;
    }

    // Check if auth user already exists
    const { data: existingUsers, error: listError } = await supabase.auth.admin.listUsers();
    if (listError) {
      console.error('Error listing users:', listError);
      return false;
    }

    const existingUser = existingUsers.users.find(user => user.email === partner.email);
    if (existingUser) {
      console.log('Auth user already exists for partner:', partner.email);
      return true;
    }

    // Create auth user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: partner.email,
      password: password,
      email_confirm: true,
      user_metadata: {
        first_name: partner.contact_name,
        company_name: partner.company_name
      }
    });

    if (authError) {
      console.error('Error creating auth user:', authError);
      return false;
    }

    // Create user role entry
    if (authData.user) {
      const { error: roleError } = await supabase
        .from('user_roles')
        .insert([{
          user_id: authData.user.id,
          role: 'partner_seller'
        }]);

      if (roleError) {
        console.error('Error creating user role:', roleError);
        // Don't return false here as the auth user was created successfully
      }
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
    // Get partner details
    const { data: partner, error: partnerError } = await supabase
      .from('production_partners')
      .select('*')
      .eq('id', partnerId)
      .single();

    if (partnerError || !partner) {
      console.error('Error fetching partner:', partnerError);
      return false;
    }

    // Find the auth user by email
    const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers();
    if (authError) {
      console.error('Error listing users:', authError);
      return false;
    }

    const authUser = authUsers.users.find(user => user.email === partner.email);
    if (!authUser) {
      console.error('No auth user found for partner:', partner.email);
      return false;
    }

    // Update password
    const { error: passwordError } = await supabase.auth.admin.updateUserById(authUser.id, {
      password: newPassword
    });

    if (passwordError) {
      console.error('Error updating password:', passwordError);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error in updatePartnerPassword:', error);
    return false;
  }
}
