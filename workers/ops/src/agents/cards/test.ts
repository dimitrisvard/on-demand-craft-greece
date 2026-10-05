// Test card: one waiting 'test' run with the single verb 'dismiss', started by an admin (POST /api/agent/start
// kind 'test_card') to check the Telegram relay end to end.

import { cardOpenUrl, type CardV1 } from './index';

export function testCard(i: { run_id: string; site_origin: string }): CardV1 {
  return {
    v: 1,
    kind: 'test',
    run_id: i.run_id,
    title: 'Test card',
    lines: [{ label: 'Purpose', value: 'Checks the approval buttons end to end. Tap Dismiss.' }],
    flags: [],
    allowed_verbs: ['dismiss'],
    open_url: cardOpenUrl(i.site_origin, i.run_id),
  };
}
