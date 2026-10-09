// Gmail API stub of the T2 profile 'agents' (generated ops config: GMAIL_API_BASE = <stub>/gmail). Read endpoints
// only, answered from a script the test posts.
//
//   GET /gmail/users/me/history?startHistoryId=…   {history: [{messagesAdded: [{message: {id}}]}], historyId}; with
//                                                  script.staleHistory 404
//   GET /gmail/users/me/messages?q=…               {messages: [{id}]}
//   GET /gmail/users/me/profile                    {historyId}
//   GET /gmail/users/me/messages/<id>?format=metadata|raw   sizeEstimate (bytes of the raw text) and
//                                                  payload.headers / raw (base64url)
//   POST /__stub/gmail/script   {historyId?, added?: [ids], staleHistory?, messages?: {<id>: {headers: {name: value},
//                               raw: <text>}}}
//   GET  /__stub/gmail/calls    recorded paths (no Authorization value)
// Phase 5 (profile 'jobs'): the send endpoint of the campaign mail.
//   POST /gmail/users/me/messages/send       (and /gmail/v1/users/me/messages/send) {raw: base64url MIME} -> the
//                                            next answer of script.send ([{status, body}]), else 200 {id, threadId,
//                                            labelIds: ['SENT']}; a body without raw answers 400
//   GET  /__stub/gmail/sent                  recorded sends: the decoded MIME text and the id answered
// Every request needs an Authorization header (401 otherwise).
// Module contract of stub-server.mjs: prefixes, createStubModule() -> {handle(req, res, url, body), reset()}.

export const prefixes = ['/gmail/', '/__stub/gmail/'];

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function base64url(text) {
  return Buffer.from(text, 'utf8').toString('base64url');
}

export function createStubModule() {
  let script = {};
  const calls = [];
  const sent = [];

  async function handle(req, res, url, body) {
    if (url.pathname === '/__stub/gmail/script' && req.method === 'POST') {
      script = JSON.parse(body.toString('utf8') || '{}');
      res.writeHead(204);
      res.end();
      return true;
    }
    if (url.pathname === '/__stub/gmail/calls' && req.method === 'GET') {
      send(res, 200, calls);
      return true;
    }
    if (url.pathname === '/__stub/gmail/sent' && req.method === 'GET') {
      send(res, 200, sent);
      return true;
    }
    if ((url.pathname === '/gmail/users/me/messages/send' || url.pathname === '/gmail/v1/users/me/messages/send') && req.method === 'POST') {
      calls.push({ method: req.method, path: url.pathname + url.search });
      if (!req.headers.authorization) {
        send(res, 401, { error: { code: 401, message: 'Request is missing required authentication credential.' } });
        return true;
      }
      let raw = null;
      try {
        raw = JSON.parse(body.toString('utf8') || '{}').raw ?? null;
      } catch {
        raw = null;
      }
      if (typeof raw !== 'string' || raw === '') {
        send(res, 400, { error: { code: 400, message: "'raw' RFC822 payload message string or uploading message via /upload/* URL required" } });
        return true;
      }
      const scripted = Array.isArray(script.send) ? script.send.shift() : undefined;
      if (scripted && (scripted.status ?? 200) !== 200) {
        sent.push({ mime: Buffer.from(raw, 'base64url').toString('utf8'), id: null, status: scripted.status });
        send(res, scripted.status, scripted.body ?? { error: { code: scripted.status, message: 'scripted' } });
        return true;
      }
      const id = `gmail-sent-${sent.length + 1}`;
      sent.push({ mime: Buffer.from(raw, 'base64url').toString('utf8'), id, status: 200 });
      send(res, 200, scripted?.body ?? { id, threadId: `thread-${sent.length}`, labelIds: ['SENT'] });
      return true;
    }
    if (!url.pathname.startsWith('/gmail/users/me/')) return false;
    calls.push({ method: req.method, path: url.pathname + url.search });
    if (!req.headers.authorization) {
      send(res, 401, { error: { code: 401, message: 'Request is missing required authentication credential.' } });
      return true;
    }
    const rest = url.pathname.slice('/gmail/users/me/'.length);
    const historyId = String(script.historyId ?? '1000');
    if (rest === 'history') {
      if (script.staleHistory) send(res, 404, { error: { code: 404, message: 'Requested entity was not found.' } });
      else send(res, 200, { history: [{ messagesAdded: (script.added ?? []).map((id) => ({ message: { id } })) }], historyId });
      return true;
    }
    if (rest === 'profile') {
      send(res, 200, { emailAddress: 'sender@example.com', historyId });
      return true;
    }
    if (rest === 'messages') {
      send(res, 200, { messages: Object.keys(script.messages ?? {}).map((id) => ({ id })) });
      return true;
    }
    const match = /^messages\/([A-Za-z0-9_-]+)$/.exec(rest);
    const message = match ? script.messages?.[match[1]] : undefined;
    if (!message) {
      send(res, 404, { error: { code: 404, message: 'Requested entity was not found.' } });
      return true;
    }
    if (url.searchParams.get('format') === 'raw') {
      send(res, 200, { id: match[1], raw: base64url(message.raw ?? '') });
      return true;
    }
    send(res, 200, { id: match[1], sizeEstimate: Buffer.byteLength(message.raw ?? '', 'utf8'), payload: { headers: Object.entries(message.headers ?? {}).map(([name, value]) => ({ name, value })) } });
    return true;
  }

  function reset() {
    script = {};
    calls.length = 0;
    sent.length = 0;
  }

  return { prefixes, handle, reset, calls, sent };
}
