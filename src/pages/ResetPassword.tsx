// /reset-password: ask for a reset link, or set a new password after following one (PLAN.md P6-4).
//
// Recovery flow with this project's client. src/integrations/supabase/client.ts passes no auth options, so
// supabase-js runs the implicit flow with detectSessionInUrl on:
//   1. Request: resetPassword(email) (AuthContext) sends the link with redirectTo <origin>/reset-password.
//   2. The link passes Supabase Auth and comes back as /reset-password#access_token=…&type=recovery. The client
//      stores that session while it initialises, clears the fragment and emits PASSWORD_RECOVERY.
//   3. With a session this page shows the new-password form and calls supabase.auth.updateUser({ password }).
// A used or expired link comes back as #error=…&error_code=…&error_description=…; the client leaves that in the
// URL and creates no session, so the page shows the error with the request form.
// The page decides on the session, not on the event alone: the event can fire before this lazily loaded page has
// subscribed, and getSession() waits for the client's initialisation. A PKCE client (?code=…) would also end with
// a session (it emits SIGNED_IN), so the page would keep working if flowType changed.
//
// Not for search engines: a non-language route like /login (robots.txt Disallow), plus a noindex meta tag for
// crawlers that render the page.

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Lock, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { passwordProblem, recoveryLinkError, type ResetMode } from '@/utils/passwordRecovery';

const ResetPassword = () => {
  const { resetPassword, getDefaultRoute } = useAuth();
  const navigate = useNavigate();
  // Read once, before anything else can change the address bar.
  const [linkError, setLinkError] = useState<string | null>(() => recoveryLinkError(window.location.href));
  // A failed link wins over a session that existed before it was opened (another tab, an earlier sign-in).
  const failedLink = useRef(linkError !== null);
  const [mode, setMode] = useState<ResetMode>('checking');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted.current) return;
      if (session && event === 'PASSWORD_RECOVERY') {
        failedLink.current = false;
        setLinkError(null);
        setMode((current) => (current === 'done' ? current : 'update'));
      } else if (session && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && !failedLink.current) {
        setMode((current) => (current === 'done' ? current : 'update'));
      } else if (event === 'SIGNED_OUT') {
        setMode((current) => (current === 'done' ? current : 'request'));
      }
    });
    supabase.auth
      .getSession()
      .then(({ data: result }) => {
        if (!mounted.current) return;
        setMode((current) => {
          if (current !== 'checking') return current;
          return result.session && !failedLink.current ? 'update' : 'request';
        });
      })
      .catch(() => {
        if (mounted.current) setMode((current) => (current === 'checking' ? 'request' : current));
      });
    return () => {
      mounted.current = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const requestLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const address = email.trim();
    if (!address) {
      setError('Please enter your e-mail address.');
      return;
    }
    setBusy(true);
    try {
      await resetPassword(address);
      setLinkError(null);
      setMode('sent');
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'The link could not be sent. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const updatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = passwordProblem(password, confirm);
    setError(problem);
    if (problem) return;
    setBusy(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message || 'The password could not be changed. Please try again.');
        return;
      }
      setPassword('');
      setConfirm('');
      setMode('done');
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'The password could not be changed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <Helmet>
        <title>Reset password | Microns Hub</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{mode === 'update' || mode === 'done' ? 'Set a new password' : 'Reset your password'}</CardTitle>
          <CardDescription>
            {mode === 'update' && 'Choose a new password for your account.'}
            {mode === 'done' && 'Your password has been changed.'}
            {(mode === 'request' || mode === 'checking') && 'Enter the e-mail address of your account and we will send you a link.'}
            {mode === 'sent' && 'Check your inbox.'}
          </CardDescription>
        </CardHeader>

        {mode === 'checking' && (
          <CardContent>
            <p className="text-sm text-muted-foreground" role="status">Checking your reset link…</p>
          </CardContent>
        )}

        {mode === 'request' && (
          <form onSubmit={requestLink} noValidate>
            <CardContent className="space-y-4">
              {linkError && (
                <Alert variant="destructive" data-testid="link-error">
                  <AlertDescription>{linkError} Request a new link below.</AlertDescription>
                </Alert>
              )}
              {error && (
                <Alert variant="destructive" data-testid="form-error">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <Label htmlFor="reset-email">E-mail</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                  <Input
                    id="reset-email"
                    type="email"
                    autoComplete="email"
                    className="pl-10"
                    value={email}
                    onChange={(ev) => setEmail(ev.target.value)}
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-3">
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? 'Sending…' : 'Send reset link'}
              </Button>
              <Link to="/login" className="text-sm text-primary hover:underline">Back to sign in</Link>
            </CardFooter>
          </form>
        )}

        {mode === 'sent' && (
          <CardContent className="space-y-4">
            <p className="text-sm" data-testid="sent">
              If an account exists for {email.trim()}, an e-mail with a reset link is on its way. The link can be used once.
            </p>
            <Link to="/login" className="text-sm text-primary hover:underline">Back to sign in</Link>
          </CardContent>
        )}

        {mode === 'update' && (
          <form onSubmit={updatePassword} noValidate>
            <CardContent className="space-y-4">
              {error && (
                <Alert variant="destructive" data-testid="form-error">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <Label htmlFor="new-password">New password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                  <Input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    className="pl-10"
                    value={password}
                    onChange={(ev) => setPassword(ev.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Repeat the new password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                  <Input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    className="pl-10"
                    value={confirm}
                    onChange={(ev) => setConfirm(ev.target.value)}
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? 'Saving…' : 'Save new password'}
              </Button>
            </CardFooter>
          </form>
        )}

        {mode === 'done' && (
          <CardFooter>
            <Button className="w-full" onClick={() => navigate(getDefaultRoute())}>
              Continue
            </Button>
          </CardFooter>
        )}
      </Card>
    </div>
  );
};

export default ResetPassword;
