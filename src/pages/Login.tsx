import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Eye, EyeOff, Lock, Mail, User, Building, Phone, Globe, Hash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const { toast } = useToast();
  const { signIn } = useAuth();
  const navigate = useNavigate();

  // Registration fields
  const [regFirstName, setRegFirstName] = useState("");
  const [regLastName, setRegLastName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirmPassword, setRegConfirmPassword] = useState("");
  const [regCompanyName, setRegCompanyName] = useState("");
  const [regPhone, setRegPhone] = useState("");
  const [regCountry, setRegCountry] = useState("");
  const [regVatNumber, setRegVatNumber] = useState("");
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [registrationSuccess, setRegistrationSuccess] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    if (!email || !password) {
      setLoginError("Please enter email and password.");
      return;
    }

    try {
      setLoading(true);
      await signIn(email, password);
      // Navigation is handled by AuthContext based on user role
    } catch (error: any) {
      console.error('Login error:', error);
      let description = error?.message || "Please check your credentials and try again.";
      if (description.includes('Invalid login credentials')) {
        description = "Invalid email or password. Please check your credentials and try again.";
      } else if (description.includes('Email not confirmed')) {
        description = "Your email is not verified yet. Please check your inbox for the verification link.";
      }
      setLoginError(description);
    } finally {
      setLoading(false);
    }
  };

  const { signUp } = useAuth();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!regFirstName || !regLastName || !regEmail || !regPassword) {
      toast({
        title: "Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    if (regPassword !== regConfirmPassword) {
      toast({
        title: "Error",
        description: "Passwords do not match",
        variant: "destructive",
      });
      return;
    }

    if (regPassword.length < 6) {
      toast({
        title: "Error",
        description: "Password must be at least 6 characters",
        variant: "destructive",
      });
      return;
    }

    try {
      setLoading(true);

      // Sign up the user - the database trigger will auto-assign 'customer' role
      const { data, error } = await supabase.auth.signUp({
        email: regEmail,
        password: regPassword,
        options: {
          data: {
            first_name: regFirstName,
            last_name: regLastName,
            company_name: regCompanyName,
            phone: regPhone,
            country: regCountry,
            vat_number: regVatNumber,
          },
        },
      });

      if (error) throw error;

      // If user was created and confirmed immediately (no email verification required)
      if (data.user && data.session) {
        // Save customer profile data (non-blocking - don't let this fail registration)
        try {
          await supabase.from('customer_profiles').upsert({
            user_id: data.user.id,
            company_name: regCompanyName,
            phone: regPhone,
            country: regCountry,
            vat_number: regVatNumber,
          });
        } catch (profileError) {
          console.warn('Could not save customer profile:', profileError);
        }

        // Also create entry in customers table so account appears in admin customers list
        try {
          const contactName = `${regFirstName} ${regLastName}`.trim();
          await supabase.from('customers').upsert({
            email: regEmail,
            company_name: regCompanyName || contactName,
            first_name: regFirstName,
            last_name: regLastName,
            contact_name: contactName,
            phone: regPhone || null,
            country: regCountry || null,
            vat_tax_id: regVatNumber || '',
            status: 'active',
            street_address: '',
            city: '',
            zip_code: '',
          }, { onConflict: 'email' });
        } catch (customerError) {
          console.warn('Could not save to customers table:', customerError);
        }

        toast({
          title: "Account created!",
          description: "Welcome to Microns Hub. Redirecting to your dashboard...",
        });

        // Small delay to let role assignment trigger complete
        setTimeout(() => {
          navigate('/customer/dashboard');
        }, 500);
      } else if (data.user && !data.session) {
        // Email verification required - still create customer record
        try {
          const contactName = `${regFirstName} ${regLastName}`.trim();
          await supabase.from('customers').upsert({
            email: regEmail,
            company_name: regCompanyName || contactName,
            first_name: regFirstName,
            last_name: regLastName,
            contact_name: contactName,
            phone: regPhone || null,
            country: regCountry || null,
            vat_tax_id: regVatNumber || '',
            status: 'active',
            street_address: '',
            city: '',
            zip_code: '',
          }, { onConflict: 'email' });
        } catch (customerError) {
          console.warn('Could not save to customers table:', customerError);
        }

        setRegistrationSuccess(true);
        toast({
          title: "Account created!",
          description: "Please check your email to verify your account before logging in.",
        });
      } else {
        // User already exists or other edge case
        setRegistrationSuccess(true);
        toast({
          title: "Check your email",
          description: "If an account with this email exists, you'll receive a verification email. Otherwise, try signing in.",
        });
      }
    } catch (error: any) {
      console.error('Registration error:', error);
      const message = error?.message || "An error occurred during registration";
      // Provide user-friendly messages for common errors
      let description = message;
      if (message.includes('unexpected_failure') || error?.status === 500) {
        description = "Server error during registration. Please try again in a moment or contact support.";
      } else if (message.includes('already registered') || message.includes('already been registered')) {
        description = "This email is already registered. Please sign in instead.";
      } else if (message.includes('rate limit') || message.includes('too many')) {
        description = "Too many attempts. Please wait a moment and try again.";
      }
      toast({
        title: "Registration failed",
        description,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <Link to="/">
            <img
              src="/lovable-uploads/a27a8329-2c4a-4b05-b1c4-b200b903617e.png"
              alt="Microns Hub Logo"
              className="h-10 mx-auto mb-4"
            />
          </Link>
        </div>

        <Card className="border-none shadow-lg">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-bold text-center">Welcome to Microns Hub</CardTitle>
            <CardDescription className="text-center">
              Sign in to your account or create a new one
            </CardDescription>
          </CardHeader>

          <Tabs defaultValue="login" className="w-full">
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="login">Sign In</TabsTrigger>
              <TabsTrigger value="register">Register</TabsTrigger>
            </TabsList>

            {/* LOGIN TAB */}
            <TabsContent value="login">
              <form onSubmit={handleLogin}>
                <CardContent className="space-y-4">
                  {loginError && (
                    <Alert variant="destructive">
                      <AlertDescription>{loginError}</AlertDescription>
                    </Alert>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="login-email">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                      <Input
                        id="login-email"
                        type="email"
                        placeholder="you@company.com"
                        className="pl-10"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="login-password">Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                      <Input
                        id="login-password"
                        type={showPassword ? "text" : "password"}
                        placeholder="Enter your password"
                        className="pl-10"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-2.5"
                      >
                        {showPassword ? (
                          <EyeOff className="h-5 w-5 text-muted-foreground" />
                        ) : (
                          <Eye className="h-5 w-5 text-muted-foreground" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="remember"
                        className="rounded border-gray-300 text-primary focus:ring-primary"
                      />
                      <label htmlFor="remember" className="text-sm text-muted-foreground">
                        Remember me
                      </label>
                    </div>
                    <a href="#" className="text-sm text-primary hover:underline">
                      Forgot password?
                    </a>
                  </div>
                </CardContent>

                <CardFooter>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? "Signing in..." : "Sign In"}
                  </Button>
                </CardFooter>
              </form>
            </TabsContent>

            {/* REGISTER TAB */}
            <TabsContent value="register">
              {registrationSuccess ? (
                <CardContent className="py-8 text-center space-y-4">
                  <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
                    <Mail className="h-8 w-8 text-green-600" />
                  </div>
                  <h3 className="text-lg font-semibold text-green-800">Account Created Successfully!</h3>
                  <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                    We've sent a verification email to <strong>{regEmail}</strong>.
                    Please check your inbox (and spam folder) and click the verification link to activate your account.
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => setRegistrationSuccess(false)}
                    className="mt-4"
                  >
                    Back to Registration
                  </Button>
                </CardContent>
              ) : (
              <form onSubmit={handleRegister}>
                <CardContent className="space-y-4">
                  {/* Name fields */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="reg-first-name">First Name *</Label>
                      <div className="relative">
                        <User className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="reg-first-name"
                          placeholder="First name"
                          className="pl-9"
                          value={regFirstName}
                          onChange={(e) => setRegFirstName(e.target.value)}
                          required
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="reg-last-name">Last Name *</Label>
                      <Input
                        id="reg-last-name"
                        placeholder="Last name"
                        value={regLastName}
                        onChange={(e) => setRegLastName(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  {/* Company Name */}
                  <div className="space-y-1">
                    <Label htmlFor="reg-company">Company Name</Label>
                    <div className="relative">
                      <Building className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="reg-company"
                        placeholder="Your company (optional)"
                        className="pl-9"
                        value={regCompanyName}
                        onChange={(e) => setRegCompanyName(e.target.value)}
                      />
                    </div>
                  </div>

                  {/* VAT Number */}
                  <div className="space-y-1">
                    <Label htmlFor="reg-vat">VAT Number</Label>
                    <div className="relative">
                      <Hash className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="reg-vat"
                        placeholder="e.g., EL123456789"
                        className="pl-9"
                        value={regVatNumber}
                        onChange={(e) => setRegVatNumber(e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Email */}
                  <div className="space-y-1">
                    <Label htmlFor="reg-email">Email *</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="reg-email"
                        type="email"
                        placeholder="you@company.com"
                        className="pl-9"
                        value={regEmail}
                        onChange={(e) => setRegEmail(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  {/* Phone */}
                  <div className="space-y-1">
                    <Label htmlFor="reg-phone">Phone</Label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="reg-phone"
                        type="tel"
                        placeholder="+30 210 444 7830"
                        className="pl-9"
                        value={regPhone}
                        onChange={(e) => setRegPhone(e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Country */}
                  <div className="space-y-1">
                    <Label htmlFor="reg-country">Country</Label>
                    <div className="relative">
                      <Globe className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="reg-country"
                        placeholder="e.g., Greece"
                        className="pl-9"
                        value={regCountry}
                        onChange={(e) => setRegCountry(e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Password */}
                  <div className="space-y-1">
                    <Label htmlFor="reg-password">Password *</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="reg-password"
                        type={showRegPassword ? "text" : "password"}
                        placeholder="Min. 6 characters"
                        className="pl-9"
                        value={regPassword}
                        onChange={(e) => setRegPassword(e.target.value)}
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowRegPassword(!showRegPassword)}
                        className="absolute right-3 top-2.5"
                      >
                        {showRegPassword ? (
                          <EyeOff className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Eye className="h-4 w-4 text-muted-foreground" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Confirm Password */}
                  <div className="space-y-1">
                    <Label htmlFor="reg-confirm-password">Confirm Password *</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="reg-confirm-password"
                        type="password"
                        placeholder="Confirm password"
                        className="pl-9"
                        value={regConfirmPassword}
                        onChange={(e) => setRegConfirmPassword(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    By creating an account, you agree to our{" "}
                    <a href="/cookie-policy" className="text-primary hover:underline">Terms & Conditions</a>
                    {" "}and{" "}
                    <a href="/cookie-policy" className="text-primary hover:underline">Privacy Policy</a>.
                  </p>
                </CardContent>

                <CardFooter>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? "Creating account..." : "Create Account"}
                  </Button>
                </CardFooter>
              </form>
              )}
            </TabsContent>
          </Tabs>
        </Card>

        <p className="text-center text-sm text-muted-foreground mt-4">
          <Link to="/" className="text-primary hover:underline">
            ← Back to Microns Hub
          </Link>
        </p>
      </div>
    </div>
  );
};

export default Login;
