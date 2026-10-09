// Article image upload (src/utils/articleImageStorage.ts): the presign request declares the file's size, so the
// upload URL can sign it as Content-Length; the browser then PUTs the file with the presigned type and keeps the
// returned public URL. The extra field is ignored by api/s3.js and by the Worker's legacy path.
import { stubFetch, jsonResponse } from './helpers';
import { supabaseMock } from './mocks/supabase-client';
import { uploadArticleImageToS3 } from '@/utils/articleImageStorage';

const UPLOAD_URL = 'https://store.example.test/articles/featured/42/x.png?X-Amz-Signature=abc';
const PUBLIC_URL = 'https://files.example.test/articles/featured/42/x.png';

beforeEach(() => {
  supabaseMock.reset();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

describe('uploadArticleImageToS3', () => {
  it('declares size: file.size in the presign-upload body, then PUTs the file with its type', async () => {
    supabaseMock.accessToken = 'session-token-for-test';
    const { calls } = stubFetch((call) =>
      call.url.startsWith('/api/s3') ? jsonResponse(200, { uploadUrl: UPLOAD_URL, key: 'articles/featured/42/x.png', publicUrl: PUBLIC_URL }) : new Response(null, { status: 200 }),
    );
    const file = new File([new Uint8Array(1234)], 'hero image.png', { type: 'image/png' });

    const url = await uploadArticleImageToS3(file, 'featured', '42');

    expect(url).toBe(PUBLIC_URL);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe('/api/s3?action=presign-upload');
    const body = JSON.parse(calls[0].body ?? '{}');
    expect(body).toMatchObject({ contentType: 'image/png', size: 1234, prefix: 'featured/42', scope: 'articles' });
    expect(body.size).toBe(file.size);
    expect(body.fileName).toMatch(/^\d+_hero_image\.png$/);
    expect(calls[0].headers.get('authorization')).toBe('Bearer session-token-for-test');
    expect(calls[1].url).toBe(UPLOAD_URL);
    expect(calls[1].method).toBe('PUT');
    expect(calls[1].headers.get('content-type')).toBe('image/png');
  });

  it('an empty file declares size 0; a refused presign returns null without a PUT', async () => {
    const { calls } = stubFetch(() => jsonResponse(400, { error: 'file_type_not_allowed' }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const url = await uploadArticleImageToS3(new File([], 'empty.svg', { type: 'image/svg+xml' }), 'content', '7');
    expect(url).toBeNull();
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].body ?? '{}').size).toBe(0);
  });
});
