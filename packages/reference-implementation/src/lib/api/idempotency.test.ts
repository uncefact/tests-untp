import { TextEncoder } from 'node:util';
import { ConflictError, UnprocessableError } from '@/lib/api/errors';
import {
  IDEMPOTENCY_KEY_IN_FLIGHT_MESSAGE,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_KEY_MISMATCH_MESSAGE,
  digestRequestBody,
  parseIdempotencyKeyHeader,
  throwIdempotencyClassification,
} from './idempotency';

function headerRequest(value: string | null): Request {
  return {
    headers: {
      get(name: string) {
        if (value === null) return null;
        return name.toLowerCase() === 'idempotency-key' ? value : null;
      },
    },
  } as unknown as Request;
}

describe('parseIdempotencyKeyHeader', () => {
  it('returns undefined when the header is absent', () => {
    expect(parseIdempotencyKeyHeader(headerRequest(null))).toBeUndefined();
  });

  it('returns the trimmed value for a printable key', () => {
    expect(parseIdempotencyKeyHeader(headerRequest('  pipeline-retry-1  '))).toBe('pipeline-retry-1');
  });

  it('accepts a 255-character key and rejects a 256-character one', () => {
    const accepted = 'k'.repeat(255);
    const rejected = 'k'.repeat(256);

    expect(accepted.length).toBe(IDEMPOTENCY_KEY_MAX_LENGTH);
    expect(parseIdempotencyKeyHeader(headerRequest(accepted))).toBe(accepted);
    expect(() => parseIdempotencyKeyHeader(headerRequest(rejected))).toThrow(
      `Idempotency-Key must be a non-blank string of at most ${IDEMPOTENCY_KEY_MAX_LENGTH} characters`,
    );
  });

  it('rejects a blank header with a message derived from the length constant', () => {
    expect(() => parseIdempotencyKeyHeader(headerRequest('   '))).toThrow(
      `Idempotency-Key must be a non-blank string of at most ${IDEMPOTENCY_KEY_MAX_LENGTH} characters`,
    );
  });

  it.each([
    ['newline', 'retry-1\nmore'],
    ['carriage return', 'retry-1\rmore'],
    ['tab', 'retry-1\tmore'],
    ['NUL', 'retry-1\x00more'],
    ['DEL', 'retry-1\x7Fmore'],
  ])('rejects a key containing a %s with the named charset message', (_label, value) => {
    expect(() => parseIdempotencyKeyHeader(headerRequest(value))).toThrow(
      'Idempotency-Key must contain only printable ASCII characters',
    );
  });

  it('accepts punctuation within printable ASCII', () => {
    expect(parseIdempotencyKeyHeader(headerRequest('key:value/ok+1=~'))).toBe('key:value/ok+1=~');
  });
});

describe('digestRequestBody', () => {
  it('returns a zTEST digest and is stable for the same bytes', async () => {
    const bytes = new TextEncoder().encode('{"credentialType":"DigitalProductPassport"}');
    const first = await digestRequestBody(bytes);
    const second = await digestRequestBody(bytes);

    expect(first).toMatch(/^zTEST[a-f0-9]{64}$/);
    expect(second).toBe(first);
  });

  it('differs for the same JSON with different whitespace', async () => {
    const compact = await digestRequestBody(new TextEncoder().encode('{"a":1}'));
    const spaced = await digestRequestBody(new TextEncoder().encode('{\n  "a": 1\n}'));

    expect(compact).not.toBe(spaced);
  });

  it('differs for a BOM-prefixed body compared with the same body without a BOM', async () => {
    const body = '{"a":1}';
    const plain = await digestRequestBody(new TextEncoder().encode(body));
    const withBom = await digestRequestBody(new TextEncoder().encode(`\uFEFF${body}`));

    expect(plain).not.toBe(withBom);
  });

  it('differs for two bodies that share an eight-byte prefix', async () => {
    // Eight shared leading bytes. A prefix encoding would treat these as equal.
    const a = await digestRequestBody(new TextEncoder().encode('abcdefgh-one-body'));
    const b = await digestRequestBody(new TextEncoder().encode('abcdefgh-two-body'));

    expect(a).not.toBe(b);
  });
});

describe('throwIdempotencyClassification', () => {
  it('throws UnprocessableError with the mismatch message and code', () => {
    try {
      throwIdempotencyClassification('mismatch');
    } catch (error) {
      expect(error).toBeInstanceOf(UnprocessableError);
      expect(error).toMatchObject({
        message: IDEMPOTENCY_KEY_MISMATCH_MESSAGE,
        code: 'IDEMPOTENCY_KEY_MISMATCH',
      });
      return;
    }
    throw new Error('expected throwIdempotencyClassification to throw');
  });

  it('throws ConflictError with the in-flight message and code', () => {
    try {
      throwIdempotencyClassification('in-flight');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictError);
      expect(error).toMatchObject({
        message: IDEMPOTENCY_KEY_IN_FLIGHT_MESSAGE,
        code: 'IDEMPOTENCY_KEY_IN_FLIGHT',
      });
      return;
    }
    throw new Error('expected throwIdempotencyClassification to throw');
  });
});
