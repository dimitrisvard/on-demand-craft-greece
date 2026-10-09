// Pure helpers of the /reset-password page (src/pages/ResetPassword.tsx), kept apart so the page file exports only
// its component (react-refresh) and the rules can be tested alone.

/** Same minimum as the registration form (src/pages/Login.tsx:94); Supabase Auth may enforce more. */
export const MIN_PASSWORD_LENGTH = 6;

export type ResetMode = 'checking' | 'request' | 'sent' | 'update' | 'done';

/** The error Supabase Auth puts into the redirect URL (fragment or query), or null. */
export function recoveryLinkError(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
  for (const params of [fragment, url.searchParams]) {
    const code = params.get('error_code');
    const description = params.get('error_description');
    if (code || description || params.get('error')) {
      if (code === 'otp_expired') return 'This reset link has expired or has already been used.';
      return description || 'This reset link is not valid.';
    }
  }
  return null;
}

/** Problem with the new password, or null when it can be sent. */
export function passwordProblem(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password !== confirm) return 'The passwords do not match.';
  return null;
}
