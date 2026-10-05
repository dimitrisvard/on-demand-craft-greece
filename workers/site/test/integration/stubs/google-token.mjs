// Google OAuth token endpoint stub of the T2 profile 'agents' (generated ops config: GOOGLE_TOKEN_URL =
// <stub>/oauth2/token).
//
//   POST /oauth2/token                form grant_type=refresh_token; answers {access_token, expires_in} or, when the
//                                     script says so, 400 {error: 'invalid_grant'}
//   POST /__stub/google-token/script  {mode: 'ok' | 'invalid_grant'}
//   GET  /__stub/google-token/calls   recorded grant types (no token or client secret values)
// Module contract of stub-server.mjs: prefixes, createStubModule() -> {handle(req, res, url, body), reset()}.

export const prefixes = ['/oauth2/token', '/__stub/google-token/'];

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

export function createStubModule() {
  let mode = 'ok';
  const calls = [];
  let issued = 0;

  async function handle(req, res, url, body) {
    if (url.pathname === '/__stub/google-token/script' && req.method === 'POST') {
      mode = JSON.parse(body.toString('utf8') || '{}').mode === 'invalid_grant' ? 'invalid_grant' : 'ok';
      res.writeHead(204);
      res.end();
      return true;
    }
    if (url.pathname === '/__stub/google-token/calls' && req.method === 'GET') {
      send(res, 200, calls);
      return true;
    }
    if (url.pathname !== '/oauth2/token' || req.method !== 'POST') return false;
    const form = new URLSearchParams(body.toString('utf8'));
    calls.push({ grant_type: form.get('grant_type'), has_refresh_token: form.has('refresh_token'), has_client_id: form.has('client_id') });
    if (mode === 'invalid_grant' || form.get('grant_type') !== 'refresh_token' || !form.get('refresh_token')) {
      send(res, 400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
      return true;
    }
    issued++;
    send(res, 200, { access_token: `stub-access-${issued}`, expires_in: 3599, token_type: 'Bearer', scope: 'https://www.googleapis.com/auth/gmail.readonly' });
    return true;
  }

  function reset() {
    mode = 'ok';
    calls.length = 0;
    issued = 0;
  }

  return { prefixes, handle, reset, calls };
}
