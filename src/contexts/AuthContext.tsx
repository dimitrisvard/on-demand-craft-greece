import { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import { toast } from '@/hooks/use-toast';

type UserRole = 'admin' | 'sales_rep' | 'production_manager' | 'customer' | 'supplier' | 'accountant' | 'partner_seller';

interface UserWithRole extends User {
  role?: UserRole;
}

interface AuthContextType {
  user: UserWithRole | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, firstName: string, lastName: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updateProfile: (data: { firstName?: string; lastName?: string; }) => Promise<void>;
  hasRole: (role: UserRole | UserRole[]) => boolean;
  isAdmin: () => boolean;
  isPartner: () => boolean;
  isCustomer: () => boolean;
  getDefaultRoute: () => string;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Determine the correct landing page based on user role
function getRouteForRole(role?: UserRole): string {
  switch (role) {
    case 'admin':
    case 'sales_rep':
    case 'production_manager':
    case 'accountant':
      return '/dashboard';
    case 'partner_seller':
    case 'supplier':
      return '/partner/jobs';
    case 'customer':
      return '/customer/dashboard';
    default:
      // Unknown or no role — default to customer portal
      return '/customer/dashboard';
  }
}

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserWithRole | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);

        if (session?.user) {
          fetchUserRole(session.user.id).then(role => {
            setUser({ ...session.user, role });
          });
        } else {
          setUser(null);
        }

        setLoading(false);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);

      if (session?.user) {
        fetchUserRole(session.user.id).then(role => {
          setUser({ ...session.user, role });
        });
      } else {
        setUser(null);
      }

      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchUserRole = async (userId: string): Promise<UserRole | undefined> => {
    try {
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      return data?.role as UserRole | undefined;
    } catch (error) {
      console.error("Error fetching user role:", error);
      return undefined;
    }
  };

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      throw error;
    }

    // Fetch user role and navigate to the correct portal
    if (data.user) {
      const role = await fetchUserRole(data.user.id);
      setUser({ ...data.user, role });
      const targetRoute = getRouteForRole(role);
      navigate(targetRoute);
    }
  };

  const signUp = async (email: string, password: string, firstName: string, lastName: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          first_name: firstName,
          last_name: lastName,
        }
      }
    });

    if (error) {
      throw error;
    }

    // The database trigger (handle_new_user_role) auto-assigns 'customer' role
    // Also create a record in the customers table so admins can see this customer
    if (data.user) {
      try {
        const contactName = `${firstName} ${lastName}`.trim();
        await supabase.from('customers').insert({
          email,
          first_name: firstName,
          last_name: lastName,
          contact_name: contactName,
          company_name: contactName,
          status: 'active',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      } catch (insertError) {
        console.error('Failed to create customer record during signup:', insertError);
      }
    }

    toast({
      title: "Account created",
      description: "Please check your email to verify your account.",
    });
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      throw error;
    }
    navigate('/login');
  };

  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/reset-password',
    });

    if (error) {
      throw error;
    }

    toast({
      title: "Password reset email sent",
      description: "Please check your email to reset your password.",
    });
  };

  const updateProfile = async (data: { firstName?: string; lastName?: string; }) => {
    if (!user) return;

    const { error } = await supabase.auth.updateUser({
      data: {
        first_name: data.firstName || user.user_metadata?.first_name,
        last_name: data.lastName || user.user_metadata?.last_name,
      },
    });

    if (error) {
      throw error;
    }

    toast({
      title: "Profile updated",
      description: "Your profile information has been updated.",
    });
  };

  const hasRole = (roleRequirement: UserRole | UserRole[]): boolean => {
    if (!user || !user.role) return false;

    if (Array.isArray(roleRequirement)) {
      return roleRequirement.includes(user.role);
    }

    return user.role === roleRequirement;
  };

  const isAdmin = (): boolean => {
    return hasRole(['admin', 'sales_rep', 'production_manager', 'accountant']);
  };

  const isPartner = (): boolean => {
    return hasRole(['partner_seller', 'supplier']);
  };

  const isCustomer = (): boolean => {
    return hasRole('customer') || (!user?.role && !!user);
  };

  const getDefaultRoute = (): string => {
    return getRouteForRole(user?.role);
  };

  return (
    <AuthContext.Provider value={{
      user,
      session,
      loading,
      signIn,
      signUp,
      signOut,
      resetPassword,
      updateProfile,
      hasRole,
      isAdmin,
      isPartner,
      isCustomer,
      getDefaultRoute,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
