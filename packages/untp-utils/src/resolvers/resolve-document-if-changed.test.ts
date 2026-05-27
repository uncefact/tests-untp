import { jest } from '@jest/globals';
import { MultibaseDigest } from '../multibase-digest/index.js';
import { ResolverNetworkError } from './errors.js';

const resolveDocument = jest.fn();

jest.unstable_mockModule('./resolve-document.js', () => ({
  resolveDocument,
}));

const { resolveDocumentIfChanged } = await import('./resolve-document-if-changed.js');

async function digestOf(text: string) {
  return MultibaseDigest.fromData(new TextEncoder().encode(text), { algorithm: 'sha2-256', base: 'base58btc' });
}

function loadResult(
  overrides: Partial<{ status: number; body: Uint8Array; finalUrl: string; bodyDigest: MultibaseDigest }>,
) {
  return {
    status: 200,
    body: new Uint8Array(0),
    finalUrl: '',
    bodyDigest: overrides.bodyDigest,
    ...overrides,
  };
}

describe('resolveDocumentIfChanged', () => {
  beforeEach(() => {
    resolveDocument.mockReset();
  });

  describe('conditional headers', () => {
    it('sends If-None-Match when cached.etag is supplied', async () => {
      resolveDocument.mockResolvedValue(loadResult({ status: 304, bodyDigest: await digestOf('') }) as never);

      await resolveDocumentIfChanged('https://example.com/', { etag: '"abc"' });

      const passedOptions = resolveDocument.mock.calls[0][1] as { headers: Record<string, string> };
      expect(passedOptions.headers['if-none-match']).toBe('"abc"');
    });

    it('sends If-Modified-Since when cached.lastModifiedHeader is supplied', async () => {
      const ts = 'Wed, 21 May 2026 12:00:00 GMT';
      resolveDocument.mockResolvedValue(loadResult({ status: 304, bodyDigest: await digestOf('') }) as never);

      await resolveDocumentIfChanged('https://example.com/', { lastModifiedHeader: ts });

      const passedOptions = resolveDocument.mock.calls[0][1] as { headers: Record<string, string> };
      expect(passedOptions.headers['if-modified-since']).toBe(ts);
    });

    it('preserves caller-supplied headers alongside conditional ones', async () => {
      resolveDocument.mockResolvedValue(loadResult({ status: 304, bodyDigest: await digestOf('') }) as never);

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
      resolveDocument.mockResolvedValue(loadResult({ status: 304, bodyDigest: await digestOf('') }) as never);

      await resolveDocumentIfChanged(
        'https://example.com/',
        { etag: '"new"' },
        // Caller passes a stale variant under a differently-cased key.
        // The cached etag must win and only one normalised header lands on the wire.
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
    it('returns { kind: "unchanged" } on a 304 response', async () => {
      resolveDocument.mockResolvedValue(loadResult({ status: 304, bodyDigest: await digestOf('') }) as never);

      await expect(resolveDocumentIfChanged('https://example.com/', { etag: '"abc"' })).resolves.toEqual({
        kind: 'unchanged',
      });
    });

    it('returns { kind: "unchanged" } on a 200 response whose body digest matches the cached one', async () => {
      const digest = await digestOf('same content');
      resolveDocument.mockResolvedValue(
        loadResult({ status: 200, body: new TextEncoder().encode('same content'), bodyDigest: digest }) as never,
      );

      await expect(resolveDocumentIfChanged('https://example.com/', { bodyDigest: digest })).resolves.toEqual({
        kind: 'unchanged',
      });
    });

    it('returns { kind: "loaded", result } on a 200 response with a different body digest', async () => {
      const oldDigest = await digestOf('old content');
      const newDigest = await digestOf('new content');
      const result = loadResult({
        status: 200,
        body: new TextEncoder().encode('new content'),
        finalUrl: 'https://example.com/',
        bodyDigest: newDigest,
      });
      resolveDocument.mockResolvedValue(result as never);

      await expect(resolveDocumentIfChanged('https://example.com/', { bodyDigest: oldDigest })).resolves.toEqual({
        kind: 'loaded',
        result,
      });
    });

    it('returns { kind: "loaded", result } on a 200 response when no cached body digest is supplied', async () => {
      const result = loadResult({
        status: 200,
        body: new TextEncoder().encode('fresh'),
        finalUrl: 'https://example.com/',
        bodyDigest: await digestOf('fresh'),
      });
      resolveDocument.mockResolvedValue(result as never);

      await expect(resolveDocumentIfChanged('https://example.com/', { etag: '"abc"' })).resolves.toEqual({
        kind: 'loaded',
        result,
      });
    });
  });

  describe('error propagation', () => {
    it('propagates errors thrown by the underlying resolveDocument call', async () => {
      resolveDocument.mockRejectedValue(new ResolverNetworkError('https://example.com/', new Error('boom')) as never);

      await expect(resolveDocumentIfChanged('https://example.com/', {})).rejects.toBeInstanceOf(ResolverNetworkError);
    });
  });
});
