// Plain-text Telegram lead alerts of the scheduled collectors (Phase 5, unit G5), byte for byte the texts of the live
// reddit-collector (version 15) and hn-collector (version 7); sent through P5Ports.telegramText (sendMessage without
// parse_mode, disable_web_page_preview true, as live).
//
// Rules
//   - The emoji and punctuation of the live templates are written as \u escapes so this file stays plain ASCII; a
//     test compares the produced text with the live functions run on the same input.
//   - "now" is passed in (epoch ms); the age is computed exactly as live: minutes = round((now / 1000 - created) /
//     60), shown in minutes below 60, else as round(minutes / 60) hours.
//   - Values are interpolated exactly as live (a missing field prints as the live template would print it).

import type { KeywordMatch, LeadScore } from './keywords';

/** Red, yellow and green circle (U+1F534, U+1F7E1, U+1F7E2). */
const SCORE_MARK: Readonly<Record<'high' | 'medium' | 'other', string>> = Object.freeze({
  high: '\u{1F534}',
  medium: '\u{1F7E1}',
  other: '\u{1F7E2}',
});
const MIDDLE_DOT = '\u{B7}';
const EM_DASH = '\u{2014}';
const PIN = '\u{1F4CD}';
const ALARM_CLOCK = '\u{23F0}';
const BUST = '\u{1F464}';
const PUSHPIN = '\u{1F4CC}';
const SPEECH = '\u{1F4AC}';
const LABEL = '\u{1F3F7}';
const LINK = '\u{1F517}';

function mark(score: LeadScore | string): string {
  return score === 'high' ? SCORE_MARK.high : score === 'medium' ? SCORE_MARK.medium : SCORE_MARK.other;
}

/** The fields of a PullPush submission the alert reads (as the live RedditPost). */
export interface RedditAlertPost {
  title: unknown;
  selftext: unknown;
  author: unknown;
  permalink: unknown;
  created_utc: unknown;
  subreddit: unknown;
}

/** The fields of an Algolia hit the alert reads (as the live HNHit). */
export interface HnAlertHit {
  objectID: unknown;
  title: unknown;
  story_text: unknown;
  author: unknown;
  created_at_i: unknown;
}

/** The live reddit lead alert. */
export function redditLeadAlert(post: RedditAlertPost, match: Pick<KeywordMatch, 'matched' | 'score'>, nowMs: number): string {
  const timeAgo = Math.round((nowMs / 1000 - (post.created_utc as number)) / 60);
  const timeStr = timeAgo < 60 ? `${timeAgo}m ago` : `${Math.round(timeAgo / 60)}h ago`;
  const selftext = post.selftext as string;
  const excerpt = (selftext || '').slice(0, 300).replace(/\n/g, ' ').trim();
  const postUrl = `https://reddit.com${post.permalink}`;
  return (
    `${mark(match.score)} ${match.score.toUpperCase()} LEAD\n\n` +
    `r/${post.subreddit} ${MIDDLE_DOT} ${timeStr} ${MIDDLE_DOT} u/${post.author}\n\n` +
    `${post.title}\n\n` +
    (excerpt ? `"${excerpt}${selftext.length > 300 ? '...' : ''}"\n\n` : '') +
    `Keywords: ${match.matched.slice(0, 5).join(', ')}\n` +
    `${postUrl}`
  );
}

/** The live Hacker News lead alert. */
export function hnLeadAlert(hit: HnAlertHit, match: Pick<KeywordMatch, 'matched' | 'score'>, nowMs: number): string {
  const timeAgo = Math.round((nowMs / 1000 - (hit.created_at_i as number)) / 60);
  const timeStr = timeAgo < 60 ? `${timeAgo} min ago` : `${Math.round(timeAgo / 60)} hr ago`;
  const excerpt = ((hit.story_text as string) || '').slice(0, 300).replace(/<[^>]+>/g, '').trim();
  const postUrl = `https://news.ycombinator.com/item?id=${hit.objectID}`;
  return (
    `${mark(match.score)} ${match.score.toUpperCase()} INTENT LEAD ${EM_DASH} Hacker News\n\n` +
    `${PIN} Source: Hacker News\n` +
    `${ALARM_CLOCK} Posted: ${timeStr}\n` +
    `${BUST} Author: ${hit.author}\n\n` +
    `${PUSHPIN} Title: ${hit.title}\n\n` +
    (excerpt ? `${SPEECH} Excerpt: "${excerpt}..."\n\n` : '') +
    `${LABEL} Keywords: ${match.matched.slice(0, 5).join(', ')}\n\n` +
    `${LINK} Post: ${postUrl}\n\nOpen Dashboard: /dashboard/leads`
  );
}
