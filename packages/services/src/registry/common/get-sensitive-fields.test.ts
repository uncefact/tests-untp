import { getSensitiveFields } from './get-sensitive-fields.js';

// jose is ESM-only; mock it so the registry import chain can load the VC adapter module
jest.mock('jose', () => ({
  decodeJwt: jest.fn(),
}));

describe('getSensitiveFields', () => {
  it('returns sensitiveFields for VCKit DID adapter (contains "authToken")', () => {
    const fields = getSensitiveFields('VCKIT');
    expect(fields).toContain('authToken');
  });

  it('returns sensitiveFields for PYX_IDR adapter (contains "apiKey")', () => {
    const fields = getSensitiveFields('PYX_IDR');
    expect(fields).toContain('apiKey');
  });

  it('returns sensitiveFields for UNCEFACT_STORAGE adapter (contains "apiKey")', () => {
    const fields = getSensitiveFields('UNCEFACT_STORAGE');
    expect(fields).toContain('apiKey');
  });

  it('returns an empty array for an unknown adapter type', () => {
    const fields = getSensitiveFields('NONEXISTENT_ADAPTER');
    expect(fields).toEqual([]);
  });

  it('returns an array (not undefined or null) for every known adapter type', () => {
    for (const adapterType of ['VCKIT', 'PYX_IDR', 'UNCEFACT_STORAGE']) {
      const fields = getSensitiveFields(adapterType);
      expect(Array.isArray(fields)).toBe(true);
    }
  });
});
