import { TextEncoder } from 'util';
import { webcrypto } from 'crypto';
import { computeDigestMultibase } from './helpers';

// jsdom doesn't provide TextEncoder or crypto.subtle
// eslint-disable-next-line @typescript-eslint/no-explicit-any
global.TextEncoder = TextEncoder as any;
Object.defineProperty(global, 'crypto', { value: webcrypto });

// The helper is a thin wrapper around `MultibaseDigest.fromData` from
// `@uncefact/untp-utils`. Round-trip multibase encoding coverage (correct
// multihash prefix, base58btc encoding, fixture-based byte assertions) lives
// in untp-utils so the canonical implementation is exercised once. Tests
// here only assert the wrapper's structural contract (returns a string,
// consistent for same input, varies across inputs).

describe('computeDigestMultibase', () => {
  it('returns a non-empty string', async () => {
    const result = await computeDigestMultibase({ content: 'hello' });
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('produces consistent results for the same input', async () => {
    const a = await computeDigestMultibase({ content: 'test content' });
    const b = await computeDigestMultibase({ content: 'test content' });
    expect(a).toBe(b);
  });

  it('produces different results for different inputs', async () => {
    const a = await computeDigestMultibase({ content: 'input one' });
    const b = await computeDigestMultibase({ content: 'input two' });
    expect(a).not.toBe(b);
  });
});
