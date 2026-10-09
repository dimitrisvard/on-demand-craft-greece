// Personalisation of campaign and follow-up mails, ported from supabase/functions/send-campaign/index.ts:19-40 and
// :293-303 (process-followups/index.ts:21-42 and :160-167 hold the same functions).
//
// Rules (as the repo functions)
//   - parseSpintax: every innermost {a|b|c} group becomes one of its options, picked with the random source; a
//     group without '|' is kept with its braces; at most 10 passes, so nested groups resolve from the inside out.
//     Text without '{' is returned unchanged.
//   - replaceVariables: {{name}}, {{company}}, {{email}} (any case) become the variable's value, '' when empty.
//   - Variables of a recipient: name = subscriber name or "there", company "", email = subscriber address, applied in
//     the order of the repo function of the mail kind (campaign: name, company, email; follow-up: name, email,
//     company), so a value that holds another placeholder resolves exactly as there.
//   - The random source is injectable (tests seed it); production uses Math.random for the A/B draw of the route.
//   - The spintax draws of one queued message come from messageRandom(idem): a stream seeded with the SHA-256 of the
//     message's idempotency key, so every delivery of the message (retry, redelivery, deferred copy) produces the same
//     subject and body, and the provider sees one payload per Idempotency-Key. Different messages draw independently
//     and uniformly, as the repo's per-call Math.random does.

export type RandomSource = () => number;

export const defaultRandom: RandomSource = () => Math.random();

/** The spintax random source of one message (rules above): mulberry32 over the first 4 bytes of SHA-256. */
export async function messageRandom(idem: string): Promise<RandomSource> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`spintax:${idem}`)));
  let state = (((digest[0] as number) << 24) | ((digest[1] as number) << 16) | ((digest[2] as number) << 8) | (digest[3] as number)) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function parseSpintax(text: string, random: RandomSource = defaultRandom): string {
  if (!text || !text.includes('{')) return text;
  let result = text;
  let iterations = 0;
  while (/\{([^{}]+)\}/.test(result) && iterations < 10) {
    result = result.replace(/\{([^{}]+)\}/g, (_match, group: string) => {
      const options = group.split('|');
      if (options.length === 1) return `{${group}}`;
      return options[Math.floor(random() * options.length)] as string;
    });
    iterations++;
  }
  return result;
}

/** As the repo: a string replacement (so '$&' and friends in a value keep String.replace semantics). */
export function replaceVariables(text: string, vars: Record<string, string>): string {
  let result = text;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'gi'), value || '');
  }
  return result;
}

export type MailKind = 'campaign' | 'followup';

/** Variables of one recipient, in the repo order of the mail kind. */
export function recipientVars(subscriber: { name?: string | null; email: string }, kind: MailKind = 'campaign'): Record<string, string> {
  const name = subscriber.name || 'there';
  return kind === 'followup' ? { name, email: subscriber.email, company: '' } : { name, company: '', email: subscriber.email };
}

/** Subject and body after spintax and variables, in the repo order (subject first, then body). */
export function personalise(
  subject: string,
  body: string,
  subscriber: { name?: string | null; email: string },
  random: RandomSource = defaultRandom,
  kind: MailKind = 'campaign',
): { subject: string; body: string } {
  const vars = recipientVars(subscriber, kind);
  return {
    subject: replaceVariables(parseSpintax(subject, random), vars),
    body: replaceVariables(parseSpintax(body, random), vars),
  };
}
