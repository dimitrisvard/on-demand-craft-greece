// Resend client (MailerPort): POST {RESEND_API_BASE or https://api.resend.com}/emails with an Idempotency-Key, and
// GET /emails/{id} to read back the provider's message_id. 4xx answers are not retryable; 5xx and 429 are.

import type { MailerPort } from '../ports/index';

export const RESEND_API = 'https://api.resend.com';

export function resendMailer(o: { apiKey: string; baseUrl?: string; fetch?: typeof fetch }): MailerPort {
  throw new Error('not implemented: CQ');
}
