import { jest } from '@jest/globals';
import { ResolverHttpError, ResolverInvalidJsonError } from './errors.js';

const resolveDocument = jest.fn();

jest.unstable_mockModule('./resolve-document.js', () => ({
  resolveDocument,
}));

const { resolveJsonDocument } = await import('./resolve-json-document.js');

const encode = (s: string) => new TextEncoder().encode(s);

describe('resolveJsonDocument', () => {
  beforeEach(() => {
    resolveDocument.mockReset();
  });

  it('fetches through resolveDocument and returns the parsed JSON with the final URL', async () => {
    resolveDocument.mockResolvedValue({ body: encode('{"a":1}'), finalUrl: 'https://ex.test/doc' } as never);

    await expect(resolveJsonDocument('https://ex.test/doc')).resolves.toEqual({
      json: { a: 1 },
      finalUrl: 'https://ex.test/doc',
    });
  });

  it('defaults the Accept header to application/json', async () => {
    resolveDocument.mockResolvedValue({ body: encode('{}'), finalUrl: 'https://ex.test/doc' } as never);

    await resolveJsonDocument('https://ex.test/doc');

    expect(resolveDocument).toHaveBeenCalledWith(
      'https://ex.test/doc',
      expect.objectContaining({ headers: expect.objectContaining({ Accept: 'application/json' }) }),
    );
  });

  it('sends the supplied accept value', async () => {
    resolveDocument.mockResolvedValue({ body: encode('{}'), finalUrl: 'https://ex.test/doc' } as never);

    await resolveJsonDocument('https://ex.test/doc', { accept: 'application/ld+json' });

    expect(resolveDocument).toHaveBeenCalledWith(
      'https://ex.test/doc',
      expect.objectContaining({ headers: expect.objectContaining({ Accept: 'application/ld+json' }) }),
    );
  });

  it('lets an explicit headers.Accept override the accept option', async () => {
    resolveDocument.mockResolvedValue({ body: encode('{}'), finalUrl: 'https://ex.test/doc' } as never);

    await resolveJsonDocument('https://ex.test/doc', {
      accept: 'application/ld+json',
      headers: { Accept: 'application/schema+json' },
    });

    expect(resolveDocument).toHaveBeenCalledWith(
      'https://ex.test/doc',
      expect.objectContaining({ headers: expect.objectContaining({ Accept: 'application/schema+json' }) }),
    );
  });

  it('lets a lowercase accept header key take precedence without duplicating the header', async () => {
    resolveDocument.mockResolvedValue({ body: encode('{}'), finalUrl: 'https://ex.test/doc' } as never);

    await resolveJsonDocument('https://ex.test/doc', {
      accept: 'application/ld+json',
      headers: { accept: 'application/schema+json' },
    });

    expect(resolveDocument).toHaveBeenCalledWith(
      'https://ex.test/doc',
      expect.objectContaining({ headers: { accept: 'application/schema+json' } }),
    );
  });

  it('forwards resolver options (allowedSchemes, size/timeout bounds) unchanged', async () => {
    resolveDocument.mockResolvedValue({ body: encode('{}'), finalUrl: 'https://ex.test/doc' } as never);

    await resolveJsonDocument('https://ex.test/doc', { allowedSchemes: ['https'], maxResponseBytes: 2048 });

    expect(resolveDocument).toHaveBeenCalledWith(
      'https://ex.test/doc',
      expect.objectContaining({ allowedSchemes: ['https'], maxResponseBytes: 2048 }),
    );
  });

  it('throws ResolverInvalidJsonError when the body is not valid JSON', async () => {
    resolveDocument.mockResolvedValue({ body: encode('not json'), finalUrl: 'https://ex.test/doc' } as never);

    const error = (await resolveJsonDocument('https://ex.test/doc').catch(
      (e: unknown) => e,
    )) as ResolverInvalidJsonError;
    expect(error).toBeInstanceOf(ResolverInvalidJsonError);
    expect(error.url).toBe('https://ex.test/doc');
  });

  it('propagates resolveDocument errors (SSRF guard, HTTP, timeout) unchanged', async () => {
    const httpError = new ResolverHttpError('https://ex.test/doc', 404);
    resolveDocument.mockRejectedValue(httpError as never);

    await expect(resolveJsonDocument('https://ex.test/doc')).rejects.toBe(httpError);
  });
});
