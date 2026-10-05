// Resend API stub of the T2 profile 'agents' (generated ops config: RESEND_API_BASE = <stub>/resend).
//
//   POST /resend/emails        needs an Authorization header; honours Idempotency-Key (a repeated key answers the
//                              first id and sends nothing); answers {id}
//   GET  /resend/emails/:id    {id, message_id} (the provider's Message-ID of a recorded mail)
//   GET  /__stub/resend/emails recorded mails: id, idempotency key, from, to, reply_to, subject, header names,
//                              attachment names (test data only; synthetic addresses)
// Module contract of stub-server.mjs: prefixes, createStubModule() -> {handle(req, res, url, body), reset()}.

export const prefixes = ['/resend/', '/__stub/resend/'];

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

export function createStubModule() {
  const emails = [];
  const byKey = new Map();

  async function handle(req, res, url, body) {
    if (url.pathname === '/__stub/resend/emails' && req.method === 'GET') {
      send(res, 200, emails);
      return true;
    }
    if (url.pathname === '/resend/emails' && req.method === 'POST') {
      if (!req.headers.authorization) {
        send(res, 401, { name: 'missing_api_key', message: 'Missing API key' });
        return true;
      }
      const key = req.headers['idempotency-key'];
      if (key && byKey.has(key)) {
        send(res, 200, { id: byKey.get(key) });
        return true;
      }
      const m = JSON.parse(body.toString('utf8') || '{}');
      const id = `stub-email-${emails.length + 1}`;
      emails.push({
        id,
        idempotency_key: key ?? null,
        from: m.from,
        to: m.to,
        reply_to: m.reply_to ?? null,
        subject: m.subject,
        header_names: Object.keys(m.headers ?? {}),
        message_id_header: m.headers?.['Message-ID'] ?? null,
        attachments: (m.attachments ?? []).map((a) => a.filename),
        message_id: `<${id}@resend.stub>`,
      });
      if (key) byKey.set(key, id);
      send(res, 200, { id });
      return true;
    }
    const match = /^\/resend\/emails\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
    if (match && req.method === 'GET') {
      const email = emails.find((e) => e.id === match[1]);
      if (!email) send(res, 404, { name: 'not_found', message: 'Email not found' });
      else send(res, 200, { object: 'email', id: email.id, message_id: email.message_id });
      return true;
    }
    return false;
  }

  function reset() {
    emails.length = 0;
    byKey.clear();
  }

  return { prefixes, handle, reset, emails };
}
