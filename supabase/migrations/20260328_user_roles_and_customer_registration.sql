-- ============================================================================
-- Migration: User Roles table + Customer Registration auto-role assignment
-- Date: 2026-03-28
-- Purpose: Ensure user_roles table exists with proper structure, add trigger
--          to auto-assign 'customer' role on new user signup, and add RLS policies
-- ============================================================================

-- Create user_roles table if it doesn't exist (it may already exist from manual setup)
CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'customer',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT user_roles_user_id_unique UNIQUE (user_id),
  CONSTRAINT user_roles_role_check CHECK (role IN ('admin', 'sales_rep', 'production_manager', 'customer', 'supplier', 'accountant', 'partner_seller'))
);

-- Add index for fast role lookups
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON public.user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON public.user_roles(role);

-- Enable RLS
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can read their own role, admins can read/write all
DO $$
BEGIN
  -- Drop existing policies if they exist to avoid conflicts
  DROP POLICY IF EXISTS "Users can read own role" ON public.user_roles;
  DROP POLICY IF EXISTS "Admins can manage all roles" ON public.user_roles;
  DROP POLICY IF EXISTS "Service role can manage roles" ON public.user_roles;
END $$;

CREATE POLICY "Users can read own role"
  ON public.user_roles
  FOR SELECT
  USING (auth.uid() = user_id);

-- Allow inserts from service role (for triggers and edge functions)
-- The trigger function runs as SECURITY DEFINER so it bypasses RLS

-- ============================================================================
-- Auto-assign 'customer' role to new signups
-- ============================================================================

-- Function to auto-assign customer role on new user creation
CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS TRIGGER AS $$
BEGIN
  -- Only insert if no role exists yet (partner_seller roles are created by admin)
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'customer')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if it exists, then create it
DROP TRIGGER IF EXISTS on_auth_user_created_assign_role ON auth.users;

CREATE TRIGGER on_auth_user_created_assign_role
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_role();

-- ============================================================================
-- Add company_name and phone to user metadata tracking (optional customer profile table)
-- ============================================================================

-- Customer profiles table for additional registration data
CREATE TABLE IF NOT EXISTS public.customer_profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name TEXT,
  phone TEXT,
  country TEXT,
  vat_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT customer_profiles_user_id_unique UNIQUE (user_id)
);

-- Enable RLS on customer_profiles
ALTER TABLE public.customer_profiles ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  DROP POLICY IF EXISTS "Users can read own profile" ON public.customer_profiles;
  DROP POLICY IF EXISTS "Users can update own profile" ON public.customer_profiles;
  DROP POLICY IF EXISTS "Users can insert own profile" ON public.customer_profiles;
END $$;

CREATE POLICY "Users can read own profile"
  ON public.customer_profiles
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own profile"
  ON public.customer_profiles
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own profile"
  ON public.customer_profiles
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);
