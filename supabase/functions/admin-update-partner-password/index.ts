// @ts-ignore: Deno Edge Function import
import { serve } from 'std/server.ts';
import { createClient } from '@supabase/supabase-js';

// @ts-ignore: Deno Edge Function env
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
// @ts-ignore: Deno Edge Function env
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// @ts-ignore: Deno Edge Function env
const ADMIN_SECRET = Deno.env.get('ADMIN_PASSWORD_UPDATE_SECRET')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const authHeader = req.headers.get('authorization') || '';
  if (authHeader !== `Bearer ${ADMIN_SECRET}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const { userId, newPassword } = body;
  if (!userId || !newPassword) {
    return new Response(JSON.stringify({ error: 'Missing userId or newPassword' }), { status: 400 });
  }

  const { error } = await supabase.auth.admin.updateUserById(userId, { password: newPassword });
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ success: true }), { status: 200 });
}); 