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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserWithRole | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    console.log("Setting up auth state listener");
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        console.log("Auth state changed:", event, session?.user?.email);
        setSession(session);
        
        if (session?.user) {
          // Fetch user role when user is logged in
          fetchUserRole(session.user.id).then(role => {
            setUser({ ...session.user, role });
          });
        } else {
          setUser(null);
        }
        
        setLoading(false);
      }
    );

    console.log("Checking for existing session");
    supabase.auth.getSession().then(({ data: { session } }) => {
      console.log("Existing session:", session?.user?.email);
      setSession(session);
      
      if (session?.user) {
        // Fetch user role for existing session
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
      return data?.role;
    } catch (error) {
      console.error("Error fetching user role:", error);
      return undefined;
    }
  };

  const signIn = async (email: string, password: string) => {
    console.log("Attempting login with:", email);
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    
    if (error) {
      console.error("Login error:", error.message);
      throw error;
    }
    
    console.log("Login successful:", data.user?.email);

    // Fetch user role after successful login
    if (data.user) {
      const role = await fetchUserRole(data.user.id);
      setUser({ ...data.user, role });
    }

    navigate('/dashboard');
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

    // By default, new users will be assigned the 'viewer' role
    // This would be handled by a database trigger in a real implementation
    toast({
      title: "Account created",
      description: "Please check your email to verify your account.",
    });
  };

  const signOut = async () => {
    console.log("Signing out");
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error("Logout error:", error.message);
      throw error;
    }
    console.log("Sign out successful");
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
      hasRole
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
