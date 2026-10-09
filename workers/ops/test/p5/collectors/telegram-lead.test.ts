// Lead alert texts (src/collectors/telegram-lead.ts): the sendMessage request bodies of the port (production
// telegramText adapter) are byte-equal to the bodies the live sendTelegramNotification of reddit-collector v15 and
// hn-collector v7 sends for the same post, match and clock (age rounding at 59/60/89/90 minutes, excerpts of 0, 300
// and more than 300 characters, line breaks, HTML tags, more than five keywords). The collector sources stay plain
// ASCII (the live emoji are \u escapes).

import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { hnLeadAlert, redditLeadAlert } from '../../../src/collectors/telegram-lead';
import { P5MemoryDb } from '../../../src/ports/p5-stub/index';
import { collectorHarness, fixture, T0, type AlgoliaFixture, type PullpushFixture } from './harness';
import { fakeSupabase, loadLive } from './live-source';

const TOKEN = 'telegram-test-value';
const CHAT = 'chat-test-value';

const liveBodies: Array<{ url: string; body: string }> = [];
const rt = {
  env: { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT, SUPABASE_URL: 'https://project.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'service-test-value' },
  supabase: fakeSupabase(new P5MemoryDb()),
  fetch: async (url: string, init?: RequestInit) => {
    liveBodies.push({ url, body: String(init?.body ?? '') });
    return new Response('{"ok":true}', { status: 200 });
  },
};
const liveReddit = loadLive('reddit-collector', rt);
const liveHn = loadLive('hn-collector', rt);

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});
afterAll(() => {
  vi.useRealTimers();
});

const MANY = ['one', 'two', 'three', 'four', 'five', 'six', 'seven'];

async function viaLive(send: () => Promise<void>): Promise<{ url: string; body: string }> {
  liveBodies.length = 0;
  await send();
  expect(liveBodies).toHaveLength(1);
  return liveBodies[0];
}

async function viaPort(text: string): Promise<{ url: string; body: string }> {
  const h = collectorHarness();
  await h.p5.telegramText.send(text, { disableWebPagePreview: true });
  expect(h.telegram).toHaveLength(1);
  return h.telegram[0];
}

function redditCases(): Array<{ name: string; post: Record<string, unknown>; score: 'high' | 'medium' | 'low'; matched: string[] }> {
  const posts = Object.values(fixture<PullpushFixture>('pullpush.json')).flatMap((e) => e.posts ?? []);
  const base = posts[0];
  const out: Array<{ name: string; post: Record<string, unknown>; score: 'high' | 'medium' | 'low'; matched: string[] }> = posts.map((p) => ({ name: `fixture ${p.id}`, post: p, score: 'high', matched: ['looking for manufacturer', 'Germany'] }));
  for (const age of [0, 1, 59, 60, 61, 89, 90, 149, 150, 1500]) out.push({ name: `age ${age} min`, post: { ...base, created_utc: T0 / 1000 - age * 60 }, score: 'high', matched: ['x'] });
  for (const selftext of [null, '', ' ', 'a\nb\n\nc', 'y'.repeat(300), 'z'.repeat(301), `${'w'.repeat(299)}\n tail`]) {
    out.push({ name: `selftext ${JSON.stringify(selftext)?.slice(0, 20)}`, post: { ...base, selftext }, score: 'medium', matched: MANY });
  }
  out.push({ name: 'score low', post: base, score: 'low', matched: [] });
  out.push({ name: 'no permalink', post: { ...base, permalink: undefined }, score: 'high', matched: ['a'] });
  return out;
}

describe('reddit alert: byte-equal to the live sendTelegramNotification', () => {
  for (const c of redditCases()) {
    it(c.name, async () => {
      const match = { matched: c.matched, categories: [], score: c.score };
      const live = await viaLive(() => liveReddit.sendTelegramNotification(c.post, match));
      const port = await viaPort(redditLeadAlert(c.post as never, match, T0));
      expect(port.body).toBe(live.body);
      expect(port.url).toBe(live.url);
    });
  }
});

function hnCases(): Array<{ name: string; hit: Record<string, unknown>; score: 'high' | 'medium' | 'low'; matched: string[] }> {
  const data = fixture<AlgoliaFixture>('algolia.json');
  const hits = [...Object.values(data.queries).flatMap((e) => e.hits ?? []), ...(data.show_hn.hits ?? [])];
  const base = hits[0];
  const out: Array<{ name: string; hit: Record<string, unknown>; score: 'high' | 'medium' | 'low'; matched: string[] }> = hits.map((h) => ({ name: `fixture ${h.objectID}`, hit: h, score: 'medium', matched: ['who can machine'] }));
  for (const age of [0, 59, 60, 89, 90, 150]) out.push({ name: `age ${age} min`, hit: { ...base, created_at_i: T0 / 1000 - age * 60 }, score: 'high', matched: MANY });
  for (const story_text of [null, '', '<p></p>', '<b>bold</b> text', `<p>${'q'.repeat(320)}</p>`, 'line\nbreak kept']) {
    out.push({ name: `story ${JSON.stringify(story_text)?.slice(0, 16)}`, hit: { ...base, story_text }, score: 'high', matched: ['a', 'b'] });
  }
  out.push({ name: 'score low', hit: base, score: 'low', matched: ['c'] });
  return out;
}

describe('hn alert: byte-equal to the live sendTelegramNotification', () => {
  for (const c of hnCases()) {
    it(c.name, async () => {
      const match = { matched: c.matched, categories: [], score: c.score };
      const live = await viaLive(() => liveHn.sendTelegramNotification(c.hit, match));
      const port = await viaPort(hnLeadAlert(c.hit as never, match, T0));
      expect(port.body).toBe(live.body);
      expect(port.url).toBe(live.url);
    });
  }
});

describe('sources stay plain ASCII', () => {
  for (const file of ['keywords', 'telegram-lead', 'reddit', 'hn', 'tenders', 'common']) {
    it(`src/collectors/${file}.ts has no character above U+007F`, () => {
      const text = readFileSync(new URL(`../../../src/collectors/${file}.ts`, import.meta.url), 'utf8');
      expect([...text].filter((ch) => ch.codePointAt(0)! > 0x7f)).toEqual([]);
    });
  }
});
