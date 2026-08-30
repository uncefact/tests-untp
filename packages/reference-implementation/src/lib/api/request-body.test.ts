import { TextEncoder } from 'node:util';
import { PayloadTooLargeError } from '@/lib/api/errors';
import { readRequestBytes } from './request-body';

function bodyFromChunks(chunks: Uint8Array[], headers: Record<string, string> = {}): Request {
  let index = 0;
  return {
    headers: new Headers(headers),
    body: {
      getReader() {
        return {
          async read() {
            if (index >= chunks.length) return { done: true as const, value: undefined };
            const value = chunks[index];
            index += 1;
            return { done: false as const, value };
          },
          async cancel() {
            index = chunks.length;
          },
        };
      },
    },
  } as unknown as Request;
}

function bodyFromString(body: string, headers: Record<string, string> = {}): Request {
  return bodyFromChunks([new TextEncoder().encode(body)], headers);
}

describe('readRequestBytes', () => {
  const ORIGINAL = process.env.MAX_REQUEST_BODY_BYTES;

  beforeEach(() => {
    process.env.MAX_REQUEST_BODY_BYTES = '1024';
  });

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.MAX_REQUEST_BODY_BYTES;
    } else {
      process.env.MAX_REQUEST_BODY_BYTES = ORIGINAL;
    }
  });

  it('returns the bytes of a body under the cap', async () => {
    const payload = '{"ok":true}';
    const bytes = await readRequestBytes(bodyFromString(payload));

    expect(Buffer.from(bytes).toString('utf8')).toBe(payload);
  });

  it('returns an empty array when the request has no body', async () => {
    const req = { headers: new Headers(), body: null } as unknown as Request;
    const bytes = await readRequestBytes(req);

    expect(bytes.byteLength).toBe(0);
  });

  it('rejects a Content-Length over the cap before reading any bytes', async () => {
    let read = false;
    const req = {
      headers: new Headers({ 'Content-Length': '2048' }),
      body: {
        getReader() {
          read = true;
          return {
            async read() {
              return { done: true as const, value: undefined };
            },
            async cancel() {},
          };
        },
      },
    } as unknown as Request;

    await expect(readRequestBytes(req)).rejects.toMatchObject({
      name: 'PayloadTooLargeError',
      message: 'The request body exceeds the maximum of 1024 bytes.',
      code: 'REQUEST_BODY_TOO_LARGE',
    });
    expect(read).toBe(false);
  });

  it('rejects when Content-Length is absent and the streamed body exceeds the cap', async () => {
    const over = new Uint8Array(1025).fill(0x61);

    await expect(readRequestBytes(bodyFromChunks([over]))).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it('rejects when Content-Length lies below the cap and the streamed body exceeds it', async () => {
    const over = new Uint8Array(2000).fill(0x61);

    await expect(readRequestBytes(bodyFromChunks([over], { 'Content-Length': '10' }))).rejects.toMatchObject({
      name: 'PayloadTooLargeError',
      code: 'REQUEST_BODY_TOO_LARGE',
      message: 'The request body exceeds the maximum of 1024 bytes.',
    });
  });

  it('rejects as soon as accumulated chunks exceed the cap, without keeping the extra chunk', async () => {
    const first = new Uint8Array(1000).fill(0x61);
    const extra = new Uint8Array(100).fill(0x62);
    let cancelled = false;
    let index = 0;
    const chunks = [first, extra];
    const req = {
      headers: new Headers(),
      body: {
        getReader() {
          return {
            async read() {
              if (index >= chunks.length) return { done: true as const, value: undefined };
              const value = chunks[index];
              index += 1;
              return { done: false as const, value };
            },
            async cancel() {
              cancelled = true;
              index = chunks.length;
            },
          };
        },
      },
    } as unknown as Request;

    await expect(readRequestBytes(req)).rejects.toBeInstanceOf(PayloadTooLargeError);
    expect(cancelled).toBe(true);
  });

  it('names a body-read failure rather than JSON when the stream errors', async () => {
    const req = {
      headers: new Headers(),
      body: {
        getReader() {
          return {
            async read() {
              throw new Error('stream interrupted');
            },
            async cancel() {},
          };
        },
      },
    } as unknown as Request;

    await expect(readRequestBytes(req)).rejects.toMatchObject({
      name: 'RequestBodyUnreadableError',
      message: 'Could not read the request body',
    });
  });
});
