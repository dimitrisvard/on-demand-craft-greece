import { supabaseMock } from './mocks/supabase-client';
import {
  captureAnchorClicks,
  fakeWindow,
  flush,
  jsonResponse,
  opaqueRedirect,
  stubFetch,
  stubObjectUrls,
  stubWindowOpen,
} from './helpers';
import {
  API_UNAUTHORIZED_EVENT,
  OBJECT_URL_TTL_MS,
  apiAuthHeaders,
  downloadWithAuth,
  fetchWithAuth,
  filenameFromDisposition,
  isTrustedMessageOrigin,
  onApiUnauthorized,
  openAuthorizedPopup,
  openWithAuth,
  resolvePopupUrl,
} from '@/utils/apiAuth';

const toastSpy = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ toast: toastSpy, useToast: () => ({ toast: toastSpy }) }));

let objectUrls: ReturnType<typeof stubObjectUrls>;

beforeEach(() => {
  supabaseMock.reset();
  toastSpy.mockReset();
  objectUrls = stubObjectUrls();
});

afterEach(() => {
  objectUrls.restore();
  vi.useRealTimers();
});

describe('apiAuthHeaders', () => {
  it('returns the session access token as a Bearer header when signed in', async () => {
    supabaseMock.accessToken = 'session-token-1';
    expect(await apiAuthHeaders()).toEqual({ Authorization: 'Bearer session-token-1' });
  });

  it('returns no header when signed out', async () => {
    expect(await apiAuthHeaders()).toEqual({});
  });

  it('returns no header when the session lookup fails', async () => {
    supabaseMock.sessionError = new Error('storage unavailable');
    expect(await apiAuthHeaders()).toEqual({});
  });
});

describe('fetchWithAuth', () => {
  it('adds the Authorization header and keeps the caller headers, method and body', async () => {
    supabaseMock.accessToken = 'tok';
    const { calls } = stubFetch(() => jsonResponse(200, { ok: true }));
    await fetchWithAuth('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"action":"nest"}',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].headers.get('authorization')).toBe('Bearer tok');
    expect(calls[0].headers.get('content-type')).toBe('application/json');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].body).toBe('{"action":"nest"}');
  });

  it('sends no Authorization header when signed out', async () => {
    const { calls } = stubFetch(() => jsonResponse(200, {}));
    await fetchWithAuth('/api/tenders');
    expect(calls[0].headers.has('authorization')).toBe(false);
  });

  it('never overrides an Authorization header the caller set', async () => {
    supabaseMock.accessToken = 'tok';
    const { calls } = stubFetch(() => jsonResponse(200, {}));
    await fetchWithAuth('/api/gsc', { headers: { Authorization: 'Bearer explicit' } });
    expect(calls[0].headers.get('authorization')).toBe('Bearer explicit');
  });

  it('announces a 401 from /api/* and nothing else', async () => {
    const seen: string[] = [];
    const off = onApiUnauthorized(() => seen.push('401'));
    const statuses = [401, 403, 200];
    stubFetch((_c, i) => jsonResponse(statuses[i] ?? 401, {}));
    await fetchWithAuth('/api/s3?action=list');
    await fetchWithAuth('/api/s3?action=list');
    await fetchWithAuth('/api/s3?action=list');
    await fetchWithAuth('https://other.example/api/x');
    off();
    expect(seen).toEqual(['401']);
  });

  it('dispatches the event under the documented name', async () => {
    const listener = vi.fn();
    window.addEventListener(API_UNAUTHORIZED_EVENT, listener);
    stubFetch(() => jsonResponse(401, { error: 'unauthorized' }));
    await fetchWithAuth('/api/notifications?action=inv-stock');
    window.removeEventListener(API_UNAUTHORIZED_EVENT, listener);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('openWithAuth', () => {
  it('opens the window synchronously, before the authorised fetch starts', async () => {
    supabaseMock.accessToken = 'tok';
    const log: string[] = [];
    const w = fakeWindow();
    stubWindowOpen(w, log);
    const { calls } = stubFetch(() => new Response('%PDF-1.4', { status: 200, headers: { 'content-type': 'application/pdf' } }), log);

    const pending = openWithAuth('/api/notifications?action=inv-label&stockItemId=s1', 'label-s1.pdf');
    // window.open ran inside the call itself (still inside the click handler).
    expect(log).toEqual(['open ']);
    expect(await pending).toBe(true);

    expect(log).toEqual(['open ', 'fetch /api/notifications?action=inv-label&stockItemId=s1']);
    expect(calls[0].headers.get('authorization')).toBe('Bearer tok');
    expect(w.opener).toBeNull();
    expect(w.location.href).toBe('blob:http://localhost:3000/object-1');
  });

  it('revokes the object URL on the window load event (not on the initial blank load)', async () => {
    const w = fakeWindow();
    stubWindowOpen(w);
    stubFetch(() => new Response('pdf', { status: 200 }));
    // An initial about:blank load before navigation must not revoke.
    const pending = openWithAuth('/api/notifications?action=inv-label&stockItemId=s1', 'label-s1.pdf');
    await pending;
    const href = w.location.href;
    w.location.href = 'about:blank';
    w.fire('load');
    expect(objectUrls.revoke).not.toHaveBeenCalled();
    w.location.href = href;
    w.fire('load');
    w.fire('load');
    expect(objectUrls.revoke).toHaveBeenCalledTimes(1);
    expect(objectUrls.revoke).toHaveBeenCalledWith(href);
  });

  it('revokes the object URL after 60 s when no load event arrives', async () => {
    vi.useFakeTimers();
    const w = fakeWindow();
    stubWindowOpen(w);
    stubFetch(() => new Response('pdf', { status: 200 }));
    const pending = openWithAuth('/api/x', 'x.pdf');
    await vi.advanceTimersByTimeAsync(0);
    expect(await pending).toBe(true);
    expect(objectUrls.revoke).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(OBJECT_URL_TTL_MS - 1);
    expect(objectUrls.revoke).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(objectUrls.revoke).toHaveBeenCalledTimes(1);
    w.fire('load');
    expect(objectUrls.revoke).toHaveBeenCalledTimes(1);
  });

  it('falls back to an anchor download when the popup is blocked, and revokes after 60 s', async () => {
    vi.useFakeTimers();
    stubWindowOpen(null);
    const clicks = captureAnchorClicks();
    stubFetch(() => new Response('pdf', { status: 200 }));
    const pending = openWithAuth('/api/notifications?action=inv-label&stockItemId=s9', 'label-s9.pdf');
    await vi.advanceTimersByTimeAsync(0);
    expect(await pending).toBe(true);
    expect(clicks).toEqual([{ href: 'blob:http://localhost:3000/object-1', download: 'label-s9.pdf' }]);
    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
    expect(objectUrls.revoke).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(OBJECT_URL_TTL_MS);
    expect(objectUrls.revoke).toHaveBeenCalledTimes(1);
  });

  it('does nothing with the answer when the visitor closed the window while it loaded', async () => {
    const w = fakeWindow();
    stubWindowOpen(w);
    const clicks = captureAnchorClicks();
    stubFetch(() => {
      // The tab is closed while the request is still in flight.
      w.closed = true;
      return new Response('%PDF-1.4', { status: 200, headers: { 'content-type': 'application/pdf' } });
    });
    expect(await openWithAuth('/api/notifications?action=inv-label&stockItemId=s1', 'label-s1.pdf')).toBe(false);
    expect(objectUrls.create).toHaveBeenCalledTimes(1);
    expect(objectUrls.revoke).toHaveBeenCalledTimes(1);
    expect(objectUrls.revoke).toHaveBeenCalledWith('blob:http://localhost:3000/object-1');
    expect(w.location.href).toBe('about:blank');
    expect(clicks).toHaveLength(0);
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it('closes the window and shows a toast when the request fails', async () => {
    const w = fakeWindow();
    stubWindowOpen(w);
    stubFetch(() => jsonResponse(401, { error: 'unauthorized' }));
    expect(await openWithAuth('/api/x', 'x.pdf')).toBe(false);
    expect(w.close).toHaveBeenCalledTimes(1);
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(objectUrls.create).not.toHaveBeenCalled();
  });
});

describe('downloadWithAuth', () => {
  it('saves the authorised answer under the server file name and revokes after 60 s', async () => {
    vi.useFakeTimers();
    supabaseMock.accessToken = 'tok';
    const clicks = captureAnchorClicks();
    const { calls } = stubFetch(
      () =>
        new Response('a,b\n', {
          status: 200,
          headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="micronshub-tenders-2026-10-04.csv"' },
        }),
    );
    const pending = downloadWithAuth('/api/tenders?export=csv', 'fallback.csv');
    await vi.advanceTimersByTimeAsync(0);
    await pending;
    expect(calls[0].headers.get('authorization')).toBe('Bearer tok');
    expect(clicks).toEqual([{ href: 'blob:http://localhost:3000/object-1', download: 'micronshub-tenders-2026-10-04.csv' }]);
    expect(objectUrls.revoke).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(OBJECT_URL_TTL_MS);
    expect(objectUrls.revoke).toHaveBeenCalledWith('blob:http://localhost:3000/object-1');
  });

  it('uses the given file name when the answer names none', async () => {
    const clicks = captureAnchorClicks();
    stubFetch(() => new Response('x', { status: 200 }));
    await downloadWithAuth('/api/funded-startups?action=export', 'funded-startups.csv');
    expect(clicks[0].download).toBe('funded-startups.csv');
  });

  it('throws on a non-2xx answer and creates no object URL', async () => {
    stubFetch(() => jsonResponse(403, { error: 'forbidden' }));
    await expect(downloadWithAuth('/api/tenders?export=csv', 'x.csv')).rejects.toThrow('403');
    expect(objectUrls.create).not.toHaveBeenCalled();
  });
});

describe('filenameFromDisposition', () => {
  it.each([
    ['attachment; filename="a b.csv"', 'a b.csv'],
    ['inline; filename=label.pdf', 'label.pdf'],
    ["attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf", 'résumé.pdf'],
    ['attachment', null],
    [null, null],
  ])('%s -> %s', (header, expected) => {
    expect(filenameFromDisposition(header)).toBe(expected);
  });
});

describe('Gmail connect popup (authorize step)', () => {
  const AUTHORIZE = '/api/marketing?action=google-auth&step=authorize&account_id=a1';
  const GOOGLE = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=y';

  it('uses the JSON url of a 200 answer and sends the session token, Accept JSON and redirect manual', async () => {
    supabaseMock.accessToken = 'admin-token';
    const { calls } = stubFetch(() => jsonResponse(200, { url: GOOGLE }));
    expect(await resolvePopupUrl(AUTHORIZE, AUTHORIZE)).toBe(GOOGLE);
    expect(calls[0].headers.get('accept')).toBe('application/json');
    expect(calls[0].headers.get('authorization')).toBe('Bearer admin-token');
    expect(calls[0].redirect).toBe('manual');
  });

  it.each([
    ['an opaque redirect', () => opaqueRedirect()],
    ['401 JSON', () => jsonResponse(401, { error: 'unauthorized' })],
    ['403 JSON', () => jsonResponse(403, { error: 'forbidden' })],
    ['403 JSON that carries a url', () => jsonResponse(403, { url: 'https://accounts.google.com/x' })],
    ['201 JSON that carries a url', () => jsonResponse(201, { url: 'https://accounts.google.com/x' })],
    ['429 HTML challenge page', () => new Response('<html>challenge</html>', { status: 429, headers: { 'content-type': 'text/html' } })],
    ['200 HTML', () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } })],
    ['200 JSON without url', () => jsonResponse(200, { ok: true })],
    ['200 JSON with a non-https url', () => jsonResponse(200, { url: 'javascript:alert(1)' })],
    ['a network error', () => Promise.reject(new TypeError('Failed to fetch'))],
  ])('falls back to the authorize URL on %s', async (_name, answer) => {
    stubFetch(answer as () => Response);
    expect(await resolvePopupUrl(AUTHORIZE, AUTHORIZE)).toBe(AUTHORIZE);
  });

  it('opens the popup synchronously, keeps its opener, then navigates it', async () => {
    const log: string[] = [];
    const popup = fakeWindow();
    const open = stubWindowOpen(popup, log);
    stubFetch(() => jsonResponse(200, { url: GOOGLE }), log);
    const result = openAuthorizedPopup(AUTHORIZE, AUTHORIZE, 'google-oauth', 'width=600');
    expect(log).toEqual(['open about:blank']);
    expect(open).toHaveBeenCalledWith('about:blank', 'google-oauth', 'width=600');
    expect(result).toBe(popup);
    await flush();
    expect(log[1]).toBe(`fetch ${AUTHORIZE}`);
    expect(popup.location.href).toBe(GOOGLE);
    expect(popup.opener).toBe(window);
  });

  it('sends the popup to the authorize URL itself when the answer is a redirect', async () => {
    const popup = fakeWindow();
    stubWindowOpen(popup);
    stubFetch(() => opaqueRedirect());
    openAuthorizedPopup(AUTHORIZE, AUTHORIZE, 'google-oauth', '');
    await flush();
    expect(popup.location.href).toBe(AUTHORIZE);
  });

  it('returns null and sends nothing when the popup is blocked', () => {
    stubWindowOpen(null);
    const { fn } = stubFetch(() => jsonResponse(200, { url: GOOGLE }));
    expect(openAuthorizedPopup(AUTHORIZE, AUTHORIZE, 'google-oauth', '')).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it.each([
    [window.location.origin, true],
    ['https://www.micronshub.eu', true],
    ['https://micronshub.eu', false],
    ['https://www.micronshub.eu.evil.example', false],
    ['https://evil.example', false],
    ['null', false],
    ['', false],
  ])('accepts OAuth messages from %s: %s', (origin, expected) => {
    expect(isTrustedMessageOrigin(origin)).toBe(expected);
  });
});

describe('/api/s3 helpers', () => {
  it('presign-upload sends the session token and the optional size field; the upload itself carries no token', async () => {
    supabaseMock.accessToken = 'customer-token';
    const { uploadFileToS3 } = await import('@/utils/awsS3Storage');
    const { calls } = stubFetch((call) =>
      call.url.startsWith('/api/s3')
        ? jsonResponse(200, { uploadUrl: 'https://upload.example/rfq/k?X-Amz-Signature=s', key: 'RFQ-1/part-A/a.step' })
        : new Response(null, { status: 200 }),
    );
    const file = new File(['0123456789'], 'a.step', { type: 'application/step' });
    expect(await uploadFileToS3(file, 'RFQ-1/part-A')).toBe('RFQ-1/part-A/a.step');

    expect(calls[0].url).toBe('/api/s3?action=presign-upload');
    expect(calls[0].headers.get('authorization')).toBe('Bearer customer-token');
    expect(JSON.parse(calls[0].body ?? '{}')).toEqual({
      fileName: 'a.step',
      contentType: 'application/step',
      prefix: 'RFQ-1/part-A',
      scope: 'rfq',
      size: 10,
    });
    expect(calls[1].url).toBe('https://upload.example/rfq/k?X-Amz-Signature=s');
    expect(calls[1].method).toBe('PUT');
    expect(calls[1].headers.has('authorization')).toBe(false);
  });
});
