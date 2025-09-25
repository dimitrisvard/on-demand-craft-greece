import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { partnerId, newPassword } = await req.json();

    if (!partnerId || !newPassword) {
      return new Response(
        JSON.stringify({ error: 'Missing partnerId or newPassword' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client with service role key
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get partner details
    const { data: partner, error: partnerError } = await supabase
      .from('production_partners')
      .select('*')
      .eq('id', partnerId)
      .single();

    if (partnerError || !partner) {
      return new Response(
        JSON.stringify({ error: 'Partner not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Find the auth user by email
    const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers();
    if (authError) {
      return new Response(
        JSON.stringify({ error: 'Error listing users' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const authUser = authUsers.users.find(user => user.email === partner.email);
    if (!authUser) {
      return new Response(
        JSON.stringify({ error: 'No auth user found for this partner' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update password
    const { error: passwordError } = await supabase.auth.admin.updateUserById(authUser.id, {
      password: newPassword
    });

    if (passwordError) {
      return new Response(
        JSON.stringify({ error: passwordError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Password updated successfully' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
