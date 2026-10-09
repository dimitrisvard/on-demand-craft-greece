// Synthetic fixtures of the collectors (test/fixtures/collectors/) and their shapes. Node-only imports, so both the T1
// harness and the T2 file (plain Node, no cloudflare:workers alias) can load them.

import { readFileSync } from 'node:fs';

const FIXTURES = new URL('../../fixtures/collectors/', import.meta.url);

export function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(name, FIXTURES), 'utf8')) as T;
}

export interface FixtureKeyword {
  keyword: string;
  category: string;
  weight: number | null;
  is_active: boolean;
}

export type PullpushFixture = Record<string, { status?: number; posts?: Array<Record<string, unknown>> }>;

export interface AlgoliaFixture {
  queries: Record<string, { status?: number; hits?: Array<Record<string, unknown>> }>;
  show_hn: { status?: number; hits?: Array<Record<string, unknown>> };
}
