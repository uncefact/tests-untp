import { jest } from '@jest/globals';
import { isHostDeliveryFailure, withBundledFallback } from './fallback.js';
import { ResolverHttpError, ResolverNetworkError } from '../resolvers/errors.js';
import { PrivateAddressError, ResolutionEmptyError, ResolutionFailedError } from '../node/errors.js';
import { SchemaLoaderNetworkError } from '../loaders/errors.js';

const BUNDLED = 'https://untp.unece.org/artefacts/schema/v0.7.0/dpp/DigitalProductPassport.json';
const UNBUNDLED = 'https://untp.unece.org/artefacts/schema/v9.9.9/dpp/DigitalProductPassport.json';

describe('withBundledFallback', () => {
  it('returns the fetched value and never consults the bundle when the fetch succeeds', async () => {
    const onBundledFallback = jest.fn();
    const result = await withBundledFallback(BUNDLED, { onBundledFallback }, async () => ({ fetched: true }));
    expect(result).toEqual({ fetched: true });
    expect(onBundledFallback).not.toHaveBeenCalled();
  });

  it('serves the bundled copy and reports the cause when the fetch of a bundled URL fails', async () => {
    const onBundledFallback = jest.fn();
    const cause = new ResolverNetworkError(BUNDLED, new Error('getaddrinfo ENOTFOUND untp.unece.org'));
    const result = (await withBundledFallback(BUNDLED, { onBundledFallback }, async () => {
      throw cause;
    })) as object;
    expect(JSON.stringify(result)).toContain('DigitalProductPassport');
    expect(onBundledFallback).toHaveBeenCalledWith({ url: BUNDLED, cause });
  });

  it('rethrows when the URL is not bundled', async () => {
    const cause = new ResolverHttpError(UNBUNDLED, 503);
    await expect(
      withBundledFallback(UNBUNDLED, {}, async () => {
        throw cause;
      }),
    ).rejects.toBe(cause);
  });

  it('rethrows when the fallback is switched off, even for a bundled URL', async () => {
    const cause = new ResolverHttpError(BUNDLED, 503);
    const onBundledFallback = jest.fn();
    await expect(
      withBundledFallback(BUNDLED, { bundledFallback: false, onBundledFallback }, async () => {
        throw cause;
      }),
    ).rejects.toBe(cause);
    expect(onBundledFallback).not.toHaveBeenCalled();
  });

  it('serves the copy when the host name stops resolving, bare (the JSON-LD path)', async () => {
    const onBundledFallback = jest.fn();
    const dns = new ResolutionFailedError('untp.unece.org', new Error('getaddrinfo ENOTFOUND untp.unece.org'));
    const result = await withBundledFallback(BUNDLED, { onBundledFallback }, async () => {
      throw dns;
    });
    expect(JSON.stringify(result)).toContain('DigitalProductPassport');
    expect(onBundledFallback).toHaveBeenCalledWith({ url: BUNDLED, cause: dns });
  });

  it('hands back a fresh copy each time, so a caller mutating one cannot poison the next', async () => {
    const first = (await withBundledFallback(BUNDLED, {}, async () => {
      throw new ResolverHttpError(BUNDLED, 503);
    })) as { required?: string[] };
    first.required = ['mutated'];
    const second = (await withBundledFallback(BUNDLED, {}, async () => {
      throw new ResolverHttpError(BUNDLED, 503);
    })) as { required?: string[] };
    expect(second.required).not.toEqual(['mutated']);
  });

  it('never covers a URL the SSRF guard refused, even when wrapped by the schema loader', async () => {
    const onBundledFallback = jest.fn();
    const guard = new PrivateAddressError(BUNDLED, ['10.0.0.5']);
    await expect(
      withBundledFallback(BUNDLED, { onBundledFallback }, async () => {
        throw guard;
      }),
    ).rejects.toBe(guard);
    const wrapped = new SchemaLoaderNetworkError(BUNDLED, guard);
    await expect(
      withBundledFallback(BUNDLED, { onBundledFallback }, async () => {
        throw wrapped;
      }),
    ).rejects.toBe(wrapped);
    expect(onBundledFallback).not.toHaveBeenCalled();
  });

  it('never covers an error that is not a typed resolver or loader failure', async () => {
    const bug = new TypeError('cannot read properties of undefined');
    await expect(
      withBundledFallback(BUNDLED, {}, async () => {
        throw bug;
      }),
    ).rejects.toBe(bug);
  });

  it('still serves the copy when the listener throws', async () => {
    const result = await withBundledFallback(
      BUNDLED,
      {
        onBundledFallback: () => {
          throw new Error('logger down');
        },
      },
      async () => {
        throw new ResolverHttpError(BUNDLED, 403);
      },
    );
    expect(JSON.stringify(result)).toContain('DigitalProductPassport');
  });
});

describe('isHostDeliveryFailure', () => {
  it.each([
    ['resolver network', new ResolverNetworkError(BUNDLED, new Error('ENOTFOUND')), true],
    ['resolver http 403', new ResolverHttpError(BUNDLED, 403), true],
    [
      'DNS resolution failed (the founding outage)',
      new ResolutionFailedError('untp.unece.org', new Error('ENOTFOUND')),
      true,
    ],
    ['DNS resolution empty', new ResolutionEmptyError('untp.unece.org'), true],
    [
      'contradictory resolver metadata',
      new ResolutionFailedError('untp.unece.org', new Error('address does not match family')),
      true,
    ],
    [
      'DNS failure wrapped by the schema loader',
      new SchemaLoaderNetworkError(BUNDLED, new ResolutionFailedError('untp.unece.org', new Error('ENOTFOUND'))),
      false,
    ],
    [
      'schema loader network (never classified any more)',
      new SchemaLoaderNetworkError(BUNDLED, new Error('ENOTFOUND')),
      false,
    ],
    ['guard rejection', new PrivateAddressError(BUNDLED, ['127.0.0.1']), false],
    [
      'guard rejection wrapped',
      new SchemaLoaderNetworkError(BUNDLED, new PrivateAddressError(BUNDLED, ['127.0.0.1'])),
      false,
    ],
    ['plain Error', new Error('boom'), false],
    ['TypeError', new TypeError('boom'), false],
    ['not an error', 'boom', false],
  ])('%s -> %s', (_label, error, expected) => {
    expect(isHostDeliveryFailure(error)).toBe(expected);
  });
});
