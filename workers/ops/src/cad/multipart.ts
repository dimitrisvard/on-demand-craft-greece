// Streamed multipart/form-data body for the unfold service: text fields, then one file part whose bytes come from
// the R2 object stream. Nothing is buffered: the body is the field bytes, the file stream and the trailer joined into
// one stream of known length (FixedLengthStream in the Workers runtime, so the request carries Content-Length). The
// 128 MB memory limit is per isolate and shared by concurrent requests, so a 50 MB upload must never sit in memory.
//
// Rules
//   - Field names and values are fixed by the caller; the file name is the sanitised safeName() of the stored file.
//   - Quotes, CR and LF are never allowed in a field name, value or file name (they would break the part headers).

export interface MultipartFile {
  name: string;
  fileName: string;
  contentType: string;
  size: number;
  body: ReadableStream<Uint8Array> | ArrayBuffer | Uint8Array;
}

export interface MultipartBody {
  body: ReadableStream<Uint8Array>;
  contentType: string;
  length: number;
}

const encoder = new TextEncoder();

function assertHeaderSafe(value: string, what: string): void {
  if (/["\r\n]/.test(value)) throw new Error(`multipart: ${what} contains a quote or line break`);
}

/** A random boundary (no character that needs quoting). */
export function newBoundary(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `----microns-${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** Bytes before the file content: every field part and the file part's headers. */
export function multipartHead(boundary: string, fields: ReadonlyArray<readonly [string, string]>, file: Pick<MultipartFile, 'name' | 'fileName' | 'contentType'>): Uint8Array {
  let head = '';
  for (const [name, value] of fields) {
    assertHeaderSafe(name, 'field name');
    assertHeaderSafe(value, 'field value');
    head += `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  }
  assertHeaderSafe(file.name, 'file field name');
  assertHeaderSafe(file.fileName, 'file name');
  assertHeaderSafe(file.contentType, 'file content type');
  head += `--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.fileName}"\r\nContent-Type: ${file.contentType}\r\n\r\n`;
  return encoder.encode(head);
}

/** Bytes after the file content. */
export function multipartTail(boundary: string): Uint8Array {
  return encoder.encode(`\r\n--${boundary}--\r\n`);
}

function streamOf(body: MultipartFile['body']): ReadableStream<Uint8Array> {
  if (body instanceof ReadableStream) return body;
  const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

type FixedLengthStreamCtor = new (length: number) => TransformStream<Uint8Array, Uint8Array>;

/** The multipart body as one stream of `length` bytes (FixedLengthStream when the runtime has it). */
export function multipartBody(fields: ReadonlyArray<readonly [string, string]>, file: MultipartFile, boundary = newBoundary()): MultipartBody {
  const head = multipartHead(boundary, fields, file);
  const tail = multipartTail(boundary);
  const length = head.byteLength + file.size + tail.byteLength;
  const content = streamOf(file.body);
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let stage: 'head' | 'file' | 'tail' | 'done' = 'head';
  let sent = 0;
  const joined = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (stage === 'head') {
        controller.enqueue(head);
        stage = 'file';
        return;
      }
      if (stage === 'file') {
        reader ??= content.getReader();
        const { done, value } = await reader.read();
        if (!done) {
          sent += value.byteLength;
          if (sent > file.size) {
            controller.error(new Error('multipart: file stream longer than its declared size'));
            return;
          }
          controller.enqueue(value);
          return;
        }
        if (sent !== file.size) {
          controller.error(new Error('multipart: file stream shorter than its declared size'));
          return;
        }
        stage = 'tail';
      }
      if (stage === 'tail') {
        controller.enqueue(tail);
        stage = 'done';
        controller.close();
      }
    },
    async cancel(reason) {
      await (reader ?? content.getReader()).cancel(reason).catch(() => undefined);
    },
  });
  const Fixed = (globalThis as { FixedLengthStream?: FixedLengthStreamCtor }).FixedLengthStream;
  const body = Fixed ? joined.pipeThrough(new Fixed(length)) : joined;
  return { body, contentType: `multipart/form-data; boundary=${boundary}`, length };
}
