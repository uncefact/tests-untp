import { fetchSchema, schemaCache, SchemaFetchError } from '@/lib/schemaFetch';
import { schemaCache as credentialSchemaCache } from '@/lib/schemaValidation';
import { validateCredentialSchema } from '@/lib/schemaValidation';
import { SchemaFetchError as SchemeSchemaFetchError, validateSchemeSchema } from '@/lib/schemeValidation';
import { classifySchemaFetchFailure } from '@/lib/artefactFailure';
import { buildUntpArtefactUrls } from '@uncefact/untp-utils/artefacts';

jest.mock('@uncefact/untp-utils/artefacts', () => {
  const actual = jest.requireActual('@uncefact/untp-utils/artefacts');
  return { ...actual, buildUntpArtefactUrls: jest.fn(actual.buildUntpArtefactUrls) };
});

const URL_A = 'https://untp.unece.org/artefacts/schema/v0.7.0/idr/LinksetSchema.json';
const URL_B = 'https://untp.unece.org/artefacts/schema/v0.7.1/idr/LinksetSchema.json';

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

describe('schemaFetch', () => {
  const originalFetch = global.fetch;
  afterEach(async () => {
    global.fetch = originalFetch;
    await schemaCache.clear();
    jest.restoreAllMocks();
  });

  it('shares one cache and one error class with the scheme and credential validators', () => {
    // Identity, not shape: SchemeTestResults narrows with `instanceof` through schemeValidation,
    // and the credential validator's tests clear the cache through schemaValidation.
    expect(SchemeSchemaFetchError).toBe(SchemaFetchError);
    expect(credentialSchemaCache).toBe(schemaCache);
  });

  it('requests the schema through the guarded proxy and caches the parsed body', async () => {
    const fetchMock = jest.fn().mockResolvedValue(okResponse({ $id: 'a' }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(fetchSchema(URL_A)).resolves.toEqual({ $id: 'a' });
    await expect(fetchSchema(URL_A)).resolves.toEqual({ $id: 'a' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/schema?url=${encodeURIComponent(URL_A)}`);
  });

  it('shares one in-flight request between concurrent callers for the same URL', async () => {
    let release: (value: Response) => void = () => {};
    const fetchMock = jest.fn().mockReturnValue(new Promise<Response>((resolve) => (release = resolve)));
    global.fetch = fetchMock as unknown as typeof fetch;

    const first = fetchSchema(URL_A);
    const second = fetchSchema(URL_A);
    release(okResponse({ $id: 'shared' }));

    await expect(Promise.all([first, second])).resolves.toEqual([{ $id: 'shared' }, { $id: 'shared' }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps different versions apart in the cache', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(okResponse({ $id: 'a' }))
      .mockResolvedValueOnce(okResponse({ $id: 'b' }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(fetchSchema(URL_A)).resolves.toEqual({ $id: 'a' });
    await expect(fetchSchema(URL_B)).resolves.toEqual({ $id: 'b' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('evicts a failed request so a retry can succeed', async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(okResponse({ $id: 'recovered' }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(fetchSchema(URL_A)).rejects.toMatchObject({ name: 'SchemaFetchError', reason: 'network' });
    await expect(fetchSchema(URL_A)).resolves.toEqual({ $id: 'recovered' });
    await expect(schemaCache.get(URL_A, () => Promise.reject(new Error('not cached')))).resolves.toEqual({
      $id: 'recovered',
    });
  });

  it.each([
    [
      { ok: false, status: 502, json: async () => ({ error: 'Schema host returned status 403', upstreamStatus: 403 }) },
      'not-found',
    ],
    [{ ok: false, status: 502, json: async () => ({ error: 'not JSON', code: 'invalid-json' }) }, 'parse'],
    [{ ok: false, status: 502, json: async () => ({ error: 'Schema host unreachable' }) }, 'network'],
    [
      {
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('bad');
        },
      },
      'unreadable-response',
    ],
  ])('maps the proxy answer %#: reason %s', async (response, reason) => {
    global.fetch = jest.fn().mockResolvedValue(response) as unknown as typeof fetch;
    await expect(fetchSchema(URL_A)).rejects.toMatchObject({ name: 'SchemaFetchError', reason, schemaUrl: URL_A });
    // A failure is never stored: the next call goes to the loader again.
    const loader = jest.fn().mockResolvedValue({ $id: 'fresh' });
    await expect(schemaCache.get(URL_A, loader)).resolves.toEqual({ $id: 'fresh' });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('reports a timeout when the proxy does not answer in time', async () => {
    jest.useFakeTimers();
    try {
      global.fetch = jest.fn().mockImplementation((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        });
      }) as unknown as typeof fetch;

      const pending = fetchSchema(URL_A);
      const expectation = expect(pending).rejects.toMatchObject({ name: 'SchemaFetchError', reason: 'timeout' });
      jest.advanceTimersByTime(15_000);
      await expectation;
    } finally {
      jest.useRealTimers();
    }
  });

  it('classifies an abort while the body is still streaming as a timeout, not invalid JSON', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      },
    }) as unknown as typeof fetch;
    await expect(fetchSchema(URL_A)).rejects.toMatchObject({ name: 'SchemaFetchError', reason: 'timeout' });
  });

  it.each([
    [200, true],
    [502, false],
  ])('times out a body read after a %s response', async (status, ok) => {
    jest.useFakeTimers();
    try {
      global.fetch = jest.fn().mockImplementation((_url: string, init: RequestInit) =>
        Promise.resolve({
          ok,
          status,
          json: () =>
            new Promise((_resolve, reject) => {
              init.signal?.addEventListener('abort', () =>
                reject(Object.assign(new Error('body read aborted'), { name: 'AbortError' })),
              );
            }),
        }),
      ) as unknown as typeof fetch;

      const pending = fetchSchema(`${URL_A}-${status}`);
      await Promise.resolve();
      await Promise.resolve();
      jest.advanceTimersByTime(15_000);
      const error = await pending.catch((caught: unknown) => caught);
      expect(error).toMatchObject({
        name: 'SchemaFetchError',
        reason: 'timeout',
        serviceStatus: status,
      });
      expect(classifySchemaFetchFailure(error as SchemaFetchError)).toMatchObject({
        class: 'could-not-fetch',
        code: 'schema.fetch.timeout',
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([
    ['scheme', 'credential'],
    ['credential', 'scheme'],
  ])('shares one rejected SchemaFetchError instance when %s arrives first', async (first, second) => {
    const sharedUrl = 'https://example.test/shared-schema.json';
    (buildUntpArtefactUrls as jest.Mock).mockReturnValue({
      schemaUrl: sharedUrl,
      contextUrl: 'https://example.test/context.jsonld',
    } as any);
    let rejectFetch: (reason?: unknown) => void = () => {};
    global.fetch = jest.fn().mockReturnValue(
      new Promise<Response>((_resolve, reject) => {
        rejectFetch = reject;
      }),
    ) as unknown as typeof fetch;

    const calls = {
      scheme: () => validateSchemeSchema({}, '0.7.0').catch((error: unknown) => error),
      credential: () =>
        validateCredentialSchema({
          '@context': ['https://vocabulary.uncefact.org/untp/dpp/0.7.0/context/'],
          type: ['VerifiableCredential', 'DigitalProductPassport'],
        }).catch((error: unknown) => error),
    };
    const firstError = calls[first as 'scheme' | 'credential']();
    const secondError = calls[second as 'scheme' | 'credential']();
    rejectFetch(new Error('shared network failure'));

    const [left, right] = await Promise.all([firstError, secondError]);
    expect(left).toBe(right);
    expect(left).toMatchObject({
      name: 'SchemaFetchError',
      category: 'uncoded',
      reason: 'network',
    });
  });
});
