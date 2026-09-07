import { jest } from '@jest/globals';
import { withBundledFallback } from './fallback.js';

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
    const cause = new Error('getaddrinfo ENOTFOUND untp.unece.org');
    const result = (await withBundledFallback(BUNDLED, { onBundledFallback }, async () => {
      throw cause;
    })) as object;
    expect(JSON.stringify(result)).toContain('DigitalProductPassport');
    expect(onBundledFallback).toHaveBeenCalledWith({ url: BUNDLED, cause });
  });

  it('rethrows when the URL is not bundled', async () => {
    const cause = new Error('boom');
    await expect(
      withBundledFallback(UNBUNDLED, {}, async () => {
        throw cause;
      }),
    ).rejects.toBe(cause);
  });

  it('rethrows when the fallback is switched off, even for a bundled URL', async () => {
    const cause = new Error('boom');
    const onBundledFallback = jest.fn();
    await expect(
      withBundledFallback(BUNDLED, { bundledFallback: false, onBundledFallback }, async () => {
        throw cause;
      }),
    ).rejects.toBe(cause);
    expect(onBundledFallback).not.toHaveBeenCalled();
  });
});
