// Telegram Bot API stub of the T2 profile 'agents' (generated ops config: TELEGRAM_API_BASE = <stub>/telegram).
//
//   POST /telegram/bot<token>/<method>   sendMessage (answers a new message_id), editMessageText,
//                                         editMessageReplyMarkup, answerCallbackQuery (answer true)
//   GET  /__stub/telegram/calls          recorded calls: method and JSON body (the bot token in the path is never
//                                         recorded); Phase 5: also `raw`, the request body byte for byte (UTF-8), so
//                                         plain lead alerts can be compared with the live texts
// Module contract of stub-server.mjs: prefixes, createStubModule() -> {handle(req, res, url, body), reset()}.

export const prefixes = ['/telegram/', '/__stub/telegram/'];
const METHODS = new Set(['sendMessage', 'editMessageText', 'editMessageReplyMarkup', 'answerCallbackQuery']);

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

export function createStubModule() {
  const calls = [];
  let nextMessageId = 1000;

  async function handle(req, res, url, body) {
    if (url.pathname === '/__stub/telegram/calls' && req.method === 'GET') {
      send(res, 200, calls);
      return true;
    }
    const match = /^\/telegram\/bot[^/]+\/([A-Za-z]+)$/.exec(url.pathname);
    if (!match || req.method !== 'POST') return false;
    const method = match[1];
    if (!METHODS.has(method)) {
      send(res, 404, { ok: false, error_code: 404, description: 'Not Found: method not found' });
      return true;
    }
    let parsed = {};
    try {
      parsed = JSON.parse(body.toString('utf8') || '{}');
    } catch {
      send(res, 400, { ok: false, error_code: 400, description: 'Bad Request: invalid JSON' });
      return true;
    }
    calls.push({ method, body: parsed, raw: body.toString('utf8') });
    if (method === 'sendMessage') {
      send(res, 200, { ok: true, result: { message_id: nextMessageId++, chat: { id: parsed.chat_id }, date: Math.floor(Date.now() / 1000), text: parsed.text } });
    } else {
      send(res, 200, { ok: true, result: true });
    }
    return true;
  }

  function reset() {
    calls.length = 0;
    nextMessageId = 1000;
  }

  return { prefixes, handle, reset, calls };
}
