// Notices of the agent pages for the states in which the agent layer is not usable yet (Phase 4): the database
// tables are missing (migration not applied), the Cloudflare API does not answer (the pages are served before it
// exists), or the session expired. Data that can be read is still shown; actions stay disabled.
import { Link } from 'react-router-dom';
import { AlertTriangle, Database, LogIn } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { AgentApiProbe } from '@/utils/agentApi';

/** The agent tables are not in the database yet. */
export function NotInstalled() {
  return (
    <Alert data-testid="agent-not-installed">
      <Database className="h-4 w-4" />
      <AlertTitle>The agent layer is not installed yet (database)</AlertTitle>
      <AlertDescription>
        The agent tables do not exist in the database yet. This page shows its data once the agent layer migration has been applied.
      </AlertDescription>
    </Alert>
  );
}

/** Why actions are disabled, from the status probe (nothing while the probe runs or when the API is available). */
export function ApiStateNotice({ probe, loading }: { probe: AgentApiProbe | undefined; loading: boolean }) {
  if (loading || !probe || probe.available === true) return null;
  // tsconfig.app.json is not strict, so the union is narrowed by hand.
  const reason = (probe as Extract<AgentApiProbe, { available: false }>).reason;
  if (reason === 'unauthorized') return <SignInAgain />;
  const text =
    reason === 'forbidden'
      ? 'Your account may read this page but not use its actions.'
      : 'Actions need the Cloudflare API; use the Telegram card.';
  return (
    <Alert data-testid="agent-api-absent">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Actions unavailable</AlertTitle>
      <AlertDescription>{text}</AlertDescription>
    </Alert>
  );
}

/** The session expired (an /api/* call answered 401). */
export function SignInAgain() {
  return (
    <Alert variant="destructive" data-testid="agent-sign-in-again">
      <LogIn className="h-4 w-4" />
      <AlertTitle>Your session has expired</AlertTitle>
      <AlertDescription>
        <Link to="/login" className="underline">
          Sign in again
        </Link>{' '}
        to use the actions on this page.
      </AlertDescription>
    </Alert>
  );
}
