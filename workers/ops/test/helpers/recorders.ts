// Recording fakes of the outbound ports for T1 tests, and one log guard.
//   RecordingMailer    MailerPort: records every send, honours the idempotency key (a repeated key returns the
//                      first provider id and sends nothing)
//   RecordingTelegram  TelegramPort: records cards, edits and notices, numbers messages; failNext() makes the next
//                      call throw
//   RecordingEvents    EventsPort: records data points
//   RecordingLogger    captures console.log/warn/error lines
//   assertNoSecretsLogged(lines, secrets): fails when a line contains one of the given secrets (tokens, hashes,
//                      subjects) or anything shaped like an e-mail address

import type { AgentEventPoint } from '../../src/agents/events';
import type { CardV1 } from '../../src/agents/cards/index';
import type { EventsPort, MailerPort, OutboundMail, TelegramPort } from '../../src/ports/index';

export class RecordingMailer implements MailerPort {
  readonly sent: OutboundMail[] = [];
  /** Provider ids by idempotency key. */
  readonly byKey = new Map<string, string>();
  /** Message ids returned by fetchMessageId, by provider id (default '<provider-id@resend.example>'). */
  readonly messageIds = new Map<string, string | null>();
  /** When set, send() answers this failure. */
  failWith?: { status: number; retryable: boolean; message: string };

  async send(m: OutboundMail): Promise<{ ok: true; provider_id: string } | { ok: false; status: number; retryable: boolean; message: string }> {
    if (this.failWith) return { ok: false, ...this.failWith };
    const existing = this.byKey.get(m.idempotency_key);
    if (existing) return { ok: true, provider_id: existing };
    const id = `resend-${this.sent.length + 1}`;
    this.sent.push(structuredClone(m));
    this.byKey.set(m.idempotency_key, id);
    return { ok: true, provider_id: id };
  }

  async fetchMessageId(providerId: string): Promise<string | null> {
    if (this.messageIds.has(providerId)) return this.messageIds.get(providerId) ?? null;
    return [...this.byKey.values()].includes(providerId) ? `<${providerId}@resend.example>` : null;
  }
}

export class RecordingTelegram implements TelegramPort {
  readonly cards: Array<{ message_id: number; card: CardV1; token: string | null }> = [];
  readonly edits: Array<{ message_id: number; card: CardV1 | { text: string } }> = [];
  readonly texts: Array<{ message_id: number; text: string }> = [];
  private next = 100;
  private failures = 0;

  /** The next n calls throw (a Bot API outage). */
  failNext(n = 1): void {
    this.failures = n;
  }

  private maybeFail(): void {
    if (this.failures > 0) {
      this.failures--;
      throw new Error('telegram sendMessage: 502');
    }
  }

  async sendCard(c: CardV1, token?: string | null): Promise<{ message_id: number }> {
    this.maybeFail();
    const message_id = this.next++;
    this.cards.push({ message_id, card: structuredClone(c), token: token ?? null });
    return { message_id };
  }

  async editCard(messageId: number, c: CardV1 | { text: string }): Promise<void> {
    this.maybeFail();
    this.edits.push({ message_id: messageId, card: structuredClone(c) });
  }

  async sendText(text: string): Promise<{ message_id: number }> {
    this.maybeFail();
    const message_id = this.next++;
    this.texts.push({ message_id, text });
    return { message_id };
  }
}

export class RecordingEvents implements EventsPort {
  readonly points: AgentEventPoint[] = [];

  point(p: AgentEventPoint): void {
    this.points.push(structuredClone(p));
  }
}

export class RecordingLogger {
  readonly lines: string[] = [];

  /** Starts capturing console output; returns a function that restores it. */
  start(): () => void {
    const original = { log: console.log, warn: console.warn, error: console.error, info: console.info };
    const capture =
      (level: string) =>
      (...args: unknown[]) => {
        this.lines.push(`${level} ${args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`);
      };
    console.log = capture('log');
    console.info = capture('info');
    console.warn = capture('warn');
    console.error = capture('error');
    return () => {
      console.log = original.log;
      console.info = original.info;
      console.warn = original.warn;
      console.error = original.error;
    };
  }
}

const EMAIL_SHAPE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/;

/** Throws when any line contains one of the secrets, an e-mail address or a subject passed in. */
export function assertNoSecretsLogged(lines: readonly string[], secrets: readonly string[]): void {
  for (const line of lines) {
    for (const secret of secrets) {
      if (secret && line.includes(secret)) throw new Error(`a log line contains a secret value: ${line.slice(0, 80)}...`);
    }
    if (EMAIL_SHAPE.test(line)) throw new Error(`a log line contains an e-mail address: ${line.replace(EMAIL_SHAPE, '<address>')}`);
  }
}
