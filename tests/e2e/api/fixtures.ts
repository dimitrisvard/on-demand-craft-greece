/**
 * E2E fixtures of tests/e2e/api.spec.ts (preview and compare modes). The JSON lives outside git; its path is
 * E2E_FIXTURES and its shape is tests/e2e/api/fixtures.example.json. The seeded rows it names come from
 * tests/e2e/api/seed.sql and go away with tests/e2e/api/cleanup.sql.
 *
 * Test users are signed in once per worker with Supabase Auth's password grant (public anon key, test users only);
 * a fixture may also hand a ready access token instead of a password.
 */
import { readFileSync } from 'node:fs';
import type { AccessPair } from './client';
import type { PlainClient } from './client';

export interface UserFixture {
  email: string;
  password?: string;
  /** Ready Supabase access token (used as is instead of signing in). */
  accessToken?: string;
}

export interface TrackingCase {
  /** Sent event id (marketing_events.id, event_type 'sent'). */
  eid: string;
}

export interface TrackingSet {
  campaignId: string;
  open: { first: TrackingCase; repeat: TrackingCase };
  click: { first: TrackingCase; repeat: TrackingCase };
  unsubscribe: { first: TrackingCase; repeat: TrackingCase };
}

export interface E2eFixtures {
  supabase: { url: string; anonKey: string };
  users: { staff: UserFixture; customer: UserFixture; admin?: UserFixture };
  machine?: { collector?: AccessPair | { clientId: string; clientSecret: string }; mcp?: AccessPair | { clientId: string; clientSecret: string } };
  /** Test signing secret of the Resend webhook (ops RESEND_WEBHOOK_SECRET on the preview), `whsec_` + base64. */
  webhookSigningSecret?: string;
  /** SITE_ORIGIN of the Worker under test (default https://www.micronshub.eu). */
  siteOrigin?: string;
  seed: {
    /** RFQ of the customer test user, created long ago. */
    rfqNumber: string;
    rfqId: string;
    customerEmail: string;
    /** File row of that RFQ (rfq_files.file_path). */
    ownFileKey: string;
    /** RFQ and file row of another (seeded) customer. */
    otherRfqNumber: string;
    otherFileKey: string;
    /** RFQ whose created_at the seed's refresh statement sets to now() right before a run (anonymous upload). */
    freshRfqNumber?: string;
    /** An object that exists in the legacy rfq bucket only (read-only check). */
    legacyObjectKey?: string;
    stockItemId: string;
    stockQrCode: string;
    /** Two-letter code for the one queued machine scan (default LU). */
    scanCountry?: string;
    clickUrl: string;
    tracking: { preview: TrackingSet; compareWorker?: TrackingSet; compareVercel?: TrackingSet };
  };
}

export function loadFixtures(path: string): E2eFixtures {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as E2eFixtures;
  for (const key of ['supabase', 'users', 'seed'] as const) {
    if (!parsed[key]) throw new Error(`E2E fixtures: "${key}" is missing (see tests/e2e/api/fixtures.example.json)`);
  }
  return parsed;
}

/** Machine pair in the client's shape (the fixtures may use clientId / clientSecret). */
export function machinePair(value: unknown): AccessPair | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const id = typeof v.id === 'string' ? v.id : typeof v.clientId === 'string' ? v.clientId : '';
  const secret = typeof v.secret === 'string' ? v.secret : typeof v.clientSecret === 'string' ? v.clientSecret : '';
  return id && secret ? { id, secret } : null;
}

const tokenCache = new Map<string, Promise<string>>();

/** Supabase access token of a test user (password grant through the plain context; cached per worker). */
export function accessTokenOf(plain: PlainClient, fixtures: E2eFixtures, label: 'staff' | 'customer' | 'admin'): Promise<string> {
  const user = fixtures.users[label];
  if (!user) return Promise.reject(new Error(`E2E fixtures: users.${label} is missing`));
  if (user.accessToken) return Promise.resolve(user.accessToken);
  const cached = tokenCache.get(user.email);
  if (cached) return cached;
  const pending = (async () => {
    if (!user.password) throw new Error(`E2E fixtures: users.${label} has neither password nor accessToken`);
    const url = `${fixtures.supabase.url.replace(/\/+$/, '')}/auth/v1/token?grant_type=password`;
    const res = await plain.fetch(url, {
      method: 'POST',
      headers: { apikey: fixtures.supabase.anonKey },
      json: { email: user.email, password: user.password },
    });
    if (res.status() !== 200) throw new Error(`sign-in of the ${label} test user failed with HTTP ${res.status()}`);
    const body = (await res.json()) as { access_token?: string };
    if (!body.access_token) throw new Error(`sign-in of the ${label} test user returned no access token`);
    return body.access_token;
  })();
  tokenCache.set(user.email, pending);
  return pending;
}
