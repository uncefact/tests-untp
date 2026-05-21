import { jest } from '@jest/globals';
import { MultibaseDigest } from '../multibase-digest/index.js';

const resolveDocument = jest.fn();

jest.unstable_mockModule('./resolve-document.js', () => ({
  resolveDocument,
}));

const { resolveDocumentIfChanged } = await import('./resolve-document-if-changed.js');

async function digestOf(text: string) {
  return MultibaseDigest.fromData(new TextEncoder().encode(text), { algorithm: 'sha2-256', base: 'base58btc' });
}

describe('resolveDocumentIfChanged', () => {
  beforeEach(() => {
    resolveDocument.mockReset();
  });

  describe('conditional headers', () => {
    it('sends If-None-Match when cached.etag is supplied', async () => {
      resolveDocument.mockResolvedValue({
        value: { status: 304, body: new Uint8Array(0), finalUrl: '', bodyDigest: await digestOf('') },
        errors: [],
        warnings: [],
      } as never);

      await resolveDocumentIfChanged('https://example.com/', { etag: '"abc"' });

      const passedOptions = resolveDocument.mock.calls[0][1] as { headers: Record<string, string> };
      expect(passedOptions.headers['if-none-match']).toBe('"abc"');
    });

    it('sends If-Modified-Since when cached.lastModifiedHeader is supplied', async () => {
      const ts = 'Wed, 21 May 2026 12:00:00 GMT';
      resolveDocument.mockResolvedValue({
        value: { status: 304, body: new Uint8Array(0), finalUrl: '', bodyDigest: await digestOf('') },
        errors: [],
        warnings: [],
      } as never);

      await resolveDocumentIfChanged('https://example.com/', { lastModifiedHeader: ts });

      const passedOptions = resolveDocument.mock.calls[0][1] as { headers: Record<string, string> };
      expect(passedOptions.headers['if-modified-since']).toBe(ts);
    });

    it('preserves caller-supplied headers alongside conditional ones', async () => {
      resolveDocument.mockResolvedValue({
        value: { status: 304, body: new Uint8Array(0), finalUrl: '', bodyDigest: await digestOf('') },
        errors: [],
        warnings: [],
      } as never);

      await resolveDocumentIfChanged(
        'https://example.com/',
        { etag: '"abc"' },
        { headers: { Accept: 'application/json' } },
      );

      const passedOptions = resolveDocument.mock.calls[0][1] as { headers: Record<string, string> };
      expect(passedOptions.headers['accept']).toBe('application/json');
      expect(passedOptions.headers['if-none-match']).toBe('"abc"');
    });

    it('does not emit duplicate conditional headers when the caller supplies a differently-cased variant', async () => {
      resolveDocument.mockResolvedValue({
        value: { status: 304, body: new Uint8Array(0), finalUrl: '', bodyDigest: await digestOf('') },
        errors: [],
        warnings: [],
      } as never);

      await resolveDocumentIfChanged(
        'https://example.com/',
        { etag: '"new"' },
        // Caller passes a stale variant under a differently-cased key.
        // The cached etag must win and only one normalised header must end up on the wire.
        { headers: { 'IF-NONE-MATCH': '"stale"' } },
      );

      const passedOptions = resolveDocument.mock.calls[0][1] as { headers: Record<string, string> };
      const keys = Object.keys(passedOptions.headers);
      const ifNoneMatchKeys = keys.filter((k) => k.toLowerCase() === 'if-none-match');
      expect(ifNoneMatchKeys).toEqual(['if-none-match']);
      expect(passedOptions.headers['if-none-match']).toBe('"new"');
    });
  });

  describe('skip chain', () => {
    it('returns unchanged on a 304 response', async () => {
      resolveDocument.mockResolvedValue({
        value: { status: 304, body: new Uint8Array(0), finalUrl: '', bodyDigest: await digestOf('') },
        errors: [],
        warnings: [],
      } as never);

      const outcome = await resolveDocumentIfChanged('https://example.com/', { etag: '"abc"' });

      expect(outcome.value).toEqual({ kind: 'unchanged' });
    });

    it('returns unchanged on a 200 response whose body digest matches the cached one', async () => {
      const digest = await digestOf('same content');
      resolveDocument.mockResolvedValue({
        value: {
          status: 200,
          body: new TextEncoder().encode('same content'),
          finalUrl: '',
          bodyDigest: digest,
        },
        errors: [],
        warnings: [],
      } as never);

      const outcome = await resolveDocumentIfChanged('https://example.com/', { bodyDigest: digest });

      expect(outcome.value).toEqual({ kind: 'unchanged' });
    });

    it('returns the LoadResult on a 200 response with a different body digest', async () => {
      const oldDigest = await digestOf('old content');
      const newDigest = await digestOf('new content');
      const value = {
        status: 200,
        body: new TextEncoder().encode('new content'),
        finalUrl: 'https://example.com/',
        bodyDigest: newDigest,
      };
      resolveDocument.mockResolvedValue({ value, errors: [], warnings: [] } as never);

      const outcome = await resolveDocumentIfChanged('https://example.com/', { bodyDigest: oldDigest });

      expect(outcome.value).toEqual({ kind: 'loaded', result: value });
    });

    it('returns the LoadResult on a 200 response when no cached body digest is supplied', async () => {
      const value = {
        status: 200,
        body: new TextEncoder().encode('fresh'),
        finalUrl: 'https://example.com/',
        bodyDigest: await digestOf('fresh'),
      };
      resolveDocument.mockResolvedValue({ value, errors: [], warnings: [] } as never);

      const outcome = await resolveDocumentIfChanged('https://example.com/', { etag: '"abc"' });

      expect(outcome.value).toEqual({ kind: 'loaded', result: value });
    });
  });

  describe('error propagation', () => {
    it('propagates errors from the underlying resolveDocument call', async () => {
      resolveDocument.mockResolvedValue({
        errors: [{ code: 'resolver.network-error', message: 'boom' }],
        warnings: [],
      } as never);

      const outcome = await resolveDocumentIfChanged('https://example.com/', {});

      expect(outcome.value).toBeUndefined();
      expect(outcome.errors[0]).toEqual(expect.objectContaining({ code: 'resolver.network-error' }));
    });
  });
});
